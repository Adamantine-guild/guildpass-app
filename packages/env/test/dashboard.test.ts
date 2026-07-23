import assert from "node:assert/strict";
import { test } from "node:test";

import { dashboardEnvSchema } from "../src/schemas/dashboard.js";
import { EnvValidationError, validateEnv } from "../src/validate.js";

test("applies development defaults when nothing is set", () => {
  const env = validateEnv(dashboardEnvSchema, {});
  assert.equal(env.DASHBOARD_API_MODE, "mock");
  assert.equal(env.DASHBOARD_STORAGE_MODE, "mock");
  assert.equal(env.ACTIVITY_STORAGE_MODE, "memory");
  assert.equal(env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS, "15000");
});

test("live mode without GUILD_PASS_CORE_URL fails with an actionable message", () => {
  assert.throws(
    () =>
      validateEnv(dashboardEnvSchema, {
        DASHBOARD_API_MODE: "live",
        GUILD_PASS_CORE_API_KEY: "key",
        WEBHOOK_SECRET: "secret",
      }),
    (err: unknown) => {
      assert.ok(err instanceof EnvValidationError);
      assert.match(err.message, /GUILD_PASS_CORE_URL is required when DASHBOARD_API_MODE=live/);
      return true;
    },
  );
});

test("live mode lists every missing variable at once", () => {
  try {
    validateEnv(dashboardEnvSchema, { DASHBOARD_API_MODE: "live" });
    assert.fail("expected validation to throw");
  } catch (err) {
    assert.ok(err instanceof EnvValidationError);
    for (const name of ["GUILD_PASS_CORE_URL", "GUILD_PASS_CORE_API_KEY", "WEBHOOK_SECRET"]) {
      assert.match(err.message, new RegExp(name));
    }
  }
});

test("durable storage mode requires DATABASE_URL", () => {
  assert.throws(
    () => validateEnv(dashboardEnvSchema, { DASHBOARD_STORAGE_MODE: "durable" }),
    /DATABASE_URL is required when DASHBOARD_STORAGE_MODE=durable/,
  );
});

test("valid live + durable configuration passes", () => {
  const env = validateEnv(dashboardEnvSchema, {
    DASHBOARD_API_MODE: "live",
    GUILD_PASS_CORE_URL: "https://core.example.com",
    GUILD_PASS_CORE_API_KEY: "key",
    WEBHOOK_SECRET: "secret",
    DASHBOARD_STORAGE_MODE: "durable",
    DATABASE_URL: "postgres://localhost/guildpass",
  });
  assert.equal(env.DASHBOARD_API_MODE, "live");
  assert.equal(env.DATABASE_URL, "postgres://localhost/guildpass");
});

test("rejects unknown mode values", () => {
  assert.throws(
    () => validateEnv(dashboardEnvSchema, { DASHBOARD_API_MODE: "staging" }),
    EnvValidationError,
  );
});

test("rejects non-numeric NEXT_PUBLIC_ACTIVITY_REFRESH_MS", () => {
  assert.throws(
    () =>
      validateEnv(dashboardEnvSchema, {
        NEXT_PUBLIC_ACTIVITY_REFRESH_MS: "fast",
      }),
    /NEXT_PUBLIC_ACTIVITY_REFRESH_MS/,
  );
});
