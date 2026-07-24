/**
 * POST /api/integrations/reconcile
 *
 * Admin-gated manual trigger for core-state reconciliation (issue #262):
 * pulls an authoritative snapshot from GuildPass core, diffs it against
 * local state, and reports (dry-run) or applies (apply) corrections.
 *
 * Permissions: Requires "settings:write" (admin/owner roles).
 *
 * Request body:
 *   { "mode": "dry-run" | "apply" }
 *
 * Response (200):
 *   The CoreSyncReport (see lib/reconciliation/core-sync-types.ts). When the
 *   deployment has no core configured (pure mock mode) or core does not
 *   implement the snapshot endpoint, the report has `supported: false` with
 *   a human-readable reason — this is not an error.
 *
 * Response (400): Invalid or missing mode.
 * Response (401): No dashboard session.
 * Response (403): Caller lacks settings:write.
 */

import { NextResponse } from "next/server";
import { IntegrationClient } from "@guildpass/integration-client";
import { apiError, apiResponse, apiValidationError, handleApiError } from "@/lib/api-helpers";
import { requireDashboardSession, UnauthorizedError } from "@/lib/auth/server-session";
import { assertPermission, PermissionDeniedError } from "@/lib/permissions";
import { getActiveGuildId } from "@/lib/guild-context";
import { getEnv } from "@/lib/env";
import { reconcileGuildWithCore } from "@/lib/reconciliation/core-sync";
import type { CoreSyncMode, SnapshotClient } from "@/lib/reconciliation/core-sync-types";
import type { ApiFieldError } from "@/lib/api-contracts";

export async function POST(request: Request): Promise<NextResponse> {
  // ── Auth guard ──────────────────────────────────────────────────────────
  try {
    const session = await requireDashboardSession(request);
    assertPermission(session, getActiveGuildId(request), "settings:write");
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
    // ── Parse & validate body ─────────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiValidationError("Invalid reconciliation request", [
        { field: "body", message: "Request body must be a JSON object" },
      ]);
    }

    const errors = validateBody(body);
    if (errors.length > 0) {
      return apiValidationError("Invalid reconciliation request", errors);
    }

    const { mode } = body as { mode: CoreSyncMode };
    const guildId = getActiveGuildId(request);

    const client = resolveSnapshotClient();
    if (!client) {
      return apiResponse({
        guildId,
        mode,
        supported: false,
        reason:
          "No GuildPass core is configured for this deployment " +
          "(GUILD_PASS_CORE_URL is unset). Reconciliation needs a core " +
          "that serves GET /v1/guilds/:guildId/snapshot.",
        changes: [],
        totals: { added: 0, updated: 0, deactivated: 0, unchanged: 0 },
        applied: 0,
        summary: "Reconciliation unavailable: no core configured.",
      });
    }

    const report = await reconcileGuildWithCore({ guildId, mode, client });
    return apiResponse(report);
  });
}

/**
 * Pick the snapshot source: test injection first, then a real core client
 * when a core URL is configured. Returns null in pure mock mode.
 */
function resolveSnapshotClient(): SnapshotClient | null {
  const testClient = (globalThis as Record<string, unknown>).__TEST_INTEGRATION_CLIENT;
  if (testClient) return testClient as SnapshotClient;

  const env = getEnv();
  if (!env.GUILD_PASS_CORE_URL) return null;

  return new IntegrationClient({
    baseUrl: env.GUILD_PASS_CORE_URL,
    apiKey: env.GUILD_PASS_CORE_API_KEY,
  });
}

function validateBody(body: unknown): ApiFieldError[] {
  if (!body || typeof body !== "object") {
    return [{ field: "body", message: "Request body must be a JSON object" }];
  }
  const { mode } = body as Record<string, unknown>;
  if (mode !== "dry-run" && mode !== "apply") {
    return [{ field: "mode", message: 'mode must be either "dry-run" or "apply"' }];
  }
  return [];
}
