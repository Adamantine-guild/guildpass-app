#!/usr/bin/env tsx
/**
 * Lightweight SQL migration runner for the GuildPass dashboard.
 *
 * Usage:
 *   pnpm db:migrate                       # Run all pending migrations
 *   DATABASE_URL=... pnpm db:migrate      # With explicit connection
 *
 * Behaviour:
 *   1. Connects to DATABASE_URL
 *   2. Creates a `_migrations` tracking table if it does not exist
 *   3. Scans `migrations/` for *.sql files, sorted by filename
 *   4. Runs any that have not been applied, recording each in `_migrations`
 *   5. Idempotent — safe to run repeatedly
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { backfillActivityHashChain } from "./migrations/activity-hash-chain.js";

const { Client } = pg;

const DATA_MIGRATIONS = new Map<
  string,
  (client: pg.ClientBase) => Promise<void>
>([
  ["0002_activity_hash_chain.sql", backfillActivityHashChain],
]);

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL is not set. Cannot run migrations.");
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    // Serialize migration runners. The activity-chain backfill must never be
    // replayed by a second runner using a stale pending list. This
    // session-level lock is released automatically when the client ends.
    await client.query(
      "SELECT pg_advisory_lock(hashtext('guildpass-dashboard-migrations'))",
    );
    console.log("✅ Connected to database.");

    // Ensure the tracking table exists.
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Discover migration files.
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.log("ℹ️  No migrations directory found. Nothing to do.");
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("ℹ️  No migration files found. Nothing to do.");
      return;
    }

    // Check which have already been applied.
    const { rows: applied } = await client.query<{ name: string }>(
      "SELECT name FROM _migrations ORDER BY name",
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    const pending = files.filter((f) => !appliedSet.has(f));

    if (pending.length === 0) {
      console.log("✅ All migrations are up-to-date.");
      return;
    }

    console.log(`🔄 Running ${pending.length} pending migration(s)...`);

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`  ➜ Applying ${file}...`);

      try {
        const dataMigration = DATA_MIGRATIONS.get(file);
        if (dataMigration) {
          await client.query("BEGIN");
          try {
            await client.query(sql);
            await dataMigration(client);
            await client.query(
              "INSERT INTO _migrations (name) VALUES ($1)",
              [file],
            );
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        } else {
          await client.query(sql);
          await client.query(
            "INSERT INTO _migrations (name) VALUES ($1)",
            [file],
          );
        }
        console.log(`  ✅ ${file} applied.`);
      } catch (err) {
        console.error(`  ❌ ${file} failed:`, (err as Error).message);
        process.exit(1);
      }
    }

    console.log("✅ All migrations applied successfully.");
  } catch (err) {
    console.error("❌ Migration runner error:", (err as Error).message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// main() handles its own errors (exit codes) — no await needed at top level
void main();
