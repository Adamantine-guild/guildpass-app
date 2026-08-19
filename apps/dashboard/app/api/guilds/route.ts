import type { NextResponse } from "next/server";
import {
  apiError,
  apiUnsupported,
  apiValidationError,
  handleApiError,
} from "@/lib/api-helpers";
import type { ApiFieldError } from "@/lib/api-contracts";
import { mockGuilds, type Guild } from "@/lib/mock-data";
import { requireDashboardSession, UnauthorizedError } from "@/lib/auth/server-session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { getApiMode } from "@/lib/env";
import { getGuildRepository } from "@/lib/repositories/factory";
import { recordDashboardActivity } from "@/lib/activity/dashboard";

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

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = requireDashboardSession(request);
    assertPermission(session, "guilds:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    if (err instanceof UnauthorizedError) {
      return apiError(err.message, 401);
    }
    throw err;
  }

  return handleApiError(async () => {
    const body = await request.json();
    const errors = validateGuildCreate(body);
    if (errors.length > 0) {
      return apiValidationError("Invalid guild payload", errors);
    }

    const guildRepository = getGuildRepository();
    const created = await guildRepository.create({
      name: body.name.trim(),
      description: body.description.trim(),
      memberCount: body.memberCount ?? 0,
      passCount: body.passCount ?? 0,
    });
    await recordDashboardActivity({
      type: "guild.created",
      entity: { type: "guild", id: created.id, name: created.name },
      actor: { id: session!.userId, name: session!.name },
    });
    return created;
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = requireDashboardSession(request);
    assertPermission(session, "guilds:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    if (err instanceof UnauthorizedError) {
      return apiError(err.message, 401);
    }
    throw err;
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing guild ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }

  return handleApiError(async () => {
    const body = await request.json();
    const guildRepository = getGuildRepository();
    const updated = await guildRepository.update(id, body);
    if (!updated) throw new Error("Guild not found or update failed");
    await recordDashboardActivity({
      type: "guild.updated",
      entity: { type: "guild", id: updated.id, name: updated.name },
      actor: { id: session!.userId, name: session!.name },
    });
    return updated;
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = requireDashboardSession(request);
    assertPermission(session, "guilds:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    if (err instanceof UnauthorizedError) {
      return apiError(err.message, 401);
    }
    throw err;
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing guild ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }

  return handleApiError(async () => {
    const guildRepository = getGuildRepository();
    const guild = await guildRepository.getById(id);
    if (!guild) throw new Error("Guild not found or deletion failed");
    const success = await guildRepository.delete(id);
    if (!success) throw new Error("Guild not found or deletion failed");
    await recordDashboardActivity({
      type: "guild.deleted",
      entity: { type: "guild", id: guild.id, name: guild.name },
      actor: { id: session!.userId, name: session!.name },
    });
    return { success: true };
  });
}

function validateGuildCreate(body: any): ApiFieldError[] {
  const errors: ApiFieldError[] = [];

  if (typeof body?.name !== "string" || body.name.trim().length === 0) {
    errors.push({ field: "name", message: "name is required" });
  }

  if (
    typeof body?.description !== "string" ||
    body.description.trim().length === 0
  ) {
    errors.push({ field: "description", message: "description is required" });
  }

  if (body?.memberCount !== undefined && !Number.isInteger(body.memberCount)) {
    errors.push({ field: "memberCount", message: "memberCount must be an integer" });
  }

  if (body?.passCount !== undefined && !Number.isInteger(body.passCount)) {
    errors.push({ field: "passCount", message: "passCount must be an integer" });
  }

  return errors;
}
