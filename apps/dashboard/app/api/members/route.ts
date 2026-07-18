import { NextResponse } from "next/server";
import {
  apiError,
  apiResponse,
  apiUnsupported,
  apiValidationError,
  handleApiError,
} from "@/lib/api-helpers";
import { NotFoundError } from "@/lib/api-errors";
import { mockMembers, type Member } from "@/lib/mock-data";
import { getActiveGuildId } from "@/lib/guild-context";
import { requireSessionAndPermission } from "@/lib/auth/require-permission";
import { IntegrationClient } from "@guildpass/integration-client";
import { getEnv, getApiMode } from "@/lib/env";
import { getMemberRepository } from "@/lib/repositories/factory";
import { filterMembers, paginateItems, parseListLimit, parseListPage } from "@/lib/pagination";
import type { MemberListQuery } from "@/lib/repositories/types";
import {
  malformedPayloadError,
  validateMemberCreatePayload,
  validateMemberUpdatePayload,
} from "@/lib/validation/mutations";
import { recordDashboardActivity } from "@/lib/activity/dashboard";
import { isMemberRole } from "@/lib/member-roles";

export async function GET(request: Request): Promise<NextResponse> {
  return handleApiError(async () => {
    const apiMode = getApiMode();

    const url = new URL(request.url);
    const wallet = url.searchParams.get("wallet");
    const discordUserId = url.searchParams.get("discordUserId");
    const query = parseMemberListQuery(request);

    if (apiMode === "live") {
      const testClient = (globalThis as any).__TEST_INTEGRATION_CLIENT;
      const env = testClient ? null : getEnv();
      const client =
        testClient ??
        new IntegrationClient({
          baseUrl: env!.GUILD_PASS_CORE_URL as string,
          apiKey: env!.GUILD_PASS_CORE_API_KEY,
        });

      try {
        if (wallet) {
          const m = await client.getMembershipByWallet(wallet);
          if (!m) return apiResponse([], { status: 200 });
          const mapped: Member = {
            id: m.userId,
            guildId: getActiveGuildId(),
            wallet: m.wallet ?? "",
            name: m.userId,
            status: m.status === "unknown" ? "pending" : m.status,
            roles: m.roles ?? [],
            joinedAt: m.updatedAt,
            lastActive: m.updatedAt,
          };
          return apiResponse([mapped]);
        }

        if (discordUserId) {
          const m = await client.getMembershipByDiscordUser(discordUserId);
          if (!m) return apiResponse([], { status: 200 });
          const mapped: Member = {
            id: m.userId,
            guildId: getActiveGuildId(),
            wallet: m.wallet ?? "",
            name: m.userId,
            status: m.status === "unknown" ? "pending" : m.status,
            roles: m.roles ?? [],
            joinedAt: m.updatedAt,
            lastActive: m.updatedAt,
          };
          return apiResponse([mapped]);
        }

        return apiUnsupported(
          "members.list",
          apiMode,
          "Live mode requires a lookup (wallet or discordUserId)"
        );
      } catch (err) {
        console.error("Error fetching membership in live mode:", err);
        return apiError("Failed to retrieve membership from core", 502);
      }
    }

    try {
      const memberRepository = getMemberRepository();
      return apiResponse(await memberRepository.query(getActiveGuildId(), query));
    } catch (error) {
      console.error("Error fetching members:", error);
      return apiResponse(getFallbackMembers(query));
    }
  });
}

const MEMBER_STATUSES: Member["status"][] = ["active", "inactive", "pending"];

function parseMemberListQuery(request: Request): MemberListQuery {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const role = searchParams.get("role");

  return {
    search: searchParams.get("search") ?? undefined,
    status: isMemberStatus(status) ? status : "all",
    role: role && isMemberRole(role) ? role : "all",
    limit: parseListLimit(searchParams.get("limit")),
    page: parseListPage(searchParams.get("page")),
    cursor: searchParams.get("cursor"),
  };
}

function isMemberStatus(value: string | null): value is Member["status"] {
  return value !== null && MEMBER_STATUSES.includes(value as Member["status"]);
}

function getFallbackMembers(query: MemberListQuery) {
  const guildId = getActiveGuildId();
  const scoped = mockMembers.filter((member) => member.guildId === guildId);
  const filtered = filterMembers(scoped, query);
  return paginateItems(filtered, query);
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = requireSessionAndPermission(request, "members:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

  return handleApiError(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiValidationError("Invalid member payload", malformedPayloadError());
    }

    const validation = validateMemberCreatePayload(body);
    if (!validation.valid) {
      return apiValidationError("Invalid member payload", validation.errors);
    }

    const memberRepository = getMemberRepository();
    const created = await memberRepository.create(getActiveGuildId(), validation.data);
    await recordDashboardActivity({
      type: "member.joined",
      entity: { type: "member", id: created.id, name: created.name },
      actor: { id: session.userId, name: session.name },
    });
    return created;
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = requireSessionAndPermission(request, "members:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing member ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }

  return handleApiError(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiValidationError("Invalid member payload", malformedPayloadError());
    }

    const validation = validateMemberUpdatePayload(body);
    if (!validation.valid) {
      return apiValidationError("Invalid member payload", validation.errors);
    }

    const memberRepository = getMemberRepository();
    const guildId = getActiveGuildId();
    const existing = validation.data.roles ? await memberRepository.getById(guildId, id) : null;
    const updated = await memberRepository.update(guildId, id, validation.data);
    if (!updated) throw new NotFoundError("Member not found.");
    const rolesChanged = existing && validation.data.roles && JSON.stringify(existing.roles) !== JSON.stringify(validation.data.roles);
    if (rolesChanged) {
      await recordDashboardActivity({
        type: "member.roles_changed",
        entity: { type: "member", id: updated.id, name: updated.name },
        actor: { id: session.userId, name: session.name },
      });
    }
    return updated;
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const guard = requireSessionAndPermission(request, "members:write");
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return apiValidationError("Missing member ID", [
      { field: "id", message: "id query parameter is required" },
    ]);
  }

  return handleApiError(async () => {
    const memberRepository = getMemberRepository();
    const guildId = getActiveGuildId();
    const member = await memberRepository.getById(guildId, id);
    if (!member) throw new NotFoundError("Member not found.");
    const success = await memberRepository.delete(guildId, id);
    if (!success) throw new NotFoundError("Member not found.");
    await recordDashboardActivity({
      type: "member.left",
      entity: { type: "member", id: member.id, name: member.name },
      actor: { id: session.userId, name: session.name },
    });
    return { success: true };
  });
}
