/**
 * Shared contract test suites for repository adapters.
 *
 * Each suite accepts a factory function so that the same behavioural assertions
 * can be run against any adapter (mock, durable, etc.) that implements the
 * corresponding repository interface.
 *
 * Usage:
 *   import { passRepositoryContract } from "./contracts";
 *   import { MockPassRepository } from "../lib/repositories/adapters/mock";
 *
 *   passRepositoryContract(() => new MockPassRepository());
 */

import test from "node:test";
import assert from "node:assert/strict";
import type {
  IPassRepository,
  IGuildRepository,
  IMemberRepository,
  IActivityRepository,
  MemberCreateData,
  MemberUpdateData,
  PassCreateData,
  PassUpdateData,
} from "../../lib/repositories/types";

/**
 * Guild (tenant) scope used by the contract suites. Adapters under test must
 * treat this as the guild that holds their seed data.
 */
export const DEFAULT_CONTRACT_GUILD = "1";

/**
 * Secondary guild used by the cross-tenant isolation suites. Must be distinct
 * from the primary guild; records are created in it during the tests.
 */
export const SECONDARY_CONTRACT_GUILD = "2";

export interface RepositoryContractOptions {
  /** Guild scope for the standard behavioural suites (default "1"). */
  guildId?: string;
}

export interface IsolationContractOptions {
  /** Primary guild (default "1"). */
  guildA?: string;
  /** Adversary guild (default "2"). */
  guildB?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Pass repository contract
// ────────────────────────────────────────────────────────────────────────────

export function passRepositoryContract(
  createRepo: () => IPassRepository,
  options: RepositoryContractOptions = {},
): void {
  const guildId = options.guildId ?? DEFAULT_CONTRACT_GUILD;

  test("PassRepository: getAll returns initial data", async () => {
    const repo = createRepo();
    const passes = await repo.getAll(guildId);
    assert.ok(Array.isArray(passes), "getAll should return an array");
    assert.ok(passes.length > 0, "should have seed data");
  });

  test("PassRepository: getById returns null for missing record", async () => {
    const repo = createRepo();
    const result = await repo.getById(guildId, "non-existent-id");
    assert.strictEqual(result, null);
  });

  test("PassRepository: create returns a pass with id and createdAt", async () => {
    const repo = createRepo();
    const pass = await repo.create(guildId, {
      name: "Contract Test Pass",
      description: "Created by contract test",
      status: "active",
      price: 0.5,
      maxSupply: 200,
      currentSupply: 0,
    });

    assert.ok(pass.id, "created pass should have an id");
    assert.ok(pass.createdAt, "created pass should have a createdAt timestamp");
    assert.strictEqual(pass.name, "Contract Test Pass");
    assert.strictEqual(pass.status, "active");
    assert.strictEqual(pass.price, 0.5);
    assert.strictEqual(pass.maxSupply, 200);
    assert.strictEqual(pass.currentSupply, 0);
  });

  test("PassRepository: create persists so getAll includes it", async () => {
    const repo = createRepo();
    const pass = await repo.create(guildId, {
      name: "Persist Test Pass",
      description: "Should appear in getAll",
      status: "draft",
      currentSupply: 0,
    });

    const all = await repo.getAll(guildId);
    const found = all.find((p) => p.id === pass.id);
    assert.ok(found, "created pass should be in getAll results");
    assert.strictEqual(found?.name, "Persist Test Pass");
  });

  test("PassRepository: getById retrieves a created pass", async () => {
    const repo = createRepo();
    const pass = await repo.create(guildId, {
      name: "Retrieval Test",
      description: "Should be retrievable by id",
      status: "active",
      price: 1.0,
      currentSupply: 10,
    });

    const found = await repo.getById(guildId, pass.id);
    assert.ok(found, "should retrieve created pass");
    assert.strictEqual(found?.id, pass.id);
    assert.strictEqual(found?.name, "Retrieval Test");
    assert.strictEqual(found?.price, 1.0);
  });

  test("PassRepository: update modifies fields", async () => {
    const repo = createRepo();
    const pass = await repo.create(guildId, {
      name: "Update Test",
      description: "Will be updated",
      status: "draft",
      price: 0.1,
      currentSupply: 5,
    });

    const updated = await repo.update(guildId, pass.id, {
      name: "Updated Name",
      price: 0.2,
      status: "active",
    });

    assert.ok(updated, "update should return the updated pass");
    assert.strictEqual(updated?.name, "Updated Name");
    assert.strictEqual(updated?.price, 0.2);
    assert.strictEqual(updated?.status, "active");
    assert.strictEqual(updated?.id, pass.id, "id should not change");
    // Unchanged fields should persist
    assert.strictEqual(updated?.description, "Will be updated");
  });

  test("PassRepository: update returns null for missing record", async () => {
    const repo = createRepo();
    const result = await repo.update(guildId, "non-existent-id", { name: "Nope" });
    assert.strictEqual(result, null);
  });

  test("PassRepository: delete removes a pass", async () => {
    const repo = createRepo();
    const pass = await repo.create(guildId, {
      name: "Delete Test",
      description: "Will be deleted",
      status: "active",
      currentSupply: 0,
    });

    const deleted = await repo.delete(guildId, pass.id);
    assert.strictEqual(deleted, true, "delete should return true");

    const found = await repo.getById(guildId, pass.id);
    assert.strictEqual(found, null, "deleted pass should not be found");
  });

  test("PassRepository: delete returns false for missing record", async () => {
    const repo = createRepo();
    const result = await repo.delete(guildId, "non-existent-id");
    assert.strictEqual(result, false);
  });

  test("PassRepository: delete removes from getAll", async () => {
    const repo = createRepo();
    const pass = await repo.create(guildId, {
      name: "Gone Soon",
      description: "Will disappear from getAll",
      status: "active",
      currentSupply: 1,
    });

    await repo.delete(guildId, pass.id);
    const all = await repo.getAll(guildId);
    const found = all.find((p) => p.id === pass.id);
    assert.ok(!found, "deleted pass should not appear in getAll");
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Guild repository contract
// ────────────────────────────────────────────────────────────────────────────

export function guildRepositoryContract(
  createRepo: () => IGuildRepository,
): void {
  test("GuildRepository: getAll returns initial data", async () => {
    const repo = createRepo();
    const guilds = await repo.getAll();
    assert.ok(Array.isArray(guilds), "getAll should return an array");
    assert.ok(guilds.length > 0, "should have seed data");
  });

  test("GuildRepository: getById returns null for missing record", async () => {
    const repo = createRepo();
    const result = await repo.getById("non-existent-id");
    assert.strictEqual(result, null);
  });

  test("GuildRepository: create returns a guild with id and createdAt", async () => {
    const repo = createRepo();
    const guild = await repo.create({
      name: "Contract Test Guild",
      description: "Created by contract test",
      memberCount: 0,
      passCount: 0,
    });

    assert.ok(guild.id, "created guild should have an id");
    assert.ok(guild.createdAt, "created guild should have a createdAt timestamp");
    assert.strictEqual(guild.name, "Contract Test Guild");
    assert.strictEqual(guild.memberCount, 0);
    assert.strictEqual(guild.passCount, 0);
  });

  test("GuildRepository: create persists so getAll includes it", async () => {
    const repo = createRepo();
    const guild = await repo.create({
      name: "Persist Test Guild",
      description: "Should appear in getAll",
      memberCount: 10,
      passCount: 2,
    });

    const all = await repo.getAll();
    const found = all.find((g) => g.id === guild.id);
    assert.ok(found, "created guild should be in getAll results");
    assert.strictEqual(found?.name, "Persist Test Guild");
  });

  test("GuildRepository: getById retrieves a created guild", async () => {
    const repo = createRepo();
    const guild = await repo.create({
      name: "Retrieval Test Guild",
      description: "Should be retrievable by id",
      memberCount: 5,
      passCount: 1,
    });

    const found = await repo.getById(guild.id);
    assert.ok(found, "should retrieve created guild");
    assert.strictEqual(found?.id, guild.id);
    assert.strictEqual(found?.name, "Retrieval Test Guild");
  });

  test("GuildRepository: update modifies fields", async () => {
    const repo = createRepo();
    const guild = await repo.create({
      name: "Update Test Guild",
      description: "Will be updated",
      memberCount: 0,
      passCount: 0,
    });

    const updated = await repo.update(guild.id, {
      name: "Updated Guild Name",
      memberCount: 100,
    });

    assert.ok(updated, "update should return the updated guild");
    assert.strictEqual(updated?.name, "Updated Guild Name");
    assert.strictEqual(updated?.memberCount, 100);
    assert.strictEqual(updated?.id, guild.id, "id should not change");
    // Unchanged fields should persist
    assert.strictEqual(updated?.description, "Will be updated");
    assert.strictEqual(updated?.passCount, 0);
  });

  test("GuildRepository: update returns null for missing record", async () => {
    const repo = createRepo();
    const result = await repo.update("non-existent-id", { name: "Nope" });
    assert.strictEqual(result, null);
  });

  test("GuildRepository: delete removes a guild", async () => {
    const repo = createRepo();
    const guild = await repo.create({
      name: "Delete Test Guild",
      description: "Will be deleted",
      memberCount: 0,
      passCount: 0,
    });

    const deleted = await repo.delete(guild.id);
    assert.strictEqual(deleted, true, "delete should return true");

    const found = await repo.getById(guild.id);
    assert.strictEqual(found, null, "deleted guild should not be found");
  });

  test("GuildRepository: delete returns false for missing record", async () => {
    const repo = createRepo();
    const result = await repo.delete("non-existent-id");
    assert.strictEqual(result, false);
  });

  test("GuildRepository: delete removes from getAll", async () => {
    const repo = createRepo();
    const guild = await repo.create({
      name: "Gone Guild",
      description: "Will disappear from getAll",
      memberCount: 0,
      passCount: 0,
    });

    await repo.delete(guild.id);
    const all = await repo.getAll();
    const found = all.find((g) => g.id === guild.id);
    assert.ok(!found, "deleted guild should not appear in getAll");
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Member repository contract
// ────────────────────────────────────────────────────────────────────────────

export function memberRepositoryContract(
  createRepo: () => IMemberRepository,
  options: RepositoryContractOptions = {},
): void {
  const guildId = options.guildId ?? DEFAULT_CONTRACT_GUILD;

  test("MemberRepository: getAll returns initial data", async () => {
    const repo = createRepo();
    const members = await repo.getAll(guildId);
    assert.ok(Array.isArray(members), "getAll should return an array");
    assert.ok(members.length > 0, "should have seed data");
  });

  test("MemberRepository: getById returns null for missing record", async () => {
    const repo = createRepo();
    const result = await repo.getById(guildId, "non-existent-id");
    assert.strictEqual(result, null);
  });

  test("MemberRepository: getByWallet returns null for missing wallet", async () => {
    const repo = createRepo();
    const result = await repo.getByWallet(guildId, "0xnonexistent");
    assert.strictEqual(result, null);
  });

  test("MemberRepository: create returns a member with id", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xcontract-test-wallet-001",
      name: "Contract Test Member",
      status: "active",
      roles: ["member"],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    assert.ok(member.id, "created member should have an id");
    assert.strictEqual(member.wallet, "0xcontract-test-wallet-001");
    assert.strictEqual(member.name, "Contract Test Member");
    assert.strictEqual(member.status, "active");
    assert.deepStrictEqual(member.roles, ["member"]);
  });

  test("MemberRepository: getByWallet finds created member by wallet", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xwallet-lookup-test",
      name: "Wallet Lookup",
      status: "active",
      roles: ["member"],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    const found = await repo.getByWallet(guildId, "0xwallet-lookup-test");
    assert.ok(found, "should find member by wallet");
    assert.strictEqual(found?.id, member.id);
    assert.strictEqual(found?.name, "Wallet Lookup");
  });

  test("MemberRepository: getByWallet returns null after member deleted", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xdelete-wallet",
      name: "Delete Wallet Test",
      status: "active",
      roles: [],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    await repo.delete(guildId, member.id);

    const found = await repo.getByWallet(guildId, "0xdelete-wallet");
    assert.strictEqual(found, null, "deleted member should not be found by wallet");
  });

  test("MemberRepository: create persists so getAll includes it", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xpersist-wallet",
      name: "Persist Test",
      status: "pending",
      roles: [],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    const all = await repo.getAll(guildId);
    const found = all.find((m) => m.id === member.id);
    assert.ok(found, "created member should be in getAll results");
    assert.strictEqual(found?.wallet, "0xpersist-wallet");
  });

  test("MemberRepository: update modifies fields and maintains wallet index", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xoriginal-wallet",
      name: "Original Name",
      status: "active",
      roles: ["member"],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    const updated = await repo.update(guildId, member.id, {
      name: "Updated Name",
      status: "inactive",
      roles: ["member", "contributor"],
    });

    assert.ok(updated, "update should return the updated member");
    assert.strictEqual(updated?.name, "Updated Name");
    assert.strictEqual(updated?.status, "inactive");
    assert.deepStrictEqual(updated?.roles, ["member", "contributor"]);
    assert.strictEqual(updated?.id, member.id, "id should not change");
    assert.strictEqual(updated?.wallet, "0xoriginal-wallet", "wallet should not change");

    // Wallet index should still work with original wallet
    const byWallet = await repo.getByWallet(guildId, "0xoriginal-wallet");
    assert.ok(byWallet, "should still find member by original wallet");
    assert.strictEqual(byWallet?.name, "Updated Name");
  });

  test("MemberRepository: update with wallet change re-indexes lookup", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xold-wallet",
      name: "Wallet Change",
      status: "active",
      roles: [],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    await repo.update(guildId, member.id, { wallet: "0xnew-wallet" });

    // Old wallet should no longer resolve
    const oldLookup = await repo.getByWallet(guildId, "0xold-wallet");
    assert.strictEqual(oldLookup, null, "old wallet should no longer resolve");

    // New wallet should resolve
    const newLookup = await repo.getByWallet(guildId, "0xnew-wallet");
    assert.ok(newLookup, "new wallet should resolve");
    assert.strictEqual(newLookup?.id, member.id);
  });

  test("MemberRepository: update returns null for missing record", async () => {
    const repo = createRepo();
    const result = await repo.update(guildId, "non-existent-id", { name: "Nope" });
    assert.strictEqual(result, null);
  });

  test("MemberRepository: delete removes a member", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xdelete-member",
      name: "Delete Test",
      status: "active",
      roles: [],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    const deleted = await repo.delete(guildId, member.id);
    assert.strictEqual(deleted, true, "delete should return true");

    const found = await repo.getById(guildId, member.id);
    assert.strictEqual(found, null, "deleted member should not be found");
  });

