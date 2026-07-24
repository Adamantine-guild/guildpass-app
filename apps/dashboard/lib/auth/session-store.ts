/**
 * lib/auth/session-store.ts
 *
 * Session-invalidation and token-refresh strategy for live SIWE sessions.
 *
 * ── Design ─────────────────────────────────────────────────────────────────
 *
 * Short-lived access tokens (15 min) paired with long-lived, revocable
 * refresh tokens stored server-side. This bounds the maximum window of
 * stale-permission access to the short access-token lifetime while avoiding
 * forcing a SIWE re-signature on every expiry.
 *
 * ── Token Lifecycle ────────────────────────────────────────────────────────
 *
 *  1. Sign-in → createSession() returns { accessToken, refreshToken }
 *  2. Each API request → validateAccessToken(accessToken) returns Session
 *  3. Access token nears expiry → refreshSession(refreshToken) returns new pair
 *  4. Explicit revocation → revokeSession(sessionId) denies refresh
 *  5. Role change → invalidateUserSessions(userId) bumps generation counter,
 *     denying all refresh attempts for that user's active sessions
 *
 * ── Revocation Bounds ──────────────────────────────────────────────────────
 *
 *  - Access tokens live 15 minutes — this is the MAXIMUM window of stale
 *    permission access after a role change or explicit revocation.
 *  - Refresh tokens are checked against session revocation state and a
 *    per-user generation counter on every refresh attempt.
 *  - Role changes AUTOMATICALLY trigger invalidation — no manual admin
 *    intervention required.
 */

import type { Session, Role, Permission } from "./session";
import { ROLE_PERMISSIONS } from "./session";
import { DEFAULT_GUILD_ID } from "@/lib/mock-data";

// ── Constants ──────────────────────────────────────────────────────────────

/** Short-lived access token lifetime: 15 minutes (in seconds). */
export const ACCESS_TOKEN_TTL = 15 * 60;

/** Long-lived refresh token lifetime: 30 days (in seconds). */
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

/** Refresh token byte length (256-bit). */
const REFRESH_TOKEN_BYTES = 32;

// ── Types ──────────────────────────────────────────────────────────────────

export interface AccessTokenPayload {
  /** Subject — the user's ID. */
  sub: string;
  /** Session ID this token belongs to. */
  sid: string;
  /** The user's display name. */
  name: string;
  /** The user's role at token-issue time. */
  role: Role;
  /** Flat permission list derived from the role. */
  permissions: Permission[];
  /** Issued-at timestamp (Unix seconds). */
  iat: number;
  /** Expiration timestamp (Unix seconds). */
  exp: number;
}

export interface SessionRecord {
  /** Unique session identifier. */
  sessionId: string;
  /** The user this session belongs to. */
  userId: string;
  /** Hashed refresh token stored server-side. */
  refreshTokenHash: string;
  /** Per-user generation counter — bumped on role change to invalidate all. */
  generation: number;
  /** When the session was created (Unix ms). */
  createdAt: number;
  /** When the refresh token expires (Unix ms). */
  expiresAt: number;
  /** Whether the session has been explicitly revoked. */
  revoked: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SessionStore {
  /** Create a new session record and return its tokens. */
  createSession(params: {
    userId: string;
    name: string;
    role: Role;
  }): Promise<TokenPair>;

  /** Validate an access token and return the session it encodes. */
  validateAccessToken(token: string): Promise<Session | null>;

  /**
   * Refresh a session — validate the refresh token, check it hasn't been
   * revoked / invalidated, and return a fresh token pair.
   */
  refreshSession(refreshToken: string): Promise<TokenPair | null>;

  /** Explicitly revoke a session by ID. */
  revokeSession(sessionId: string): Promise<void>;

  /**
   * Invalidate ALL active sessions for a user by bumping their generation
   * counter. Called automatically when a user's role changes.
   */
  invalidateUserSessions(userId: string): Promise<void>;

  /** Get the current generation counter for a user. */
  getUserGeneration(userId: string): Promise<number>;

  /** Get all active (non-revoked, non-expired) session records for a user. */
  getUserSessions(userId: string): Promise<SessionRecord[]>;
}

// ── In-memory session store (server-side singleton) ────────────────────────

// NOTE: In production, this would be backed by a database (PostgreSQL, Redis).
// The in-memory store here serves as the mock/default implementation and
// demonstrates the full session lifecycle contract.

// ── Secret for token signing ───────────────────────────────────────────────

let _signingKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (_signingKey) return _signingKey;

  // In production, this comes from an environment variable.
  // For dev/test, derive from a fixed seed (deterministic across restarts).
  const secret =
    process.env.SESSION_SIGNING_SECRET || "guildpass-dev-signing-secret-do-not-use-in-prod";

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  _signingKey = keyMaterial;
  return _signingKey;
}

// ── Token encoding / decoding ──────────────────────────────────────────────

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const key = await getSigningKey();
  const encoder = new TextEncoder();

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));

  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signingInput),
  );
  const signatureB64 = base64UrlEncode(signature);

  return `${signingInput}.${signatureB64}`;
}

async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const key = await getSigningKey();
    const encoder = new TextEncoder();

    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(signingInput),
    );

    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as AccessTokenPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;

    return payload;
  } catch {
    return null;
  }
}

