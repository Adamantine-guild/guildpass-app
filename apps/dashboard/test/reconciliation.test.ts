/**
 * test/reconciliation.test.ts
 *
 * Tests for the cross-repository reconciliation system.
 *
 * Validates:
 *  - Report-only mode accurately detects seeded count discrepancies
 *    without modifying any data.
 *  - Fix mode corrects discrepancies and records each correction as
 *    an auditable activity event.
 *  - The job is idempotent: running it twice with no new discrepancies
 *    makes no further changes.
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reconcileGuildCounts } from "../lib/reconciliation/index";
import type { ReconcileOptions, ReconciliationReport } from "../lib/reconciliation/types";
import {
  clearRepositories,
  getGuildRepository,
  getMemberRepository,
  getPassRepository,
  getActivityRepository,
} from "../lib/repositories/factory";
import type { Guild } from "../lib/mock-data";

// ── Test environment setup ────────────────────────────────────────────────────
// Ensure we always run in mock mode for deterministic tests.

process.env.DASHBOARD_STORAGE_MODE = "mock";
process.env.DASHBOARD_API_MODE = "mock";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create guild-aware counting functions. Each guild gets its own (members, passes)
 * count pair. Guilds not in the map get their stored values (treated as consistent).
 */
function guildAwareCounters(
  overrides: Map<string, { members: number; passes: number }>,
  guildRepo: ReturnType<typeof getGuildRepository>,
): {
  countMembers: ReconcileOptions["countMembers"];
  countPasses: ReconcileOptions["countPasses"];
} {
  return {
    countMembers: async (guildId: string) => {
      const override = overrides.get(guildId);
      if (override) return override.members;
      // Fall back to stored value for un-overridden guilds (treated as consistent)
      const guild = await guildRepo.getById(guildId);
      return guild?.memberCount ?? 0;
    },
    countPasses: async (guildId: string) => {
      const override = overrides.get(guildId);
      if (override) return override.passes;
      const guild = await guildRepo.getById(guildId);
      return guild?.passCount ?? 0;
    },
  };
}

/**
 * Create guild-aware counters for a single test guild with drifted values.
 * All other guilds get their stored (consistent) values.
 */
async function singleGuildDriftCounters(
  guildId: string,
  driftedMembers: number,
  driftedPasses: number,
): Promise<{
  countMembers: ReconcileOptions["countMembers"];
  countPasses: ReconcileOptions["countPasses"];
}> {
  const guildRepo = getGuildRepository();
  const overrides = new Map<string, { members: number; passes: number }>();
  overrides.set(guildId, { members: driftedMembers, passes: driftedPasses });
  return guildAwareCounters(overrides, guildRepo);
}

/**
 * Get the first guild from the repository and return it.
 */
async function getFirstGuild(): Promise<Guild> {
  const guildRepo = getGuildRepository();
  const guilds = await guildRepo.getAll();
  assert.ok(guilds.length > 0, "At least one guild must exist for tests");
  return guilds[0];
}

/**
 * Assert that the guild's stored counters match the expected values.
 */
async function assertGuildCounts(
  guildId: string,
  expectedMemberCount: number,
  expectedPassCount: number,
): Promise<void> {
  const guildRepo = getGuildRepository();
  const guild = await guildRepo.getById(guildId);
  assert.ok(guild, `Guild ${guildId} should exist`);
  assert.equal(
    guild.memberCount,
    expectedMemberCount,
    `memberCount should be ${expectedMemberCount}`,
  );
  assert.equal(
    guild.passCount,
    expectedPassCount,
    `passCount should be ${expectedPassCount}`,
  );
}

/**
 * Count audit events of a specific type that contain a given substring,
 * scoped to the given guild.
 */
