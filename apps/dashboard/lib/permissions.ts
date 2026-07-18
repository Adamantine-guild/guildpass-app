/**
 * lib/permissions.ts
 *
 * Pure permission helper functions used by both client components (UI gating)
 * and server-side API route handlers (mutation enforcement).
 *
 * Design principles:
 *  - All logic lives here; no inline `session.permissions.includes(...)` spread
 *    around the codebase.
 *  - Named helpers (canManagePasses, etc.) are the public API — import these.
 *  - `assertPermission` is the server-side guard; it throws PermissionDeniedError
 *    which API routes catch and convert to a 403 response.
 *
 * ⚠️  UI hiding is a UX convenience only. Real security depends on backend
 *     enforcement via assertPermission in every mutation route handler.
 */

import type { Session, Permission } from "@/lib/auth/session";
import { ROLE_PERMISSIONS } from "@/lib/auth/session";

// ── Core check ────────────────────────────────────────────────────────────────

/**
 * Returns true if the session holds the requested permission for the given guild.
 * This is the single primitive all other helpers delegate to.
 */
export function hasPermission(session: Session, guildId: string, permission: Permission): boolean {
  if (!session || !session.roles) return false;
  const role = session.roles[guildId];
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Returns true if the session user holds one of the allowed roles in the given guild.
 */
export function hasRole(session: Session, guildId: string, allowedRoles: string[]): boolean {
  if (!session || !session.roles) return false;
  const role = session.roles[guildId];
  if (!role) return false;
  return allowedRoles.includes(role);
}

// ── Named helpers (UI gating) ─────────────────────────────────────────────────

/** Can the user create, edit, or delete passes? */
export const canManagePasses = (session: Session, guildId: string): boolean =>
  hasPermission(session, guildId, "passes:write");

/** Can the user invite, remove, or change roles of members? */
export const canManageMembers = (session: Session, guildId: string): boolean =>
  hasPermission(session, guildId, "members:write");

/** Can the user edit guild metadata (name, description, etc.)? */
export const canManageGuilds = (session: Session, guildId: string): boolean =>
  hasPermission(session, guildId, "guilds:write");

/** Can the user view dashboard activity? */
export const canViewActivity = (session: Session, guildId: string): boolean =>
  hasPermission(session, guildId, "activity:read");

/** Can the user save changes on the Settings page? */
export const canEditSettings = (session: Session, guildId: string): boolean =>
  hasPermission(session, guildId, "settings:write");

// ── Server-side assertion (API route guard) ───────────────────────────────────

/**
 * Custom error thrown by assertPermission.
 * API routes should catch this and return a 403 response.
 */
export class PermissionDeniedError extends Error {
  readonly permission: Permission;
  readonly statusCode = 403;
  /** Marks this as a client-safe error so handleApiError exposes its message. */
  readonly expose = true as const;

  constructor(permission: Permission) {
    super(`Permission denied: "${permission}" is required for this action.`);
    this.name = "PermissionDeniedError";
    this.permission = permission;
  }
}

/**
 * Throws PermissionDeniedError if the session does not hold `permission` in `guildId`.
 */
export function assertPermission(session: Session, guildId: string, permission: Permission): void {
  if (!hasPermission(session, guildId, permission)) {
    throw new PermissionDeniedError(permission);
  }
}
