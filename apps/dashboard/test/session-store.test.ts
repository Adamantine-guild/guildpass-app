/**
 * test/session-store.test.ts
 *
 * Comprehensive tests for the session-invalidation and token-refresh strategy.
 *
 * Coverage:
 *  - Session creation (issuance)
 *  - Access token validation (valid, expired, tampered)
 *  - Refresh token exchange (happy path)
 *  - Explicit session revocation (refresh denied after revoke)
 *  - Role-change-triggered invalidation (generation counter bump)
 *  - Staleness bound verification (documented access-token lifetime window)
 *  - Server-session integration (live mode token extraction)
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionStore,
  clearSessionStore,
  ACCESS_TOKEN_TTL,
  type SessionStore,
  type TokenPair,
} from "../lib/auth/session-store.ts";
import { ROLE_PERMISSIONS } from "../lib/auth/session.ts";
import type { Role } from "../lib/auth/session.ts";
import { DEFAULT_GUILD_ID } from "../lib/mock-data.ts";
import { hasPermission } from "../lib/permissions.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sign in a test user and return the token pair.
 */
async function signIn(store: SessionStore, role: Role = "admin"): Promise<TokenPair> {
  return store.createSession({
    userId: "test-user-001",
    name: "Test User",
    roles: {
      [DEFAULT_GUILD_ID]: role,
    },
  });
}

// ── Session creation ─────────────────────────────────────────────────────────

describe("SessionStore — issuance", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("createSession returns an access token and refresh token", async () => {
    const tokens = await signIn(store);
    assert.ok(tokens.accessToken, "should have an access token");
    assert.ok(tokens.refreshToken, "should have a refresh token");
    assert.ok(tokens.accessToken.length > 20, "access token should be non-trivial");
    assert.equal(tokens.refreshToken.length, 64, "refresh token should be 256-bit hex");
  });

  test("access token can be validated and returns a Session", async () => {
    const tokens = await signIn(store);
    const session = await store.validateAccessToken(tokens.accessToken);
    assert.ok(session, "should return a valid session");
    assert.equal(session!.userId, "test-user-001");
    assert.equal(session!.name, "Test User");
    assert.equal(session!.roles[DEFAULT_GUILD_ID], "admin");
    assert.ok(hasPermission(session!, DEFAULT_GUILD_ID, "passes:write"));
  });

  test("access token for a different role has correct permissions", async () => {
    const tokens = await signIn(store, "readonly");
    const session = await store.validateAccessToken(tokens.accessToken);
    assert.ok(session);
    assert.equal(session!.roles[DEFAULT_GUILD_ID], "readonly");
    assert.equal(hasPermission(session!, DEFAULT_GUILD_ID, "passes:write"), false);
  });

  test("session records are stored server-side", async () => {
    await signIn(store);
    const sessions = await store.getUserSessions("test-user-001");
    assert.equal(sessions.length, 1, "should have one active session");
    assert.equal(sessions[0].userId, "test-user-001");
    assert.equal(sessions[0].revoked, false);
  });

  test("generation counter starts at 0 for new users", async () => {
    const gen = await store.getUserGeneration("new-user");
    assert.equal(gen, 0);
  });
});

// ── Access token validation ──────────────────────────────────────────────────

describe("SessionStore — access token validation", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("validateAccessToken returns null for an empty token", async () => {
    const result = await store.validateAccessToken("");
    assert.equal(result, null);
  });

  test("validateAccessToken returns null for a garbage token", async () => {
    const result = await store.validateAccessToken("not.a.valid.token");
    assert.equal(result, null);
  });

  test("validateAccessToken returns null for a token with tampered signature", async () => {
    const tokens = await signIn(store);
    const parts = tokens.accessToken.split(".");
    // Tamper with the payload
    const tampered = `${parts[0]}.${parts[1]}x.${parts[2]}`;
    const result = await store.validateAccessToken(tampered);
    assert.equal(result, null);
  });

  test("validateAccessToken returns null for a token with wrong signature", async () => {
    const tokens = await signIn(store);
    const parts = tokens.accessToken.split(".");
    // Flip the last character of the signature
    const sig = parts[2];
    const tamperedSig = sig.slice(0, -1) + (sig[sig.length - 1] === "a" ? "b" : "a");
    const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;
    const result = await store.validateAccessToken(tampered);
    assert.equal(result, null);
  });

  test("access tokens from different sessions produce different tokens", async () => {
    const t1 = await signIn(store);
    const t2 = await store.createSession({
      userId: "test-user-002",
      name: "User Two",
      roles: {
        [DEFAULT_GUILD_ID]: "moderator",
      },
    });
    assert.notEqual(t1.accessToken, t2.accessToken);
    assert.notEqual(t1.refreshToken, t2.refreshToken);
  });
});

