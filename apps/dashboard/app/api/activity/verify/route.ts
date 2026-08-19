/**
 * GET /api/activity/verify
 *
 * Recomputes the durable PostgreSQL activity hash chain without modifying it.
 * Requires guilds:write, which is limited to owner/admin roles.
 */

import { apiResponse, apiUnsupported, handleApiError } from "@/lib/api-helpers";
import { verifyDurableActivityChain } from "@/lib/activity/hash-chain";
import { requireSessionAndPermission } from "@/lib/auth/require-permission";
import { getActiveGuildId } from "@/lib/guild-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guildId = getActiveGuildId(request);
  const guard = await requireSessionAndPermission(
    request,
    guildId,
    "guilds:write",
  );
  if (!guard.ok) return guard.response;

  const dashboardMode = (
    process.env.DASHBOARD_STORAGE_MODE ?? "mock"
  ).toLowerCase();
  const activityMode = (
    process.env.ACTIVITY_STORAGE_MODE ?? "memory"
  ).toLowerCase();
  if (dashboardMode !== "durable" && activityMode !== "durable") {
    return apiUnsupported(
      "activity hash-chain verification",
      `dashboard=${dashboardMode},activity=${activityMode}`,
      "Hash-chain verification is available only for PostgreSQL-backed durable activity entries.",
    );
  }

  return handleApiError(async () => {
    const result = await verifyDurableActivityChain();
    return apiResponse(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }, "/api/activity/verify");
}
