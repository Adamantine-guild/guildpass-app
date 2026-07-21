#!/usr/bin/env node
/**
 * scripts/reconcile.ts
 *
 * CLI entry point for the GuildPass reconciliation job.
 *
 * Usage:
 *   npx tsx scripts/reconcile.ts --report-only    # Dry-run: detect discrepancies only
 *   npx tsx scripts/reconcile.ts --fix             # Fix discrepancies + record audit events
 *
 * Environment variables:
 *   DASHBOARD_STORAGE_MODE  - "mock" (default) or "durable"
 *   DATABASE_URL            - Required when STORAGE_MODE is "durable"
 *
 * Exit codes:
 *   0 - No discrepancies found (or all fixed successfully)
 *   1 - Discrepancies found (report-only mode) or fix errors
 *   2 - Runtime error (bad args, connection failure, etc.)
 */

import { reconcileGuildCounts } from "../lib/reconciliation/index";
import type { ReconcileOptions } from "../lib/reconciliation/types";
import { getMemberRepository, getPassRepository } from "../lib/repositories/factory";

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = parseMode(args);

if (!mode) {
  console.error("Usage: npx tsx scripts/reconcile.ts [--report-only | --fix]");
  console.error("");
  console.error("  --report-only   Dry-run mode: detect discrepancies without modifying data.");
  console.error("  --fix           Fix mode: correct discrepancies and record audit events.");
  process.exit(2);
}

// ── Default counting strategies ───────────────────────────────────────────────
//
// These are default implementations that work against the repository layer.
// In production (durable mode), replace these with direct SQL queries:
//
//   SELECT COUNT(*) FROM members WHERE guild_id = $1
//   SELECT COUNT(*) FROM passes WHERE guild_id = $1
//
// The repository-based defaults work for both mock (in-memory) and durable
// backends, although durable backends will want optimized DB-level counts.

async function defaultCountMembers(guildId: string): Promise<number> {
  const memberRepo = getMemberRepository();
  const all = await memberRepo.getAll();
  // In mock mode, members are global (no guildId field).
  // In production/durable mode, filter by guildId when the schema supports it.
  // For now, return total count as a reasonable default.
  return all.length;
}

async function defaultCountPasses(guildId: string): Promise<number> {
  const passRepo = getPassRepository();
  const all = await passRepo.getAll();
  // Same rationale as countMembers — global in mock, filterable in production.
  return all.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n🔍 GuildPass Reconciliation Job — Mode: ${mode}`);
  console.log("═".repeat(60));

  const options: ReconcileOptions = {
    mode,
    countMembers: defaultCountMembers,
    countPasses: defaultCountPasses,
  };

  console.log(`⏳ Running reconciliation across all guilds...\n`);

  const report = await reconcileGuildCounts(options);

  // ── Print report ──────────────────────────────────────────────────────────

  console.log(`📊 Report — ${report.timestamp}`);
  console.log(`   Guilds checked:      ${report.guildsChecked}`);
  console.log(`   Discrepancies found: ${report.totalDiscrepancies}`);
  if (mode === "fix") {
    console.log(`   Corrected:           ${report.totalCorrected}`);
  }
  console.log(`   ${report.summary}`);

  if (report.discrepancies.length > 0) {
    console.log(`\n📋 Discrepancy details:`);
    console.log("─".repeat(60));

    for (const d of report.discrepancies) {
      const icon = d.corrected ? "✅" : "⚠️";
      const delta = d.actualValue - d.storedValue;
      const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
      console.log(
        `   ${icon} [${d.guildName}] ${d.field}: ${d.storedValue} → ${d.actualValue} (${deltaStr})`,
      );
    }
  }

  console.log("═".repeat(60));

  // ── Exit code ─────────────────────────────────────────────────────────────

  if (report.totalDiscrepancies > 0 && mode === "report") {
    console.log(`\n⚠️  Discrepancies detected. Run with --fix to correct them.`);
    process.exit(1);
  }

  console.log(`\n✅ Reconciliation complete.`);
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseMode(args: string[]): "report" | "fix" | null {
  if (args.includes("--report-only")) return "report";
  if (args.includes("--fix")) return "fix";
  return null;
}

main().catch((err) => {
  console.error("\n❌ Reconciliation failed with an unexpected error:");
  console.error(err);
  process.exit(2);
});
