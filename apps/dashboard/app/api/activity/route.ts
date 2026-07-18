import { NextResponse } from "next/server";
import { apiError, apiResponse, apiValidationError } from "@/lib/api-helpers";
import { filterActivityEvents, parseActivityQuery } from "@/lib/activity/query";
import { activityStorage } from "@/lib/activity/storage";
import { requireSessionAndPermission } from "@/lib/auth/require-permission";
import { getActivityRepository } from "@/lib/repositories/factory";

import { getActiveGuildId } from "@/lib/guild-context";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionAndPermission(request, getActiveGuildId(), "activity:read");
  if (!guard.ok) return guard.response;

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
