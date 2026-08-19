import type { NextResponse } from "next/server";
import { apiError, apiResponse, apiValidationError } from "@/lib/api-helpers";
import { filterActivityEvents, parseActivityQuery } from "@/lib/activity/query";
import { activityStorage } from "@/lib/activity/storage";
import {
  requireDashboardSession,
  UnauthorizedError,
} from "@/lib/auth/server-session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { getActivityRepository } from "@/lib/repositories/factory";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const session = requireDashboardSession(request);
    assertPermission(session, "activity:read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return apiError(error.message, 403);
    }
    if (error instanceof UnauthorizedError) {
      return apiError(error.message, 401);
    }
    throw error;
  }

  const url = new URL(request.url);
  const parsed = parseActivityQuery(url.searchParams);

  if (!parsed.ok) {
    return apiValidationError("Invalid activity query", parsed.errors);
  }

  try {
    const repositoryEvents = await getActivityRepository()
      .query({})
      .catch((error) => {
        console.error("Error fetching repository activity:", error);
        return [];
      });
    const storageEvents = await activityStorage.getEvents();
    const seen = new Set<string>();
    const merged = [...repositoryEvents, ...storageEvents].filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });

    const result = filterActivityEvents(merged, parsed.value);
    return apiResponse(result);
  } catch (error) {
    console.error("Error fetching activity:", error);
    return apiError("Failed to fetch activity", 500);
  }
}
