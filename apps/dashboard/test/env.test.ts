import assert from "node:assert/strict";
import { test } from "node:test";

const MODULE = "../lib/env.js";

async function importFresh() {
  // Cache-bust so each test re-evaluates the module with fresh process.env.
  return import(`${MODULE}?t=${Date.now()}-${Math.random()}`);
}

const ENV_KEYS = [
  "DASHBOARD_API_MODE",
  "DASHBOARD_STORAGE_MODE",
  "GUILD_PASS_CORE_URL",
  "GUILD_PASS_CORE_API_KEY",
  "WEBHOOK_SECRET",
  "WEBHOOK_SECRET_PREVIOUS",
  "DATABASE_URL",
  "ACTIVITY_STORAGE_MODE",
  "ACTIVITY_STORAGE_DIR",
  "NEXT_PUBLIC_ACTIVITY_REFRESH_MS",
  "NEXT_PUBLIC_ACTIVITY_MAX_EVENTS",
];

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

test("mock defaults: getApiMode/getStorageMode work with no variables set", async () => {
  clearEnv();
  const { getApiMode, getStorageMode, getStorageConfig } = await importFresh();
  assert.equal(getApiMode(), "mock");
  assert.equal(getStorageMode(), "mock");
  assert.deepEqual(getStorageConfig(), { mode: "mock", connectionString: "" });
});

test("lazy env proxy validates on first access and applies defaults", async () => {
  clearEnv();
  const { env } = await importFresh();
  assert.equal(env.DASHBOARD_API_MODE, "mock");
  assert.equal(env.DASHBOARD_STORAGE_MODE, "mock");
});

test("live mode missing GUILD_PASS_CORE_URL throws a clear startup error", async () => {
  clearEnv();
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_API_KEY = "key";
  process.env.WEBHOOK_SECRET = "secret";
  const { validateStartupEnv } = await importFresh();
  assert.throws(
    () => validateStartupEnv(),
    /GUILD_PASS_CORE_URL is required when DASHBOARD_API_MODE=live/,
  );
});

test("durable mode without DATABASE_URL fails validation with actionable message", async () => {
  clearEnv();
  process.env.DASHBOARD_STORAGE_MODE = "durable";
  const { validateStartupEnv } = await importFresh();
  assert.throws(
    () => validateStartupEnv(),
    /DATABASE_URL is required when DASHBOARD_STORAGE_MODE=durable/,
  );
});

test("valid live configuration passes and is exposed via getEnv", async () => {
  clearEnv();
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_URL = "https://core.example.com";
  process.env.GUILD_PASS_CORE_API_KEY = "key";
  process.env.WEBHOOK_SECRET = "secret";
  const { validateStartupEnv, getEnv, getApiMode } = await importFresh();
  const validated = validateStartupEnv();
  assert.equal(validated.GUILD_PASS_CORE_URL, "https://core.example.com");
  assert.equal(getApiMode(), "live");
  assert.equal(getEnv().apiMode, "live");
});

test("validateLiveModeEnv lists all missing live-mode variables", async () => {
  clearEnv();
  const { validateLiveModeEnv } = await importFresh();
  assert.throws(
    () => validateLiveModeEnv(),
    /GUILD_PASS_CORE_URL, GUILD_PASS_CORE_API_KEY, WEBHOOK_SECRET/,
  );
});

test("getActivityRefreshConfig keeps legacy fallbacks", async () => {
  clearEnv();
  const { getActivityRefreshConfig } = await importFresh();
  assert.deepEqual(getActivityRefreshConfig(), {
    intervalMs: 15_000,
    maxEvents: 500,
  });
  process.env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS = "5000";
  const fresh = await importFresh();
  assert.equal(fresh.getActivityRefreshConfig().intervalMs, 5000);
});
