/**
 * Centralized, validated environment configuration for the dashboard.
 *
 * All environment access flows through the shared `dashboardEnvSchema` from
 * `@guildpass/env`. On the server, variables are validated lazily on first
 * access (see `getValidatedEnv` / `validateStartupEnv`): mode-dependent
 * requirements are enforced with cross-field rules, e.g.
 * `DASHBOARD_API_MODE=live` requires `GUILD_PASS_CORE_URL`,
 * `GUILD_PASS_CORE_API_KEY` and `WEBHOOK_SECRET`, and
 * `DASHBOARD_STORAGE_MODE=durable` requires `DATABASE_URL`. Failures throw
 * `EnvValidationError` listing every missing/invalid variable.
 *
 * Client bundles never see server-only secrets (`GUILD_PASS_CORE_API_KEY`,
 * `WEBHOOK_SECRET`, `DATABASE_URL`, ...): Next.js only inlines
 * `NEXT_PUBLIC_*` variables, and this module skips validation in the browser
 * (`process.env` there only ever contains the inlined public values).
 */

import {
  dashboardEnvBaseSchema,
  dashboardEnvSchema,
  validateEnv,
  type DashboardEnv,
} from "@guildpass/env";
import { PublicApiError } from "./api-errors";

const isServer = typeof window === "undefined";

/**
 * Validate `process.env` against the field-level dashboard schema.
 * Server-only: throws `EnvValidationError` with an actionable message naming
 * every invalid variable. Validation runs on each call (it is
 * sub-millisecond for this schema) so callers always see the current
 * process.env — a cached snapshot would go stale in tests and in any runtime
 * that rotates env.
 *
 * Plain reads use the field-level schema only: cross-field, mode-dependent
 * requirements (live mode needs core credentials, durable mode needs
 * DATABASE_URL) are enforced by `validateStartupEnv` and by the consumers
 * that actually need those values (e.g. `validateLiveModeEnv`), so a
 * misconfigured optional mode fails with a clear error at the point of use
 * instead of breaking every unrelated env read.
 */
function getValidatedEnv(): DashboardEnv {
  return validateEnv(dashboardEnvBaseSchema);
}

/**
 * Explicit startup validation hook. Call this early in server startup (or in
 * a health/ready probe) to fail fast on misconfiguration instead of deep in a
 * request handler. Returns the typed, validated environment.
 */
export function validateStartupEnv(): DashboardEnv {
  return validateEnv(dashboardEnvSchema);
}

/**
 * Raw, unvalidated environment as seen by legacy callers. Used only in
 * browser bundles where validation is skipped (secrets are never shipped to
 * the client, and only `NEXT_PUBLIC_*` values are inlined).
 */
const rawEnv = {
  GUILD_PASS_CORE_URL: process.env.GUILD_PASS_CORE_URL,
  GUILD_PASS_CORE_API_KEY: process.env.GUILD_PASS_CORE_API_KEY,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  WEBHOOK_SECRET_PREVIOUS: process.env.WEBHOOK_SECRET_PREVIOUS,
  ACTIVITY_STORAGE_MODE: process.env.ACTIVITY_STORAGE_MODE,
  ACTIVITY_STORAGE_DIR: process.env.ACTIVITY_STORAGE_DIR,
  DASHBOARD_API_MODE: process.env.DASHBOARD_API_MODE || "mock",
  DASHBOARD_STORAGE_MODE: process.env.DASHBOARD_STORAGE_MODE || "mock",
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_ACTIVITY_REFRESH_MS: process.env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS,
};

function readEnv(): DashboardEnv {
  if (!isServer) return rawEnv as DashboardEnv;
  return getValidatedEnv();
}

/**
 * Backwards-compatible environment object. Property access is lazy: on the
 * server the first read triggers full schema validation, so a misconfigured
 * deployment fails with a clear error naming the offending variables.
 */
export const env: DashboardEnv = new Proxy({} as DashboardEnv, {
  get(_target, prop: string) {
    return readEnv()[prop as keyof DashboardEnv];
  },
});

export interface ActivityRefreshConfig {
  intervalMs: number;
  maxEvents: number;
}

const DEFAULT_REFRESH_MS = 15_000;
const DEFAULT_MAX_EVENTS = 500;

export function getActivityRefreshConfig(): ActivityRefreshConfig {
  const intervalMs = parseNonNegativeInteger(
    process.env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS,
    DEFAULT_REFRESH_MS
  );
  const maxEvents = parsePositiveInteger(
    process.env.NEXT_PUBLIC_ACTIVITY_MAX_EVENTS,
    DEFAULT_MAX_EVENTS
  );

  return { intervalMs, maxEvents };
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = parseNonNegativeInteger(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export function getApiMode(): "mock" | "live" {
  const m = (readEnv().DASHBOARD_API_MODE || "mock")?.toLowerCase();
  return m === "live" ? "live" : "mock";
}

export function getStorageMode(): "mock" | "durable" {
  const m = (readEnv().DASHBOARD_STORAGE_MODE || "mock")?.toLowerCase();
  return m === "durable" ? "durable" : "mock";
}

export interface StorageConfig {
  mode: "mock" | "durable";
  connectionString: string;
}

export function getStorageConfig(): StorageConfig {
  const mode = getStorageMode();
  const connectionString = readEnv().DATABASE_URL || "";

  if (mode === "durable" && !connectionString) {
    throw new Error(
      "DATABASE_URL is required when DASHBOARD_STORAGE_MODE is 'durable'"
    );
  }

  return { mode, connectionString };
}

export function getEnv() {
  const current = readEnv();

  return {
    GUILD_PASS_CORE_URL: current.GUILD_PASS_CORE_URL,
    GUILD_PASS_CORE_API_KEY: current.GUILD_PASS_CORE_API_KEY,
    WEBHOOK_SECRET: current.WEBHOOK_SECRET,
    ACTIVITY_STORAGE_MODE: current.ACTIVITY_STORAGE_MODE,
    ACTIVITY_STORAGE_DIR: current.ACTIVITY_STORAGE_DIR,
    apiMode: getApiMode(),
    storageMode: getStorageMode(),
  };
}

export function validateLiveModeEnv() {
  const envVars = getEnv();
  const missing: string[] = [];

  if (!envVars.GUILD_PASS_CORE_URL) missing.push("GUILD_PASS_CORE_URL");
  if (!envVars.GUILD_PASS_CORE_API_KEY) missing.push("GUILD_PASS_CORE_API_KEY");
  if (!envVars.WEBHOOK_SECRET) missing.push("WEBHOOK_SECRET");

  if (missing.length > 0) {
    throw new PublicApiError(
      `Missing required environment variables for live mode: ${missing.join(", ")}`,
      500
    );
  }

  return {
    GUILD_PASS_CORE_URL: envVars.GUILD_PASS_CORE_URL as string,
    GUILD_PASS_CORE_API_KEY: envVars.GUILD_PASS_CORE_API_KEY as string,
    WEBHOOK_SECRET: envVars.WEBHOOK_SECRET as string,
  };
}
