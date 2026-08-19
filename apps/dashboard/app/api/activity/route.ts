import type { NextResponse } from "next/server";
import { apiError, apiResponse, apiValidationError } from "@/lib/api-helpers";
import { filterActivityEvents, parseActivityQuery } from "@/lib/activity/query";
import { activityStorage } from "@/lib/activity/storage";
import { requireSessionAndPermission } from "@/lib/auth/require-permission";
import { getActivityRepository } from "@/lib/repositories/factory";
import { getActiveGuildId } from "@/lib/guild-context";
import { filterActivityEventsByGuild } from "@/lib/data/guild-scoped";
import { mockActivity, type Activity } from "@/lib/mock-data";
import {
  CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  type ActivityEvent,
} from "@guildpass/integration-client";

const TYPE_MAP: Record<Activity["type"], ActivityEvent["type"]> = {
  member_joined: "member.joined",
  pass_created: "pass.created",
  pass_purchased: "pass.purchased",
  role_changed: "member.roles_changed",
  access_granted: "access.granted",
};

function mockActivityToEvent(activity: Activity): ActivityEvent {
  return {
    id: `mock_${activity.id}`,
    type: TYPE_MAP[activity.type],
    source: "dashboard",
    severity: "info",
    actor: { name: activity.actor },
    timestamp: activity.timestamp,
    description: activity.description,
    changes: activity.changes,
    metadata: { guildId: activity.guildId },
    schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionAndPermission(request, getActiveGuildId(request), "activity:read");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = parseActivityQuery(url.searchParams);

  if (!parsed.ok) {
    return apiValidationError("Invalid activity query", parsed.errors);
  }

  const guildId = getActiveGuildId(request);

  try {
    // Repository-sourced events are already guild-scoped at the choke point
    // (IActivityRepository.query requires guildId). Storage-sourced (webhook)
    // and seed events aren't tagged at write time yet, so they still rely on
    // the best-effort metadata.guildId filter — see docs/multi-tenancy.md.
    const repositoryEvents = await getActivityRepository()
      .query(guildId, {})
      .catch((error) => {
        console.error("Error fetching repository activity:", error);
        return [];
      });
    const storageEvents = await activityStorage.getEvents();
    const seedEvents = mockActivity.map(mockActivityToEvent);
    const scopedStorageAndSeed = filterActivityEventsByGuild([...storageEvents, ...seedEvents], guildId);

    const seen = new Set<string>();
    const merged = [...repositoryEvents, ...scopedStorageAndSeed].filter((event) => {
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
