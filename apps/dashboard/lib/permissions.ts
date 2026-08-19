import { ROLE_PERMISSIONS, type Permission, type Role, type Session } from "@/lib/auth/session";

/** Returns the role assigned to this user in exactly this guild. */
export function getGuildRole(session: Session, guildId: string): Role | undefined {
  return session.roles[guildId];
}

/**
 * Checks a permission against the role assigned to `guildId`. Never use the
 * deprecated flat session fields here: they would reintroduce cross-tenant
 * privilege escalation.
 */
export function hasPermission(session: Session, guildId: string, permission: Permission): boolean {
  const role = getGuildRole(session, guildId);
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
}

export function hasRole(session: Session, guildId: string, allowedRoles: readonly Role[]): boolean {
  const role = getGuildRole(session, guildId);
  return role !== undefined && allowedRoles.includes(role);
}

export const canManagePasses = (session: Session, guildId: string) => hasPermission(session, guildId, "passes:write");
export const canManageMembers = (session: Session, guildId: string) => hasPermission(session, guildId, "members:write");
export const canManageGuilds = (session: Session, guildId: string) => hasPermission(session, guildId, "guilds:write");
export const canViewActivity = (session: Session, guildId: string) => hasPermission(session, guildId, "activity:read");
export const canEditSettings = (session: Session, guildId: string) => hasPermission(session, guildId, "settings:write");

export class PermissionDeniedError extends Error {
  readonly statusCode = 403;
  readonly expose = true as const;
  constructor(readonly permission: Permission, readonly guildId: string) {
    super(`Permission denied: "${permission}" is required for guild "${guildId}".`);
    this.name = "PermissionDeniedError";
  }
}

export function assertPermission(session: Session, guildId: string, permission: Permission): void {
  if (!hasPermission(session, guildId, permission)) throw new PermissionDeniedError(permission, guildId);
}