async function countAuditEvents(
  guildId: string,
  type: string,
  descriptionSubstring: string,
): Promise<number> {
  const activityRepo = getActivityRepository();
  const events = await activityRepo.query(guildId, { type: type as any });
  return events.filter((e) => e.description.includes(descriptionSubstring)).length;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Reconciliation", () => {
  // Reset repositories before each test for clean state.
  beforeEach(() => {
    clearRepositories();
  });

  // ── Report-only mode ─────────────────────────────────────────────────────

  describe("report-only mode", () => {
    test("returns a valid report structure even when all counts are consistent", async () => {
      const guildRepo = getGuildRepository();
      const guilds = await guildRepo.getAll();

      // Use stored values for all guilds → no discrepancies
      const overrides = new Map<string, { members: number; passes: number }>();
      const { countMembers, countPasses } = guildAwareCounters(overrides, guildRepo);

      const report = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      assert.equal(report.mode, "report");
      assert.equal(report.guildsChecked, guilds.length);
      assert.equal(report.totalDiscrepancies, 0);
      assert.equal(report.discrepancies.length, 0);
      assert.equal(report.totalCorrected, 0);
      assert.ok(report.summary.includes("all consistent"));
      assert.ok(typeof report.timestamp === "string");
    });

    test("detects memberCount drift without modifying data", async () => {
      const guild = await getFirstGuild();
      const originalMemberCount = guild.memberCount;
      const driftedMemberCount = originalMemberCount + 50;

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        driftedMemberCount,
        guild.passCount, // passes consistent
      );

      const report = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      // Should detect exactly 1 discrepancy for this guild
      assert.equal(report.totalDiscrepancies, 1);
      const d = report.discrepancies[0];
      assert.equal(d.guildId, guild.id);
      assert.equal(d.field, "memberCount");
      assert.equal(d.storedValue, originalMemberCount);
      assert.equal(d.actualValue, driftedMemberCount);
      assert.equal(d.corrected, undefined); // Not corrected in report mode

      // Data must NOT have been modified
      await assertGuildCounts(guild.id, originalMemberCount, guild.passCount);
    });

    test("detects passCount drift without modifying data", async () => {
      const guild = await getFirstGuild();
      const driftedPassCount = guild.passCount + 10;

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        guild.memberCount, // members consistent
        driftedPassCount,
      );

      const report = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      assert.equal(report.totalDiscrepancies, 1);
      assert.equal(report.discrepancies[0].field, "passCount");
      assert.equal(report.discrepancies[0].storedValue, guild.passCount);
      assert.equal(report.discrepancies[0].actualValue, driftedPassCount);

      // Data must NOT have been modified
      await assertGuildCounts(guild.id, guild.memberCount, guild.passCount);
    });

    test("detects both memberCount and passCount drift simultaneously", async () => {
      const guild = await getFirstGuild();

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        guild.memberCount + 100,
        guild.passCount + 20,
      );

      const report = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      assert.equal(report.totalDiscrepancies, 2);
      assert.equal(report.totalCorrected, 0);

      const fields = report.discrepancies.map((d) => d.field).sort();
      assert.deepEqual(fields, ["memberCount", "passCount"]);

      // Data must NOT have been modified
      await assertGuildCounts(guild.id, guild.memberCount, guild.passCount);
    });

    test("summary includes discrepancy count", async () => {
      const guild = await getFirstGuild();

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        guild.memberCount + 1,
        guild.passCount,
      );

      const report = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      assert.ok(report.summary.includes("1 discrepancy"));
      assert.ok(report.summary.includes("report"));
    });
  });

  // ── Fix mode ──────────────────────────────────────────────────────────────

  describe("fix mode", () => {
    test("corrects memberCount drift and records audit event", async () => {
      const guild = await getFirstGuild();
      const originalMemberCount = guild.memberCount;
      const actualMemberCount = originalMemberCount + 25;

      // Seed drift by updating the guild to a wrong count
      const guildRepo = getGuildRepository();
      await guildRepo.update(guild.id, { memberCount: originalMemberCount - 5 });

      // Verify drift exists
      await assertGuildCounts(guild.id, originalMemberCount - 5, guild.passCount);

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        actualMemberCount,
        guild.passCount,
      );

      const report = await reconcileGuildCounts({
        mode: "fix",
        countMembers,
        countPasses,
      });

      // Should have detected and corrected 1 discrepancy
      assert.equal(report.totalDiscrepancies, 1);
      assert.equal(report.totalCorrected, 1);

      const d = report.discrepancies[0];
      assert.equal(d.field, "memberCount");
      assert.equal(d.corrected, true);

      // Verify the guild was actually corrected
      await assertGuildCounts(guild.id, actualMemberCount, guild.passCount);

      // Verify an audit event was recorded
      const auditCount = await countAuditEvents(guild.id, "guild.updated", "[RECONCILE]");
      assert.ok(auditCount >= 1, "At least one reconciliation audit event should exist");
    });

    test("corrects passCount drift and records audit event", async () => {
      const guild = await getFirstGuild();
      const actualPassCount = guild.passCount + 5;

      // Seed drift
      const guildRepo = getGuildRepository();
      await guildRepo.update(guild.id, { passCount: 1 });

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        guild.memberCount,
        actualPassCount,
      );

      const report = await reconcileGuildCounts({
        mode: "fix",
        countMembers,
        countPasses,
      });

      assert.equal(report.totalDiscrepancies, 1);
      assert.equal(report.totalCorrected, 1);
      assert.equal(report.discrepancies[0].field, "passCount");
      assert.equal(report.discrepancies[0].corrected, true);

      await assertGuildCounts(guild.id, guild.memberCount, actualPassCount);

      const auditCount = await countAuditEvents(guild.id, "guild.updated", "[RECONCILE]");
      assert.ok(auditCount >= 1);
    });

    test("corrects both memberCount and passCount simultaneously", async () => {
      const guild = await getFirstGuild();
      const actualMembers = guild.memberCount + 30;
      const actualPasses = guild.passCount + 3;

      // Seed both drifts
      const guildRepo = getGuildRepository();
      await guildRepo.update(guild.id, { memberCount: 0, passCount: 0 });

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        actualMembers,
        actualPasses,
      );

      const report = await reconcileGuildCounts({
        mode: "fix",
        countMembers,
        countPasses,
      });

      assert.equal(report.totalDiscrepancies, 2);
      assert.equal(report.totalCorrected, 2);

      await assertGuildCounts(guild.id, actualMembers, actualPasses);
    });

    test("audit event metadata contains reconciliation flag and discrepancy details", async () => {
      const guild = await getFirstGuild();

      // Seed drift
      const guildRepo = getGuildRepository();
      await guildRepo.update(guild.id, { memberCount: 99 });

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        guild.memberCount + 10,
        guild.passCount,
      );

      await reconcileGuildCounts({
        mode: "fix",
        countMembers,
        countPasses,
      });

      const activityRepo = getActivityRepository();
      const events = await activityRepo.query(guild.id, { type: "guild.updated" });
      const reconcileEvent = events.find(
        (e) =>
          e.metadata?.reconciliation === true &&
          e.description.includes("[RECONCILE]"),
      );

      assert.ok(reconcileEvent, "Should find a reconciliation audit event");
      const metadata = reconcileEvent.metadata!;
      assert.equal(metadata.mode, "fix");
      assert.equal(reconcileEvent.severity, "warning");
      assert.equal(reconcileEvent.actor.name, "Reconciliation Job");
      assert.ok(Array.isArray(metadata.discrepancies));
      assert.equal(metadata.discrepancies.length, 1);
      assert.equal(metadata.discrepancies[0].field, "memberCount");
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  describe("idempotency", () => {
    test("running fix mode twice with no new drift makes no further changes", async () => {
      const guild = await getFirstGuild();
      const actualMembers = guild.memberCount + 15;
      const actualPasses = guild.passCount;

      // Seed drift
      const guildRepo = getGuildRepository();
      await guildRepo.update(guild.id, { memberCount: guild.memberCount - 10 });

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        actualMembers,
        actualPasses,
      );

      // First run: should detect and fix
      const report1 = await reconcileGuildCounts({
        mode: "fix",
        countMembers,
        countPasses,
      });

      assert.equal(report1.totalDiscrepancies, 1);
      assert.equal(report1.totalCorrected, 1);

      // Verify correction
      await assertGuildCounts(guild.id, actualMembers, actualPasses);

      // Count audit events after first run
      const auditAfterFirst = await countAuditEvents(guild.id, "guild.updated", "[RECONCILE]");

      // Second run: should find no discrepancies (counters now match ground truth)
      const report2 = await reconcileGuildCounts({
        mode: "fix",
        countMembers,
        countPasses,
      });

      assert.equal(report2.totalDiscrepancies, 0);
      assert.equal(report2.totalCorrected, 0);
      assert.ok(report2.summary.includes("all consistent"));

      // Count audit events after second run — should be unchanged
      const auditAfterSecond = await countAuditEvents(guild.id, "guild.updated", "[RECONCILE]");
      assert.equal(
        auditAfterSecond,
        auditAfterFirst,
        "Second run should not create additional audit events",
      );
    });

    test("running report-only mode twice produces identical results", async () => {
      const guild = await getFirstGuild();

      // Seed drift
      const guildRepo = getGuildRepository();
      await guildRepo.update(guild.id, { memberCount: 999 });

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        guild.memberCount, // ground truth = original stored value
        guild.passCount,
      );

      const report1 = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      const report2 = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      // Both runs should detect the same discrepancy
      assert.equal(report1.totalDiscrepancies, report2.totalDiscrepancies);
      assert.equal(report1.totalDiscrepancies, 1);
      assert.equal(report2.totalCorrected, 0);

      // Data should still be unchanged
      await assertGuildCounts(guild.id, 999, guild.passCount);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("handles guilds with zero counts correctly", async () => {
      const guildRepo = getGuildRepository();
      const newGuild = await guildRepo.create({
        name: "Zero Count Guild",
        description: "Test guild with zero counters",
        memberCount: 0,
        passCount: 0,
      });

      // Counters claim zero, ground truth also says zero — should be consistent
      const { countMembers, countPasses } = guildAwareCounters(
        new Map(),
        guildRepo,
      );

      const report = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      const guildDiscrepancy = report.discrepancies.find(
        (d) => d.guildId === newGuild.id,
      );
      assert.equal(guildDiscrepancy, undefined, "Zero-count guild should have no discrepancy");
    });

    test("detects zero stored count vs non-zero actual count", async () => {
      const guildRepo = getGuildRepository();
      const newGuild = await guildRepo.create({
        name: "Drifted Zero Guild",
        description: "Test guild with zero stored but non-zero actual",
        memberCount: 0,
        passCount: 0,
      });

      const overrides = new Map<string, { members: number; passes: number }>();
      overrides.set(newGuild.id, { members: 50, passes: 5 });
      const { countMembers, countPasses } = guildAwareCounters(overrides, guildRepo);

      const report = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      const guildDiscrepancies = report.discrepancies.filter(
        (d) => d.guildId === newGuild.id,
      );
      assert.equal(guildDiscrepancies.length, 2);
      assert.equal(guildDiscrepancies[0].storedValue, 0);
      assert.equal(guildDiscrepancies[0].actualValue, 50);
      assert.equal(guildDiscrepancies[1].storedValue, 0);
      assert.equal(guildDiscrepancies[1].actualValue, 5);
    });

    test("report contains all required fields", async () => {
      const guild = await getFirstGuild();

      const { countMembers, countPasses } = await singleGuildDriftCounters(
        guild.id,
        guild.memberCount + 1,
        guild.passCount,
      );

      const report = await reconcileGuildCounts({
        mode: "report",
        countMembers,
        countPasses,
      });

      assert.ok(typeof report.timestamp === "string");
      assert.ok(report.mode === "report" || report.mode === "fix");
      assert.ok(typeof report.guildsChecked === "number");
      assert.ok(Array.isArray(report.discrepancies));
      assert.ok(typeof report.totalDiscrepancies === "number");
      assert.ok(typeof report.totalCorrected === "number");
      assert.ok(typeof report.summary === "string");

      if (report.discrepancies.length > 0) {
        const d = report.discrepancies[0];
        assert.ok(typeof d.guildId === "string");
        assert.ok(typeof d.guildName === "string");
        assert.ok(d.field === "memberCount" || d.field === "passCount");
        assert.ok(typeof d.storedValue === "number");
        assert.ok(typeof d.actualValue === "number");
      }
    });
  });
});

