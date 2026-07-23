import { z } from "zod";

/**
 * Zod schema for the GuildPass Dashboard environment variables.
 *
 * Development defaults:
 *   DASHBOARD_API_MODE       = "mock"
 *   DASHBOARD_STORAGE_MODE   = "mock"
 *   ACTIVITY_STORAGE_MODE    = "memory"
 *   ACTIVITY_REFRESH_MS      = "15000"
 *
 * When `DASHBOARD_API_MODE=live` the following become REQUIRED:
 *   GUILD_PASS_CORE_URL
 *   GUILD_PASS_CORE_API_KEY
 *   WEBHOOK_SECRET
 *
 * When `DASHBOARD_STORAGE_MODE=durable` the following become REQUIRED:
 *   DATABASE_URL
 */

const nonEmptyString = z.string().min(1, "Must not be empty");

export const dashboardEnvSchema = z
  .object({
    // ── Mode selectors ───────────────────────────────────────────────
    DASHBOARD_API_MODE: z
      .enum(["mock", "live"])
      .default("mock"),
    DASHBOARD_STORAGE_MODE: z
      .enum(["mock", "durable"])
      .default("mock"),

    // ── Core API (required in live mode) ─────────────────────────────
    GUILD_PASS_CORE_URL: z.string().optional(),
    GUILD_PASS_CORE_API_KEY: z.string().optional(),

    // ── Webhook ─────────────────────────────────────────────────────
    WEBHOOK_SECRET: z.string().optional(),
    WEBHOOK_SECRET_PREVIOUS: z.string().optional(),

    // ── Activity feed ────────────────────────────────────────────────
    ACTIVITY_STORAGE_MODE: z
      .enum(["memory", "file"])
      .default("memory"),
    ACTIVITY_STORAGE_DIR: z.string().default(".guildpass-activity"),
    NEXT_PUBLIC_ACTIVITY_REFRESH_MS: z
      .string()
      .regex(/^\d+$/, "Must be a numeric string (milliseconds)")
      .default("15000"),

    // ─── Database ────────────────────────────────────────────────────
    DATABASE_URL: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Live API mode requires core connection + webhook secret
    if (data.DASHBOARD_API_MODE === "live") {
      if (!data.GUILD_PASS_CORE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "GUILD_PASS_CORE_URL is required when DASHBOARD_API_MODE=live",
          path: ["GUILD_PASS_CORE_URL"],
        });
      }
      if (!data.GUILD_PASS_CORE_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "GUILD_PASS_CORE_API_KEY is required when DASHBOARD_API_MODE=live",
          path: ["GUILD_PASS_CORE_API_KEY"],
        });
      }
      if (!data.WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WEBHOOK_SECRET is required when DASHBOARD_API_MODE=live",
          path: ["WEBHOOK_SECRET"],
        });
      }
    }

    // Durable storage mode requires DATABASE_URL
    if (data.DASHBOARD_STORAGE_MODE === "durable") {
      if (!data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "DATABASE_URL is required when DASHBOARD_STORAGE_MODE=durable",
          path: ["DATABASE_URL"],
        });
      }
    }
  });

export type DashboardEnv = z.infer<typeof dashboardEnvSchema>;