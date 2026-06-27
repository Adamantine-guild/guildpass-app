import { NextResponse } from "next/server";
import { handleApiError, apiError } from "@/lib/api-helpers";
import { type Member } from "@/lib/mock-data";
import { MOCK_API_SESSION } from "@/lib/auth/session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { IntegrationClient } from "@guildpass/integration-client";
import { getEnv, getApiMode } from "@/lib/env";
import { memberService } from "@/lib/data/member-service";

/**
 * GET /api/members
 * Accessible to all authenticated roles (members:read).
 */
export async function GET(request: Request): Promise<NextResponse> {
  return handleApiError(async () => {
    const apiMode = getApiMode();
    const url = new URL(request.url);
    const wallet = url.searchParams.get("wallet");
    const discordUserId = url.searchParams.get("discordUserId");

    if (apiMode === "live") {
      const env = getEnv();
      const testClient = (globalThis as any).__TEST_INTEGRATION_CLIENT;
      const client =
        testClient ??
        new IntegrationClient({
          baseUrl: env.GUILD_PASS_CORE_URL as string,
          apiKey: env.GUILD_PASS_CORE_API_KEY,
        });

      try {
        if (wallet) {
          const m = await client.getMembershipByWallet(wallet);
          if (!m) return [];
          const mapped: Member = {
            id: m.userId,
            wallet: m.wallet ?? "",
            name: m.userId,
            status: m.status === "unknown" ? "pending" : m.status,
            roles: m.roles ?? [],
            joinedAt: m.updatedAt,
            lastActive: m.updatedAt,
          };
          return [mapped];
        }

        if (discordUserId) {
          const m = await client.getMembershipByDiscordUser(discordUserId);
          if (!m) return [];
          const mapped: Member = {
            id: m.userId,
            wallet: m.wallet ?? "",
            name: m.userId,
            status: m.status === "unknown" ? "pending" : m.status,
            roles: m.roles ?? [],
            joinedAt: m.updatedAt,
            lastActive: m.updatedAt,
          };
          return [mapped];
        }

        return apiError("Live mode requires a lookup (wallet or discordUserId)", 501);
      } catch (err) {
        console.error("Error fetching membership in live mode:", err);
        return apiError("Failed to retrieve membership from core", 502);
      }
    }

    // Mock mode
    if (wallet) {
      const member = await memberService.getMemberByWallet(wallet);
      return member ? [member] : [];
    }

    return await memberService.getAllMembers();
  });
}

/**
 * POST /api/members
 * Requires members:write permission.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertPermission(MOCK_API_SESSION, "members:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    throw err;
  }

  return handleApiError(async () => {
    const body = await request.json();

    if (!body.wallet) {
      return apiError("Wallet address is required", 400);
    }

    return await memberService.createMember(body);
  });
}

/**
 * DELETE /api/members
 * Requires members:write permission.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    assertPermission(MOCK_API_SESSION, "members:write");
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return apiError(err.message, 403);
    }
    throw err;
  }

  return handleApiError(async () => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return apiError("Member ID is required", 400);
    }

    const deleted = await memberService.deleteMember(id);
    if (!deleted) {
      return apiError("Member not found", 404);
    }

    return { message: "Member removed" };
  });
}
