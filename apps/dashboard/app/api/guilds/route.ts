import type { NextResponse } from "next/server";
import {
  apiUnsupported,
  apiValidationError,
  handleApiError,
} from "@/lib/api-helpers";
import type { ApiFieldError } from "@/lib/api-contracts";
import { mockGuilds, type Guild } from "@/lib/mock-data";
import { requireSessionAndPermission } from "@/lib/auth/require-permission";
import { getApiMode } from "@/lib/env";
import { getGuildRepository } from "@/lib/repositories/factory";
import { recordDashboardActivity } from "@/lib/activity/dashboard";
import { getActiveGuildId } from "@/lib/guild-context";
import { guildSchema } from "@guildpass/integration-client";

export async function GET(): Promise<NextResponse> {
  return handleApiError(async () => {
    const apiMode = getApiMode();

    if (apiMode === "live") {
      return apiUnsupported(
        "guilds.list",
        apiMode,
        "Guild listing in live mode is not implemented"
      );
    }

    try {
      const guildRepository = getGuildRepository();
      return await guildRepository.getAll();
    } catch (error) {
      console.error("Error fetching guilds:", error);
      return mockGuilds as Guild[];
    }
  });
}

/**
 * POST /api/guilds
 * Requires guilds:write permission (create a guild).
 *
 * ⚠️ In production, resolve the session from the request (JWT / cookie)
 *    instead of using MOCK_SESSION, then assertPermission against it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionAndPermission(request, getActiveGuildId(request), "guilds:write");
  if (!guard.ok) return guard.response;

  const { session } = guard;

  return handleApiError(async () => {
    const body = await request.json();

    // Parse the payload using the imported schema validator
    const result = guildSchema.safeParse(body);

    if (!result.success) {
      const errors: ApiFieldError[] = result.error.issues.map((issue) => ({
        field: issue.path[0] ? String(issue.path[0]) : "body",
        message: issue.message,
      }));
      return apiValidationError("Invalid guild payload", errors);
    }

    const validData = result.data;
    const guildRepository = getGuildRepository();

    const created = await guildRepository.create({
      name: validData.name,
      description: validData.description,
      memberCount: validData.memberCount,
      passCount: validData.passCount,
    });

    await recordDashboardActivity(created.id, {
      type: "guild.created",
      entity: { type: "guild", id: created.id, name: created.name },
      actor: { id: session.userId, name: session.name },
    });

    return created;
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing guild ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }
  const guard = await requireSessionAndPermission(request, id, "guilds:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

  return handleApiError(async () => {
    const body = await request.json();
    const guildRepository = getGuildRepository();
    const updated = await guildRepository.update(id, body);
    if (!updated) throw new Error("Guild not found or update failed");
    await recordDashboardActivity(id, {
      type: "guild.updated",
      entity: { type: "guild", id: updated.id, name: updated.name },
      actor: { id: session.userId, name: session.name },
    });
    return updated;
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing guild ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }
  const guard = await requireSessionAndPermission(request, id, "guilds:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

  return handleApiError(async () => {
    const guildRepository = getGuildRepository();
    const guild = await guildRepository.getById(id);
    if (!guild) throw new Error("Guild not found or deletion failed");
    const success = await guildRepository.delete(id);
    if (!success) throw new Error("Guild not found or deletion failed");
    await recordDashboardActivity(id, {
      type: "guild.deleted",
      entity: { type: "guild", id: guild.id, name: guild.name },
      actor: { id: session.userId, name: session.name },
    });
    return { success: true };
  });
}

