/**
 * POST /api/auth/revoke
 *
 * Explicitly revokes a session by session ID.
 * After revocation, the refresh token for that session will no longer work.
 * Existing access tokens for that session remain valid until they expire
 * (bounded to the 15-minute access-token lifetime).
 *
 * Request body:
 *   { sessionId: string }
 *
 * Requires: authenticated session (any role can revoke their own session;
 *           admin/owner can revoke any session).
 */

import type { NextResponse } from "next/server";
import { apiError, apiResponse, apiValidationError } from "@/lib/api-helpers";
import { requireDashboardSession, UnauthorizedError, getSessionStore } from "@/lib/auth/server-session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { getActiveGuildId } from "@/lib/guild-context";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireDashboardSession(request);
    // Any authenticated user can revoke a session.
    // For admin-controlled revocation, add an additional permission check.
    assertPermission(session, getActiveGuildId(request), "members:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    if (err instanceof UnauthorizedError) {
      return apiError(err.message, 401);
    }
    throw err;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Invalid request body", [
      { field: "body", message: "Request body must be valid JSON" },
    ]);
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";

  if (!sessionId) {
    return apiValidationError("Missing session ID", [
      { field: "sessionId", message: "sessionId is required" },
    ]);
  }

  const sessionStore = getSessionStore();
  await sessionStore.revokeSession(sessionId);

  return apiResponse({ success: true, revoked: sessionId });
}

/**
 * POST /api/auth/revoke-all
 *
 * Revokes ALL active sessions for a user. Used when a user's access
 * needs to be terminated immediately (e.g., account compromised).
 *
 * Request body:
 *   { userId: string }
 *
 * Requires: admin or owner role.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const session = await requireDashboardSession(request);
    // Revoking all sessions is a privileged operation.
    assertPermission(session, getActiveGuildId(request), "members:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    if (err instanceof UnauthorizedError) {
      return apiError(err.message, 401);
    }
    throw err;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Invalid request body", [
      { field: "body", message: "Request body must be valid JSON" },
    ]);
  }

  const userId = typeof body.userId === "string" ? body.userId : "";

  if (!userId) {
    return apiValidationError("Missing user ID", [
      { field: "userId", message: "userId is required" },
    ]);
  }

  const sessionStore = getSessionStore();
  await sessionStore.invalidateUserSessions(userId);

  return apiResponse({
    success: true,
    invalidatedUser: userId,
    message:
      "All active sessions for this user have been invalidated. " +
      "Existing access tokens remain valid for up to 15 minutes.",
  });
}
