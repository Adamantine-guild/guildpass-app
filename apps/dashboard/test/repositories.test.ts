/**
 * Integration tests for the repository layer.
 * Validates mock/durable adapters and factory selection.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getRepositoryFactory,
  getPassRepository,
  getGuildRepository,
  getMemberRepository,
  getActivityRepository,
  clearRepositories,
} from "../lib/repositories/factory";

// Mock environment for testing
process.env.DASHBOARD_STORAGE_MODE = "mock";
process.env.DASHBOARD_API_MODE = "mock";

// Pass/member repositories are guild-scoped; the seeded mock data belongs to
// guild "1" (DEFAULT_GUILD_ID).
const GUILD = "1";

test("Repository Factory: MockPassRepository", async () => {
  clearRepositories();

  const repo = getPassRepository();
  assert.ok(repo, "Pass repository should be created");

  const passes = await repo.getAll(GUILD);
  assert.ok(Array.isArray(passes), "Should return array of passes");

  // Test create
  const newPass = await repo.create(GUILD, {
    name: "Test Pass",
    price: 1.0,
    description: "Test description",
    status: "active",
    currentSupply: 0,
  });
  assert.ok(newPass.id, "Created pass should have id");
  assert.strictEqual(newPass.name, "Test Pass", "Pass name should match");

  // Test getById
  const retrieved = await repo.getById(GUILD, newPass.id);
  assert.ok(retrieved, "Should retrieve created pass");
  assert.strictEqual(retrieved.id, newPass.id, "Retrieved pass id should match");

  // Test update
  const updated = await repo.update(GUILD, newPass.id, { price: 2.0 });
  assert.strictEqual(updated?.price, 2.0, "Updated price should reflect");

  // Test delete
  const deleted = await repo.delete(GUILD, newPass.id);
  assert.strictEqual(deleted, true, "Delete should return true");

  const notFound = await repo.getById(GUILD, newPass.id);
  assert.strictEqual(notFound, null, "Deleted pass should not be found");
});

test("Repository Factory: MockPassRepository returns consistent pagination at boundaries", async () => {
  clearRepositories();

  const repo = getPassRepository();

  const outOfRangePage = await repo.query(GUILD, { limit: 2, page: 3 });
  assert.deepStrictEqual(
    {
      itemIds: outOfRangePage.items.map((pass) => pass.id),
      total: outOfRangePage.total,
      limit: outOfRangePage.limit,
      page: outOfRangePage.page,
      nextCursor: outOfRangePage.nextCursor,
      hasNextPage: outOfRangePage.hasNextPage,
      hasPreviousPage: outOfRangePage.hasPreviousPage,
    },
    {
      itemIds: [],
      total: 4,
      limit: 2,
      page: 3,
      nextCursor: null,
      hasNextPage: false,
      hasPreviousPage: true,
    },
    "Out-of-range pass pages should keep pagination metadata consistent"
  );

  const oversizedLimit = await repo.query(GUILD, { limit: 99, page: 1 });
  assert.deepStrictEqual(
    {
      itemIds: oversizedLimit.items.map((pass) => pass.id),
      total: oversizedLimit.total,
      limit: oversizedLimit.limit,
      page: oversizedLimit.page,
      nextCursor: oversizedLimit.nextCursor,
      hasNextPage: oversizedLimit.hasNextPage,
      hasPreviousPage: oversizedLimit.hasPreviousPage,
    },
    {
      itemIds: ["1", "2", "3", "4"],
      total: 4,
      limit: 50,
      page: 1,
      nextCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    "Oversized pass limits should be clamped while returning all available matches"
  );
});

test("Repository Factory: MockGuildRepository", async () => {
  clearRepositories();

  const repo = getGuildRepository();
  assert.ok(repo, "Guild repository should be created");

  const guilds = await repo.getAll();
  assert.ok(Array.isArray(guilds), "Should return array of guilds");

  // Test create
  const newGuild = await repo.create({
    name: "Test Guild",
    description: "Test description",
    memberCount: 0,
    passCount: 0,
  });
  assert.ok(newGuild.id, "Created guild should have id");

  // Test getById
  const retrieved = await repo.getById(newGuild.id);
  assert.ok(retrieved, "Should retrieve created guild");
});

test("Repository Factory: MockMemberRepository", async () => {
  clearRepositories();

  const repo = getMemberRepository();
  assert.ok(repo, "Member repository should be created");

  const members = await repo.getAll(GUILD);
  assert.ok(Array.isArray(members), "Should return array of members");

  // Test create
  const newMember = await repo.create(GUILD, {
    wallet: "0x999zzz",
    name: "Charlie",
    status: "active",
    roles: ["member"],
    joinedAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
  });
  assert.ok(newMember.id, "Created member should have id");
  assert.strictEqual(newMember.wallet, "0x999zzz", "Member wallet should match");

  // Test getByWallet
  const byWallet = await repo.getByWallet(GUILD, "0x999zzz");
  assert.ok(byWallet, "Should find member by wallet");
  assert.strictEqual(byWallet.id, newMember.id, "Located member should match created");

  // Test update
  const updated = await repo.update(GUILD, newMember.id, { status: "inactive" });
  assert.strictEqual(updated?.status, "inactive", "Updated status should reflect");

  // Wallet index should still work after update
  const stillFound = await repo.getByWallet(GUILD, "0x999zzz");
  assert.ok(stillFound, "Member should still be findable by wallet after update");
});

test("Repository Factory: MockMemberRepository returns consistent pagination for zero-match searches", async () => {
  clearRepositories();

  const repo = getMemberRepository();
  const result = await repo.query(GUILD, { search: "no-such-wallet", limit: 2, page: 1 });

  assert.deepStrictEqual(
    {
      items: result.items,
      total: result.total,
      limit: result.limit,
      page: result.page,
      nextCursor: result.nextCursor,
      hasNextPage: result.hasNextPage,
      hasPreviousPage: result.hasPreviousPage,
    },
    {
      items: [],
      total: 0,
      limit: 2,
      page: 1,
      nextCursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    "Zero-match member searches should return an empty, well-formed paginated result"
  );
});

test("Repository Factory: MockActivityRepository", async () => {
  clearRepositories();

  const repo = getActivityRepository();
  assert.ok(repo, "Activity repository should be created");

  const event1 = {
    type: "member.joined" as const,
    source: "dashboard" as const,
    severity: "info" as const,
    actor: { name: "system" },
    description: "Member joined",
  };

  const result1 = await repo.append(event1);
  assert.strictEqual(result1.type, "member.joined", "Appended event should preserve type");
  assert.ok(result1.id, "Appended event should get an id");
  assert.ok(result1.timestamp, "Appended event should get a timestamp");

  // Test query
  const events = await repo.query({});
  assert.ok(Array.isArray(events), "Should return array of events");
  assert.ok(events.some((event) => event.id === result1.id), "Should include appended event");

  // Test explicit processed-event tracking
  const marked = await repo.markProcessed("evt_001");
  assert.strictEqual(marked, true, "First processed marker should be recorded");

  const duplicateMarked = await repo.markProcessed("evt_001");
  assert.strictEqual(duplicateMarked, false, "Same processed marker should be detected as duplicate");

  const hasProcessed = await repo.hasProcessed("evt_001");
  assert.strictEqual(hasProcessed, true, "Should report event as processed");

  const notProcessed = await repo.hasProcessed("evt_nonexistent");
  assert.strictEqual(notProcessed, false, "Should report non-existent event as not processed");
});

test("Repository Factory: Singleton behavior", async () => {
  clearRepositories();

  const pass1 = getPassRepository();
  const pass2 = getPassRepository();
  assert.strictEqual(pass1, pass2, "Should return same instance");

  const guild1 = getGuildRepository();
  const guild2 = getGuildRepository();
  assert.strictEqual(guild1, guild2, "Should return same instance");

  const member1 = getMemberRepository();
  const member2 = getMemberRepository();
  assert.strictEqual(member1, member2, "Should return same instance");

  const activity1 = getActivityRepository();
  const activity2 = getActivityRepository();
  assert.strictEqual(activity1, activity2, "Should return same instance");
});

test("Repository Factory: Factory pattern", async () => {
  clearRepositories();

  const factory = getRepositoryFactory();
  assert.ok(factory, "Factory should exist");
  assert.ok(factory.passRepository, "Factory should have passRepository method");
  assert.ok(factory.guildRepository, "Factory should have guildRepository method");
  assert.ok(factory.memberRepository, "Factory should have memberRepository method");
  assert.ok(factory.activityRepository, "Factory should have activityRepository method");
});

test("Repository Factory: Data persistence across calls", async () => {
  clearRepositories();

  // Create a pass
  const pass1 = await getPassRepository().create(GUILD, {
    name: "Persistent Pass",
    price: 5.0,
    description: "Should persist",
    status: "active",
    currentSupply: 10,
  });

  // Create a member
  await getMemberRepository().create(GUILD, {
    wallet: "0xpersist",
    name: "Persistent Member",
    status: "active",
    roles: [],
    joinedAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
  });

  // Retrieve and verify
  const retrieved = await getPassRepository().getById(GUILD, pass1.id);
  assert.strictEqual(retrieved?.id, pass1.id, "Pass should persist");

  const memberRetrieved = await getMemberRepository().getByWallet(GUILD, "0xpersist");
  assert.strictEqual(memberRetrieved?.wallet, "0xpersist", "Member should persist");

  // Verify all instances share the same data
  const allPasses = await getPassRepository().getAll(GUILD);
  assert.ok(allPasses.some((p) => p.id === pass1.id), "New pass should appear in getAll");

  const allMembers = await getMemberRepository().getAll(GUILD);
  assert.ok(allMembers.some((m) => m.wallet === "0xpersist"), "New member should appear in getAll");
});

test("Repository Factory: Clear repositories", async () => {
  // Create a pass
  await getPassRepository().create(GUILD, {
    name: "Will be cleared",
    price: 1.0,
    description: "Test",
    status: "draft",
    currentSupply: 0,
  });

  // Clear
  clearRepositories();

  // Create new factory and verify fresh state
  await getPassRepository().create(GUILD, {
    name: "After clear",
    price: 2.0,
    description: "Should be fresh",
    status: "active",
    currentSupply: 5,
  });

  // The cleared repository should have fresh mock data
  const allPasses = await getPassRepository().getAll(GUILD);
  assert.ok(allPasses.some((p) => p.name === "After clear"), "Should have new pass");
});

test("Repository Factory: Error handling in durable mode stub", async () => {
  // This test validates that durable adapters throw appropriate errors
  // when not yet implemented

  process.env.DASHBOARD_STORAGE_MODE = "durable";
  process.env.DATABASE_URL = "postgresql://localhost/test";

  clearRepositories();

  try {
    const repo = getPassRepository();
    await repo.getAll(GUILD);
    assert.fail("Should throw 'not yet implemented'");
  } catch (error: any) {
    assert.ok(error.message.includes("not yet implemented"), "Durable adapter should throw informative error");
  }

  // Reset to mock
  process.env.DASHBOARD_STORAGE_MODE = "mock";
  delete process.env.DATABASE_URL;
  clearRepositories();
});

test("Repository Factory: durable mode without DATABASE_URL throws", async () => {
  process.env.DASHBOARD_STORAGE_MODE = "durable";
  delete process.env.DATABASE_URL;

  clearRepositories();

  try {
    getRepositoryFactory();
    assert.fail("Should throw missing DATABASE_URL error");
  } catch (error: any) {
    assert.ok(error.message.includes("DATABASE_URL"), "Should complain about missing DATABASE_URL");
  }

  // Reset
  process.env.DASHBOARD_STORAGE_MODE = "mock";
  clearRepositories();
});
