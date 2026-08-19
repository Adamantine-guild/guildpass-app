/**
 * Sharded entry point for the GuildPass Discord bot.
 *
 * ## When to use this entry point
 *
 * Discord **requires** sharding once your bot reaches 2 500 guilds.
 * Even before that threshold, sharding improves responsiveness by
 * distributing gateway connections across multiple processes.
 *
 * Use this entry point (`shard.ts`) when:
 * - Your bot is in 1 000+ guilds and you want to prepare for scale
 * - You're deploying to production with the intent to grow
 * - You want per-shard process isolation (one shard crashing doesn't
 *   take down the entire bot)
 *
 * Use the single-process entry point (`index.ts`) when:
 * - You're in early development / testing
 * - Your bot is in fewer than ~500 guilds
 * - You're self-hosting on a single small machine
 *
 * ## How it works
 *
 * The `ShardingManager` spawns one child process per shard.  Each
 * child process runs `bot.ts` which creates its own `Client` instance
 * that only handles the guilds assigned to that shard.  Discord
 * automatically distributes guilds across shards based on
 * `(guild_id >> 22) % shardCount`.
 *
 * Because our `config.ts` reads from environment variables, each shard
 * process inherits the same configuration.  Our `RoleReconciliationQueue`
 * is per-process with per-guild serialization — since a guild is only
 * ever assigned to one shard, this is naturally shard-safe.
 *
 * ## Usage
 *
 * ```sh
 * # Auto-detect shard count (recommended)
 * SHARD_COUNT=auto tsx src/shard.ts
 *
 * # Fixed shard count
 * SHARD_COUNT=4 tsx src/shard.ts
 *
 * # Run specific shards only (multi-machine deployment)
 * SHARDS=0,1 tsx src/shard.ts
 * ```
 *
 * ## Environment variables
 *
 * | Variable       | Default   | Description                              |
 * | -------------- | --------- | ---------------------------------------- |
 * | `SHARD_COUNT`  | `"auto"`  | Number of shards. `"auto"` lets discord.js decide via `/gateway/bot`. |
 * | `SHARDS`       | (all)     | Comma-separated shard IDs to run (e.g. `0,1,2`). Useful for splitting shards across machines. |
 * | `SHARD_MODE`   | `"worker"`| `"worker"` (child processes) or `"process"`. Use `"process"` only for development. |
 */

import { ShardingManager } from "discord.js";
import type { ChildProcess } from "node:child_process";
import { config, validateConfig } from "./config.js";

// ── Validation ─────────────────────────────────────────────────────────────

const missing = validateConfig();
if (missing.length > 0) {
  console.error("[shard] Missing config:", missing.join(", "));
  process.exit(1);
}

// ── Shard configuration ────────────────────────────────────────────────────

const SHARD_COUNT_RAW = process.env.SHARD_COUNT ?? "auto";
const totalShards: number | "auto" =
  SHARD_COUNT_RAW === "auto" ? "auto" : parseInt(SHARD_COUNT_RAW, 10);

if (totalShards !== "auto" && (isNaN(totalShards) || totalShards < 1)) {
  console.error("[shard] Invalid SHARD_COUNT:", SHARD_COUNT_RAW);
  process.exit(1);
}

const shardList: number[] | "auto" = process.env.SHARDS
  ? process.env.SHARDS.split(",").map((s) => {
      const n = parseInt(s.trim(), 10);
      if (isNaN(n)) {
        console.error("[shard] Invalid shard ID in SHARDS:", s);
        process.exit(1);
      }
      return n;
    })
  : "auto";

const mode: "worker" | "process" =
  process.env.SHARD_MODE === "process" ? "process" : "worker";

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `[shard] Starting ShardingManager — ` +
      `totalShards=${totalShards}, shardList=${Array.isArray(shardList) ? shardList.join(",") : "auto"}, mode=${mode}`,
  );

  const manager = new ShardingManager("./dist/bot.js", {
    token: config.token,
    totalShards,
    shardList: shardList === "auto" ? undefined : shardList,
    mode,
  });

  // ── Shard lifecycle logging ──────────────────────────────────────────

  manager.on("shardCreate", (shard) => {
    console.log(`[shard] Spawned shard ${shard.id}`);

    shard.on("ready", () => {
      console.log(`[shard] Shard ${shard.id} reported ready`);
    });

    shard.on("disconnect", () => {
      console.warn(`[shard] Shard ${shard.id} disconnected`);
    });

    shard.on("reconnecting", () => {
      console.warn(`[shard] Shard ${shard.id} reconnecting`);
    });

    shard.on("death", (proc) => {
      const exitCode =
        proc && "exitCode" in proc ? (proc as ChildProcess).exitCode : null;
      console.error(
        `[shard] Shard ${shard.id} died${exitCode != null ? ` (exit code ${exitCode})` : ""} — ` +
          `ShardingManager will attempt respawn if configured.`,
      );
    });

    shard.on("error", (error) => {
      console.error(`[shard] Shard ${shard.id} error:`, error);
    });
  });

  // ── Spawn ────────────────────────────────────────────────────────────

  try {
    await manager.spawn({
      amount: totalShards === "auto" ? "auto" : totalShards,
      delay: 5_500, // Discord recommends 5s between spawns to avoid identify rate limits
      timeout: 60_000, // 60s per shard to become ready
    });

    console.log("[shard] All shards spawned successfully");
  } catch (err) {
    console.error("[shard] Failed to spawn shards:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[shard] Fatal error:", err);
  process.exit(1);
});
