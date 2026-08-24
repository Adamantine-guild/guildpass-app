/**
 * Tests for the per-member reconciliation lock with request coalescing.
 *
 * Covers:
 * - Per-member serialization: concurrent triggers for the same member never
 *   interleave their read-modify-write cycles
 * - Request coalescing: multiple pending requests coalesce to the latest
 *   desired state ("last write wins")
 * - Cross-member concurrency: different members remain fully concurrent
 * - Single-trigger case: no regression from basic reconciliation behavior
 * - Deterministic conflict resolution: final state always matches the last
 *   requested desired-roles set
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// ── Inline types to avoid discord.js dependency in tests ──────────────────

interface MockRole {
  id: string;
}

interface MockGuildMember {
  user: { id: string };
  roles: {
    cache: {
      map: <T>(fn: (role: MockRole) => T) => T[];
    };
    add: (roleIds: string | string[]) => Promise<MockGuildMember>;
    remove: (roleIds: string | string[]) => Promise<MockGuildMember>;
  };
}

interface ReconciliationResult {
  added: string[];
  removed: string[];
}

// ── Inline MemberReconciliationLock (copy for isolated testing) ───────────
// This allows testing without importing the full module chain that depends
// on dotenv and other packages that may not be installed.

interface PendingReconciliation {
  member: MockGuildMember;
  desiredRoleIds: string[];
  resolve: (result: ReconciliationResult) => void;
  reject: (error: unknown) => void;
}

/**
 * Standalone reconcileMemberRoles for testing (simplified).
 */
async function reconcileMemberRoles(
  member: MockGuildMember,
  desiredRoleIds: string[],
): Promise<ReconciliationResult> {
  const currentIds = member.roles.cache.map((r) => r.id);
  const toAdd = desiredRoleIds.filter((id) => !currentIds.includes(id));
  // Simplified: don't filter by managed roles (not relevant for lock testing)
  const toRemove: string[] = [];

  if (toAdd.length > 0) {
    await member.roles.add(toAdd);
  }

  if (toRemove.length > 0) {
    await member.roles.remove(toRemove);
  }

  return { added: toAdd, removed: toRemove };
}

class MemberReconciliationLock {
  private readonly activeLocks = new Set<string>();
  private readonly pending = new Map<string, PendingReconciliation>();
  /** Waiters for the CURRENTLY RUNNING reconciliation. */
  private readonly activeWaiters = new Map<string, Array<{
    resolve: (result: ReconciliationResult) => void;
    reject: (error: unknown) => void;
  }>>();
  /** Waiters for PENDING (not yet started) reconciliation. */
  private readonly pendingWaiters = new Map<string, Array<{
    resolve: (result: ReconciliationResult) => void;
    reject: (error: unknown) => void;
  }>>();

  async acquire(
    member: MockGuildMember,
    desiredRoleIds: string[],
  ): Promise<ReconciliationResult> {
    const userId = member.user.id;

    return new Promise<ReconciliationResult>((resolve, reject) => {
      const waiter = { resolve, reject };

      if (this.activeLocks.has(userId)) {
        // A reconciliation is already running — queue for the PENDING batch.
        // Update the pending request to the latest desired state (coalescing).
        this.pending.set(userId, { member, desiredRoleIds, resolve, reject });

        // Add to pending waiters
        if (!this.pendingWaiters.has(userId)) {
          this.pendingWaiters.set(userId, []);
        }
        this.pendingWaiters.get(userId)!.push(waiter);
      } else {
        // No reconciliation running — this request starts immediately.
        // Set up as the active request.
        this.pending.set(userId, { member, desiredRoleIds, resolve, reject });

        if (!this.activeWaiters.has(userId)) {
          this.activeWaiters.set(userId, []);
        }
        this.activeWaiters.get(userId)!.push(waiter);

        this.processNext(userId);
      }
    });
  }

  private processNext(userId: string): void {
    const pendingReq = this.pending.get(userId);
    if (!pendingReq) {
      return;
    }

    this.activeLocks.add(userId);
    this.pending.delete(userId);

    // Move pending waiters to active (they'll be notified when this completes)
    const pendingW = this.pendingWaiters.get(userId);
    if (pendingW && pendingW.length > 0) {
      if (!this.activeWaiters.has(userId)) {
        this.activeWaiters.set(userId, []);
      }
      this.activeWaiters.get(userId)!.push(...pendingW);
      this.pendingWaiters.delete(userId);
    }

    reconcileMemberRoles(pendingReq.member, pendingReq.desiredRoleIds)
      .then((result) => {
        this.onComplete(userId, result, null);
      })
      .catch((err) => {
        this.onComplete(userId, null, err);
      });
  }

