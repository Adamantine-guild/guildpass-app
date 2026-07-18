export const env = {
  GUILD_PASS_CORE_URL: process.env.GUILD_PASS_CORE_URL,
  GUILD_PASS_CORE_API_KEY: process.env.GUILD_PASS_CORE_API_KEY,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  WEBHOOK_SECRET_PREVIOUS: process.env.WEBHOOK_SECRET_PREVIOUS,
  ACTIVITY_STORAGE_MODE: process.env.ACTIVITY_STORAGE_MODE,
  ACTIVITY_STORAGE_DIR: process.env.ACTIVITY_STORAGE_DIR,
  // API mode for dashboard: 'mock' (default) or 'live'
  DASHBOARD_API_MODE: process.env.DASHBOARD_API_MODE || "mock",
  // Storage mode for data persistence: 'mock' (default, in-memory) or 'durable' (backend)
  DASHBOARD_STORAGE_MODE: process.env.DASHBOARD_STORAGE_MODE || "mock",
  // Storage connection string (required when DASHBOARD_STORAGE_MODE is 'durable')
  DATABASE_URL: process.env.DATABASE_URL,
};

/**
 * Activity refresh configuration.
 *
 * All values can be controlled via environment variables so operators can tune
 * polling behaviour without code changes.
 */
export interface ActivityRefreshConfig {
  /** Polling interval in milliseconds. Set to 0 to disable auto-polling. */
  intervalMs: number;
  /** Maximum number of events to keep in the client feed. */
  maxEvents: number;
}

const DEFAULT_REFRESH_MS = 15_000; // 15 seconds
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
  const m = (process.env.DASHBOARD_API_MODE || env.DASHBOARD_API_MODE)?.toLowerCase();
  return m === "live" ? "live" : "mock";
}

export function getStorageMode(): "mock" | "durable" {
  const m = (
    process.env.DASHBOARD_STORAGE_MODE || env.DASHBOARD_STORAGE_MODE
  )?.toLowerCase();
  return m === "durable" ? "durable" : "mock";
}

export interface StorageConfig {
  mode: "mock" | "durable";
  connectionString: string;
}

export function getStorageConfig(): StorageConfig {
  const mode = getStorageMode();
  const connectionString = process.env.DATABASE_URL || env.DATABASE_URL || "";

  if (mode === "durable" && !connectionString) {
    throw new Error(
      "DATABASE_URL is required when DASHBOARD_STORAGE_MODE is 'durable'"
    );
  }

  return { mode, connectionString };
}

export function getEnv() {
  const GUILD_PASS_CORE_URL =
    process.env.GUILD_PASS_CORE_URL || env.GUILD_PASS_CORE_URL;
  const GUILD_PASS_CORE_API_KEY =
    process.env.GUILD_PASS_CORE_API_KEY || env.GUILD_PASS_CORE_API_KEY;
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || env.WEBHOOK_SECRET;
  const WEBHOOK_SECRET_PREVIOUS =
    process.env.WEBHOOK_SECRET_PREVIOUS || env.WEBHOOK_SECRET_PREVIOUS;
  const ACTIVITY_STORAGE_MODE =
    process.env.ACTIVITY_STORAGE_MODE || env.ACTIVITY_STORAGE_MODE;
  const ACTIVITY_STORAGE_DIR =
    process.env.ACTIVITY_STORAGE_DIR || env.ACTIVITY_STORAGE_DIR;
  const apiMode = getApiMode();
  const storageMode = getStorageMode();

  // Only require core URL when running in live mode
  if (apiMode === "live" && !GUILD_PASS_CORE_URL) {
    throw new Error("GUILD_PASS_CORE_URL is not set (required for live mode)");
  }

  return {
    GUILD_PASS_CORE_URL,
    GUILD_PASS_CORE_API_KEY,
    WEBHOOK_SECRET,
    WEBHOOK_SECRET_PREVIOUS,
    ACTIVITY_STORAGE_MODE,
    ACTIVITY_STORAGE_DIR,
    apiMode,
    storageMode,
  };
}