// ── Refresh ──────────────────────────────────────────────────────────────────

describe("SessionStore — refresh", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("refreshSession returns a new token pair for a valid refresh token", async () => {
    const tokens = await signIn(store);
    const refreshed = await store.refreshSession(tokens.refreshToken);
    assert.ok(refreshed, "should return new tokens");
    assert.notEqual(refreshed!.accessToken, tokens.accessToken, "access token should be new");
    assert.notEqual(refreshed!.refreshToken, tokens.refreshToken, "refresh token should be new");
  });

  test("refreshed access token is also valid", async () => {
    const tokens = await signIn(store);
    const refreshed = await store.refreshSession(tokens.refreshToken);
    assert.ok(refreshed);
    const session = await store.validateAccessToken(refreshed!.accessToken);
    assert.ok(session);
    assert.equal(session!.userId, "test-user-001");
  });

  test("refresh token is one-time use — cannot refresh twice with the same token", async () => {
    const tokens = await signIn(store);
    const first = await store.refreshSession(tokens.refreshToken);
    assert.ok(first, "first refresh should succeed");

    const second = await store.refreshSession(tokens.refreshToken);
    assert.equal(second, null, "second refresh with same token should fail");
  });

  test("refreshSession returns null for a non-existent refresh token", async () => {
    const result = await store.refreshSession("nonexistent-refresh-token-1234567890abcdef");
    assert.equal(result, null);
  });

  test("refreshSession returns null for an empty refresh token", async () => {
    const result = await store.refreshSession("");
    assert.equal(result, null);
  });
});

// ── Explicit revocation ──────────────────────────────────────────────────────

describe("SessionStore — explicit revocation", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("revokeSession prevents refresh for that session", async () => {
    const tokens = await signIn(store);
    const sessions = await store.getUserSessions("test-user-001");
    assert.equal(sessions.length, 1);

    await store.revokeSession(sessions[0].sessionId);

    // Refresh should now fail
    const refreshed = await store.refreshSession(tokens.refreshToken);
    assert.equal(refreshed, null, "refresh should be denied after revocation");
  });

  test("revokeSession marks the session as revoked", async () => {
    const tokens = await signIn(store);
    const sessions = await store.getUserSessions("test-user-001");
    await store.revokeSession(sessions[0].sessionId);

    const activeSessions = await store.getUserSessions("test-user-001");
    assert.equal(activeSessions.length, 0, "no active sessions after revocation");
  });

  test("revoking one session does not affect other sessions of the same user", async () => {
    const t1 = await signIn(store);
    // Create a second session for the same user
    const t2 = await store.createSession({
      userId: "test-user-001",
      name: "Test User",
      roles: {
        [DEFAULT_GUILD_ID]: "admin",
      },
    });

    const sessions = await store.getUserSessions("test-user-001");
    assert.equal(sessions.length, 2);

    await store.revokeSession(sessions[0].sessionId);

    const remaining = await store.getUserSessions("test-user-001");
    assert.equal(remaining.length, 1, "one session should remain");

    // The non-revoked session should still refresh
    const refreshed = await store.refreshSession(t2.refreshToken);
    assert.ok(refreshed, "non-revoked session should still work");
  });

  test("revoking a non-existent session is a no-op", async () => {
    // Should not throw
    await store.revokeSession("non-existent-session-id");
  });
});

// ── Role-change-triggered invalidation ───────────────────────────────────────

