import { NextResponse } from "next/server";
import { handleApiError, apiError } from "@/lib/api-helpers";
import { type Guild } from "@/lib/mock-data";
import { MOCK_API_SESSION } from "@/lib/auth/session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { getApiMode } from "@/lib/env";
import { guildService } from "@/lib/data/guild-service";

/**
 * GET /api/guilds
 * Accessible to all authenticated roles (guilds:read).
 */
export async function GET(): Promise<NextResponse> {
  return handleApiError(async () => {
    const apiMode = getApiMode();

    if (apiMode === "live") {
      return apiError("Guild listing in live mode is not implemented", 501);
    }

    return await guildService.getAllGuilds();
  });
}

/**
 * POST /api/guilds
 * Requires guilds:write permission.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertPermission(MOCK_API_SESSION, "guilds:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    throw err;
  }

  return handleApiError(async () => {
    const body = await request.json();

    if (!body.name) {
      return apiError("Guild name is required", 400);
    }

    return await guildService.createGuild(body);
  });
}

/**
 * DELETE /api/guilds
 * Requires guilds:write permission.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    assertPermission(MOCK_API_SESSION, "guilds:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    throw err;
  }

  return handleApiError(async () => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return apiError("Guild ID is required", 400);
    }

    const deleted = await guildService.deleteGuild(id);
    if (!deleted) {
      return apiError("Guild not found", 404);
    }

    return { message: "Guild deleted" };
  });
}