function generateRefreshToken(): string {
  const bytes = new Uint8Array(REFRESH_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── In-Memory Session Store Implementation ─────────────────────────────────

interface InMemoryStore {
  sessions: Map<string, SessionRecord>;
  generations: Map<string, number>; // userId → generation counter
}

function createInMemoryStore(): InMemoryStore {
  return {
    sessions: new Map(),
    generations: new Map(),
  };
}

// Global singleton — in production this is replaced by a DB-backed store.
const _store: InMemoryStore = createInMemoryStore();

/**
 * Create an in-memory session store.
 *
 * In production, replace this with a durable store backed by PostgreSQL,
 * Redis, or the platform's session storage.
 */
export function createSessionStore(): SessionStore {
  const store = _store;

  return {
    async createSession({ userId, name, role }) {
      const now = Date.now();
      const sessionId = crypto.randomUUID();
      const refreshToken = generateRefreshToken();
      const refreshTokenHash = await hashToken(refreshToken);

      // Get or initialize the user's generation counter.
      let generation = store.generations.get(userId) ?? 0;

      const record: SessionRecord = {
        sessionId,
        userId,
        refreshTokenHash,
        generation,
        createdAt: now,
        expiresAt: now + REFRESH_TOKEN_TTL * 1000,
        revoked: false,
      };

      store.sessions.set(sessionId, record);
      if (!store.generations.has(userId)) {
        store.generations.set(userId, generation);
      }

      const nowSec = Math.floor(now / 1000);
      const accessPayload: AccessTokenPayload = {
        sub: userId,
        sid: sessionId,
        name,
        role,
        permissions: [...ROLE_PERMISSIONS[role]],
        iat: nowSec,
        exp: nowSec + ACCESS_TOKEN_TTL,
      };

      const accessToken = await signAccessToken(accessPayload);

      return { accessToken, refreshToken };
    },

    async validateAccessToken(token) {
      const payload = await verifyAccessToken(token);
      if (!payload) return null;

      return {
        userId: payload.sub,
        name: payload.name,
        roles: { [DEFAULT_GUILD_ID]: payload.role },
        activeGuildId: DEFAULT_GUILD_ID,
        role: payload.role,
        permissions: payload.permissions,
      };
    },

    async refreshSession(refreshToken) {
      const refreshHash = await hashToken(refreshToken);

      // Find the session with this refresh token hash.
      let found: SessionRecord | null = null;
      for (const [, record] of store.sessions) {
        if (record.refreshTokenHash === refreshHash) {
          found = record;
          break;
        }
      }

      if (!found) return null;

      const now = Date.now();

      // Check explicit revocation.
      if (found.revoked) return null;

      // Check expiry.
      if (found.expiresAt <= now) return null;

      // Check generation counter — if the user's generation has advanced
      // (role changed since this session was created), deny refresh.
      const currentGeneration = store.generations.get(found.userId) ?? 0;
      if (found.generation < currentGeneration) return null;

      // Delete the old session record (one-time use refresh token).
      store.sessions.delete(found.sessionId);

      // Create a new session (new refresh token, new generation snapshot).
      // We need the user's current name and role — in a production system
      // this would be fetched from the user store. For now, we preserve
      // the existing role from the access token payload. In practice,
      // the refresh endpoint receives the old access token too, so we
      // can extract the name/role from it or look up the user.
      //
      // For a proper implementation, the refresh endpoint should also
      // receive the access token to extract user metadata. Here we
      // construct a new session with the current generation.
      return this.createSession({
        userId: found.userId,
        name: found.userId, // placeholder — real impl fetches from user store
        role: "readonly", // placeholder — real impl needs current role
        // NOTE: The above placeholders are intentional. In a fully wired
        // production system, refreshSession also receives the old accessToken
        // (or looks up the user) to get the current name and role.
        // See the refresh endpoint for the complete implementation.
      });
    },

    async revokeSession(sessionId) {
      const record = store.sessions.get(sessionId);
      if (record) {
        record.revoked = true;
      }
    },

    async invalidateUserSessions(userId) {
      // Bump the generation counter. All existing sessions with a lower
      // generation will be denied on refresh.
      const currentGen = store.generations.get(userId) ?? 0;
      store.generations.set(userId, currentGen + 1);
    },

    async getUserGeneration(userId) {
      return store.generations.get(userId) ?? 0;
    },

    async getUserSessions(userId) {
      const now = Date.now();
      const sessions: SessionRecord[] = [];
      for (const [, record] of store.sessions) {
        if (record.userId === userId && !record.revoked && record.expiresAt > now) {
          sessions.push({ ...record });
        }
      }
      return sessions;
    },
  };
}

// ── Enhanced refresh with user metadata ────────────────────────────────────

/**
 * Refresh a session with explicit user metadata.
 *
 * Unlike `SessionStore.refreshSession()`, this variant receives the current
 * user name and role rather than placeholders. This is the function the
 * refresh API endpoint should call.
 */
export async function refreshSessionWithMetadata(
  store: SessionStore,
  refreshToken: string,
  currentName: string,
  currentRole: Role,
): Promise<TokenPair | null> {
  // We need access to the internal store to validate the refresh token
  // and get the userId. For the in-memory store, we do a direct lookup.
  const refreshHash = await hashToken(refreshToken);

  let found: SessionRecord | null = null;
  for (const [, record] of _store.sessions) {
    if (record.refreshTokenHash === refreshHash) {
      found = record;
      break;
    }
  }

  if (!found) return null;

  const now = Date.now();
  if (found.revoked) return null;
  if (found.expiresAt <= now) return null;

  const currentGeneration = _store.generations.get(found.userId) ?? 0;
  if (found.generation < currentGeneration) return null;

  // Delete old session (one-time use).
  _store.sessions.delete(found.sessionId);

  // Create a new session with the current user metadata.
  return store.createSession({
    userId: found.userId,
    name: currentName,
    role: currentRole,
  });
}

// ── Test helpers ───────────────────────────────────────────────────────────

/**
 * Clear all session data. For testing only.
 */
export function clearSessionStore(): void {
  _store.sessions.clear();
  _store.generations.clear();
}

/**
 * Get the raw store for introspection in tests.
 */
export function _getRawStore(): InMemoryStore {
  return _store;
}
