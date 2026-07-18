/**
 * POST /api/auth/refresh
 *
 * Exchanges a valid refresh token for a new access + refresh token pair.
 *
 * The old refresh token is consumed (one-time use). If the session has been
 * revoked or the user's generation counter has been bumped (e.g., role change),
 * the refresh is denied.
 *
 * Request body:
 *   { refreshToken: string, accessToken: string }
 *
 * The accessToken is needed to extract the user's current metadata (name, role).
 *
 * Response:
 *   { accessToken: string, refreshToken: string, expiresIn: number }
 */

import { NextResponse } from "next/server";
import { apiError, apiResponse, apiValidationError } from "@/lib/api-helpers";
import { getSessionStore } from "@/lib/auth/server-session";
import { ACCESS_TOKEN_TTL, refreshSessionWithMetadata } from "@/lib/auth/session-store";
import type { Role } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Invalid request body", [
      { field: "body", message: "Request body must be valid JSON" },
    ]);
  }

  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";

  if (!refreshToken) {
    return apiValidationError("Missing refresh token", [
      { field: "refreshToken", message: "refreshToken is required" },
    ]);
  }

  // Extract user metadata from the (possibly expired) access token.
  // We only need name and roles to construct the new access token.
  let currentName = "unknown";
  const { DEFAULT_GUILD_ID } = await import("@/lib/mock-data");
  let currentRoles: Record<string, Role> = { [DEFAULT_GUILD_ID]: "readonly" };

  if (accessToken) {
    const sessionStore = getSessionStore();
    // Allow expired tokens for metadata extraction only.
    try {
      // Decode without expiry check by looking at the raw payload.
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const payloadJson = Buffer.from(payloadB64, "base64").toString("utf-8");
        const payload = JSON.parse(payloadJson);
        if (payload.name) currentName = payload.name;
        if (payload.roles) currentRoles = payload.roles as Record<string, Role>;
      }
    } catch {
      // If the access token is completely malformed, fall back to defaults.
      // The refresh will still succeed or fail based on the refresh token.
    }
  }

  const sessionStore = getSessionStore();
  const tokens = await refreshSessionWithMetadata(
    sessionStore,
    refreshToken,
    currentName,
    currentRoles,
  );

  if (!tokens) {
    return apiError(
      "Refresh token is invalid, expired, or has been revoked. " +
        "Please sign in again.",
      401,
    );
  }

  return apiResponse({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}
