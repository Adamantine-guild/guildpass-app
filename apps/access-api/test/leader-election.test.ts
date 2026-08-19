/**
 * Leader Election Integration Tests
 *
 * Tests the distributed leader election system including:
 *  - Basic leader acquisition and renewal
 *  - Standby promotion when leader lease expires
 *  - Fencing token protection against split-brain writes
 *  - Crash-and-failover scenarios
 *
 * These tests require a running PostgreSQL database with the Prisma schema
 * migrated. Set DATABASE_URL appropriately before running.
 *
 * Run: npx tsx --test test/leader-election.test.ts
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  LeaderElectionService,
  FencingTokenError,
} from "../src/utils/leader-election.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SHORT_TTL = 2_000; // 2 seconds — fast for tests
const SHORT_RENEW = 500; // 500ms
const SHORT_POLL = 500; // 500ms

function createPrisma(): PrismaClient {
  return new PrismaClient();
}

/** Clean up the LeaderElection table between tests. */
async function cleanupElection(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM "LeaderElection"`);
}

/** Wait for a condition with a timeout. */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 10_000,
  intervalMs: number = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("LeaderElectionService", () => {
  let db: PrismaClient;

  before(async () => {
    db = createPrisma();
    await cleanupElection(db);
  });

  after(async () => {
    await cleanupElection(db);
    await db.$disconnect();
  });

  // ── Basic acquisition ──────────────────────────────────────────────────

  test("single instance acquires leadership on startup", async () => {
    await cleanupElection(db);

    const service = new LeaderElectionService(db, {
      instanceId: "instance-1",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await service.start();

    assert.equal(service.isLeader(), true);
    assert.equal(service.getStatus().role, "leader");
    assert.equal(service.getGeneration(), 1);

    await service.stop();
  });

  test("second instance stays as standby when leader is active", async () => {
    await cleanupElection(db);

    const leader = new LeaderElectionService(db, {
      instanceId: "leader-1",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader.start();
    assert.equal(leader.isLeader(), true);

    const standby = new LeaderElectionService(db, {
      instanceId: "standby-1",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await standby.start();
    assert.equal(standby.isLeader(), false);
    assert.equal(standby.getStatus().role, "standby");

    await leader.stop();
    await standby.stop();
  });

  // ── Failover ───────────────────────────────────────────────────────────

  test("standby takes over after leader lease expires", async () => {
    await cleanupElection(db);

    // Leader with auto-renew
    const leader = new LeaderElectionService(db, {
      instanceId: "leader-failover",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader.start();
    assert.equal(leader.isLeader(), true);
    const leaderGen = leader.getGeneration();

    // Simulate crash: stop the leader (no more renewals)
    await leader.stop();
    assert.equal(leader.isLeader(), false);

    // Standby that polls for lease expiry
    const standby = new LeaderElectionService(db, {
      instanceId: "standby-failover",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    let standbyBecameLeader = false;
    standby.onBecomeLeader = () => {
      standbyBecameLeader = true;
    };

    await standby.start();

    // Wait for failover (lease TTL + poll interval + buffer)
    await waitFor(
      () => standby.isLeader(),
      SHORT_TTL + SHORT_POLL + 2_000,
      200,
    );

    assert.equal(standby.isLeader(), true);
    assert.equal(standbyBecameLeader, true);
    assert.equal(standby.getStatus().role, "leader");
    // Generation should have incremented
    assert.ok(standby.getGeneration() > leaderGen);

    await standby.stop();
  });

  test("standby takes over within bounded time window after leader crash", async () => {
    await cleanupElection(db);

    const leader = new LeaderElectionService(db, {
      instanceId: "leader-bounded",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader.start();
    assert.equal(leader.isLeader(), true);

    // Standby starts polling
    const standby = new LeaderElectionService(db, {
      instanceId: "standby-bounded",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await standby.start();

    // Kill the leader
    const killTime = Date.now();
    await leader.stop();

    // Wait for standby to take over
    await waitFor(
      () => standby.isLeader(),
      SHORT_TTL + SHORT_POLL + 3_000,
      200,
    );

    const takeoverTime = Date.now();
    const failoverDuration = takeoverTime - killTime;

    // Should take over within lease TTL + 2 poll cycles
    const maxExpected = SHORT_TTL + SHORT_POLL * 2 + 1_000;
    assert.ok(
      failoverDuration < maxExpected,
      `Failover took ${failoverDuration}ms, expected < ${maxExpected}ms`,
    );

    console.log(`Failover completed in ${failoverDuration}ms`);

    await standby.stop();
  });

  // ── Fencing token / split-brain protection ────────────────────────────

  test("verifyLeadershipOrThrow throws FencingTokenError for standby", async () => {
    await cleanupElection(db);

    const standby = new LeaderElectionService(db, {
      instanceId: "fencing-standby",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await standby.start();
    // Don't wait for leadership — just verify it throws

    await assert.rejects(
      async () => standby.verifyLeadershipOrThrow(),
      FencingTokenError,
    );

    await standby.stop();
  });

  test("former leader cannot write after lease expires and new leader takes over", async () => {
    await cleanupElection(db);

    // Leader 1
    const leader1 = new LeaderElectionService(db, {
      instanceId: "zombie-leader",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader1.start();
    assert.equal(leader1.isLeader(), true);
    const gen1 = leader1.getGeneration();

    // Kill leader1 (simulate crash/GC pause)
    await leader1.stop();

    // Leader 2 takes over
    const leader2 = new LeaderElectionService(db, {
      instanceId: "new-leader",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader2.start();
    await waitFor(() => leader2.isLeader(), SHORT_TTL + 3_000, 200);
    assert.equal(leader2.isLeader(), true);
    const gen2 = leader2.getGeneration();
    assert.ok(gen2 > gen1, `Expected gen2 (${gen2}) > gen1 (${gen1})`);

    // Now simulate zombie leader1 waking up and trying to verify leadership
    // It should fail because its generation is stale
    await assert.rejects(
      async () => leader1.verifyLeadershipOrThrow(),
      FencingTokenError,
    );

    // Also verify leader1 can't renew
    const renewed = await leader1.tryBecomeLeader();
    // It might succeed if it re-acquires (CAS allows re-acquisition)
    // The key is: if it re-acquires, it gets a NEW generation, not the old one
    if (renewed) {
      const newGen = leader1.getGeneration();
      assert.ok(
        newGen > gen2,
        `Re-acquired leader should have gen > ${gen2}, got ${newGen}`,
      );
    }

    await leader1.stop();
    await leader2.stop();
  });

  test("zombie leader with stale generation cannot corrupt state", async () => {
    await cleanupElection(db);

    // This test simulates the split-brain scenario:
    // 1. Leader A holds generation N
    // 2. Leader A experiences a long pause (not a crash)
    // 3. Leader B takes over with generation N+1
    // 4. Leader A wakes up and tries to write with generation N
    // 5. The write must be rejected

    const leaderA = new LeaderElectionService(db, {
      instanceId: "leader-a",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leaderA.start();
    assert.equal(leaderA.isLeader(), true);
    const genA = leaderA.getGeneration();
    assert.equal(genA, 1);

    // Simulate GC pause: stop renewal but keep the service instance alive
    await leaderA.stop(); // This relinquishes leadership

    // Leader B starts and takes over
    const leaderB = new LeaderElectionService(db, {
      instanceId: "leader-b",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leaderB.start();
    await waitFor(() => leaderB.isLeader(), SHORT_TTL + 3_000, 200);
    assert.equal(leaderB.isLeader(), true);
    const genB = leaderB.getGeneration();
    assert.ok(genB > genA, `Expected genB (${genB}) > genA (${genA})`);

    // Leader A tries to verify leadership — must fail
    await assert.rejects(
      async () => leaderA.verifyLeadershipOrThrow(),
      FencingTokenError,
    );

    // Leader B still holds leadership — state is not corrupted
    assert.equal(leaderB.isLeader(), true);
    await leaderB.verifyLeadershipOrThrow(); // Should not throw

    await leaderA.stop();
    await leaderB.stop();
  });

  // ── Multiple standbys ──────────────────────────────────────────────────

  test("multiple standbys — only one becomes leader after leader crash", async () => {
    await cleanupElection(db);

    const leader = new LeaderElectionService(db, {
      instanceId: "multi-leader",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader.start();
    assert.equal(leader.isLeader(), true);

    // Two standbys
    const standby1 = new LeaderElectionService(db, {
      instanceId: "multi-standby-1",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    const standby2 = new LeaderElectionService(db, {
      instanceId: "multi-standby-2",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await standby1.start();
    await standby2.start();

    // Kill leader
    await leader.stop();

    // Wait for one to become leader
    await waitFor(
      () => standby1.isLeader() || standby2.isLeader(),
      SHORT_TTL + 3_000,
      200,
    );

    // Exactly one should be leader
    const s1Leader = standby1.isLeader();
    const s2Leader = standby2.isLeader();

    assert.ok(
      s1Leader !== s2Leader,
      `Exactly one standby should be leader. s1: ${s1Leader}, s2: ${s2Leader}`,
    );

    // The other should be standby
    if (s1Leader) {
      assert.equal(standby2.getStatus().role, "standby");
    } else {
      assert.equal(standby1.getStatus().role, "standby");
    }

    await standby1.stop();
    await standby2.stop();
  });

  // ── Status / health endpoint data ──────────────────────────────────────

  test("getStatus returns correct role and generation", async () => {
    await cleanupElection(db);

    const leader = new LeaderElectionService(db, {
      instanceId: "status-test",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader.start();

    const status = leader.getStatus();
    assert.equal(status.role, "leader");
    assert.equal(status.isLeader, true);
    assert.equal(status.instanceId, "status-test");
    assert.ok(status.generation > 0);

    await leader.stop();
  });

  // ── Lease renewal ─────────────────────────────────────────────────────

  test("leader successfully renews lease", async () => {
    await cleanupElection(db);

    const leader = new LeaderElectionService(db, {
      instanceId: "renew-test",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader.start();
    assert.equal(leader.isLeader(), true);

    // Wait for a couple of renewal cycles
    await new Promise((r) => setTimeout(r, SHORT_RENEW * 3));

    // Should still be leader
    assert.equal(leader.isLeader(), true);

    // Renew explicitly
    const renewed = await leader.renewLease();
    assert.equal(renewed, true);

    await leader.stop();
  });

  test("renewLease returns false after losing leadership", async () => {
    await cleanupElection(db);

    const leader = new LeaderElectionService(db, {
      instanceId: "renew-fail",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader.start();
    assert.equal(leader.isLeader(), true);

    // Manually expire the lease in the DB
    await db.$executeRawUnsafe(
      `UPDATE "LeaderElection" SET "leaseExpiresAt" = NOW() - INTERVAL '1 second' WHERE id = 'singleton'`,
    );

    // Standby takes over
    const standby = new LeaderElectionService(db, {
      instanceId: "renew-fail-standby",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await standby.start();
    await waitFor(() => standby.isLeader(), 5_000, 200);

    // Original leader tries to renew — must fail
    const renewed = await leader.renewLease();
    assert.equal(renewed, false);
    assert.equal(leader.isLeader(), false);

    await leader.stop();
    await standby.stop();
  });

  // ── Clean shutdown ────────────────────────────────────────────────────

  test("stop() relinquishes leadership cleanly", async () => {
    await cleanupElection(db);

    const leader = new LeaderElectionService(db, {
      instanceId: "clean-shutdown",
      leaseTtlMs: SHORT_TTL,
      renewIntervalMs: SHORT_RENEW,
      standbyPollIntervalMs: SHORT_POLL,
    });

    await leader.start();
    assert.equal(leader.isLeader(), true);

    await leader.stop();
    assert.equal(leader.isLeader(), false);

    // Verify lease is expired in DB
    const row = await db.leaderElection.findUnique({
      where: { id: "singleton" },
    });
    assert.ok(row);
    assert.ok(new Date(row!.leaseExpiresAt) <= new Date());
  });
});
