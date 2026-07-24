#!/usr/bin/env tsx
/**
 * Optional seed script for local Postgres development.
 *
 * Inserts the same fixture data from mock-data.ts into the database so
 * contributors can test durable mode with realistic data. Idempotent:
 * uses ON CONFLICT DO NOTHING so re-running is safe.
 *
 * Usage:
 *   pnpm db:seed
 */

import pg from "pg";
import { mockGuilds, mockPasses, mockMembers, mockActivity } from "../lib/mock-data.js";

const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL is not set. Cannot seed.");
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("✅ Connected to database.");

    await client.query("BEGIN");

    // ── Guilds ──────────────────────────────────────────────────────────
    console.log("  ➜ Seeding guilds...");
    for (const g of mockGuilds) {
      await client.query(
        `INSERT INTO guilds (id, name, description, member_count, pass_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [g.id, g.name, g.description, g.memberCount, g.passCount, g.createdAt],
      );
    }

    // ── Passes ──────────────────────────────────────────────────────────
    console.log("  ➜ Seeding passes...");
    for (const p of mockPasses) {
      await client.query(
        `INSERT INTO passes (id, guild_id, name, description, status, price, max_supply, current_supply, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.guildId, p.name, p.description, p.status, p.price ?? null, p.maxSupply ?? null, p.currentSupply, p.createdAt],
      );
    }

    // ── Members ─────────────────────────────────────────────────────────
    console.log("  ➜ Seeding members...");
    for (const m of mockMembers) {
      await client.query(
        `INSERT INTO members (id, guild_id, wallet, name, status, roles, joined_at, last_active, version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [m.id, m.guildId, m.wallet, m.name, m.status, JSON.stringify(m.roles), m.joinedAt, m.lastActive, m.version],
      );
    }

    // ── Activity ────────────────────────────────────────────────────────
    console.log("  ➜ Seeding activity events...");
    for (const a of mockActivity) {
      await client.query(
        `INSERT INTO activity_events (id, type, source, severity, actor, timestamp, description, entity, changes, schema_version)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          a.id,
          mapLegacyActivityType(a.type),
          "dashboard",
          "info",
          JSON.stringify({ name: a.actor }),
          a.timestamp,
          a.description,
          a.guildId ? JSON.stringify({ type: "guild", id: a.guildId }) : null,
          a.changes ? JSON.stringify(a.changes) : null,
          2,
        ],
      );
    }

    await client.query("COMMIT");
    console.log("✅ Seed data inserted successfully.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Seed error:", (err as Error).message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

/**
 * Map legacy mock activity types to the canonical ActivityEventType union.
 */
function mapLegacyActivityType(type: string): string {
  const map: Record<string, string> = {
    pass_created: "pass.created",
    pass_purchased: "pass.purchased",
    member_joined: "member.joined",
    role_changed: "member.roles_changed",
    access_granted: "access.granted",
  };
  return map[type] ?? type;
}

main();