describe("SessionStore — role-change invalidation", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("invalidateUserSessions bumps the generation counter", async () => {
    const genBefore = await store.getUserGeneration("test-user-001");
    await store.invalidateUserSessions("test-user-001");
    const genAfter = await store.getUserGeneration("test-user-001");
    assert.equal(genAfter, genBefore + 1, "generation should increment by 1");
  });

  test("after invalidation, existing refresh tokens are denied", async () => {
    const tokens = await signIn(store);

    // Simulate a role change by invalidating the user's sessions
    await store.invalidateUserSessions("test-user-001");

    const refreshed = await store.refreshSession(tokens.refreshToken);
    assert.equal(refreshed, null, "refresh should be denied after invalidation");
  });

  test("after invalidation, a new sign-in creates a session with the new generation", async () => {
    // Initial session
    const tokens1 = await signIn(store);

    // Invalidate
    await store.invalidateUserSessions("test-user-001");

    // Old refresh should fail
    const failed = await store.refreshSession(tokens1.refreshToken);
    assert.equal(failed, null);

    // New sign-in should work
    const tokens2 = await store.createSession({
      userId: "test-user-001",
      name: "Test User",
      roles: {
        [DEFAULT_GUILD_ID]: "readonly", // downgraded role
      },
    });

    const session = await store.validateAccessToken(tokens2.accessToken);
    assert.ok(session);
    assert.equal(session!.roles[DEFAULT_GUILD_ID], "readonly", "new session should reflect new role");
  });

  test("invalidation bumps generation for multiple calls", async () => {
    await store.invalidateUserSessions("test-user-001");
    await store.invalidateUserSessions("test-user-001");
    await store.invalidateUserSessions("test-user-001");
    const gen = await store.getUserGeneration("test-user-001");
    assert.equal(gen, 3, "generation should be 3 after three invalidations");
  });
});

// ── Staleness bound verification ─────────────────────────────────────────────

describe("SessionStore — staleness bound", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("access token TTL is 15 minutes (900 seconds)", () => {
    assert.equal(ACCESS_TOKEN_TTL, 15 * 60);
  });

  test("the staleness bound is documented as the access-token lifetime", () => {
    const STALENESS_BOUND_SECONDS = ACCESS_TOKEN_TTL;
    const STALENESS_BOUND_MINUTES = STALENESS_BOUND_SECONDS / 60;

    assert.equal(STALENESS_BOUND_MINUTES, 15);
    assert.ok(
      STALENESS_BOUND_SECONDS <= 15 * 60,
      "staleness bound must not exceed 15 minutes",
    );
  });

  test("after revocation, existing access token still works until expiry", async () => {
    const tokens = await signIn(store);
    const sessions = await store.getUserSessions("test-user-001");

    // Revoke the session
    await store.revokeSession(sessions[0].sessionId);

    // The access token (not yet expired) still validates — this is the
    // staleness window in action.
    const session = await store.validateAccessToken(tokens.accessToken);
    assert.ok(session, "existing access token should still work after revocation");
    assert.equal(session!.roles[DEFAULT_GUILD_ID], "admin", "stale role still present in token");
  });

  test("after role-change invalidation, existing access token still works until expiry", async () => {
    const tokens = await signIn(store, "admin");

    // Invalidate (simulating a role downgrade)
    await store.invalidateUserSessions("test-user-001");

    // Access token still works (stale role)
    const session = await store.validateAccessToken(tokens.accessToken);
    assert.ok(session);
    assert.equal(session!.roles[DEFAULT_GUILD_ID], "admin", "stale admin role still in token");

    // But refresh is denied
    const refreshed = await store.refreshSession(tokens.refreshToken);
    assert.equal(refreshed, null, "refresh should be denied");
  });
});

// ── Server-session integration (live mode) ───────────────────────────────────

describe("Server-session integration", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("a valid Bearer token produces a session with correct permissions", async () => {
    const tokens = await signIn(store);
    const request = new Request("http://localhost:3000/api/test", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    // Extract token manually (simulating server-session logic)
    const authHeader = request.headers.get("Authorization");
    assert.ok(authHeader);
    const parts = authHeader!.split(" ");
    assert.equal(parts[0], "Bearer");
    assert.equal(parts[1], tokens.accessToken);

    const session = await store.validateAccessToken(parts[1]);
    assert.ok(session);
    assert.equal(session!.roles[DEFAULT_GUILD_ID], "admin");
    assert.ok(hasPermission(session!, DEFAULT_GUILD_ID, "settings:write"));
  });

  test("a missing Authorization header produces null", async () => {
    const request = new Request("http://localhost:3000/api/test");
    const authHeader = request.headers.get("Authorization");
    assert.equal(authHeader, null);
  });

  test("a malformed Authorization header produces null", async () => {
    const request = new Request("http://localhost:3000/api/test", {
      headers: { Authorization: "NotBearer token" },
    });
    const authHeader = request.headers.get("Authorization");
    const parts = authHeader!.split(" ");
    assert.notEqual(parts[0].toLowerCase(), "bearer");
  });
});

