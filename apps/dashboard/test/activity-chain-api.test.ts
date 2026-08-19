import { after, afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { GET as verifyActivityChain } from "../app/api/activity/verify/route";
import {
  getSessionStore,
  resetSessionStore,
} from "../lib/auth/server-session";
import type { Role } from "../lib/auth/session";
import { DurableActivityStorage } from "../lib/activity/storage";
import { query } from "../lib/db";
import { clearRepositories } from "../lib/repositories/factory";
import { makeActivityEvent } from "./fixtures";
import { acquirePostgresTestLock } from "./postgres-test-lock";

const ORIGINAL_ENV = {
  dashboardApiMode: process.env.DASHBOARD_API_MODE,
  dashboardStorageMode: process.env.DASHBOARD_STORAGE_MODE,
  activityStorageMode: process.env.ACTIVITY_STORAGE_MODE,
  sessionSigningSecret: process.env.SESSION_SIGNING_SECRET,
};
const releasePostgresTestLock = process.env.DATABASE_URL
  ? await acquirePostgresTestLock()
  : null;
after(async () => {
  await releasePostgresTestLock?.();
});

async function requestFor(role: Role): Promise<Request> {
  const { accessToken } = await getSessionStore().createSession({
    userId: `verify-${role}`,
    name: `Verify ${role}`,
    role,
  });
  return new Request("http://localhost/api/activity/verify", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("GET /api/activity/verify authorization and mode gating", () => {
  beforeEach(() => {
    process.env.DASHBOARD_API_MODE = "live";
    process.env.DASHBOARD_STORAGE_MODE = "mock";
    process.env.ACTIVITY_STORAGE_MODE = "memory";
    process.env.SESSION_SIGNING_SECRET =
      "activity-chain-api-test-signing-secret-32-bytes";
    resetSessionStore();
    clearRepositories();
  });

  afterEach(async () => {
    // Allow the permission-denied audit's intentionally asynchronous mock
    // write to settle before clearing shared state.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    resetSessionStore();
    clearRepositories();
    restore("DASHBOARD_API_MODE", ORIGINAL_ENV.dashboardApiMode);
    restore("DASHBOARD_STORAGE_MODE", ORIGINAL_ENV.dashboardStorageMode);
    restore("ACTIVITY_STORAGE_MODE", ORIGINAL_ENV.activityStorageMode);
    restore("SESSION_SIGNING_SECRET", ORIGINAL_ENV.sessionSigningSecret);
  });

  test("rejects an unauthenticated caller before disclosing storage mode", async () => {
    const response = await verifyActivityChain(
      new Request("http://localhost/api/activity/verify"),
    );
    assert.equal(response.status, 401);
  });

  test("rejects a readonly caller with 403", async () => {
    const response = await verifyActivityChain(await requestFor("readonly"));
    assert.equal(response.status, 403);
  });

  test("returns 501 to an authorized admin when no PostgreSQL activity mode is enabled", async () => {
    const response = await verifyActivityChain(await requestFor("admin"));
    assert.equal(response.status, 501);

    const body = await response.json() as {
      ok: boolean;
      code: string;
      unsupported: { feature: string; mode: string };
    };
    assert.equal(body.ok, false);
    assert.equal(body.code, "UNSUPPORTED");
    assert.match(body.unsupported.feature, /hash-chain/);
  });
});

if (!process.env.DATABASE_URL) {
  test(
    "GET /api/activity/verify returns a durable verification result",
    { skip: "DATABASE_URL is not configured" },
    () => {},
  );
} else {
  describe("GET /api/activity/verify durable result", () => {
    beforeEach(async () => {
      process.env.DASHBOARD_API_MODE = "live";
      process.env.DASHBOARD_STORAGE_MODE = "durable";
      process.env.ACTIVITY_STORAGE_MODE = "memory";
      process.env.SESSION_SIGNING_SECRET =
        "activity-chain-api-test-signing-secret-32-bytes";
      resetSessionStore();
      clearRepositories();
      await query("TRUNCATE TABLE activity_events, processed_events");
      await query(
        `UPDATE activity_chain_head
         SET last_sequence = 0,
             last_hash = repeat('0', 64),
             last_entry_id = NULL
         WHERE scope = 'global'`,
      );
    });

    afterEach(() => {
      resetSessionStore();
      clearRepositories();
      restore("DASHBOARD_API_MODE", ORIGINAL_ENV.dashboardApiMode);
      restore("DASHBOARD_STORAGE_MODE", ORIGINAL_ENV.dashboardStorageMode);
      restore("ACTIVITY_STORAGE_MODE", ORIGINAL_ENV.activityStorageMode);
      restore("SESSION_SIGNING_SECRET", ORIGINAL_ENV.sessionSigningSecret);
    });

    test("returns an intact wrapped result to an authorized admin", async () => {
      const storage = new DurableActivityStorage({ ttlSeconds: 3600 });
      await storage.recordActivityEvent(
        makeActivityEvent({ id: "api_verify_a" }),
      );
      await storage.recordActivityEvent(
        makeActivityEvent({
          id: "api_verify_b",
          description: "Second endpoint fixture",
        }),
      );

      const response = await verifyActivityChain(await requestFor("admin"));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);

      const body = await response.json() as {
        ok: boolean;
        data: {
          intact: boolean;
          checkedEntries: number;
          latestSequence: string;
        };
      };
      assert.equal(body.ok, true);
      assert.equal(body.data.intact, true);
      assert.equal(body.data.checkedEntries, 2);
      assert.equal(body.data.latestSequence, "2");
    });
  });
}
