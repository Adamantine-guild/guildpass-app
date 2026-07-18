/**
 * test/server-session.test.ts
 *
 * Tests for the server-side session resolution module.
 *
 * Coverage:
 *  - Mock mode returns MOCK_API_SESSION (predictable local role testing)
 *  - Live mode validates access tokens from Authorization header
 *  - requireDashboardSession delegates to getDashboardSession
 *  - UnauthorizedError carries statusCode 401
 */

import { test, describe, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getDashboardSession,
  requireDashboardSession,
  UnauthorizedError,
  resetSessionStore,
} from "../lib/auth/server-session.ts";
import { MOCK_API_SESSION } from "../lib/auth/session.ts";
import { createSessionStore, clearSessionStore } from "../lib/auth/session-store.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/test", { headers });
}

// ── UnauthorizedError ────────────────────────────────────────────────────────

describe("UnauthorizedError", () => {
  test("is an instance of Error", () => {
    const e = new UnauthorizedError();
    assert.ok(e instanceof Error);
  });

  test("name is 'UnauthorizedError'", () => {
    const e = new UnauthorizedError();
    assert.equal(e.name, "UnauthorizedError");
  });

  test("statusCode is 401", () => {
    const e = new UnauthorizedError();
    assert.equal(e.statusCode, 401);
  });

  test("default message is descriptive", () => {
    const e = new UnauthorizedError();
    assert.ok(e.message.includes("Unauthorized"));
  });

  test("accepts a custom message", () => {
    const e = new UnauthorizedError("Custom error");
    assert.equal(e.message, "Custom error");
  });
});

// ── getDashboardSession (mock mode) ───────────────────────────────────────────

describe("getDashboardSession — mock mode", () => {
  const request = makeRequest();

  test("returns a Session object", async () => {
    const session = await getDashboardSession(request);
    assert.ok(session);
    assert.equal(typeof session.userId, "string");
    assert.equal(typeof session.role, "string");
    assert.ok(Array.isArray(session.permissions));
  });

  test("returns MOCK_API_SESSION (same userId and role)", async () => {
    const session = await getDashboardSession(request);
    assert.equal(session.userId, MOCK_API_SESSION.userId);
    assert.equal(session.role, MOCK_API_SESSION.role);
    assert.equal(session.name, MOCK_API_SESSION.name);
  });

  test("permissions match the role defined by MOCK_API_ROLE", async () => {
    const session = await getDashboardSession(request);
    assert.deepEqual(session.permissions, MOCK_API_SESSION.permissions);
  });

  test("works independently of the request content (mock ignores it)", async () => {
    const session1 = await getDashboardSession(makeRequest());
    const session2 = await getDashboardSession(new Request("http://localhost:3000/api/other"));
    assert.equal(session1.userId, session2.userId);
  });
});

// ── requireDashboardSession (mock mode) ───────────────────────────────────────

describe("requireDashboardSession — mock mode", () => {
  const request = makeRequest();

  test("returns the same session as getDashboardSession", async () => {
    const got = await getDashboardSession(request);
    const required = await requireDashboardSession(request);
    assert.equal(required.userId, got.userId);
    assert.equal(required.role, got.role);
  });

  test("does not throw in mock mode", async () => {
    await assert.doesNotReject(async () => {
      await requireDashboardSession(makeRequest());
    });
  });
});

// ── getDashboardSession (live mode — no token) ────────────────────────────────

describe("getDashboardSession — live mode (missing token)", () => {
  const originalMode = process.env.DASHBOARD_API_MODE;
  const request = makeRequest();

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.DASHBOARD_API_MODE;
    } else {
      process.env.DASHBOARD_API_MODE = originalMode;
    }
  });

  test("throws UnauthorizedError when DASHBOARD_API_MODE=live and no token provided", async () => {
    process.env.DASHBOARD_API_MODE = "live";
    await assert.rejects(
      async () => getDashboardSession(request),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError, "should be UnauthorizedError");
        return true;
      }
    );
  });

  test("thrown error has statusCode 401", async () => {
    process.env.DASHBOARD_API_MODE = "live";
    try {
      await getDashboardSession(request);
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err instanceof UnauthorizedError);
      assert.equal((err as UnauthorizedError).statusCode, 401);
    }
  });

  test("thrown error message mentions Authorization header", async () => {
    process.env.DASHBOARD_API_MODE = "live";
    try {
      await getDashboardSession(request);
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.toLowerCase().includes("authorization"),
        `message "${err.message}" should mention Authorization`
      );
    }
  });
});

// ── getDashboardSession (live mode — valid token) ─────────────────────────────

describe("getDashboardSession — live mode (valid token)", () => {
  const originalMode = process.env.DASHBOARD_API_MODE;

  beforeEach(() => {
    process.env.DASHBOARD_API_MODE = "live";
    clearSessionStore();
    resetSessionStore();
  });

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.DASHBOARD_API_MODE;
    } else {
      process.env.DASHBOARD_API_MODE = originalMode;
    }
    clearSessionStore();
  });

  test("returns a valid session when Bearer token is provided", async () => {
    // Create a session via the store
    const store = createSessionStore();
    const tokens = await store.createSession({
      userId: "test-user-live",
      name: "Live User",
      role: "admin",
    });

    const request = makeRequest({
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    const session = await getDashboardSession(request);
    assert.ok(session);
    assert.equal(session.userId, "test-user-live");
    assert.equal(session.name, "Live User");
    assert.equal(session.role, "admin");
  });

  test("throws UnauthorizedError for an invalid Bearer token", async () => {
    const request = makeRequest({
      Authorization: "Bearer invalid.token.here",
    });

    await assert.rejects(
      async () => getDashboardSession(request),
      UnauthorizedError,
    );
  });
});

// ── requireDashboardSession (live mode) ───────────────────────────────────────

describe("requireDashboardSession — live mode", () => {
  const originalMode = process.env.DASHBOARD_API_MODE;

  beforeEach(() => {
    process.env.DASHBOARD_API_MODE = "live";
    clearSessionStore();
    resetSessionStore();
  });

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.DASHBOARD_API_MODE;
    } else {
      process.env.DASHBOARD_API_MODE = originalMode;
    }
    clearSessionStore();
  });

  test("throws UnauthorizedError when no token is provided", async () => {
    await assert.rejects(
      async () => requireDashboardSession(makeRequest()),
      UnauthorizedError,
    );
  });

  test("returns session when valid token is provided", async () => {
    const store = createSessionStore();
    const tokens = await store.createSession({
      userId: "req-test-user",
      name: "Req User",
      role: "moderator",
    });

    const request = makeRequest({
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    const session = await requireDashboardSession(request);
    assert.equal(session.userId, "req-test-user");
    assert.equal(session.role, "moderator");
  });
});
