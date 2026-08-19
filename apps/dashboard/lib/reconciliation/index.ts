/**
 * lib/reconciliation/index.ts
 *
 * Core reconciliation engine that detects and optionally corrects drift
 * between denormalized Guild counters (memberCount / passCount) and the
 * actual ground-truth Member / Pass tables.
 *
 * Design principles:
 *  - Ground-truth is always the real tables (Members, Passes), never the cached count.
 *  - Report-only mode is read-only — no side effects, safe to run anytime.
 *  - Fix mode writes corrections and records each as an auditable activity event.
 *  - The job is idempotent: running it twice with no new drift makes no changes.
 */

import type {
  ReconciliationReport,
  GuildDiscrepancy,
  ReconcileOptions,
} from "./types";
import type { Guild } from "../mock-data";
import type { ActivityChange } from "@guildpass/integration-client";
import { getGuildRepository, getActivityRepository } from "../repositories/factory";
import { computeDiff } from "../activity/diff";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reconcile all guilds' memberCount and passCount against actual table counts.
 *
 * @param options - Reconciliation mode and counting strategies.
 * @returns A full ReconciliationReport with per-guild discrepancy details.
 */
export async function reconcileGuildCounts(
  options: ReconcileOptions,
): Promise<ReconciliationReport> {
  const { mode, countMembers, countPasses } = options;
  const guildRepo = getGuildRepository();
  const guilds = await guildRepo.getAll();

  const discrepancies: GuildDiscrepancy[] = [];
  let totalCorrected = 0;

  for (const guild of guilds) {
    const guildDiscrepancies = await checkGuild(guild, countMembers, countPasses);

    if (guildDiscrepancies.length === 0) continue;

    if (mode === "fix") {
      const corrected = await fixGuildDiscrepancies(guild, guildDiscrepancies, guildRepo);
      discrepancies.push(...corrected);
      totalCorrected += corrected.filter((d) => d.corrected).length;
    } else {
      discrepancies.push(...guildDiscrepancies);
    }
  }

  const totalDiscrepancies = discrepancies.length;

  return {
    timestamp: new Date().toISOString(),
    mode,
    guildsChecked: guilds.length,
    discrepancies,
    totalDiscrepancies,
    totalCorrected,
    summary: buildSummary(mode, guilds.length, totalDiscrepancies, totalCorrected),
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Check a single guild for memberCount / passCount drift.
 * Returns an array of discrepancies (empty if consistent).
 */
async function checkGuild(
  guild: Guild,
  countMembers: ReconcileOptions["countMembers"],
  countPasses: ReconcileOptions["countPasses"],
): Promise<GuildDiscrepancy[]> {
  const [actualMembers, actualPasses] = await Promise.all([
    countMembers(guild.id),
    countPasses(guild.id),
  ]);

  const results: GuildDiscrepancy[] = [];

  if (actualMembers !== guild.memberCount) {
    results.push({
      guildId: guild.id,
      guildName: guild.name,
      field: "memberCount",
      storedValue: guild.memberCount,
      actualValue: actualMembers,
    });
  }

  if (actualPasses !== guild.passCount) {
    results.push({
      guildId: guild.id,
      guildName: guild.name,
      field: "passCount",
      storedValue: guild.passCount,
      actualValue: actualPasses,
    });
  }

  return results;
}

/**
 * Correct the discrepancies for a single guild by updating the stored counters
 * and recording an audit event for each correction.
 *
 * Returns the discrepancies with `corrected` set to true for successfully
 * corrected fields.
 */
async function fixGuildDiscrepancies(
  guild: Guild,
  discrepancies: GuildDiscrepancy[],
  guildRepo: ReturnType<typeof getGuildRepository>,
): Promise<GuildDiscrepancy[]> {
  // Build the correction patch by applying actual values for each drifted field.
  const patch: Partial<Guild> = {};

  for (const d of discrepancies) {
    patch[d.field] = d.actualValue;
  }

  // Update the guild record. This also records a guild.updated activity event
  // via the repository's built-in diff + audit logic.
  const previous = { ...guild };
  await guildRepo.update(guild.id, patch);

  // Record a dedicated reconciliation audit event with structured diff.
  await recordReconciliationAudit(guild.id, guild.name, previous, patch, discrepancies);

  // Mark each discrepancy as corrected.
  return discrepancies.map((d) => ({
    ...d,
    corrected: true,
  }));
}

/**
 * Record a dedicated audit event for the reconciliation correction.
 * Uses the activity repository directly to create a "guild.reconciled" event
 * with a structured diff showing what changed and why.
 */
async function recordReconciliationAudit(
  guildId: string,
  guildName: string,
  previous: Guild,
  patch: Partial<Guild>,
  discrepancies: GuildDiscrepancy[],
): Promise<void> {
  const activityRepo = getActivityRepository();

  // Compute a structured diff for the audit trail
  const changes: ActivityChange[] = computeDiff(
    previous as unknown as Record<string, unknown>,
    { ...previous, ...patch } as unknown as Record<string, unknown>,
  );

  const description = discrepancies
    .map((d) => `${d.field}: ${d.storedValue} → ${d.actualValue}`)
    .join("; ");

  await activityRepo.append(guildId, {
    type: "guild.updated",
    source: "dashboard",
    severity: "warning",
    actor: { name: "Reconciliation Job" },
    description: `[RECONCILE] Corrected guild "${guildName}" counters: ${description}`,
    entity: { type: "guild", id: guildId, name: guildName },
    metadata: {
      reconciliation: true,
      mode: "fix",
      discrepancies: discrepancies.map((d) => ({
        field: d.field,
        storedValue: d.storedValue,
        actualValue: d.actualValue,
      })),
    },
    changes,
  });
}

/**
 * Build a human-readable summary line for the reconciliation report.
 */
function buildSummary(
  mode: string,
  guildsChecked: number,
  totalDiscrepancies: number,
  totalCorrected: number,
): string {
  if (totalDiscrepancies === 0) {
    return `Reconciliation (${mode}): Checked ${guildsChecked} guild(s) — all consistent.`;
  }

  if (mode === "fix") {
    return `Reconciliation (fix): Checked ${guildsChecked} guild(s), found ${totalDiscrepancies} discrepancy(ies), corrected ${totalCorrected}.`;
  }

  return `Reconciliation (report): Checked ${guildsChecked} guild(s), found ${totalDiscrepancies} discrepancy(ies).`;
}
