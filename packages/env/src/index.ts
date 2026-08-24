/**
 * @guildpass/env — Shared environment variable validation for all GuildPass apps.
 *
 * Each app exports a Zod schema that validates its required environment variables
 * at startup.  This keeps validation in one place and avoids drift between apps.
 */

export { dashboardEnvSchema, dashboardEnvBaseSchema, type DashboardEnv } from "./schemas/dashboard.ts";
export { accessApiEnvSchema, type AccessApiEnv } from "./schemas/access-api.ts";
export { discordBotEnvSchema, type DiscordBotEnv } from "./schemas/discord-bot.ts";
export { EnvValidationError, validateEnv } from "./validate.ts";