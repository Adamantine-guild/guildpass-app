import type { NextResponse } from "next/server";
import { apiError, apiValidationError, handleApiError } from "@/lib/api-helpers";
import { MOCK_API_SESSION } from "@/lib/auth/session";
import { requireDashboardSession, UnauthorizedError } from "@/lib/auth/server-session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { getSettingsRepository } from "@/lib/repositories/factory";
import { validateSettingsPatch } from "@/lib/validation/settings";
import { recordDashboardActivity } from "@/lib/activity/dashboard";

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
    return await getSettingsRepository().get();
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = requireDashboardSession(request);
    assertPermission(session, "settings:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    if (err instanceof UnauthorizedError) {
      return apiError(err.message, 401);
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError("Request body must be valid JSON.", [
      { field: "_root", message: "Request body must be valid JSON." },
    ]);
  }

  const validation = validateSettingsPatch(body);
  if (!validation.ok) {
    return apiValidationError("Invalid settings", validation.errors);
  }

  return handleApiError(async () => {
    const updated = await getSettingsRepository().update(validation.value);
    await recordDashboardActivity({
      type: "settings.updated",
      actor: { id: session!.userId, name: session!.name },
      description: "Dashboard settings updated",
    });
    return updated;
  });
}
