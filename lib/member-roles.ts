/**
 * lib/member-roles.ts
 *
 * Single source of truth for the allowed *member-record* roles, plus the pure
 * helpers used to edit a member's role list in the UI. These are intentionally
 * separate from the dashboard access-control roles (owner / admin / moderator /
 * readonly in lib/auth/session.ts), which govern what a *session* may do — see
 * issue #74's note.
 *
 * The API-side payload validation (lib/validation/mutations.ts) imports
 * MEMBER_ROLES from here so the role editor can only ever offer values the
 * server will accept.
 */

export const MEMBER_ROLES = ["admin", "member", "contributor"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Type guard: is `value` one of the supported member roles? */
export function isMemberRole(value: unknown): value is MemberRole {
  return (
    typeof value === "string" &&
    (MEMBER_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Add a role to a member's role list. No-ops on an unsupported role or a
 * duplicate, so the result is always a valid, de-duplicated list.
 */
export function addRole(roles: string[], role: string): string[] {
  if (!isMemberRole(role) || roles.includes(role)) return roles;
  return [...roles, role];
}

/** Remove a role from a member's role list (no-op if absent). */
export function removeRole(roles: string[], role: string): string[] {
  return roles.filter((r) => r !== role);
}
