/**
 * lib/auth/session.ts
 *
 * Defines the core permission model for the GuildPass dashboard.
 *
 * Contains:
 *  - Role and Permission type unions
 *  - Session interface
 *  - ROLE_PERMISSIONS matrix — what each role is allowed to do
 *  - Mock sessions for all four roles (dev/test use)
 *  - MOCK_SESSION — the active mock session (change MOCK_ACTIVE_ROLE to switch)
 *
 * ⚠️  Production note: Replace MOCK_SESSION with a real auth call
 *     (e.g. `getServerSession()` from next-auth, or a JWT decode) when
 *     backend authentication is wired up.
 */

// ── Roles ─────────────────────────────────────────────────────────────────────

/**
 * The four supported dashboard roles, ordered from most to least privileged.
 *
 * owner      – Full control; identical permissions to admin in this matrix.
 *              Intended for the guild creator / contract deployer.
 * admin      – Full read + write access to all resources.
 * moderator  – Can read everything and manage members, but cannot create/edit
 *              passes or change guild/workspace settings.
 * readonly   – Read-only access across the board; no mutation capability.
 */
export type Role = "owner" | "admin" | "moderator" | "readonly";

// ── Permissions ───────────────────────────────────────────────────────────────

/**
 * Exhaustive set of permission strings recognised by the dashboard.
 * Format: `<resource>:<action>`
 */
export type Permission =
  | "passes:read"
  | "passes:write"
  | "members:read"
  | "members:write"
  | "guilds:read"
  | "guilds:write"
  | "settings:read"
  | "settings:write";

// ── Session interface ─────────────────────────────────────────────────────────

export interface Session {
  /** Opaque user identifier (wallet address, UUID, etc.) */
  userId: string;
  /** Display name shown in the sidebar role badge */
  name: string;
  /** The user's single assigned role */
  role: Role;
  /**
   * Flat list of permissions granted to this session.
   * Derived from ROLE_PERMISSIONS[role] at session-creation time so that
   * individual permission checks are O(1) array includes.
   */
  permissions: Permission[];
}

// ── Permission matrix ─────────────────────────────────────────────────────────

/**
 * Canonical source-of-truth for which permissions each role holds.
 * UI helpers and API guards both derive their decisions from this matrix.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "passes:read",
    "passes:write",
    "members:read",
    "members:write",
    "guilds:read",
    "guilds:write",
    "settings:read",
    "settings:write",
  ],
  admin: [
    "passes:read",
    "passes:write",
    "members:read",
    "members:write",
    "guilds:read",
    "guilds:write",
    "settings:read",
    "settings:write",
  ],
  moderator: [
    "passes:read",
    "members:read",
    "members:write",
    "guilds:read",
    "settings:read",
  ],
  readonly: [
    "passes:read",
    "members:read",
    "guilds:read",
    "settings:read",
  ],
};

// ── Mock sessions (all four roles) ───────────────────────────────────────────

export const MOCK_SESSIONS: Record<Role, Session> = {
  owner: {
    userId: "mock-owner-001",
    name: "Owner Alice",
    role: "owner",
    permissions: ROLE_PERMISSIONS.owner,
  },
  admin: {
    userId: "mock-admin-001",
    name: "Admin Bob",
    role: "admin",
    permissions: ROLE_PERMISSIONS.admin,
  },
  moderator: {
    userId: "mock-moderator-001",
    name: "Moderator Charlie",
    role: "moderator",
    permissions: ROLE_PERMISSIONS.moderator,
  },
  readonly: {
    userId: "mock-readonly-001",
    name: "Viewer Diana",
    role: "readonly",
    permissions: ROLE_PERMISSIONS.readonly,
  },
};

// ── Active mock session ───────────────────────────────────────────────────────

/**
 * Change this constant to simulate a different role during development.
 * Accepted values: "owner" | "admin" | "moderator" | "readonly"
 *
 * @example
 *   export const MOCK_ACTIVE_ROLE: Role = "readonly";
 */
export const MOCK_ACTIVE_ROLE: Role = "readonly";

/**
 * The session object consumed by useSession() and all permission helpers.
 * In production, replace this export with a real auth SDK call.
 */
export const MOCK_SESSION: Session = MOCK_SESSIONS[MOCK_ACTIVE_ROLE];

// ── API-layer mock session (independent from UI) ──────────────────────────────

/**
 * Separate mock role for the API layer, independent from MOCK_ACTIVE_ROLE (which
 * drives the UI via useSession()). This lets you demonstrate that backend
 * enforcement is real and independent of the UI — e.g. set MOCK_ACTIVE_ROLE to
 * "admin" (UI shows write buttons) and MOCK_API_ROLE to "readonly" (API still
 * rejects every mutation with 403) to prove the backend isn't just trusting
 * the frontend.
 *
 * In production this entire export is deleted — real session resolution
 * happens per-request from the incoming JWT/cookie, not from a shared constant.
 */
export const MOCK_API_ROLE: Role = MOCK_ACTIVE_ROLE;
export const MOCK_API_SESSION: Session = MOCK_SESSIONS[MOCK_API_ROLE];

// ── Mock admin mode (local development) ──────────────────────────────────────

/**
 * Enables mock admin access for local development.
 * Set NEXT_PUBLIC_MOCK_ADMIN=true in apps/dashboard/.env.local and restart
 * the dev server. Management pages will be accessible using MOCK_SESSION.
 *
 * When false (default), getSession() returns null — simulating an
 * unauthenticated visitor who is blocked by the AdminGuard.
 *
 * This constant is intentionally public (NEXT_PUBLIC_*) so the same flag
 * works in both server and client components without duplication.
 */
export const MOCK_ADMIN_MODE: boolean =
  process.env.NEXT_PUBLIC_MOCK_ADMIN === "true";

/**
 * Returns the current session, or null when no authenticated user is present.
 *
 * In production, replace the body with a real auth call:
 *   - next-auth:  const s = await getServerSession(authOptions); return s?.user ?? null;
 *   - JWT/cookie: decode and verify the token from the incoming request headers.
 *   - SIWE:       resolve the signed-in wallet address from the session store.
 *
 * The rest of the codebase (AdminGuard, useSession) imports from here, so
 * swapping auth providers requires changing only this function.
 */
export function getSession(): Session | null {
  return MOCK_ADMIN_MODE ? MOCK_SESSION : null;
}