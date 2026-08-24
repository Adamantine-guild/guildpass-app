/**
 * lib/auth/require-permission.ts
 *
 * Centralizes the session-resolution + assertPermission try/catch that used
 * to be duplicated in every mutation route handler. Also hooks in audit
 * recording of denied attempts so it isn't duplicated per-route either.
 */

import type { NextResponse } from "next/server";
import { apiError } from "@/lib/api-helpers";
import { requireDashboardSession, UnauthorizedError } from "./server-session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { recordDashboardActivity } from "@/lib/activity/dashboard";
import type { Permission, Session } from "./session";

export type PermissionGuardResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

/**
 * Asserts that `session` holds `permission`. On denial, records an
 * `activity.permission_denied` audit event and returns the 403 response to
 * send. Recording is fire-and-forget and swallows its own errors — an audit
 * write failure must never delay or fail the 403 response.
 */
export function guardPermission(
  session: Session,
  guildId: string,
  permission: Permission
): PermissionGuardResult {
  try {
    assertPermission(session, guildId, permission);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      recordPermissionDenied(session, guildId, permission);
      return { ok: false, response: apiError(err.message, 403) };
    }
    throw err;
  }
  return { ok: true, session };
}

/**
 * Resolves the session from `request` and asserts `permission` — the common
 * case for API route handlers.
 *
 * @example
 * ```ts
 * const guard = await requireSessionAndPermission(request, guildId, "passes:write");
 * if (!guard.ok) return guard.response;
 * const { session } = guard;
 * ```
 */
export async function requireSessionAndPermission(
  request: Request,
  guildId: string,
  permission: Permission
): Promise<PermissionGuardResult> {
  let session: Session;
  try {
    session = await requireDashboardSession(request);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { ok: false, response: apiError(err.message, 401) };
    }
    throw err;
  }

  return guardPermission(session, guildId, permission);
}

function recordPermissionDenied(session: Session, guildId: string, permission: Permission): void {
  void recordDashboardActivity(guildId, {
    type: "activity.permission_denied",
    severity: "warning",
    actor: { id: session.userId, name: session.name },
    description: `Permission denied: "${permission}" is required for this action.`,
    metadata: { permission, guildId, role: session.roles[guildId] ?? null },
  }).catch((err) => {
    console.error("Failed to record permission_denied activity event:", err);
  });
}
