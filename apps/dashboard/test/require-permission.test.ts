import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { guardPermission, requireSessionAndPermission } from "../lib/auth/require-permission";
import { clearRepositories, getActivityRepository } from "../lib/repositories/factory";
import { SESSION_ADMIN, SESSION_READONLY } from "./fixtures";
import { DEFAULT_GUILD_ID } from "../lib/mock-data";

process.env.DASHBOARD_STORAGE_MODE = "mock";
process.env.DASHBOARD_API_MODE = "mock";

/**
 * Waits a tick so fire-and-forget audit recording settles. All tests in this
 * file live in a single `describe` (node:test runs sibling top-level suites
 * concurrently, but subtests within one suite run sequentially) so that a
 * dangling background write from one test can't bleed into the next.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("permission-denied audit recording", () => {
  beforeEach(() => clearRepositories());

  test("guardPermission returns ok:true and records no audit event when the session holds the permission", async () => {
    const before = await getActivityRepository().query(DEFAULT_GUILD_ID, { type: "activity.permission_denied" });

    const result = guardPermission(SESSION_ADMIN, DEFAULT_GUILD_ID, "passes:write");
    assert.equal(result.ok, true);

    await flush();
    const after = await getActivityRepository().query(DEFAULT_GUILD_ID, { type: "activity.permission_denied" });
    assert.equal(after.length, before.length, "no denial event should be recorded on success");
  });

  test("guardPermission returns a 403 response when the session lacks the permission", async () => {
    const result = guardPermission(SESSION_READONLY, DEFAULT_GUILD_ID, "passes:write");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 403);

    await flush();
  });

  test("guardPermission records a correctly-typed activity.permission_denied event on denial", async () => {
    const result = guardPermission(SESSION_READONLY, DEFAULT_GUILD_ID, "passes:write");
    assert.equal(result.ok, false);

    await flush();

    const events = await getActivityRepository().query(DEFAULT_GUILD_ID, { type: "activity.permission_denied" });
    const found = events.find(
      (e) => e.actor.id === SESSION_READONLY.userId && e.metadata?.permission === "passes:write"
    );

    assert.ok(found, "permission_denied event should be recorded");
    assert.equal(found?.severity, "warning");
    assert.equal(found?.source, "dashboard");
    assert.equal(found?.actor.name, SESSION_READONLY.name);
    assert.equal(found?.metadata?.role, SESSION_READONLY.role);
    assert.ok(found?.description.includes("passes:write"));
  });

  test("guardPermission returns the 403 response synchronously, without waiting on audit recording", async () => {
    const start = Date.now();
    const result = guardPermission(SESSION_READONLY, DEFAULT_GUILD_ID, "members:write");
    const elapsed = Date.now() - start;

    assert.equal(result.ok, false);
    assert.ok(elapsed < 50, "guardPermission should not block on the audit write");

    await flush();
  });

  test("a broken activity repository never causes guardPermission to throw or delay the 403", async () => {
    const originalMode = process.env.DASHBOARD_STORAGE_MODE;
    const originalUrl = process.env.DATABASE_URL;

    // Force getActivityRepository() to throw synchronously (durable mode with no DATABASE_URL).
    process.env.DASHBOARD_STORAGE_MODE = "durable";
    delete process.env.DATABASE_URL;
    clearRepositories();

    let result: ReturnType<typeof guardPermission> | undefined;
    assert.doesNotThrow(() => {
      result = guardPermission(SESSION_READONLY, DEFAULT_GUILD_ID, "guilds:write");
    });

    assert.equal(result?.ok, false);
    if (result && !result.ok) {
      assert.equal(result.response.status, 403);
    }

    // Let the swallowed rejection settle before restoring env / moving on.
    await flush();

    process.env.DASHBOARD_STORAGE_MODE = originalMode;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    clearRepositories();
  });

  test("requireSessionAndPermission returns ok:true with the resolved session when it holds the permission", async () => {
    // Mock mode resolves to MOCK_API_SESSION regardless of the request; activity:read
    // is held by every role, so this is a safe always-allowed permission to probe.
    const request = new Request("http://localhost/api/activity");
    const result = await requireSessionAndPermission(request, DEFAULT_GUILD_ID, "activity:read");
    assert.equal(result.ok, true);

    await flush();
  });
});
