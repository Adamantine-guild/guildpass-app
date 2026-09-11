import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for issue #140: session resolution for Server Components must resolve a
 * real Session from a valid signed token and reject missing / expired / tampered
 * tokens with UnauthorizedError.
 *
 * We test resolveServerComponentSession (the pure core) directly, feeding it the
 * cookie/header values getServerComponentSession would read. Tokens are minted
 * by the real session store, so genuine HS256 verification runs — nothing is
 * stubbed.
 */

process.env.SESSION_SIGNING_SECRET = "test-signing-secret-for-server-session";

const { resolveServerComponentSession, UnauthorizedError, resetSessionStore } =
  await import("../lib/auth/server-session");
const { createSessionStore, clearSessionStore } = await import("../lib/auth/session-store");

beforeEach(() => {
  resetSessionStore();
});

afterEach(() => {
  clearSessionStore();
});

type Role = "owner" | "admin" | "moderator" | "readonly";

async function mintValidToken(role: Role = "admin") {
  const store = createSessionStore();
  const { accessToken } = await store.createSession({
    userId: "user-1",
    name: "Test User",
    role,
  });
  return accessToken;
}

describe("resolveServerComponentSession — valid session", () => {
  test("a valid cookie token resolves to a Session with role-appropriate permissions", async () => {
    const token = await mintValidToken("admin");
    const session = await resolveServerComponentSession(token, null);
    assert.equal(session.userId, "user-1");
    assert.equal(session.role, "admin");
    assert.ok(session.permissions.includes("settings:write"));
  });

  test("falls back to a valid Bearer header when no cookie", async () => {
    const token = await mintValidToken("readonly");
    const session = await resolveServerComponentSession(null, `Bearer ${token}`);
    assert.equal(session.role, "readonly");
    assert.equal(session.permissions.includes("settings:write"), false);
  });

  test("cookie takes precedence over header", async () => {
    const cookieToken = await mintValidToken("owner");
    const headerToken = await mintValidToken("readonly");
    const session = await resolveServerComponentSession(cookieToken, `Bearer ${headerToken}`);
    assert.equal(session.role, "owner");
  });
});

describe("resolveServerComponentSession — missing session", () => {
  test("throws UnauthorizedError with a distinct 'missing' message when both are absent", async () => {
    await assert.rejects(
      () => resolveServerComponentSession(null, null),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError);
        assert.match(err.message, /no session cookie or authorization header/i);
        return true;
      },
    );
  });

  test("a malformed Authorization header (no Bearer) counts as missing", async () => {
    await assert.rejects(
      () => resolveServerComponentSession(null, "Basic abc123"),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError);
        assert.match(err.message, /no session cookie or authorization header/i);
        return true;
      },
    );
  });
});

describe("resolveServerComponentSession — tampered / invalid token", () => {
  test("a token with a mutated payload is rejected as invalid", async () => {
    const good = await mintValidToken("readonly");
    const [h, p, s] = good.split(".");
    const tamperedPayload = p.slice(0, -1) + (p.slice(-1) === "A" ? "B" : "A");
    await assert.rejects(
      () => resolveServerComponentSession(`${h}.${tamperedPayload}.${s}`, null),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError);
        assert.match(err.message, /invalid or expired/i);
        return true;
      },
    );
  });

  test("a structurally malformed token is rejected", async () => {
    await assert.rejects(
      () => resolveServerComponentSession("not-a-real-jwt", null),
      (err: unknown) => err instanceof UnauthorizedError,
    );
  });
});

describe("resolveServerComponentSession — expired token", () => {
  test("a token past its exp is rejected", async () => {
    const token = await mintValidToken("admin");
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60 * 1000;
    try {
      await assert.rejects(
        () => resolveServerComponentSession(token, null),
        (err: unknown) => {
          assert.ok(err instanceof UnauthorizedError);
          assert.match(err.message, /invalid or expired/i);
          return true;
        },
      );
    } finally {
      Date.now = realNow;
    }
  });
});
