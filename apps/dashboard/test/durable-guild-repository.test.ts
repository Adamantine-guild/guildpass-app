import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DurableGuildRepository } from "../lib/repositories/adapters/durable";
import type { Guild, Member, Pass } from "../lib/mock-data";
import type { IMemberRepository, IPassRepository } from "../lib/repositories/types";

/**
 * Tests for issue #136: DurableGuildRepository must fully implement
 * IGuildRepository with no "not yet implemented" throw, keep member/pass counts
 * consistent under concurrent writes, and never leave a guild record corrupted.
 *
 * Counts are derived at read from the member/pass repos, so we drive those with
 * minimal fakes that only implement getAll (the sole method the guild repo uses).
 */

function fakeMemberRepo(members: Member[]): IMemberRepository {
  return {
    async getAll() { return members; },
    async *streamAll() { yield members; },
    async query() { throw new Error("not used"); },
    async getById() { return null; },
    async getByWallet() { return null; },
    async create() { throw new Error("not used"); },
    async update() { return null; },
    async delete() { return false; },
  };
}

function fakePassRepo(passes: Pass[]): IPassRepository {
  return {
    async getAll() { return passes; },
    async query() { throw new Error("not used"); },
    async getById() { return null; },
    async create() { throw new Error("not used"); },
    async update() { return null; },
    async delete() { return false; },
  };
}

function seedGuild(overrides: Partial<Guild> = {}): Guild {
  return {
    id: "1",
    name: "Test Guild",
    description: "seed",
    memberCount: 0,
    passCount: 0,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DurableGuildRepository — full implementation", () => {
  test("implements IGuildRepository without throwing 'not yet implemented'", async () => {
    const repo = new DurableGuildRepository("mock://conn", undefined, {
      memberRepo: fakeMemberRepo([]),
      passRepo: fakePassRepo([]),
    });
    // Every contract method resolves rather than throwing the stub error.
    await assert.doesNotReject(() => repo.getAll());
    const created = await repo.create({
      name: "New",
      description: "d",
      memberCount: 999, // caller-supplied count must be ignored in favor of derived
      passCount: 999,
    } as Omit<Guild, "id" | "createdAt">);
    assert.ok(created.id);
    await assert.doesNotReject(() => repo.getById(created.id));
    await assert.doesNotReject(() => repo.update(created.id, { name: "Renamed" }));
    await assert.doesNotReject(() => repo.delete(created.id));
  });
});

describe("DurableGuildRepository — derived counts (reconciliation)", () => {
  test("stored counts are ignored; reads reflect the member/pass repos", async () => {
    // Seed a guild whose stored counts are deliberately WRONG.
    const members = [
      { id: "1" }, { id: "2" }, { id: "3" },
    ] as unknown as Member[];
    const passes = [{ id: "1" }, { id: "2" }] as unknown as Pass[];

    const repo = new DurableGuildRepository("mock://conn", undefined, {
      memberRepo: fakeMemberRepo(members),
      passRepo: fakePassRepo(passes),
      seed: [seedGuild({ memberCount: 42, passCount: 99 })], // inconsistent on purpose
    });

    const guild = await repo.getById("1");
    assert.ok(guild);
    // Reads converge on the source of truth, not the stale stored numbers.
    assert.equal(guild.memberCount, 3);
    assert.equal(guild.passCount, 2);
  });

  test("counts stay correct after the underlying member set changes", async () => {
    const members: Member[] = [{ id: "1" } as unknown as Member];
    const repo = new DurableGuildRepository("mock://conn", undefined, {
      memberRepo: fakeMemberRepo(members),
      passRepo: fakePassRepo([]),
      seed: [seedGuild()],
    });

    assert.equal((await repo.getById("1"))!.memberCount, 1);
    members.push({ id: "2" } as unknown as Member); // membership grows
    assert.equal((await repo.getById("1"))!.memberCount, 2);
  });
});

describe("DurableGuildRepository — concurrent writes", () => {
  test("parallel creates all persist with unique ids and no lost writes", async () => {
    const repo = new DurableGuildRepository("mock://conn", undefined, {
      memberRepo: fakeMemberRepo([]),
      passRepo: fakePassRepo([]),
    });

    // Fire 25 creates concurrently; the write mutex must serialize them so no
    // two share an id and none is dropped.
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        repo.create({
          name: `G${i}`,
          description: "d",
          memberCount: 0,
          passCount: 0,
        } as Omit<Guild, "id" | "createdAt">),
      ),
    );

    const ids = new Set(results.map((g) => g.id));
    assert.equal(ids.size, 25); // all unique — no id collisions
    assert.equal((await repo.getAll()).length, 25); // no lost writes
  });

  test("concurrent create/delete never corrupts the store", async () => {
    const repo = new DurableGuildRepository("mock://conn", undefined, {
      memberRepo: fakeMemberRepo([]),
      passRepo: fakePassRepo([]),
    });

    const created = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        repo.create({ name: `G${i}`, description: "d", memberCount: 0, passCount: 0 } as Omit<Guild, "id" | "createdAt">),
      ),
    );

    // Interleave deletes of the first five with five fresh creates.
    await Promise.all([
      ...created.slice(0, 5).map((g) => repo.delete(g.id)),
      ...Array.from({ length: 5 }, (_, i) =>
        repo.create({ name: `H${i}`, description: "d", memberCount: 0, passCount: 0 } as Omit<Guild, "id" | "createdAt">),
      ),
    ]);

    const all = await repo.getAll();
    // 10 created - 5 deleted + 5 new = 10, all with unique ids.
    assert.equal(all.length, 10);
    assert.equal(new Set(all.map((g) => g.id)).size, 10);
  });
});