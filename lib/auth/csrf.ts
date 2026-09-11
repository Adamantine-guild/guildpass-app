/**
 * lib/auth/csrf.ts
 *
 * CSRF protection using the double-submit cookie pattern.
 *
 * How it works:
 *   1. A random token is set as a cookie on the client (non-HttpOnly so JS can read it).
 *   2. The client reads the cookie and sends the same value back in an X-CSRF-Token header.
 *   3. The server compares the cookie value with the header value.
 *      – If they match: the request originated from a page on the same origin.
 *      – If they differ or either is missing: reject the request (403).
 *
 * This is defense-in-depth alongside SameSite cookie attributes.
 *
 * ⚠️  Production: generateCsrfToken() should be called whenever a new session
 *     is created (SIWE login, session refresh). The token is tied to the session,
 *     not the request, so it persists across requests.
 *
 * Security properties:
 *   – Cookie uses __Host- prefix → browser enforces Secure + Path=/ + no Domain.
 *   – SameSite=Strict → cookie is never sent on cross-site requests.
 *   – Token comparison is constant-time to prevent timing attacks.
 */

import { timingSafeEqual, randomBytes } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Name of the CSRF cookie sent to the browser. */
export const CSRF_COOKIE_NAME = "__Host-guildpass-csrf";

/** Name of the request header the client must send back. */
export const CSRF_HEADER_NAME = "X-CSRF-Token";

/** Byte length of the random CSRF token (32 bytes → 64 hex chars). */
const TOKEN_BYTES = 32;

// ── Cookie options ────────────────────────────────────────────────────────────

/**
 * Standard cookie attributes for the CSRF token cookie.
 *
 * – SameSite=Strict: cookie is never attached to cross-site requests.
 * – Secure: only sent over HTTPS (set to false in local dev if needed).
 * – HttpOnly=false: client JS must be able to read the value.
 * – Path=/: available to all API routes.
 * – __Host- prefix: browser enforces Secure + Path=/ (no Domain override).
 */
export function getCsrfCookieOptions(): {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict";
    path: string;
    maxAge: number;
  };
} {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    name: CSRF_COOKIE_NAME,
    value: "", // filled in by caller
    options: {
      httpOnly: false, // JS must read this for double-submit
      secure: isProduction,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24, // 24 hours
    },
  };
}

// ── Token generation ──────────────────────────────────────────────────────────

/**
 * Generates a cryptographically secure random CSRF token.
 *
 * @returns A 64-character hex string (32 random bytes).
 *
 * @example
 *   const token = generateCsrfToken();
 *   // "a1b2c3d4e5f6...64 chars total"
 */
export function generateCsrfToken(): string {
  // Server-side: Node.js crypto
  if (typeof window === "undefined") {
    return randomBytes(TOKEN_BYTES).toString("hex");
  }

  // Client-side fallback: Web Crypto API
  const bytes = new Uint8Array(TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Error type ────────────────────────────────────────────────────────────────

/**
 * Thrown when CSRF validation fails.
 * Carries a user-safe message and HTTP 403 status code.
 */
export class CsrfError extends Error {
  public readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "CsrfError";
  }
}

// ── Token extraction helpers ──────────────────────────────────────────────────

/**
 * Extracts the CSRF token cookie value from the request's Cookie header.
 *
 * @returns The token string, or `null` if the cookie is not present.
 */
function extractCookieToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  // Parse cookies manually to avoid dependencies
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((pair) => {
      const [key, ...rest] = pair.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    })
  );

  return cookies[CSRF_COOKIE_NAME] ?? null;
}

/**
 * Extracts the CSRF token from the X-CSRF-Token request header.
 *
 * @returns The token string, or `null` if the header is not present.
 */
function extractHeaderToken(request: Request): string | null {
  return request.headers.get(CSRF_HEADER_NAME);
}

// ── Constant-time comparison ──────────────────────────────────────────────────

/**
 * Compares two token strings in constant time to prevent timing attacks.
 *
 * Falls back to a pure-JS implementation if crypto.timingSafeEqual is unavailable
 * (e.g. in edge runtimes). The fallback still compares every byte.
 */
function constantTimeEqual(a: string, b: string): boolean {
  // Quick length check before the constant-time compare
  if (a.length !== b.length) return false;

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  return timingSafeEqual(bufA, bufB);
}

// ── Main guard ────────────────────────────────────────────────────────────────

/**
 * Validates the CSRF double-submit cookie pattern for a mutating request.
 *
 * Compares the value of the `__Host-guildpass-csrf` cookie against the
 * `X-CSRF-Token` request header. If they match, the request is considered
 * same-origin and the guard passes. Otherwise, a CsrfError is thrown.
 *
 * @param request – The incoming Request (or NextRequest) object.
 * @throws {CsrfError} If either the cookie or header token is missing or mismatched.
 *
 * @example
 *   // In a route handler:
 *   export async function POST(request: Request) {
 *     assertCsrfToken(request); // throws CsrfError on failure
 *     // ... mutation logic ...
 *   }
 */
export function assertCsrfToken(request: Request): void {
  const cookieToken = extractCookieToken(request);
  const headerToken = extractHeaderToken(request);

  if (!cookieToken) {
    throw new CsrfError(
      `Missing CSRF cookie ("${CSRF_COOKIE_NAME}"). Ensure the session includes a CSRF token.`
    );
  }

  if (!headerToken) {
    throw new CsrfError(
      `Missing CSRF header ("${CSRF_HEADER_NAME}"). The client must read the CSRF cookie and send it back as a header.`
    );
  }

  if (!constantTimeEqual(cookieToken, headerToken)) {
    throw new CsrfError(
      "CSRF token mismatch. The cookie value does not match the header value."
    );
  }
}

// ── Cookie setter helper ──────────────────────────────────────────────────────

/**
 * Creates a Set-Cookie header string for the CSRF token.
 *
 * Use this when issuing a new session or refreshing an existing one.
 *
 * @param token – The token value to set (use `generateCsrfToken()`).
 * @returns A Set-Cookie header value string.
 *
 * @example
 *   const token = generateCsrfToken();
 *   const cookie = setCsrfCookie(token);
 *   // "__Host-guildpass-csrf=abc123...; Path=/; SameSite=Strict; Secure; Max-Age=86400"
 */
export function setCsrfCookie(token: string): string {
  const { options } = getCsrfCookieOptions();
  const parts: string[] = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`,
    `Max-Age=${options.maxAge}`,
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  // Explicitly not setting HttpOnly — JS must be able to read this cookie
  return parts.join("; ");
}

// ── Mock token for dev/test ───────────────────────────────────────────────────

/**
 * A deterministic CSRF token for use in mock mode and tests.
 *
 * In mock mode the dashboard UI can read this token and send it as a header
 * to satisfy the CSRF guard without real session infrastructure.
 *
 * ⚠️  Never use this value in production.
 */
export const MOCK_CSRF_TOKEN = "mock-csrf-token-for-development-only";
