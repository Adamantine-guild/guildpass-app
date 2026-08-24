#!/usr/bin/env tsx
/**
 * backfill.ts — GuildPass Access-API backfill / replay CLI
 *
 * Reprocesses a historical block range through the same event-processing
 * logic as the live MembershipIndexer, without touching IndexerCheckpoint.
 *
 * Usage:
 *   pnpm tsx scripts/backfill.ts --from-block 1000000 --to-block 1050000
 *   pnpm tsx scripts/backfill.ts --from-block 1000000 --to-block 1050000 --dry-run
 *   pnpm tsx scripts/backfill.ts --from-block 1000000 --to-block 1050000 --batch-size 500
 *
 * Flags:
 *   --from-block  <n>   First block to include (required)
 *   --to-block    <n>   Last block to include (required)
 *   --dry-run           Preview what would change without writing (optional)
 *   --batch-size  <n>   Number of blocks per RPC getLogs call (default: 1000)
 *   --yes               Skip confirmation prompt (useful in CI)
 *
 * Environment variables (same as the live indexer):
 *   DATABASE_URL
 *   RPC_URL
 *   MEMBERSHIP_CONTRACT_ADDRESS
 *   INDEXER_CONFIRMATION_DEPTH   (default: 10)
 *   INDEXER_START_BLOCK          (default: 0)
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import * as readline from "node:readline";
import { PrismaClient } from "@prisma/client";
import { type Address } from "viem";

import {
  IndexerCore,
  type ProcessRangeResult,
  type IndexerConfig,
} from "../src/workers/indexer.js";
import {
  BackfillLock,
  BackfillLockError,
} from "../src/utils/backfill-lock.js";

// ─── Argument parsing ─────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    "from-block": { type: "string" },
    "to-block": { type: "string" },
    "batch-size": { type: "string", default: "1000" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: false,
});

function printHelp() {
  console.log(`
GuildPass Backfill CLI

  Reprocess a historical block range through the MembershipIndexer event
  pipeline without disturbing the live indexer's checkpoint.

Usage:
  pnpm tsx scripts/backfill.ts --from-block <n> --to-block <n> [options]

Options:
  --from-block  <n>   First block to include in the replay (required)
  --to-block    <n>   Last block to include in the replay (required)
  --batch-size  <n>   Blocks per RPC getLogs call (default: 1000)
  --dry-run           Preview changes without writing to the database
  --yes               Skip the confirmation prompt (useful in CI / scripts)
  --help              Show this help message

Environment variables:
  DATABASE_URL                    PostgreSQL connection string
  RPC_URL                         EVM RPC endpoint
  MEMBERSHIP_CONTRACT_ADDRESS     Contract to index
  INDEXER_CONFIRMATION_DEPTH      (default: 10)
  INDEXER_START_BLOCK             (default: 0)

Examples:
  # Dry-run: see what would change for blocks 1M-1.05M
  pnpm tsx scripts/backfill.ts --from-block 1000000 --to-block 1050000 --dry-run

  # Live backfill with auto-confirm
  pnpm tsx scripts/backfill.ts --from-block 1000000 --to-block 1050000 --yes
`);
}

if (args.help) {
  printHelp();
  process.exit(0);
}

// ─── Validation ───────────────────────────────────────────────────────────────

function exitError(msg: string): never {
  console.error(`\n✗ Error: ${msg}\n`);
  process.exit(1);
}

if (!args["from-block"]) exitError("--from-block is required. Run with --help for usage.");
if (!args["to-block"]) exitError("--to-block is required. Run with --help for usage.");

const fromBlock = BigInt(args["from-block"] as string);
const toBlock = BigInt(args["to-block"] as string);
const batchSize = BigInt(args["batch-size"] as string);
const dryRun = args["dry-run"] as boolean;
const autoYes = args["yes"] as boolean;

if (fromBlock > toBlock) {
  exitError(`--from-block (${fromBlock}) must be ≤ --to-block (${toBlock})`);
}
if (batchSize < 1n) {
  exitError("--batch-size must be a positive integer");
}

// ─── Environment ─────────────────────────────────────────────────────────────

const rpcUrl = process.env.RPC_URL;
const contractAddress = process.env.MEMBERSHIP_CONTRACT_ADDRESS as Address;
const confirmationDepth = parseInt(process.env.INDEXER_CONFIRMATION_DEPTH ?? "10", 10);
const startBlock = BigInt(process.env.INDEXER_START_BLOCK ?? "0");

if (!rpcUrl) exitError("RPC_URL environment variable is not set.");
if (!contractAddress) exitError("MEMBERSHIP_CONTRACT_ADDRESS environment variable is not set.");

// ─── Confirmation prompt ──────────────────────────────────────────────────────

async function confirm(question: string): Promise<boolean> {
  if (autoYes) return true;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

function fmt(n: bigint): string {
  return n.toLocaleString("en-US");
}

function printBanner() {
  const mode = dryRun ? "DRY-RUN (no writes)" : "LIVE (writes to DB)";
  const totalBlocks = toBlock - fromBlock + 1n;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          GuildPass  Backfill / Replay CLI                ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Mode        : ${mode}`);
  console.log(`  Range       : blocks ${fmt(fromBlock)} → ${fmt(toBlock)}`);
  console.log(`  Total blocks: ${fmt(totalBlocks)}`);
  console.log(`  Batch size  : ${fmt(batchSize)} blocks/call`);
  console.log(`  Contract    : ${contractAddress}`);
  console.log(`  RPC         : ${rpcUrl}`);
  console.log("");
}

function printBatchProgress(
  batchIdx: number,
  totalBatches: number,
  batchFrom: bigint,
  batchTo: bigint,
  result: ProcessRangeResult
) {
  const pct = Math.round(((batchIdx + 1) / totalBatches) * 100);
  console.log(
    `  [${String(batchIdx + 1).padStart(String(totalBatches).length)}/${totalBatches}] ` +
      `blocks ${fmt(batchFrom)}-${fmt(batchTo)} | ` +
      `found=${result.logsFound} applied=${result.logsApplied} skipped=${result.logsSkipped} | ` +
      `${pct}%`
  );
}

function printSummary(
  totals: { logsFound: number; logsApplied: number; logsSkipped: number },
  elapsed: number
) {
  console.log("");
  console.log("── Summary ──────────────────────────────────────────────────");
  console.log(`  Logs found  : ${totals.logsFound}`);
  console.log(`  Logs applied: ${totals.logsApplied}`);
  console.log(`  Logs skipped: ${totals.logsSkipped} (already up-to-date)`);
  console.log(`  Elapsed     : ${(elapsed / 1000).toFixed(1)}s`);
  if (dryRun) {
    console.log("");
    console.log("  ℹ  DRY-RUN complete — no changes were written.");
    console.log("     Re-run without --dry-run to apply.");
  } else {
    console.log("");
    console.log("  ✓ Backfill complete.");
  }
  console.log("");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  // Confirmation gate ─────────────────────────────────────────────────────────
  if (!dryRun) {
    const ok = await confirm(
      `⚠  This will write membership state to the database for ${fmt(toBlock - fromBlock + 1n)} blocks.\n  Proceed?`
    );
    if (!ok) {
      console.log("\nAborted.\n");
      process.exit(0);
    }
    console.log("");
  }

  const prisma = new PrismaClient();
  const lock = new BackfillLock(prisma);

  // Lock acquisition ──────────────────────────────────────────────────────────
  let lockAcquired = false;
  try {
    if (!dryRun) {
      console.log("Acquiring backfill lock…");
      const { staleLiveIndexerDetected } = await lock.acquireBackfillLock(
        fromBlock,
        toBlock
      );

      if (staleLiveIndexerDetected) {
        console.warn(
          "  ⚠  A stale live-indexer lock was detected (heartbeat expired). " +
            "Proceeding — but verify the live indexer is truly stopped."
        );
      } else {
        console.log("  ✓ Lock acquired.");
      }
    }
    lockAcquired = !dryRun;

    // Build config ─────────────────────────────────────────────────────────────
    const config: IndexerConfig = {
      rpcUrl: rpcUrl!,
      contractAddress,
      confirmationDepth,
      startBlock,
    };

    const core = new IndexerCore(config);

    // Batch iteration ──────────────────────────────────────────────────────────
    console.log(`\nProcessing range ${fmt(fromBlock)} → ${fmt(toBlock)} …\n`);

    const totalBlocks = toBlock - fromBlock + 1n;
    const totalBatches = Number((totalBlocks + batchSize - 1n) / batchSize);

    const totals = { logsFound: 0, logsApplied: 0, logsSkipped: 0 };
    const startTime = Date.now();
    const allPreviews: ProcessRangeResult["preview"] = [];

    for (let i = 0; i < totalBatches; i++) {
      const batchFrom = fromBlock + BigInt(i) * batchSize;
      const batchTo =
        batchFrom + batchSize - 1n < toBlock ? batchFrom + batchSize - 1n : toBlock;

      const result = await core.processRange({
        fromBlock: batchFrom,
        toBlock: batchTo,
        dryRun,
      });

      totals.logsFound += result.logsFound;
      totals.logsApplied += result.logsApplied;
      totals.logsSkipped += result.logsSkipped;
      allPreviews.push(...result.preview);

      printBatchProgress(i, totalBatches, batchFrom, batchTo, result);
    }

    const elapsed = Date.now() - startTime;

    // Dry-run preview output ────────────────────────────────────────────────────
    if (dryRun && allPreviews.length > 0) {
      console.log("\n── Dry-run preview ──────────────────────────────────────");
      for (const ev of allPreviews) {
        const tag = ev.alreadyProcessed ? "[SKIP]" : "[APPLY]";
        const args = JSON.stringify(ev.args, (_, v) =>
          typeof v === "bigint" ? v.toString() : v
        );
        console.log(
          `  ${tag} block=${fmt(ev.blockNumber)} tx=${ev.transactionHash.slice(0, 10)}… ` +
            `logIdx=${ev.logIndex} type=${ev.eventType} args=${args}`
        );
      }
    }

    printSummary(totals, elapsed);
  } catch (err) {
    if (err instanceof BackfillLockError) {
      console.error(`\n✗ Lock error: ${err.message}\n`);
      process.exit(2);
    }
    console.error("\n✗ Unexpected error during backfill:", err);
    process.exit(1);
  } finally {
    if (lockAcquired) {
      await lock.releaseBackfillLock();
    }
    await (prisma as any).$disconnect();
  }
}

// main() handles its own errors (exit codes) — no await needed at top level
void main();
