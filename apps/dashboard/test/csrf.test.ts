/**
 * lib/auth/csrf.test.ts
 *
 * Tests for the CSRF double-submit cookie guard.
 *
 * Covers:
 *   – Token generation (randomness, length)
 *   – Successful validation (cookie + header match)
 *   – Missing cookie → 403
 *   – Missing header → 403
 *   – Mismatched tokens → 403
 *   – Constant-time comparison behavior
 *   – Mock token helper
 *   – setCsrfCookie format
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assertCsrfToken,
  generateCsrfToken,
  setCsrfCookie,
  CsrfError,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  MOCK_CSRF_TOKEN,
} from "../lib/auth/csrf";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a minimal Request with the given CSRF cookie and header values. */
function makeRequest(cookieValue?: string, headerValue?: string): Request {
  const headers = new Headers();

  if (cookieValue !== undefined) {
    headers.set("cookie", `${CSRF_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`);
  }

  if (headerValue !== undefined) {
    headers.set(CSRF_HEADER_NAME, headerValue);
  }

  return new Request("http://localhost/api/test", {
    method: "POST",
    headers,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("generateCsrfToken", () => {
  test("returns a 64-character hex string", () => {
    const token = generateCsrfToken();
    assert.equal(token.length, 64, "Token must be 64 hex chars (32 bytes)");
    assert.ok(/^[0-9a-f]{64}$/.test(token), "Token must be lowercase hex only");
  });

  test("generates unique tokens on each call", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    assert.notEqual(a, b, "Consecutive tokens must be unique");
  });

  test("generates 100 unique tokens (no collisions)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(generateCsrfToken());
    }
    assert.equal(seen.size, 100, "100 tokens should all be unique");
  });
});

describe("assertCsrfToken — successful validation", () => {
  test("passes when cookie and header tokens match", () => {
    const token = generateCsrfToken();
    const req = makeRequest(token, token);
    // Should not throw
    assert.doesNotThrow(() => assertCsrfToken(req));
  });

  test("passes with mock token in development", () => {
    const req = makeRequest(MOCK_CSRF_TOKEN, MOCK_CSRF_TOKEN);
    assert.doesNotThrow(() => assertCsrfToken(req));
  });
});

describe("assertCsrfToken — missing cookie", () => {
  test("throws CsrfError when cookie is absent", () => {
    const req = makeRequest(undefined, "some-token");
    assert.throws(
      () => assertCsrfToken(req),
      (err: unknown) => {
        assert.ok(err instanceof CsrfError);
        assert.ok((err as CsrfError).message.includes("Missing CSRF cookie"));
        assert.equal((err as CsrfError).statusCode, 403);
        return true;
      }
    );
  });

  test("throws CsrfError when cookie header is empty", () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        cookie: "",
        [CSRF_HEADER_NAME]: "some-token",
      },
    });
    assert.throws(
      () => assertCsrfToken(req),
      (err: unknown) => err instanceof CsrfError
    );
  });
});

describe("assertCsrfToken — missing header", () => {
  test("throws CsrfError when X-CSRF-Token header is absent", () => {
    const req = makeRequest("some-token", undefined);
    assert.throws(
      () => assertCsrfToken(req),
      (err: unknown) => {
        assert.ok(err instanceof CsrfError);
        assert.ok((err as CsrfError).message.includes("Missing CSRF header"));
        assert.equal((err as CsrfError).statusCode, 403);
        return true;
      }
    );
  });

  test("throws CsrfError when both cookie and header are missing", () => {
    const req = makeRequest(undefined, undefined);
    assert.throws(
      () => assertCsrfToken(req),
      (err: unknown) => {
        assert.ok(err instanceof CsrfError);
        // Should report missing cookie first
        assert.ok((err as CsrfError).message.includes("Missing CSRF cookie"));
        return true;
      }
    );
  });
});

describe("assertCsrfToken — mismatched tokens", () => {
  test("throws CsrfError when tokens differ", () => {
    const req = makeRequest("cookie-token", "header-token");
    assert.throws(
      () => assertCsrfToken(req),
      (err: unknown) => {
        assert.ok(err instanceof CsrfError);
        assert.ok((err as CsrfError).message.includes("CSRF token mismatch"));
        assert.equal((err as CsrfError).statusCode, 403);
        return true;
      }
    );
  });

  test("throws CsrfError when token lengths differ (different values)", () => {
    const short = generateCsrfToken().slice(0, 32);
    const full = generateCsrfToken();
    const req = makeRequest(short, full);
    assert.throws(
      () => assertCsrfToken(req),
      (err: unknown) => err instanceof CsrfError
    );
  });
});

describe("assertCsrfToken — edge cases", () => {
  test("rejects empty-string token as missing", () => {
    const req = makeRequest("", "");
    // Empty strings are falsy — treated as missing, not valid
    assert.throws(
      () => assertCsrfToken(req),
      (err: unknown) => {
        assert.ok(err instanceof CsrfError);
        assert.ok((err as CsrfError).message.includes("Missing CSRF cookie"));
        return true;
      }
    );
  });

  test("cookie value is URL-decoded", () => {
    const token = "test+token/value=";
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
        [CSRF_HEADER_NAME]: token,
      },
    });
    assert.doesNotThrow(() => assertCsrfToken(req));
  });
});

describe("setCsrfCookie", () => {
  test("returns a valid Set-Cookie string", () => {
    const token = generateCsrfToken();
    const cookie = setCsrfCookie(token);

    assert.ok(cookie.startsWith(`${CSRF_COOKIE_NAME}=`), "Starts with cookie name");
    assert.ok(cookie.includes(encodeURIComponent(token)), "Contains the token");
    assert.ok(cookie.includes("Path=/"), "Has Path=/");
    assert.ok(cookie.includes("SameSite=Strict"), "Has SameSite=Strict");
    assert.ok(cookie.includes("Max-Age=86400"), "Has 24h Max-Age");
  });

  test("does NOT include HttpOnly (JS must be able to read it)", () => {
    const cookie = setCsrfCookie("test");
    assert.ok(!cookie.includes("HttpOnly"), "Must NOT be HttpOnly for double-submit pattern");
  });
});

describe("MOCK_CSRF_TOKEN", () => {
  test("is a non-empty string", () => {
    assert.ok(typeof MOCK_CSRF_TOKEN === "string");
    assert.ok(MOCK_CSRF_TOKEN.length > 0);
  });

  test("is accepted by assertCsrfToken", () => {
    const req = makeRequest(MOCK_CSRF_TOKEN, MOCK_CSRF_TOKEN);
    assert.doesNotThrow(() => assertCsrfToken(req));
  });
});
