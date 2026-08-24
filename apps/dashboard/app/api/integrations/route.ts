import type { NextResponse } from "next/server";
import { apiResponse, handleApiError } from "@/lib/api-helpers";
import { getIntegrationsList } from "@/lib/integrations";

export async function GET(): Promise<NextResponse> {
  return handleApiError(async () => {
    return apiResponse(await getIntegrationsList());
  });
}
