import { NextResponse } from "next/server";
import { apiError, handleApiError } from "@/lib/api-helpers";
import { parseActivityQuery } from "@/lib/activity/query";
import { activityService } from "@/lib/data/activity-service";

export async function GET(request: Request): Promise<NextResponse> {
  const parsed = parseActivityQuery(new URL(request.url).searchParams);
  if ("error" in parsed) return apiError(parsed.error, 400);

  return handleApiError(async () => {
    return activityService.getEvents(parsed.query);
  });
}
