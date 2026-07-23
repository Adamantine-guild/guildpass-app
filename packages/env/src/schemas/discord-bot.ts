import { z } from "zod";

/**
 * Zod schema for the GuildPass Discord Bot environment variables.
 *
 * In development mode the bot uses DISCORD_GUILD_ID for guild-commands;
 * in production (global commands) DISCORD_GUILD_ID is optional.
 */

export const discordBotEnvSchema = z
  .object({
    // ── Discord Authentication ──────────────────────────────────────
    DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),

    // Application / Client ID
    DISCORD_CLIENT_ID: z
      .string()
      .regex(/^\d+$/, "DISCORD_CLIENT_ID must be a numeric string"),

    // Guild ID for development guild-command registration (optional in prod)
    DISCORD_GUILD_ID: z
      .string()
      .regex(/^\d+$/, "DISCORD_GUILD_ID must be a numeric string")
      .optional(),

    // ── Role Mappings ───────────────────────────────────────────────
    DISCORD_ROLE_ADMIN: z
      .string()
      .regex(/^\d+$/, "DISCORD_ROLE_ADMIN must be a numeric string (role ID)")
      .optional(),
    DISCORD_ROLE_MEMBER: z
      .string()
      .regex(/^\d+$/, "DISCORD_ROLE_MEMBER must be a numeric string (role ID)")
      .optional(),
    DISCORD_ROLE_CONTRIBUTOR: z
      .string()
      .regex(/^\d+$/, "DISCORD_ROLE_CONTRIBUTOR must be a numeric string (role ID)")
      .optional(),

    // ── OAuth2 (optional) ───────────────────────────────────────────
    DISCORD_CLIENT_SECRET: z.string().optional(),

    // ── GuildPass Core connection (optional, for integration) ───────
    GUILD_PASS_CORE_URL: z.string().optional(),
    GUILD_PASS_CORE_API_KEY: z.string().optional(),

    // ── Bot behaviour ──────────────────────────────────────────────
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z
      .enum(["debug", "info", "warn", "error"])
      .default("info"),
  })
  .superRefine((data, ctx) => {
    // Production requires at least the admin role mapping if roles feature is used
    // But since all roles are optional, we just warn about missing ones — no hard fail

    // In development mode, GUILD_ID should be present, warn if not
    if (data.NODE_ENV === "development" && !data.DISCORD_GUILD_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "DISCORD_GUILD_ID is recommended in development mode for guild-command registration",
        path: ["DISCORD_GUILD_ID"],
      });
    }
  });

export type DiscordBotEnv = z.infer<typeof discordBotEnvSchema>;