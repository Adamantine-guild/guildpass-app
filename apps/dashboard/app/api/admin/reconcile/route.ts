/**
 * POST /api/admin/reconcile
 *
 * Admin-gated endpoint for triggering guild count reconciliation.
 *
 * Permissions: Requires "guilds:write" (admin/owner roles).
 *
 * Request body:
 *   { "mode": "report" | "fix" }
 *
 * Response (200):
 *   The full ReconciliationReport (see lib/reconciliation/types.ts).
 *
 * Response (400):
 *   Invalid or missing mode parameter.
 *
 * Response (403):
 *   Caller lacks guilds:write permission.
 */

import { NextResponse } from "next/server";
import { apiError, apiResponse, apiValidationError, handleApiError } from "@/lib/api-helpers";
import { requireDashboardSession, UnauthorizedError } from "@/lib/auth/server-session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { reconcileGuildCounts } from "@/lib/reconciliation/index";
import type { ReconcileOptions } from "@/lib/reconciliation/types";
import { getMemberRepository, getPassRepository } from "@/lib/repositories/factory";
import type { ApiFieldError } from "@/lib/api-contracts";

// ── Counting strategies ───────────────────────────────────────────────────────
//
// Same defaults as the CLI script. In production, these should use direct SQL
// queries for performance. The repository layer is guild-scoped, so each count
// only ever sees the requested guild's records.

async function countMembersForGuild(guildId: string): Promise<number> {
  const memberRepo = getMemberRepository();
  const all = await memberRepo.getAll(guildId);
  return all.length;
}

async function countPassesForGuild(guildId: string): Promise<number> {
  const passRepo = getPassRepository();
  const all = await passRepo.getAll(guildId);
  return all.length;
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  // ── Auth guard ────────────────────────────────────────────────────────────
  try {
    const session = requireDashboardSession(request);
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
    // ── Parse & validate body ───────────────────────────────────────────────
    const body = await request.json();
    const errors = validateReconcileBody(body);
    if (errors.length > 0) {
      return apiValidationError("Invalid reconciliation request", errors);
    }

    const mode: "report" | "fix" = body.mode;

    const options: ReconcileOptions = {
      mode,
      countMembers: countMembersForGuild,
      countPasses: countPassesForGuild,
    };

    const report = await reconcileGuildCounts(options);

    // Return 200 with the full report — the client can inspect discrepancies
    // and decide what to display.
    return apiResponse(report);
  });
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateReconcileBody(
  body: unknown,
): ApiFieldError[] {
  const errors: ApiFieldError[] = [];

  if (!body || typeof body !== "object") {
    return [{ field: "body", message: "Request body must be a JSON object" }];
  }

  const { mode } = body as Record<string, unknown>;

  if (mode !== "report" && mode !== "fix") {
    errors.push({
      field: "mode",
      message: 'mode must be either "report" or "fix"',
    });
  }

  return errors;
}