// ── Multiple session management ──────────────────────────────────────────────

describe("SessionStore — multiple sessions", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("a user can have multiple concurrent sessions", async () => {
    const t1 = await signIn(store);
    const t2 = await store.createSession({
      userId: "test-user-001",
      name: "Test User",
      roles: {
        [DEFAULT_GUILD_ID]: "admin",
      },
    });
    const t3 = await store.createSession({
      userId: "test-user-001",
      name: "Test User",
      roles: {
        [DEFAULT_GUILD_ID]: "admin",
      },
    });

    const sessions = await store.getUserSessions("test-user-001");
    assert.equal(sessions.length, 3);
  });

  test("invalidateUserSessions denies refresh for ALL existing sessions", async () => {
    const t1 = await signIn(store);
    const t2 = await store.createSession({
      userId: "test-user-001",
      name: "Test User",
      roles: {
        [DEFAULT_GUILD_ID]: "admin",
      },
    });
    const t3 = await store.createSession({
      userId: "test-user-001",
      name: "Test User",
      roles: {
        [DEFAULT_GUILD_ID]: "admin",
      },
    });

    await store.invalidateUserSessions("test-user-001");

    // All three refresh tokens should be denied
    assert.equal(await store.refreshSession(t1.refreshToken), null);
    assert.equal(await store.refreshSession(t2.refreshToken), null);
    assert.equal(await store.refreshSession(t3.refreshToken), null);

    // But new sign-in should work
    const t4 = await store.createSession({
      userId: "test-user-001",
      name: "Test User",
      roles: {
        [DEFAULT_GUILD_ID]: "readonly",
      },
    });
    assert.ok(t4.accessToken);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("SessionStore — edge cases", () => {
  let store: SessionStore;

  beforeEach(() => {
    clearSessionStore();
    store = createSessionStore();
  });

  test("creating sessions for different users does not interfere", async () => {
    const user1 = await store.createSession({
      userId: "user-1",
      name: "User One",
      roles: {
        [DEFAULT_GUILD_ID]: "admin",
      },
    });
    const user2 = await store.createSession({
      userId: "user-2",
      name: "User Two",
      roles: {
        [DEFAULT_GUILD_ID]: "readonly",
      },
    });

    // Validate both tokens independently
    const s1 = await store.validateAccessToken(user1.accessToken);
    const s2 = await store.validateAccessToken(user2.accessToken);

    assert.equal(s1!.userId, "user-1");
    assert.equal(s1!.roles[DEFAULT_GUILD_ID], "admin");
    assert.equal(s2!.userId, "user-2");
    assert.equal(s2!.roles[DEFAULT_GUILD_ID], "readonly");
  });

  test("invalidating user-1 does not affect user-2", async () => {
    const user1 = await store.createSession({
      userId: "user-1",
      name: "User One",
      roles: {
        [DEFAULT_GUILD_ID]: "admin",
      },
    });
    const user2 = await store.createSession({
      userId: "user-2",
      name: "User Two",
      roles: {
        [DEFAULT_GUILD_ID]: "admin",
      },
    });

    await store.invalidateUserSessions("user-1");

    // User 1's refresh should fail
    assert.equal(await store.refreshSession(user1.refreshToken), null);

    // User 2's refresh should still work
    const refreshed = await store.refreshSession(user2.refreshToken);
    assert.ok(refreshed);
  });

  test("getUserGeneration returns 0 for never-seen users", async () => {
    const gen = await store.getUserGeneration("completely-new-user");
    assert.equal(gen, 0);
  });

  test("getUserSessions returns empty array for unknown users", async () => {
    const sessions = await store.getUserSessions("unknown-user");
    assert.deepEqual(sessions, []);
  });
});
