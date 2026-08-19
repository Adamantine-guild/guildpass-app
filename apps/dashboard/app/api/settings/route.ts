import type { NextResponse } from "next/server";
import { apiValidationError, handleApiError } from "@/lib/api-helpers";
import { requireSessionAndPermission } from "@/lib/auth/require-permission";
import { getSettingsRepository } from "@/lib/repositories/factory";
import { validateSettingsPatch } from "@/lib/validation/settings";
import { recordDashboardActivity } from "@/lib/activity/dashboard";
import { getActiveGuildId } from "@/lib/guild-context";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionAndPermission(request, getActiveGuildId(request), "settings:read");
  if (!guard.ok) return guard.response;

  return handleApiError(async () => {
    return await getSettingsRepository().get();
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const guildId = getActiveGuildId(request);
  const guard = await requireSessionAndPermission(request, guildId, "settings:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

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
    await recordDashboardActivity(guildId, {
      type: "settings.updated",
      actor: { id: session.userId, name: session.name },
      description: "Dashboard settings updated",
    });
    return updated;
  });
}
