import { NextResponse } from "next/server";
import { handleApiError, apiError } from "@/lib/api-helpers";
import { MOCK_API_SESSION } from "@/lib/auth/session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { settingsService } from "@/lib/data/settings-service";

/**
 * GET /api/settings
 * Requires settings:read permission.
 */
export async function GET(): Promise<NextResponse> {
  try {
    assertPermission(MOCK_API_SESSION, "settings:read");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    throw err;
  }

  return handleApiError(async () => {
    return await settingsService.getSettings();
  });
}

/**
 * PATCH /api/settings
 * Requires settings:write permission.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    assertPermission(MOCK_API_SESSION, "settings:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    throw err;
  }

  return handleApiError(async () => {
    const body = await request.json();

    if (!body.workspaceName) {
      return apiError("Workspace name is required", 400);
    }

    return await settingsService.updateSettings(body);
  });
}
