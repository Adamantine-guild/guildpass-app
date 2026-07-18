import { NextResponse } from "next/server";
import {
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
  const guard = requireSessionAndPermission(request, "passes:write");
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
    const created = await passRepository.create(getActiveGuildId(), validation.data);
    await recordDashboardActivity({
      type: "pass.created",
      entity: { type: "pass", id: created.id, name: created.name },
      actor: { id: session.userId, name: session.name },
    });
    return created;
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = requireSessionAndPermission(request, "passes:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing pass ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }

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

    const passRepository = getPassRepository();
    const updated = await passRepository.update(getActiveGuildId(), id, validation.data);
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
  const guard = requireSessionAndPermission(request, "passes:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing pass ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }

  return handleApiError(async () => {
    const passRepository = getPassRepository();
    const guildId = getActiveGuildId();
    const pass = await passRepository.getById(guildId, id);
    if (!pass) throw new NotFoundError("Pass not found.");
    const success = await passRepository.delete(guildId, id);
    if (!success) throw new NotFoundError("Pass not found.");
    await recordDashboardActivity({
      type: "pass.deleted",
      entity: { type: "pass", id: pass.id, name: pass.name },
      actor: { id: session.userId, name: session.name },
    });
    return { success: true };
  });
}
