import { NextResponse } from "next/server";
import { handleApiError, apiError } from "@/lib/api-helpers";
import { activityService } from "@/lib/data/activity-service";
import { ActivityEventType } from "@guildpass/integration-client";

/**
 * GET /api/activity
 * Fetches activity events via activityService.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return handleApiError(async () => {
    const { searchParams } = new URL(request.url);
    const limitStr = searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr) : undefined;

    if (limit !== undefined && isNaN(limit)) {
      return apiError("Invalid limit parameter", 400);
    }

    const type = searchParams.get("type") as ActivityEventType | null;

    return await activityService.getEvents({
      limit,
      type: type || undefined,
    });
  });
}
