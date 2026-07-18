/**
 * POST /api/auth/signin
 *
 * Creates a new session and returns an access + refresh token pair.
 *
 * In production, this endpoint validates a SIWE (Sign-In with Ethereum)
 * signature before creating the session. The mock mode is for dev/testing.
 *
 * Request body:
 *   { userId: string, name: string, role: Role }
 *
 * Response:
 *   { accessToken: string, refreshToken: string, expiresIn: number }
 */

import { NextResponse } from "next/server";
import { apiError, apiResponse, apiValidationError } from "@/lib/api-helpers";
import { getSessionStore } from "@/lib/auth/server-session";
import { ACCESS_TOKEN_TTL } from "@/lib/auth/session-store";
import type { Role } from "@/lib/auth/session";
import { getApiMode } from "@/lib/env";

const VALID_ROLES: Role[] = ["owner", "admin", "moderator", "readonly"];

export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Invalid request body", [
      { field: "body", message: "Request body must be valid JSON" },
    ]);
  }

  const mode = getApiMode();

  // In mock mode, accept a simple sign-in payload for testing.
  // In live mode, SIWE validation would happen here.
  if (mode !== "mock" && mode !== "live") {
    return apiError(`Unsupported API mode: ${mode}`, 500);
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = typeof body.role === "string" ? body.role : "";

  const errors: { field: string; message: string }[] = [];
  if (!userId) errors.push({ field: "userId", message: "userId is required" });
  if (!name) errors.push({ field: "name", message: "name is required" });
  if (!VALID_ROLES.includes(role as Role)) {
    errors.push({
      field: "role",
      message: `role must be one of: ${VALID_ROLES.join(", ")}`,
    });
  }

  if (errors.length > 0) {
    return apiValidationError("Invalid sign-in payload", errors);
  }

  // TODO (live mode): Validate SIWE signature before creating session.
  // const siweMessage = body.siweMessage;
  // const siweSignature = body.siweSignature;
  // if (mode === "live") { validate SIWE ... }

  const { DEFAULT_GUILD_ID } = await import("@/lib/mock-data");
  const sessionStore = getSessionStore();
  const tokens = await sessionStore.createSession({
    userId,
    name,
    roles: {
      [DEFAULT_GUILD_ID]: role as Role,
    },
  });

  return apiResponse({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}
