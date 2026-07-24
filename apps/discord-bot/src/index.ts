/**
 * Single-process entry point for the GuildPass Discord bot.
 *
 * This is the simple, non-sharded startup path suitable for:
 * - Local development and testing
 * - Self-hosted deployments with few guilds (< ~500)
 * - CI/CD smoke tests
 *
 * For production deployments at scale (1 000+ guilds), use `shard.ts`
 * instead — it spawns a ShardingManager that distributes guilds across
 * multiple child processes.
 *
 * ## Mock mode
 *
 * When any config value contains "dummy", the bot starts in mock mode:
 * it validates configuration and exits without connecting to Discord.
 * This is useful for CI and for testing code logic without real tokens.
 *
 * To force mock mode explicitly, set:
 * ```env
 * MOCK_MODE=true
 * ```
 */

import dotenv from "dotenv";
dotenv.config();

import { config, validateConfig } from "./config.js";
import { createClient } from "./bot.js";
import type { GuildStats } from "./bot.js";
import type { Membership, VerificationResult } from "@guildpass/integration-client";

// ── Mock mode detection ────────────────────────────────────────────────────

const isMockMode =
  process.env.MOCK_MODE === "true" ||
  config.token.includes("dummy") ||
  config.clientId.includes("dummy") ||
  config.guildId.includes("dummy");

if (isMockMode) {
  console.log("[mock] Starting in mock mode (will not connect to Discord)");
  console.log("[mock] You can test the code logic without real credentials");

  // Validate config so CI catches missing vars early
  const missing = validateConfig();
  if (missing.length > 0) {
    console.error("[mock] Missing config:", missing.join(", "));
    process.exit(1);
  }

  // Mock integration client for local/CI testing
  class MockIntegrationClient {
    async verifyWallet(
      discordUserId: string,
      wallet: string,
    ): Promise<VerificationResult> {
      console.log("[mock] verifyWallet called", discordUserId, wallet);
      return {
        userId: discordUserId,
        wallet,
        verified: true,
        message: "Mock verification successful",
      };
    }

    async issueVerificationChallenge(
      discordUserId: string,
      wallet: string,
    ) {
      console.log("[mock] issueVerificationChallenge called", discordUserId, wallet);
      return {
        nonce: "mocknonce1234567",
        message: `GuildPass wallet verification\n\nDiscord user: ${discordUserId}\nWallet: ${wallet}\nNonce: mocknonce1234567`,
        expiresAt: Date.now() + 5 * 60 * 1000,
        expiresIn: 300,
      };
    }

    async getMembershipByDiscordUser(
      discordUserId: string,
    ): Promise<Membership | null> {
      console.log("[mock] getMembershipByDiscordUser called", discordUserId);
      return {
        userId: discordUserId,
        wallet: "0x1234567890123456789012345678901234567890",
        status: "active",
        roles: ["member", "contributor"],
        updatedAt: new Date().toISOString(),
      };
    }

    async getMembershipByWallet(
      wallet: string,
    ): Promise<Membership | null> {
      console.log("[mock] getMembershipByWallet called", wallet);
      return {
        userId: "1234567890",
        wallet,
        status: "active",
        roles: ["member"],
        updatedAt: new Date().toISOString(),
      };
    }

    async getGuildStats(_guildId: string): Promise<GuildStats> {
      console.log("[mock] getGuildStats called", _guildId);
      return {
        totalMembers: 42,
        activeCount: 31,
        inactiveCount: 11,
        roleDistribution: {
          admin: 3,
          member: 30,
          contributor: 9,
        },
      };
    }
  }

  // Smoke-test the client factory (no Discord connection)
  const mockClient = new MockIntegrationClient();
  const client = createClient({ integration: mockClient });
  console.log("[mock] Bot client created successfully (no login attempted)");
  console.log("[mock] Mock integration client ready!");

  // Keep the process alive briefly for any pending microtasks, then exit cleanly
  setTimeout(() => {
    console.log("[mock] Mock mode complete — exiting.");
    process.exit(0);
  }, 100);

  // Prevent the mock path from reaching the real login below
  // (void client is deliberate — we never log in)
  void client;
} else {
  // ── Real (single-process) mode ─────────────────────────────────────────
  const missing = validateConfig();
  if (missing.length > 0) {
    console.error("[bot] Missing config:", missing.join(", "));
    process.exit(1);
  }

  console.log("[bot] Starting in single-process mode (no sharding)");
  console.log(
    "[bot] For large deployments (1 000+ guilds), use the sharded entry point:",
  );
  console.log("      SHARD_COUNT=auto tsx src/shard.ts");

  const client = createClient();

  try {
    await client.login(config.token);
    console.log("[bot] Logged in successfully");
  } catch (err) {
    console.error("[bot] Failed to log in:", err);
    process.exit(1);
  }
}