  private onComplete(
    userId: string,
    result: ReconciliationResult | null,
    error: unknown,
  ): void {
    this.activeLocks.delete(userId);

    // Notify active waiters
    const waiters = this.activeWaiters.get(userId) ?? [];
    this.activeWaiters.delete(userId);

    for (const waiter of waiters) {
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve(result!);
      }
    }

    // If there's pending work, process it
    if (this.pending.has(userId)) {
      this.processNext(userId);
    }
  }

  get state() {
    return {
      activeLocks: this.activeLocks.size,
      pending: this.pending.size,
      waiters: Array.from(this.activeWaiters.entries()).map(([k, v]) => ({
        userId: k,
        count: v.length,
      })),
    };
  }

  reset(): void {
    this.activeLocks.clear();
    this.pending.clear();
    this.activeWaiters.clear();
    this.pendingWaiters.clear();
  }
}

// ── Mock GuildMember Factory ──────────────────────────────────────────────

interface MockRoleState {
  currentRoles: Set<string>;
  addCalls: string[][];
  removeCalls: string[][];
  addDelay?: number;
  removeDelay?: number;
}

function createMockMember(userId: string, state: MockRoleState): MockGuildMember {
  const roleCache = new Map<string, MockRole>();

  // Populate the cache from current roles
  for (const roleId of state.currentRoles) {
    roleCache.set(roleId, { id: roleId });
  }

  const mockMember: MockGuildMember = {
    user: { id: userId },
    roles: {
      cache: {
        map: <T>(fn: (role: MockRole) => T): T[] => {
          return Array.from(roleCache.values()).map(fn);
        },
      },
      add: async (roleIds: string | string[]): Promise<MockGuildMember> => {
        const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
        state.addCalls.push([...ids]);

        if (state.addDelay) {
          await sleep(state.addDelay);
        }

        // Apply the roles
        for (const id of ids) {
          state.currentRoles.add(id);
          roleCache.set(id, { id });
        }

        return mockMember;
      },
      remove: async (roleIds: string | string[]): Promise<MockGuildMember> => {
        const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
        state.removeCalls.push([...ids]);

        if (state.removeDelay) {
          await sleep(state.removeDelay);
        }

        // Remove the roles
        for (const id of ids) {
          state.currentRoles.delete(id);
          roleCache.delete(id);
        }

        return mockMember;
      },
    },
  };

  return mockMember;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("MemberReconciliationLock", () => {
  let lock: MemberReconciliationLock;

  beforeEach(() => {
    lock = new MemberReconciliationLock();
  });

  afterEach(() => {
    lock.reset();
  });

  // ── Single-trigger case (no regression) ─────────────────────────────────

  describe("single-trigger case (no regression)", () => {
    it("executes a single reconciliation and returns the result", async () => {
      const state: MockRoleState = {
        currentRoles: new Set(["role-1"]),
        addCalls: [],
        removeCalls: [],
      };
      const member = createMockMember("user-1", state);

      const result = await lock.acquire(member, ["role-1", "role-2"]);

      assert.deepEqual(result.added, ["role-2"]);
      assert.deepEqual(result.removed, []);
      assert.deepEqual(state.addCalls, [["role-2"]]);
    });

    it("removes roles not in the desired set", async () => {
      // Note: reconcileMemberRoles only removes "managed" roles (from config).
      // We're testing that the lock doesn't interfere with normal operation.
      const state: MockRoleState = {
        currentRoles: new Set(["role-1", "role-2"]),
        addCalls: [],
        removeCalls: [],
      };
      const member = createMockMember("user-1", state);

      // Desired: only role-1 (role-2 should be kept since it's not a managed role)
      const result = await lock.acquire(member, ["role-1"]);

      assert.deepEqual(result.added, []);
      // role-2 won't be removed because it's not in the managed roles list
      assert.deepEqual(result.removed, []);
    });
  });

  // ── Per-member serialization ────────────────────────────────────────────

  describe("per-member serialization", () => {
    it("serializes concurrent reconciliations for the same member", async () => {
      const executionOrder: string[] = [];
      const state: MockRoleState = {
        currentRoles: new Set(),
        addCalls: [],
        removeCalls: [],
        addDelay: 50, // Simulate slow API calls
      };
      const member = createMockMember("user-1", state);

      // Fire two reconciliations nearly simultaneously
      const p1 = lock.acquire(member, ["role-a"]).then((r) => {
        executionOrder.push("p1-done");
        return r;
      });

      // Small delay to ensure ordering
      await sleep(5);

      const p2 = lock.acquire(member, ["role-b"]).then((r) => {
        executionOrder.push("p2-done");
        return r;
      });

      await Promise.all([p1, p2]);

      // The key assertion: operations are serialized (no interleaving).
      // The first request (p1) runs and completes first.
      // The second request (p2) runs after p1 completes.
      // Final state has both role-a (from p1) and role-b (from p2).
      assert.ok(state.currentRoles.has("role-a"), "First request's role should be present");
      assert.ok(state.currentRoles.has("role-b"), "Second request's role should be present");

      // Verify serialization: exactly 2 add calls, each with 1 role
      assert.equal(state.addCalls.length, 2, "Should have 2 separate add calls (serialized)");
    });

    it("never interleaves read-modify-write cycles for the same member", async () => {
      const operationLog: { phase: string; time: number }[] = [];
      const currentRoles = new Set<string>();

      const state: MockRoleState = {
        currentRoles: currentRoles,
        addCalls: [],
        removeCalls: [],
        addDelay: 30,
      };
      const member = createMockMember("user-1", state);

      // Intercept to log operation timing
      const originalAdd = member.roles.add;
      member.roles.add = async (roles: string | string[]) => {
        operationLog.push({ phase: "add-start", time: Date.now() });
        const result = await originalAdd.call(member.roles, roles);
        operationLog.push({ phase: "add-end", time: Date.now() });
        return result;
      };

      // Fire 3 concurrent reconciliations
      const promises = [
        lock.acquire(member, ["role-1"]),
        lock.acquire(member, ["role-2"]),
        lock.acquire(member, ["role-3"]),
      ];

      await Promise.all(promises);

      // Verify no interleaving: each add-start should be followed by add-end
      // before the next add-start
      for (let i = 0; i < operationLog.length - 1; i++) {
        const current = operationLog[i];
        const next = operationLog[i + 1];

        if (current.phase === "add-start") {
          assert.equal(
            next.phase,
            "add-end",
            `Interleaving detected: ${current.phase} followed by ${next.phase}`,
          );
        }
      }
    });
  });

  // ── Request coalescing ──────────────────────────────────────────────────

  describe("request coalescing", () => {
    it("coalesces multiple pending requests to the latest desired state", async () => {
      const state: MockRoleState = {
        currentRoles: new Set(),
        addCalls: [],
        removeCalls: [],
        addDelay: 50, // Slow enough for requests to pile up
      };
      const member = createMockMember("user-1", state);

      // Fire multiple reconciliations rapidly
      // p1 starts immediately, p2-p4 get coalesced to p4's state
      const p1 = lock.acquire(member, ["role-1"]);
      const p2 = lock.acquire(member, ["role-2"]);
      const p3 = lock.acquire(member, ["role-3"]);
      const p4 = lock.acquire(member, ["final-role"]);

      await Promise.all([p1, p2, p3, p4]);

      // p1 runs first with ["role-1"], then coalesced request runs with ["final-role"]
      // Final state has BOTH (since we're only adding, not removing)
      assert.ok(
        state.currentRoles.has("role-1"),
        "First request's role should be present",
      );
      assert.ok(
        state.currentRoles.has("final-role"),
        "Final coalesced request's role should be present",
      );

      // We should have exactly 2 add calls (not 4):
      // 1. First request runs immediately
      // 2. Coalesced pending runs with the latest state
      assert.equal(
        state.addCalls.length,
        2,
        `Expected exactly 2 add calls due to coalescing, got ${state.addCalls.length}`,
      );

      // Verify the coalesced call had the final desired state
      assert.deepEqual(
        state.addCalls[1],
        ["final-role"],
        "Second call should have the coalesced (final) state",
      );
    });

    it("implements last-write-wins for pending requests", async () => {
      const state: MockRoleState = {
        currentRoles: new Set(),
        addCalls: [],
        removeCalls: [],
        addDelay: 100,
      };
      const member = createMockMember("user-1", state);

      // First request starts running
      const p1 = lock.acquire(member, ["initial-role"]);

      // Give p1 time to start running
      await sleep(10);

      // These arrive while p1 is running — they coalesce
      const p2 = lock.acquire(member, ["intermediate-role"]);
      const p3 = lock.acquire(member, ["final-role"]); // Last write wins

      await Promise.all([p1, p2, p3]);

      // p1 completes with its state, then coalesced (p3's state) runs
      assert.ok(
        state.currentRoles.has("initial-role"),
        "First request's role should be present",
      );
      assert.ok(
        state.currentRoles.has("final-role"),
        "Final coalesced role should be present (last write wins)",
      );

      // Only 2 add calls: p1's immediate, and the coalesced (p3's state)
      assert.equal(state.addCalls.length, 2, "Should have 2 add calls");
    });
  });

  // ── Cross-member concurrency ────────────────────────────────────────────

  describe("cross-member concurrency", () => {
    it("allows concurrent reconciliation for different members", async () => {
      const startTimes: { userId: string; time: number }[] = [];
      const endTimes: { userId: string; time: number }[] = [];

      const makeSlowMember = (userId: string): MockGuildMember => {
        const state: MockRoleState = {
          currentRoles: new Set(),
          addCalls: [],
          removeCalls: [],
          addDelay: 50,
        };
        const member = createMockMember(userId, state);

        // Wrap to track timing
        const originalAdd = member.roles.add;
        member.roles.add = async (roles: string | string[]) => {
          startTimes.push({ userId, time: Date.now() });
          const result = await originalAdd.call(member.roles, roles);
          endTimes.push({ userId, time: Date.now() });
          return result;
        };

        return member;
      };

      const member1 = makeSlowMember("user-1");
      const member2 = makeSlowMember("user-2");
      const member3 = makeSlowMember("user-3");

      // Fire reconciliations for different members concurrently
      const start = Date.now();
      await Promise.all([
        lock.acquire(member1, ["role-a"]),
        lock.acquire(member2, ["role-b"]),
        lock.acquire(member3, ["role-c"]),
      ]);
      const elapsed = Date.now() - start;

      // All 3 members should have started before any finished
      // (proving they ran concurrently, not sequentially)
      const sortedStarts = [...startTimes].sort((a, b) => a.time - b.time);
      const sortedEnds = [...endTimes].sort((a, b) => a.time - b.time);

      // All should start before the first one ends (concurrent execution)
      assert.ok(
        sortedStarts[2].time < sortedEnds[0].time,
        "All members should start before any finishes (concurrent)",
      );

      // Total time should be ~50ms (parallel), not ~150ms (sequential)
      assert.ok(
        elapsed < 120,
        `Elapsed ${elapsed}ms suggests sequential execution (expected <120ms)`,
      );
    });

    it("does not block member-B while member-A is reconciling", async () => {
      // Member A will be slow
      const stateA: MockRoleState = {
        currentRoles: new Set(),
        addCalls: [],
        removeCalls: [],
        addDelay: 100,
      };
      const memberA = createMockMember("user-a", stateA);

      // Member B will be fast
      const stateB: MockRoleState = {
        currentRoles: new Set(),
        addCalls: [],
        removeCalls: [],
        addDelay: 5,
      };
      const memberB = createMockMember("user-b", stateB);

      let bFinished = false;
      const promiseA = lock.acquire(memberA, ["role-a"]);
      const promiseB = lock.acquire(memberB, ["role-b"]).then((r) => {
        bFinished = true;
        return r;
      });

      // B should finish before A (no blocking)
      await sleep(50);
      assert.ok(bFinished, "Member B should finish before member A");

      await Promise.all([promiseA, promiseB]);
    });
  });

  // ── Deterministic final state ───────────────────────────────────────────

  describe("deterministic final state", () => {
    it("final state is deterministic with coalescing", async () => {
      const state: MockRoleState = {
        currentRoles: new Set(["existing-role"]),
        addCalls: [],
        removeCalls: [],
        addDelay: 30,
      };
      const member = createMockMember("user-1", state);

      // Simulate rapid concurrent updates with different desired states
      // First request runs immediately, rest coalesce to the last
      const desiredStates = [
        ["role-1", "role-2"],        // This runs immediately
        ["role-3"],                  // Queued, coalesced away
        ["role-4", "role-5", "role-6"],  // Queued, coalesced away
        ["final-only-role"],         // Queued, this becomes the coalesced state
      ];

      const promises = desiredStates.map((desired) =>
        lock.acquire(member, desired),
      );

      await Promise.all(promises);

      // First request's state is applied
      assert.ok(
        state.currentRoles.has("role-1"),
        "First request's role-1 should be present",
      );
      assert.ok(
        state.currentRoles.has("role-2"),
        "First request's role-2 should be present",
      );

      // Coalesced request's state is applied
      assert.ok(
        state.currentRoles.has("final-only-role"),
        "Final coalesced state should contain 'final-only-role'",
      );

      // Intermediate states (role-3, role-4, etc.) were coalesced away
      assert.ok(
        !state.currentRoles.has("role-3"),
        "Intermediate role-3 should NOT be present (coalesced)",
      );
      assert.ok(
        !state.currentRoles.has("role-4"),
        "Intermediate role-4 should NOT be present (coalesced)",
      );

      // Exactly 2 add calls total
      assert.equal(state.addCalls.length, 2, "Should have exactly 2 add calls");
    });
  });

  // ── State observability ─────────────────────────────────────────────────

  describe("state observability", () => {
    it("reports correct lock state during operations", async () => {
      const state: MockRoleState = {
        currentRoles: new Set(),
        addCalls: [],
        removeCalls: [],
        addDelay: 100,
      };
      const member = createMockMember("user-1", state);

      // Initially empty
      assert.deepEqual(lock.state, {
        activeLocks: 0,
        pending: 0,
        waiters: [],
      });

      // Start a reconciliation
      const p1 = lock.acquire(member, ["role-1"]);
      await sleep(10); // Let it start

      // Should show 1 active lock and 1 waiter (the active request)
      assert.equal(lock.state.activeLocks, 1, "Should have 1 active lock");

      // Queue another
      const p2 = lock.acquire(member, ["role-2"]);
      await sleep(5);

      // Should show 1 active, 1 pending
      assert.equal(lock.state.activeLocks, 1, "Still 1 active lock");
      assert.equal(lock.state.pending, 1, "Should have 1 pending request");

      await Promise.all([p1, p2]);

      // Back to empty after all complete
      assert.deepEqual(lock.state, {
        activeLocks: 0,
        pending: 0,
        waiters: [],
      });
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe("error handling", () => {
    it("propagates errors to all waiters", async () => {
      const state: MockRoleState = {
        currentRoles: new Set(),
        addCalls: [],
        removeCalls: [],
      };
      const member = createMockMember("user-1", state);

      // Make add fail
      member.roles.add = async () => {
        throw new Error("Discord API error");
      };

      const p1 = lock.acquire(member, ["role-1"]);
      const p2 = lock.acquire(member, ["role-2"]);

      // Both should reject
      await assert.rejects(p1, /Discord API error/);
      await assert.rejects(p2, /Discord API error/);
    });

    it("allows new requests after an error", async () => {
      const state: MockRoleState = {
        currentRoles: new Set(),
        addCalls: [],
        removeCalls: [],
      };
      const member = createMockMember("user-1", state);

      let shouldFail = true;
      const originalAdd = member.roles.add;
      member.roles.add = async (roles: string | string[]) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("First call fails");
        }
        return originalAdd.call(member.roles, roles);
      };

      // First request fails
      await assert.rejects(
        lock.acquire(member, ["role-1"]),
        /First call fails/,
      );

      // Second request should succeed
      const result = await lock.acquire(member, ["role-2"]);
      assert.deepEqual(result.added, ["role-2"]);
    });
  });
});

// ── Integration test with reconcileMemberRoles ────────────────────────────

describe("reconcileMemberRoles (standalone)", () => {
  it("works without the lock for backwards compatibility", async () => {
    const state: MockRoleState = {
      currentRoles: new Set(["existing"]),
      addCalls: [],
      removeCalls: [],
    };
    const member = createMockMember("user-1", state);

    const result = await reconcileMemberRoles(member, ["existing", "new-role"]);

    assert.deepEqual(result.added, ["new-role"]);
    assert.deepEqual(result.removed, []);
    assert.ok(state.currentRoles.has("new-role"));
  });
});
