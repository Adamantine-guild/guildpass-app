/**
 * lib/auth/server-session.ts
 *
 * Server-side session resolution abstraction for API route handlers.
 *
 * API routes call `requireDashboardSession(request)` instead of importing
 * `MOCK_API_SESSION` directly. This decouples route handler logic from the
 * session source and creates the boundary needed to add real authentication
 * (cookies, JWTs, SIWE sessions, etc.) later without touching every route.
 *
 * ── Current behaviour (mock mode) ───────────────────────────────────────────
 *   Returns MOCK_API_SESSION — the pre-configured mock session.
 *   Switch MOCK_API_ROLE in session.ts to test different permission levels.
 *
 * ── Live mode (session-store) ──────────────────────────────────────────────
 *   Resolves the session from an Authorization: Bearer <accessToken> header
 *   (API routes) or the guildpass_session cookie (Server Components).
 *   Access tokens are short-lived (15 min) and validated via HMAC signature.
 *   Stale-permission window is bounded to the access-token lifetime.
 */

import type { Session } from "./session";
import { MOCK_API_SESSION } from "./session";
import { getApiMode } from "@/lib/env";
import { cookies, headers } from "next/headers";
import { createSessionStore, clearSessionStore, type SessionStore } from "./session-store";

// ── Error types ──────────────────────────────────────────────────────────────

/**
 * Thrown when no valid session can be resolved from the request.
 * API routes should catch this and return a 401 response.
 */
export class UnauthorizedError extends Error {
  readonly statusCode = 401;

  constructor(message = "Unauthorized: no valid session") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

// ── Session store singleton ─────────────────────────────────────────────────

let _sessionStore: SessionStore | null = null;

/**
 * Get or create the session store singleton.
 * In mock mode this is unused; in live mode it validates and manages sessions.
 */
export function getSessionStore(): SessionStore {
  if (!_sessionStore) {
    _sessionStore = createSessionStore();
  }
  return _sessionStore;
}

/**
 * Reset the session store (for testing).
 */
export function resetSessionStore(): void {
  _sessionStore = null;
  clearSessionStore();
}

// ── Session resolution ──────────────────────────────────────────────────────

/**
 * Extract the access token from the Authorization header of a Request.
 */
function extractAccessToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Extract a Bearer access token from a raw Authorization header value.
 * Shared by the Server Component path, which reads the header via next/headers
 * rather than from a Request object. Returns null for a missing or malformed
 * header so the caller can distinguish "no token" from "rejected token".
 */
function parseBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }
  return parts[1];
}

/**
 * Resolves the current dashboard session from the incoming `Request`.
 *
 * **Mock mode** (default, `DASHBOARD_API_MODE=mock`):
 *   Returns `MOCK_API_SESSION` for predictable local role testing.
 *
 * **Live mode** (`DASHBOARD_API_MODE=live`):
 *   Validates the access token from the `Authorization: Bearer <token>` header.
 *   Throws `UnauthorizedError` if the token is missing, invalid, or expired.
 *
 * @throws {UnauthorizedError} When no valid session can be resolved.
 */
export async function getDashboardSession(request: Request): Promise<Session> {
  const mode = getApiMode();

  if (mode === "live") {
    const token = extractAccessToken(request);
    if (!token) {
      throw new UnauthorizedError(
        "Missing or invalid Authorization header. " +
          "Provide a Bearer token from the sign-in endpoint."
      );
    }

    const sessionStore = getSessionStore();
    const session = await sessionStore.validateAccessToken(token);

    if (!session) {
      throw new UnauthorizedError(
        "Access token is invalid or expired. " +
          "Refresh your session or sign in again."
      );
    }

    return session;
  }

  return MOCK_API_SESSION;
}

/**
 * Like `getDashboardSession`, but semantically asserts that the caller
 * requires a valid session. Throws `UnauthorizedError` if resolution fails.
 *
 * This is the primary function API route handlers should use before
 * proceeding with permission checks.
 *
 * @example
 * ```ts
 * import { requireDashboardSession, UnauthorizedError } from "@/lib/auth/server-session";
 * import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
 *
 * export async function POST(request: Request) {
 *   try {
 *     const session = await requireDashboardSession(request);
 *     assertPermission(session, guildId, "passes:write");
 *   } catch (err) {
 *     if (err instanceof PermissionDeniedError) return apiError(err.message, 403);
 *     if (err instanceof UnauthorizedError)    return apiError(err.message, 401);
 *     throw err;
 *   }
 *   // ... handle the mutation
 * }
 * ```
 */
export async function requireDashboardSession(request: Request): Promise<Session> {
  return getDashboardSession(request);
}

/**
 * Pure session-resolution core for the Server Component path. Takes the raw
 * cookie token and Authorization header value as plain arguments so it can be
 * unit-tested without mocking next/headers. Cookie is preferred; a Bearer
 * header is the fallback.
 *
 * Two distinct 401 cases, both surfaced as UnauthorizedError with different
 * messages so client-side redirect logic can tell them apart:
 *   - MISSING: no usable token in either source.
 *   - INVALID: a token was presented but failed signature or expiry checks.
 *
 * @throws {UnauthorizedError} MISSING when neither source has a token;
 *         INVALID when a token is present but fails signature/expiry checks.
 */
export async function resolveServerComponentSession(
  cookieToken: string | null | undefined,
  authHeader: string | null | undefined,
): Promise<Session> {
  const token = (cookieToken ?? null) || parseBearer(authHeader);

  if (!token) {
    throw new UnauthorizedError(
      "No session cookie or authorization header present.",
    );
  }

  const session = await getSessionStore().validateAccessToken(token);
  if (!session) {
    throw new UnauthorizedError(
      "Session token is invalid or expired. Sign in again.",
    );
  }

  return session;
}

/**
 * Resolves the active session within Next.js Server Components or Layouts.
 *
 * **Mock mode:** returns MOCK_SESSION (matching the UI's MOCK_ACTIVE_ROLE).
 *
 * **Live mode:** reads the `guildpass_session` cookie (preferred) or an
 * `Authorization: Bearer <token>` header (fallback), then validates the token
 * through the SAME session store the API-route path uses. This deliberately
 * reuses the existing HMAC-signed-JWT verification in session-store.ts rather
 * than introducing a second verification mechanism — a single source of truth
 * for "what is a valid token" is a security requirement, not a convenience.
 *
 * @throws {UnauthorizedError} When no valid session can be resolved.
 */
export async function getServerComponentSession(): Promise<Session> {
  const mode = getApiMode();

  if (mode === "live") {
    const cookieStore = await cookies();
    const headerList = await headers();
    return resolveServerComponentSession(
      cookieStore.get("guildpass_session")?.value ?? null,
      headerList.get("authorization"),
    );
  }

  const { MOCK_SESSION } = await import("./session");
  return MOCK_SESSION;
}
