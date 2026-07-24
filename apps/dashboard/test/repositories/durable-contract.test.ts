import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { query } from "../../lib/db";
import { mockGuilds, mockPasses, mockMembers } from "../../lib/mock-data";
import {
  passRepositoryContract,
  guildRepositoryContract,
  memberRepositoryContract,
  activityRepositoryContract,
  passRepositoryIsolationContract,
  memberRepositoryIsolationContract,
} from "./contracts";
import {
  DurablePassRepository,
  DurableGuildRepository,
  DurableMemberRepository,
  DurableActivityRepository,
} from "../../lib/repositories/adapters/durable";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  test("Durable Repository Contracts (skipped: DATABASE_URL not set)", () => {
    console.log("ℹ️  Skipping durable repository contract tests (DATABASE_URL not set).");
  });
} else {
  // Truncate and seed tables before each contract test to ensure clean states
  beforeEach(async () => {
    await query("TRUNCATE TABLE passes, members, guilds, activity_events, processed_events CASCADE");

    // Insert guilds
    for (const g of mockGuilds) {
      await query(
        `INSERT INTO guilds (id, name, description, member_count, pass_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [g.id, g.name, g.description, g.memberCount, g.passCount, g.createdAt]
      );
    }

    // Insert passes
    for (const p of mockPasses) {
      await query(
        `INSERT INTO passes (id, guild_id, name, description, status, price, max_supply, current_supply, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.id, p.guildId, p.name, p.description, p.status, p.price ?? null, p.maxSupply ?? null, p.currentSupply, p.createdAt]
      );
    }

    // Insert members
    for (const m of mockMembers) {
      await query(
        `INSERT INTO members (id, guild_id, wallet, name, status, roles, joined_at, last_active, version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
        [m.id, m.guildId, m.wallet, m.name, m.status, JSON.stringify(m.roles), m.joinedAt, m.lastActive, m.version]
      );
    }
  });

  const getPassRepo = () => new DurablePassRepository(connectionString);
  const getGuildRepo = () => new DurableGuildRepository(connectionString);
  const getMemberRepo = () => new DurableMemberRepository(connectionString);
  const getActivityRepo = () => new DurableActivityRepository(connectionString);

  passRepositoryContract(getPassRepo);
  guildRepositoryContract(getGuildRepo);
  memberRepositoryContract(getMemberRepo);
  activityRepositoryContract(getActivityRepo);

  passRepositoryIsolationContract(getPassRepo);
  memberRepositoryIsolationContract(getMemberRepo);
}
