import { NextResponse } from "next/server";
import {
  apiError,
  apiUnsupported,
  apiValidationError,
  handleApiError,
} from "@/lib/api-helpers";
import { NotFoundError } from "@/lib/api-errors";
import { mockPasses, type Pass } from "@/lib/mock-data";
import { getActiveGuildId } from "@/lib/guild-context";
import { requireSessionAndPermission } from "@/lib/auth/require-permission";
import { getApiMode } from "@/lib/env";
import { getPassRepository } from "@/lib/repositories/factory";
import type { PassListQuery } from "@/lib/repositories/types";
import { filterPasses, paginateItems, parseListLimit, parseListPage } from "@/lib/pagination";
import {
  malformedPayloadError,
  validatePassCreatePayload,
  validatePassUpdatePayload,
} from "@/lib/validation/mutations";
import { recordDashboardActivity } from "@/lib/activity/dashboard";

const PASS_STATUSES: Pass["status"][] = ["active", "inactive", "draft"];

export async function GET(
  request: Request
): Promise<NextResponse> {
  return handleApiError(async () => {
    const apiMode = getApiMode();
    const query = parsePassListQuery(request);

    if (apiMode === "live") {
      return apiUnsupported(
        "passes.list",
        apiMode,
        "Pass listing in live mode is not implemented"
      );
    }

    try {
      const passRepository = getPassRepository();
      return await passRepository.query(getActiveGuildId(), query);
    } catch (error) {
      console.error("Error fetching passes:", error);
      return getFallbackPasses(query);
    }
  });
}

function parsePassListQuery(request: Request): PassListQuery {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  return {
    search: searchParams.get("search") ?? undefined,
    status: isPassStatus(status) ? status : "all",
    limit: parseListLimit(searchParams.get("limit")),
    page: parseListPage(searchParams.get("page")),
    cursor: searchParams.get("cursor"),
  };
}

function isPassStatus(value: string | null): value is Pass["status"] {
  return value !== null && PASS_STATUSES.includes(value as Pass["status"]);
}

function getFallbackPasses(query: PassListQuery) {
  const guildId = getActiveGuildId();
  const scoped = mockPasses.filter((pass) => pass.guildId === guildId);
  const filtered = filterPasses(scoped, query);
  return paginateItems(filtered, query);
}

export async function POST(request: Request): Promise<NextResponse> {
  const guildId = getActiveGuildId();
  const guard = await requireSessionAndPermission(request, guildId, "passes:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

  return handleApiError(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiValidationError("Invalid pass payload", malformedPayloadError());
    }

    const validation = validatePassCreatePayload(body);
    if (!validation.valid) {
      return apiValidationError("Invalid pass payload", validation.errors);
    }

    const passRepository = getPassRepository();
    const created = await passRepository.create(guildId, validation.data);
    await recordDashboardActivity({
      type: "pass.created",
      entity: { type: "pass", id: created.id, name: created.name },
      actor: { id: session.userId, name: session.name },
    });
    return created;
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing pass ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }

  let session;
  try {
    const { requireDashboardSession } = await import("@/lib/auth/server-session");
    session = await requireDashboardSession(request);
  } catch (err) {
    const { UnauthorizedError } = await import("@/lib/auth/server-session");
    if (err instanceof UnauthorizedError) {
      return apiError(err.message, 401);
    }
    throw err;
  }

  const passRepository = getPassRepository();
  const pass = await passRepository.getById(getActiveGuildId(), id);
  if (!pass) {
    return apiError("Pass not found", 404);
  }

  const { guardPermission } = await import("@/lib/auth/require-permission");
  const guard = guardPermission(session, pass.guildId, "passes:write");
  if (!guard.ok) return guard.response;

  return handleApiError(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiValidationError("Invalid pass payload", malformedPayloadError());
    }

    const validation = validatePassUpdatePayload(body);
    if (!validation.valid) {
      return apiValidationError("Invalid pass payload", validation.errors);
    }

    const updated = await passRepository.update(pass.guildId, id, validation.data);
    if (!updated) throw new NotFoundError("Pass not found.");
    await recordDashboardActivity({
      type: "pass.updated",
      entity: { type: "pass", id: updated.id, name: updated.name },
      actor: { id: session.userId, name: session.name },
    });
    return updated;
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing pass ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }

  let session;
  try {
    const { requireDashboardSession } = await import("@/lib/auth/server-session");
    session = await requireDashboardSession(request);
  } catch (err) {
    const { UnauthorizedError } = await import("@/lib/auth/server-session");
    if (err instanceof UnauthorizedError) {
      return apiError(err.message, 401);
    }
    throw err;
  }

  const passRepository = getPassRepository();
  const pass = await passRepository.getById(getActiveGuildId(), id);
  if (!pass) {
    return apiError("Pass not found", 404);
  }

  const { guardPermission } = await import("@/lib/auth/require-permission");
  const guard = guardPermission(session, pass.guildId, "passes:write");
  if (!guard.ok) return guard.response;

  return handleApiError(async () => {
    const success = await passRepository.delete(pass.guildId, id);
    if (!success) throw new NotFoundError("Pass not found.");
    await recordDashboardActivity({
      type: "pass.deleted",
      entity: { type: "pass", id: pass.id, name: pass.name },
      actor: { id: session.userId, name: session.name },
    });
    return { success: true };
  });
}
