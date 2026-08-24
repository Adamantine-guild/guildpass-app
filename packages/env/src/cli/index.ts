#!/usr/bin/env node

/**
 * guildpass-env-check — CLI tool to validate environment variables.
 *
 * Usage:
 *   guildpass-env-check                    # validates all known schemas
 *   guildpass-env-check --app dashboard    # validates only dashboard env
 *   guildpass-env-check --app access-api   # validates only access-api env
 *   guildpass-env-check --app discord-bot  # validates only discord-bot env
 *
 * Exit codes:
 *   0  All validations passed
 *   1  One or more validations failed
 */

import {
  dashboardEnvSchema,
  accessApiEnvSchema,
  discordBotEnvSchema,
  validateEnv,
  EnvValidationError,
} from "../index.ts";

type AppName = "dashboard" | "access-api" | "discord-bot";

function parseArgs(): { app?: AppName } {
  const args = process.argv.slice(2);
  const appIndex = args.indexOf("--app");
  if (appIndex !== -1 && args[appIndex + 1]) {
    const app = args[appIndex + 1] as AppName;
    if (!["dashboard", "access-api", "discord-bot"].includes(app)) {
      console.error(
        `Unknown app "${app}". Valid options: dashboard, access-api, discord-bot`
      );
      process.exit(1);
    }
    return { app };
  }
  return {};
}

function validate(
  schema: typeof dashboardEnvSchema | typeof accessApiEnvSchema | typeof discordBotEnvSchema,
  label: string,
): boolean {
  try {
    // The validateEnv function is generic; we cast schema to match
    validateEnv(schema as any);
    console.log(`  \u2713 ${label}: All environment variables valid`);
    return true;
  } catch (err: unknown) {
    if (err instanceof EnvValidationError) {
      console.error(`  \u2717 ${label}: Validation failed`);
      for (const issue of err.issues) {
        console.error(`      ${issue}`);
      }
    } else {
      console.error(`  \u2717 ${label}: Unexpected error:`, err);
    }
    return false;
  }
}

function main(): void {
  const { app } = parseArgs();
  let allPassed = true;

  console.log("\n\uD83D\uDD0D GuildPass Environment Validation\n");

  if (!app || app === "dashboard") {
    console.log("  \u2500\u2500 Dashboard \u2500\u2500");
    allPassed &&= validate(dashboardEnvSchema, "@guildpass/dashboard");
  }

  if (!app || app === "access-api") {
    console.log("  \u2500\u2500 Access API \u2500\u2500");
    allPassed &&= validate(accessApiEnvSchema, "@guildpass/access-api");
  }

  if (!app || app === "discord-bot") {
    console.log("  \u2500\u2500 Discord Bot \u2500\u2500");
    allPassed &&= validate(discordBotEnvSchema, "@guildpass/discord-bot");
  }

  console.log();

  if (allPassed) {
    console.log("\u2705 All environment checks passed.");
    process.exit(0);
  } else {
    console.log("\u274C Some environment checks failed. See above for details.");
    process.exit(1);
  }
}

main();