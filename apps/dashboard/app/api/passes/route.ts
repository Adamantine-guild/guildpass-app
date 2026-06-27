import { NextResponse } from "next/server";
import { handleApiError, apiError } from "@/lib/api-helpers";
import { MOCK_API_SESSION } from "@/lib/auth/session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { getApiMode } from "@/lib/env";
import { passService } from "@/lib/data/pass-service";

/**
 * GET /api/passes
 * Accessible to all authenticated roles (passes:read).
 */
export async function GET(): Promise<NextResponse> {
  return handleApiError(async () => {
    const apiMode = getApiMode();

    if (apiMode === "live") {
      return apiError("Pass listing in live mode is not implemented", 501);
    }

    return await passService.getAllPasses();
  });
}

/**
 * POST /api/passes
 * Requires passes:write permission.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertPermission(MOCK_API_SESSION, "passes:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    throw err;
  }

  return handleApiError(async () => {
    const body = await request.json();

    // Simple validation
    if (!body.name) {
      return apiError("Pass name is required", 400);
    }

    return await passService.createPass(body);
  });
}

/**
 * DELETE /api/passes
 * Requires passes:write permission.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    assertPermission(MOCK_API_SESSION, "passes:write");
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
      return apiError("Pass ID is required", 400);
    }

    const deleted = await passService.deletePass(id);
    if (!deleted) {
      return apiError("Pass not found", 404);
    }

    return { message: "Pass deleted" };
  });
}
