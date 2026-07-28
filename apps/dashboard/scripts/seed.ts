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
import { seedDurableActivityEvent } from "../lib/activity/hash-chain.js";
import type { ActivityEvent } from "../lib/activity/types.js";

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
      const event: ActivityEvent = {
        id: a.id,
        type: mapLegacyActivityType(a.type),
        source: "dashboard",
        severity: "info",
        actor: { name: a.actor },
        timestamp: a.timestamp,
        description: a.description,
        ...(a.guildId
          ? { entity: { type: "guild" as const, id: a.guildId } }
          : {}),
        ...(a.changes ? { changes: a.changes } : {}),
        schemaVersion: 2,
      };
      await seedDurableActivityEvent(client, event);
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
function mapLegacyActivityType(type: string): ActivityEvent["type"] {
  const map: Record<string, ActivityEvent["type"]> = {
    pass_created: "pass.created",
    pass_purchased: "pass.purchased",
    member_joined: "member.joined",
    role_changed: "member.roles_changed",
    access_granted: "access.granted",
  };
  return map[type] ?? (type as ActivityEvent["type"]);
}

main();