  test("MemberRepository: delete returns false for missing record", async () => {
    const repo = createRepo();
    const result = await repo.delete(guildId, "non-existent-id");
    assert.strictEqual(result, false);
  });

  test("MemberRepository: delete removes from getAll", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xgone-member",
      name: "Gone Member",
      status: "active",
      roles: [],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    await repo.delete(guildId, member.id);
    const all = await repo.getAll(guildId);
    const found = all.find((m) => m.id === member.id);
    assert.ok(!found, "deleted member should not appear in getAll");
  });

  test("MemberRepository: getById retrieves a created member", async () => {
    const repo = createRepo();
    const member = await repo.create(guildId, {
      wallet: "0xretrieval-member",
      name: "Retrieval Test",
      status: "active",
      roles: ["admin"],
      joinedAt: "2025-06-01T00:00:00Z",
      lastActive: "2025-06-28T00:00:00Z",
    });

    const found = await repo.getById(guildId, member.id);
    assert.ok(found, "should retrieve created member");
    assert.strictEqual(found?.id, member.id);
    assert.strictEqual(found?.name, "Retrieval Test");
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Activity repository contract
// ────────────────────────────────────────────────────────────────────────────

export function activityRepositoryContract(
  createRepo: () => IActivityRepository,
): void {
  test("ActivityRepository: append creates an event with id and timestamp", async () => {
    const repo = createRepo();
    const event = await repo.append({
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      actor: { name: "system" },
      description: "Contract test member joined",
    });

    assert.ok(event.id, "appended event should have an id");
    assert.ok(event.timestamp, "appended event should have a timestamp");
    assert.strictEqual(event.type, "member.joined");
    assert.strictEqual(event.source, "dashboard");
    assert.strictEqual(event.severity, "info");
    assert.strictEqual(event.description, "Contract test member joined");
  });

  test("ActivityRepository: append with entity and metadata", async () => {
    const repo = createRepo();
    const event = await repo.append({
      type: "pass.created",
      source: "dashboard",
      severity: "info",
      actor: { name: "admin", wallet: "0xadmin" },
      description: "Created a pass",
      entity: { type: "pass", id: "pass_001", name: "Test Pass" },
      metadata: { price: 0.1 },
    });

    assert.ok(event.id);
    assert.ok(event.timestamp);
    assert.strictEqual(event.type, "pass.created");
    assert.deepStrictEqual(event.entity, { type: "pass", id: "pass_001", name: "Test Pass" });
    assert.deepStrictEqual(event.metadata, { price: 0.1 });
    assert.strictEqual(event.actor.name, "admin");
  });

  test("ActivityRepository: query returns appended events", async () => {
    const repo = createRepo();
    await repo.append({
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      actor: { name: "Alice" },
      description: "Alice joined",
    });

    const events = await repo.query({});
    assert.ok(Array.isArray(events), "query should return an array");
    assert.ok(events.length > 0, "should return at least one event");
    assert.ok(events.some((e) => e.description === "Alice joined"), "should include appended event");
  });

  test("ActivityRepository: query filters by type", async () => {
    const repo = createRepo();
    await repo.append({
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      actor: { name: "Alice" },
      description: "Alice joined",
    });

    await repo.append({
      type: "pass.created",
      source: "dashboard",
      severity: "info",
      actor: { name: "admin" },
      description: "Pass created",
    });

    const filtered = await repo.query({ type: "pass.created" });
    assert.ok(filtered.every((e) => e.type === "pass.created"), "all results should match type filter");
    assert.strictEqual(filtered.length, 1, "should only return matching events");
  });

  test("ActivityRepository: query respects limit", async () => {
    const repo = createRepo();
    for (let i = 0; i < 5; i++) {
      await repo.append({
        type: "member.joined",
        source: "dashboard",
        severity: "info",
        actor: { name: `User${i}` },
        description: `User${i} joined`,
      });
    }

    const limited = await repo.query({ limit: 2 });
    assert.strictEqual(limited.length, 2, "limit should cap results");
  });

  test("ActivityRepository: query filters by since (ISO date)", async () => {
    const repo = createRepo();

    // First event
    await repo.append({
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      actor: { name: "Early" },
      description: "Early event",
    });

    // Force a small delay to ensure distinct timestamps
    await new Promise((r) => setTimeout(r, 10));

    const cutoff = new Date().toISOString();

    await new Promise((r) => setTimeout(r, 10));

    // Later event
    await repo.append({
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      actor: { name: "Late" },
      description: "Late event",
    });

    const sinceFiltered = await repo.query({ since: cutoff });
    assert.ok(sinceFiltered.length > 0, "should return events after cutoff");
    assert.ok(
      sinceFiltered.every((e) => new Date(e.timestamp).getTime() >= new Date(cutoff).getTime()),
      "all returned events should be at or after cutoff",
    );
  });

  test("ActivityRepository: hasProcessed returns false for unknown id", async () => {
    const repo = createRepo();
    const result = await repo.hasProcessed("unknown-event-id");
    assert.strictEqual(result, false);
  });

  test("ActivityRepository: markProcessed records an id", async () => {
    const repo = createRepo();
    const result = await repo.markProcessed("evt_contract_001");
    assert.strictEqual(result, true, "first mark should succeed");

    const checked = await repo.hasProcessed("evt_contract_001");
    assert.strictEqual(checked, true, "should report as processed");
  });

  test("ActivityRepository: markProcessed is idempotent — duplicate returns false", async () => {
    const repo = createRepo();
    const first = await repo.markProcessed("evt_duplicate_test");
    assert.strictEqual(first, true, "first mark should succeed");

    const second = await repo.markProcessed("evt_duplicate_test");
    assert.strictEqual(second, false, "duplicate mark should return false");
  });

  test("ActivityRepository: append auto-marks event as processed", async () => {
    const repo = createRepo();
    const event = await repo.append({
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      actor: { name: "AutoMark" },
      description: "Auto-mark test",
    });

    const processed = await repo.hasProcessed(event.id);
    assert.strictEqual(processed, true, "appended event should be marked as processed");
  });

  test("ActivityRepository: events are returned in append order (newest first)", async () => {
    const repo = createRepo();
    const descriptions: string[] = [];

    for (let i = 0; i < 3; i++) {
      const evt = await repo.append({
        type: "member.joined",
        source: "dashboard",
        severity: "info",
        actor: { name: `User${i}` },
        description: `Event ${i}`,
      });
      descriptions.push(evt.description);
    }

    const events = await repo.query({});
    // Events are unshifted, so newest is first
    assert.strictEqual(
      events[0].description,
      descriptions[descriptions.length - 1],
      "newest event should be first",
    );
    assert.strictEqual(
      events[events.length - 1].description,
      descriptions[0],
      "oldest event should be last",
    );
  });

  test("ActivityRepository: query with type filter and limit combined", async () => {
    const repo = createRepo();

    for (let i = 0; i < 3; i++) {
      await repo.append({
        type: "member.joined",
        source: "dashboard",
        severity: "info",
        actor: { name: `User${i}` },
        description: `Member event ${i}`,
      });
    }

    await repo.append({
      type: "pass.created",
      source: "dashboard",
      severity: "info",
      actor: { name: "admin" },
      description: "Pass event",
    });

    const result = await repo.query({ type: "member.joined", limit: 2 });
    assert.strictEqual(result.length, 2, "should return 2 member events");
    assert.ok(result.every((e) => e.type === "member.joined"), "all should be member.joined");
  });

  test("ActivityRepository: query returns empty array when no events match", async () => {
    const repo = createRepo();
    const result = await repo.query({ type: "pass.deleted" });
    assert.ok(Array.isArray(result), "should return an array");
    assert.strictEqual(result.length, 0, "should be empty when no events match");
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Cross-tenant isolation contracts
//
// These suites prove the multi-tenant isolation guarantee documented in
// docs/multi-tenancy.md: a repository call scoped to guild A structurally
// cannot read, modify, or delete guild B's data — including adversarial
// attempts that pass another guild's record ID, reuse of the same wallet
// across guilds, and payloads that try to smuggle a foreign guildId past the
// type system. Every conforming adapter (mock included) must pass them.
// ────────────────────────────────────────────────────────────────────────────

const isolationPass = (name: string): PassCreateData => ({
  name,
  description: `Isolation fixture: ${name}`,
  status: "active",
  currentSupply: 0,
});

const isolationMember = (name: string, wallet: string): MemberCreateData => ({
  name,
  wallet,
  status: "active",
  roles: ["member"],
  joinedAt: "2025-06-01T00:00:00Z",
  lastActive: "2025-06-28T00:00:00Z",
});

export function passRepositoryIsolationContract(
  createRepo: () => IPassRepository,
  options: IsolationContractOptions = {},
): void {
  const guildA = options.guildA ?? DEFAULT_CONTRACT_GUILD;
  const guildB = options.guildB ?? SECONDARY_CONTRACT_GUILD;

  test("PassRepository isolation: getAll never returns another guild's passes", async () => {
    const repo = createRepo();
    const passA = await repo.create(guildA, isolationPass("Guild A Pass"));
    const passB = await repo.create(guildB, isolationPass("Guild B Pass"));

    const allA = await repo.getAll(guildA);
    const allB = await repo.getAll(guildB);

    assert.ok(allA.some((p) => p.id === passA.id), "guild A should see its own pass");
    assert.ok(!allA.some((p) => p.id === passB.id), "guild A must not see guild B's pass");
    assert.ok(allB.some((p) => p.id === passB.id), "guild B should see its own pass");
    assert.ok(!allB.some((p) => p.id === passA.id), "guild B must not see guild A's pass");
    assert.ok(allA.every((p) => p.guildId === guildA), "every pass in guild A's view is stamped with guild A");
    assert.ok(allB.every((p) => p.guildId === guildB), "every pass in guild B's view is stamped with guild B");
  });

  test("PassRepository isolation: query never returns another guild's passes", async () => {
    const repo = createRepo();
    await repo.create(guildA, isolationPass("Unique Isolation Needle"));

    const result = await repo.query(guildB, { search: "Unique Isolation Needle" });
    assert.strictEqual(result.items.length, 0, "guild B's search must not match guild A's pass");
    assert.strictEqual(result.total, 0, "guild B's total must not count guild A's pass");

    const unfiltered = await repo.query(guildB);
    assert.ok(
      unfiltered.items.every((p) => p.guildId === guildB),
      "every queried pass must belong to the requested guild",
    );
  });

  test("PassRepository isolation: getById with another guild's pass ID returns null", async () => {
    const repo = createRepo();
    const passA = await repo.create(guildA, isolationPass("Lookup Target"));

    assert.strictEqual(
      await repo.getById(guildB, passA.id),
      null,
      "guild B must not resolve guild A's pass by ID",
    );
    assert.ok(await repo.getById(guildA, passA.id), "guild A can still resolve its own pass");
  });

  test("PassRepository isolation: update with another guild's pass ID is a no-op returning null", async () => {
    const repo = createRepo();
    const passA = await repo.create(guildA, isolationPass("Update Target"));

    const hijack = await repo.update(guildB, passA.id, { name: "Hijacked" });
    assert.strictEqual(hijack, null, "cross-guild update must return null");

    const intact = await repo.getById(guildA, passA.id);
    assert.strictEqual(intact?.name, "Update Target", "guild A's pass must be unmodified");
  });

  test("PassRepository isolation: delete with another guild's pass ID is a no-op returning false", async () => {
    const repo = createRepo();
    const passA = await repo.create(guildA, isolationPass("Delete Target"));

    const hijack = await repo.delete(guildB, passA.id);
    assert.strictEqual(hijack, false, "cross-guild delete must return false");
    assert.ok(await repo.getById(guildA, passA.id), "guild A's pass must still exist");
  });

  test("PassRepository isolation: create ignores a smuggled guildId in the payload", async () => {
    const repo = createRepo();
    // Simulate an adversarial JS caller bypassing the type system.
    const smuggled = { ...isolationPass("Smuggled Pass"), guildId: guildB } as PassCreateData;
    const created = await repo.create(guildA, smuggled);

    assert.strictEqual(created.guildId, guildA, "created pass must belong to the scope guild");
    assert.strictEqual(
      await repo.getById(guildB, created.id),
      null,
      "the pass must not be visible to the smuggled guild",
    );
  });

  test("PassRepository isolation: update cannot reassign a pass to another guild", async () => {
    const repo = createRepo();
    const passA = await repo.create(guildA, isolationPass("Reassign Target"));

    // Simulate an adversarial JS caller bypassing the type system.
    const smuggled = { guildId: guildB } as PassUpdateData;
    const updated = await repo.update(guildA, passA.id, smuggled);

    assert.strictEqual(updated?.guildId, guildA, "the owning guild must be immutable");
    assert.strictEqual(await repo.getById(guildB, passA.id), null, "guild B must not gain access");
    assert.ok(await repo.getById(guildA, passA.id), "guild A must retain access");
  });
}

export function memberRepositoryIsolationContract(
  createRepo: () => IMemberRepository,
  options: IsolationContractOptions = {},
): void {
  const guildA = options.guildA ?? DEFAULT_CONTRACT_GUILD;
  const guildB = options.guildB ?? SECONDARY_CONTRACT_GUILD;

  test("MemberRepository isolation: getAll never returns another guild's members", async () => {
    const repo = createRepo();
    const memberA = await repo.create(guildA, isolationMember("Ana", "0xiso-a-getall"));
    const memberB = await repo.create(guildB, isolationMember("Ben", "0xiso-b-getall"));

    const allA = await repo.getAll(guildA);
    const allB = await repo.getAll(guildB);

    assert.ok(allA.some((m) => m.id === memberA.id), "guild A should see its own member");
    assert.ok(!allA.some((m) => m.id === memberB.id), "guild A must not see guild B's member");
    assert.ok(allB.some((m) => m.id === memberB.id), "guild B should see its own member");
    assert.ok(!allB.some((m) => m.id === memberA.id), "guild B must not see guild A's member");
    assert.ok(allA.every((m) => m.guildId === guildA), "every member in guild A's view is stamped with guild A");
    assert.ok(allB.every((m) => m.guildId === guildB), "every member in guild B's view is stamped with guild B");
  });

  test("MemberRepository isolation: query never returns another guild's members", async () => {
    const repo = createRepo();
    await repo.create(guildA, isolationMember("Needle Member", "0xiso-a-query"));

    const result = await repo.query(guildB, { search: "Needle Member" });
    assert.strictEqual(result.items.length, 0, "guild B's search must not match guild A's member");
    assert.strictEqual(result.total, 0, "guild B's total must not count guild A's member");

    const unfiltered = await repo.query(guildB);
    assert.ok(
      unfiltered.items.every((m) => m.guildId === guildB),
      "every queried member must belong to the requested guild",
    );
  });

  test("MemberRepository isolation: getById with another guild's member ID returns null", async () => {
    const repo = createRepo();
    const memberA = await repo.create(guildA, isolationMember("Lookup", "0xiso-a-byid"));

    assert.strictEqual(
      await repo.getById(guildB, memberA.id),
      null,
      "guild B must not resolve guild A's member by ID",
    );
    assert.ok(await repo.getById(guildA, memberA.id), "guild A can still resolve its own member");
  });

  test("MemberRepository isolation: getByWallet is guild-scoped", async () => {
    const repo = createRepo();
    await repo.create(guildA, isolationMember("Wallet Holder", "0xiso-shared-wallet"));

    assert.strictEqual(
      await repo.getByWallet(guildB, "0xiso-shared-wallet"),
      null,
      "guild B must not resolve guild A's member by wallet",
    );
    assert.ok(
      await repo.getByWallet(guildA, "0xiso-shared-wallet"),
      "guild A can still resolve its own member by wallet",
    );
  });

  test("MemberRepository isolation: the same wallet can exist independently in two guilds", async () => {
    const repo = createRepo();
    await repo.create(guildA, isolationMember("Ana", "0xiso-dual-wallet"));
    await repo.create(guildB, isolationMember("Ben", "0xiso-dual-wallet"));

    const inA = await repo.getByWallet(guildA, "0xiso-dual-wallet");
    const inB = await repo.getByWallet(guildB, "0xiso-dual-wallet");
    assert.strictEqual(inA?.name, "Ana", "guild A resolves its own record for the wallet");
    assert.strictEqual(inB?.name, "Ben", "guild B resolves its own record for the wallet");

    // Deleting the wallet's member in one guild must not affect the other.
    assert.strictEqual(await repo.delete(guildA, inA!.id), true);
    assert.strictEqual(await repo.getByWallet(guildA, "0xiso-dual-wallet"), null);
    assert.strictEqual(
      (await repo.getByWallet(guildB, "0xiso-dual-wallet"))?.name,
      "Ben",
      "guild B's record must survive guild A's delete",
    );
  });

  test("MemberRepository isolation: update with another guild's member ID is a no-op returning null", async () => {
    const repo = createRepo();
    const memberA = await repo.create(guildA, isolationMember("Update Target", "0xiso-a-update"));

    const hijack = await repo.update(guildB, memberA.id, { name: "Hijacked", roles: ["admin"] });
    assert.strictEqual(hijack, null, "cross-guild update must return null");

    const intact = await repo.getById(guildA, memberA.id);
    assert.strictEqual(intact?.name, "Update Target", "guild A's member must be unmodified");
    assert.deepStrictEqual(intact?.roles, ["member"], "guild A's member roles must be unmodified");
  });

  test("MemberRepository isolation: delete with another guild's member ID is a no-op returning false", async () => {
    const repo = createRepo();
    const memberA = await repo.create(guildA, isolationMember("Delete Target", "0xiso-a-delete"));

    const hijack = await repo.delete(guildB, memberA.id);
    assert.strictEqual(hijack, false, "cross-guild delete must return false");
    assert.ok(await repo.getById(guildA, memberA.id), "guild A's member must still exist");
    assert.ok(
      await repo.getByWallet(guildA, "0xiso-a-delete"),
      "guild A's wallet lookup must be unaffected",
    );
  });

  test("MemberRepository isolation: create ignores a smuggled guildId in the payload", async () => {
    const repo = createRepo();
    // Simulate an adversarial JS caller bypassing the type system.
    const smuggled = {
      ...isolationMember("Smuggler", "0xiso-smuggle-create"),
      guildId: guildB,
    } as MemberCreateData;
    const created = await repo.create(guildA, smuggled);

    assert.strictEqual(created.guildId, guildA, "created member must belong to the scope guild");
    assert.strictEqual(
      await repo.getById(guildB, created.id),
      null,
      "the member must not be visible to the smuggled guild",
    );
    assert.strictEqual(
      await repo.getByWallet(guildB, "0xiso-smuggle-create"),
      null,
      "the wallet must not resolve in the smuggled guild",
    );
  });

  test("MemberRepository isolation: update cannot reassign a member to another guild", async () => {
    const repo = createRepo();
    const memberA = await repo.create(guildA, isolationMember("Reassign", "0xiso-smuggle-update"));

    // Simulate an adversarial JS caller bypassing the type system.
    const smuggled = { guildId: guildB } as MemberUpdateData;
    const updated = await repo.update(guildA, memberA.id, smuggled);

    assert.strictEqual(updated?.guildId, guildA, "the owning guild must be immutable");
    assert.strictEqual(await repo.getById(guildB, memberA.id), null, "guild B must not gain access");
    assert.ok(await repo.getById(guildA, memberA.id), "guild A must retain access");
    assert.ok(
      await repo.getByWallet(guildA, "0xiso-smuggle-update"),
      "guild A's wallet lookup must be unaffected",
    );
  });
}
