/**
 * @guildpass/env — Shared environment variable validation for all GuildPass apps.
 *
 * Each app exports a Zod schema that validates its required environment variables
 * at startup.  This keeps validation in one place and avoids drift between apps.
 */

export { dashboardEnvSchema, type DashboardEnv } from "./schemas/dashboard.js";
export { accessApiEnvSchema, type AccessApiEnv } from "./schemas/access-api.js";
export { discordBotEnvSchema, type DiscordBotEnv } from "./schemas/discord-bot.js";
export { EnvValidationError, validateEnv } from "./validate.js";