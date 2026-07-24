/**
 * lib/reconciliation/core-sync.ts
 *
 * Core-state reconciliation ("backfill") for issue #262: detect and correct
 * drift between the dashboard's local state and GuildPass core's
 * authoritative state after webhook delivery gaps (downtime, deploys,
 * idempotency-store incidents).
 *
 * Contract with core (see docs/core-reconciliation.md):
 *  - The dashboard asks core for a point-in-time snapshot per guild via
 *    `IntegrationClient.getGuildSnapshot()` (GET /v1/guilds/:id/snapshot).
 *  - `members` in the snapshot is the COMPLETE membership list: a local
 *    member with a wallet absent from the snapshot is deactivated.
 *  - `passes` in the snapshot is the complete core-managed pass list.
 *    Local-only passes (dashboard drafts core has never seen) are left
 *    untouched, because core cannot distinguish them from deleted ones.
 *  - Core may not implement the endpoint yet (separate repo) — a 404 comes
 *    back as `null` and the job reports `supported: false` instead of failing.
 *
 * Matching rules:
 *  - Members match on wallet (case-insensitive). Snapshot members without a
 *    wallet are skipped: there is no safe join key.
 *  - Passes match on id first, then on exact name (local pass ids are
 *    repo-generated, so a pass created locally from a previous
 *    reconciliation run carries a different id than core's).
 *
 * Idempotency:
 *  - A run with no drift performs zero writes and zero activity entries.
 *  - Every applied change is recorded through the same idempotent write path
 *    webhooks use (`activityStorage.recordActivityEvent`) with a
 *    deterministic event id, so a retried run never double-records.
 */

import type {
  ActivityChange,
  ActivityEvent,
  GuildSnapshot,
  Membership,
} from "@guildpass/integration-client";
import {
  CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  CircuitOpenError,
  TimeoutError,
  UpstreamError,
} from "@guildpass/integration-client";
import type { Guild, Member, Pass } from "../mock-data";
import type {
  IGuildRepository,
  IMemberRepository,
  IPassRepository,
} from "../repositories/types";
import {
  getGuildRepository,
  getMemberRepository,
  getPassRepository,
} from "../repositories/factory";
import { activityStorage, type IActivityStorage } from "../activity/storage";
import { publishActivityEvent } from "../activity/stream";
import type {
  CoreSyncChange,
  CoreSyncDeps,
  CoreSyncMode,
  CoreSyncReport,
  SnapshotClient,
} from "./core-sync-types";

export type {
  CoreSyncChange,
  CoreSyncDeps,
  CoreSyncMode,
  CoreSyncReport,
  SnapshotClient,
};

/** Map core membership status to the dashboard's member vocabulary. */
function mapMemberStatus(status: Membership["status"]): Member["status"] {
  return status === "unknown" ? "pending" : status;
}

function sameRoles(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((role, i) => role === sortedB[i]);
}

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

/**
 * Run a reconciliation pass for one guild against core's authoritative state.
 *
 * @param options.guildId - Tenant scope. Every read/write stays inside it.
 * @param options.mode - "dry-run" reports drift without writing; "apply"
 *   writes corrections and records reconciliation-tagged activity.
 * @param options.client - Anything with `getGuildSnapshot` — the real
 *   IntegrationClient or a stub in tests / mock mode.
 */
export async function reconcileGuildWithCore(options: {
  guildId: string;
  mode: CoreSyncMode;
  client: SnapshotClient;
  deps?: CoreSyncDeps;
}): Promise<CoreSyncReport> {
  const { guildId, mode, client } = options;
  const memberRepo = options.deps?.memberRepo ?? getMemberRepository();
  const passRepo = options.deps?.passRepo ?? getPassRepository();
  const guildRepo = options.deps?.guildRepo ?? getGuildRepository();
  const sink = options.deps?.activitySink ?? activityStorage;
  const publish = options.deps?.publish ?? publishActivityEvent;
  const now = options.deps?.now ?? (() => new Date().toISOString());

  let snapshot: GuildSnapshot | null | undefined;

  try {
    snapshot = await client.getGuildSnapshot(guildId);
  } catch (err: unknown) {
    if (err instanceof CircuitOpenError) {
      return {
        guildId,
        mode,
        supported: false,
        reason:
          "GuildPass core is currently unreachable (circuit open). " +
          "The circuit will allow a probe request after the cooldown period. " +
          "Reconciliation is unavailable until the circuit closes.",
        changes: [],
        totals: { added: 0, updated: 0, deactivated: 0, unchanged: 0 },
        applied: 0,
        summary:
          "Reconciliation unavailable: circuit breaker is open (core is failing).",
      };
    }
    if (err instanceof TimeoutError) {
      return {
        guildId,
        mode,
        supported: false,
        reason:
          "GuildPass core timed out while fetching the guild snapshot. " +
          "The core may be slow or overloaded. Reconciliation will be retried on the next run.",
        changes: [],
        totals: { added: 0, updated: 0, deactivated: 0, unchanged: 0 },
        applied: 0,
        summary: "Reconciliation unavailable: core timed out.",
      };
    }
    if (err instanceof UpstreamError) {
      return {
        guildId,
        mode,
        supported: false,
        reason:
          `GuildPass core responded with status ${err.status} while fetching ` +
          "the guild snapshot. Reconciliation cannot proceed until core recovers.",
        changes: [],
        totals: { added: 0, updated: 0, deactivated: 0, unchanged: 0 },
        applied: 0,
        summary: `Reconciliation unavailable: core returned HTTP ${err.status}.`,
      };
    }
    // Re-throw unexpected errors
    throw err;
  }

  if (!snapshot) {
    return {
      guildId,
      mode,
      supported: false,
      reason:
        "GuildPass core does not expose a guild snapshot endpoint " +
        "(GET /v1/guilds/:guildId/snapshot returned 404). Reconciliation " +
        "requires core-side support; see docs/core-reconciliation.md.",
      changes: [],
      totals: { added: 0, updated: 0, deactivated: 0, unchanged: 0 },
      applied: 0,
      summary:
        "Reconciliation unavailable: core snapshot endpoint not supported.",
    };
  }

  const [localGuild, localMembers, localPasses] = await Promise.all([
    guildRepo.getById(guildId),
    memberRepo.getAll(guildId),
    passRepo.getAll(guildId),
  ]);

  const changes = diffSnapshot(
    guildId,
    snapshot,
    localGuild,
    localMembers,
    localPasses,
  );

  const totals = {
    added: changes.filter((c) => c.action === "add").length,
    updated: changes.filter((c) => c.action === "update").length,
    deactivated: changes.filter((c) => c.action === "deactivate").length,
    unchanged:
      snapshot.members.length +
      snapshot.passes.length -
      changes.filter((c) => c.entity !== "guild").length,
  };

  let applied = 0;
  if (mode === "apply") {
    for (const change of changes) {
      await applyChange(guildId, change, { memberRepo, passRepo, guildRepo });
      const recorded = await recordChange(
        guildId,
        change,
        snapshot,
        mode,
        sink,
        publish,
        now,
      );
      if (recorded) applied += 1;
    }
  }

  return {
    guildId,
    mode,
    supported: true,
    snapshotAt: snapshot.generatedAt,
    changes,
    totals,
    applied,
    summary: buildSummary(mode, guildId, totals, applied, changes.length),
  };
}

// ── Diff ──────────────────────────────────────────────────────────────────────

function diffSnapshot(
  guildId: string,
  snapshot: GuildSnapshot,
  localGuild: Guild | null,
  localMembers: Member[],
  localPasses: Pass[],
): CoreSyncChange[] {
  const changes: CoreSyncChange[] = [];

  // ── Members ─────────────────────────────────────────────────────────────
  const localByWallet = new Map<string, Member>();
  for (const m of localMembers) {
    if (m.wallet) localByWallet.set(normalizeWallet(m.wallet), m);
  }

  const snapshotWallets = new Set<string>();
  for (const sm of snapshot.members) {
    if (!sm.wallet) continue; // no safe join key — documented contract
    const key = normalizeWallet(sm.wallet);
    snapshotWallets.add(key);
    const local = localByWallet.get(key);

    if (!local) {
      changes.push({
        entity: "member",
        action: "add",
        id: key,
        summary: `Add member ${sm.userId} (${sm.wallet}) — present in core, missing locally`,
        changes: [
          {
            field: "status",
            before: undefined,
            after: mapMemberStatus(sm.status),
          },
          { field: "roles", before: undefined, after: sm.roles ?? [] },
        ],
        snapshotMember: sm,
      });
      continue;
    }

    const fieldChanges: ActivityChange[] = [];
    const coreStatus = mapMemberStatus(sm.status);
    if (local.status !== coreStatus) {
      fieldChanges.push({
        field: "status",
        before: local.status,
        after: coreStatus,
      });
    }
    if (!sameRoles(local.roles ?? [], sm.roles ?? [])) {
      fieldChanges.push({
        field: "roles",
        before: local.roles,
        after: sm.roles ?? [],
      });
    }
    if (fieldChanges.length > 0) {
      changes.push({
        entity: "member",
        action: "update",
        id: local.id,
        summary: `Update member ${local.name} — ${fieldChanges
          .map((c) => c.field)
          .join(", ")} drifted from core`,
        changes: fieldChanges,
        localMember: local,
        snapshotMember: sm,
      });
    }
  }

  // Local wallet-members absent from the snapshot are no longer members.
  for (const m of localMembers) {
    if (!m.wallet) continue;
    if (snapshotWallets.has(normalizeWallet(m.wallet))) continue;
    if (m.status === "inactive") continue; // already reflected
    changes.push({
      entity: "member",
      action: "deactivate",
      id: m.id,
      summary: `Deactivate member ${m.name} — absent from core snapshot`,
      changes: [{ field: "status", before: m.status, after: "inactive" }],
      localMember: m,
    });
  }

  // ── Passes ──────────────────────────────────────────────────────────────
  const localPassById = new Map(localPasses.map((p) => [p.id, p]));
  const localPassByName = new Map(localPasses.map((p) => [p.name, p]));

  for (const sp of snapshot.passes) {
    const local = localPassById.get(sp.id) ?? localPassByName.get(sp.name);

    if (!local) {
      changes.push({
        entity: "pass",
        action: "add",
        id: sp.id,
        summary: `Add pass "${sp.name}" — present in core, missing locally`,
        changes: [{ field: "status", before: undefined, after: sp.status }],
        snapshotPass: sp,
      });
      continue;
    }

    const fieldChanges: ActivityChange[] = [];
    if (local.name !== sp.name)
      fieldChanges.push({ field: "name", before: local.name, after: sp.name });
    if (local.status !== sp.status)
      fieldChanges.push({
        field: "status",
        before: local.status,
        after: sp.status,
      });
    if (local.price !== sp.price)
      fieldChanges.push({
        field: "price",
        before: local.price,
        after: sp.price,
      });
    if ((local.maxSupply ?? null) !== (sp.maxSupply ?? null)) {
      fieldChanges.push({
        field: "maxSupply",
        before: local.maxSupply ?? null,
        after: sp.maxSupply ?? null,
      });
    }
    if (
      sp.currentSupply !== undefined &&
      local.currentSupply !== sp.currentSupply
    ) {
      fieldChanges.push({
        field: "currentSupply",
        before: local.currentSupply,
        after: sp.currentSupply,
      });
    }
    if (fieldChanges.length > 0) {
      changes.push({
        entity: "pass",
        action: "update",
        id: local.id,
        summary: `Update pass "${local.name}" — ${fieldChanges
          .map((c) => c.field)
          .join(", ")} drifted from core`,
        changes: fieldChanges,
        localPass: local,
        snapshotPass: sp,
      });
    }
  }

  // ── Guild metadata ──────────────────────────────────────────────────────
  if (localGuild && snapshot.guild) {
    const fieldChanges: ActivityChange[] = [];
    if (
      snapshot.guild.name !== undefined &&
      localGuild.name !== snapshot.guild.name
    ) {
      fieldChanges.push({
        field: "name",
        before: localGuild.name,
        after: snapshot.guild.name,
      });
    }
    if (
      snapshot.guild.description !== undefined &&
      localGuild.description !== snapshot.guild.description
    ) {
      fieldChanges.push({
        field: "description",
        before: localGuild.description,
        after: snapshot.guild.description,
      });
    }
    if (fieldChanges.length > 0) {
      changes.push({
        entity: "guild",
        action: "update",
        id: guildId,
        summary: `Update guild — ${fieldChanges
          .map((c) => c.field)
          .join(", ")} drifted from core`,
        changes: fieldChanges,
        snapshotGuild: snapshot.guild,
      });
    }
  }

  return changes;
}

// ── Apply ─────────────────────────────────────────────────────────────────────

async function applyChange(
  guildId: string,
  change: CoreSyncChange,
  repos: {
    memberRepo: IMemberRepository;
    passRepo: IPassRepository;
    guildRepo: IGuildRepository;
  },
): Promise<void> {
  if (change.entity === "member") {
    if (change.action === "add" && change.snapshotMember) {
      const sm = change.snapshotMember;
      await repos.memberRepo.create(guildId, {
        wallet: sm.wallet ?? "",
        name: sm.userId,
        status: mapMemberStatus(sm.status),
        roles: sm.roles ?? [],
        joinedAt: sm.updatedAt,
        lastActive: sm.updatedAt,
      });
    } else if (
      change.action === "update" &&
      change.localMember &&
      change.snapshotMember
    ) {
      const sm = change.snapshotMember;
      await repos.memberRepo.update(
        guildId,
        change.localMember.id,
        { status: mapMemberStatus(sm.status), roles: sm.roles ?? [] },
        change.localMember.version,
      );
    } else if (change.action === "deactivate" && change.localMember) {
      await repos.memberRepo.update(
        guildId,
        change.localMember.id,
        { status: "inactive" },
        change.localMember.version,
      );
    }
    return;
  }

  if (change.entity === "pass" && change.snapshotPass) {
    const sp = change.snapshotPass;
    if (change.action === "add") {
      await repos.passRepo.create(guildId, {
        name: sp.name,
        description: sp.description ?? "",
        status: sp.status,
        price: sp.price,
        maxSupply: sp.maxSupply ?? null,
        currentSupply: sp.currentSupply ?? 0,
      });
    } else if (change.action === "update" && change.localPass) {
      const patch: Record<string, unknown> = {};
      for (const c of change.changes) patch[c.field] = c.after;
      await repos.passRepo.update(guildId, change.localPass.id, patch);
    }
    return;
  }

  if (change.entity === "guild" && change.snapshotGuild) {
    const patch: Record<string, unknown> = {};
    for (const c of change.changes) patch[c.field] = c.after;
    await repos.guildRepo.update(guildId, patch);
  }
}

// ── Activity ──────────────────────────────────────────────────────────────────

const ACTIVITY_TYPE: Record<
  CoreSyncChange["entity"],
  Partial<Record<CoreSyncChange["action"], ActivityEvent["type"]>>
> = {
  member: {
    add: "member.joined",
    update: "member.roles_changed",
    deactivate: "member.left",
  },
  pass: { add: "pass.created", update: "pass.updated" },
  guild: { update: "guild.updated" },
};

/**
 * Record one reconciliation-tagged activity event for an applied change.
 * Uses the webhook idempotent write path with a deterministic event id, so
 * retries of the same run never produce duplicates. Returns true when the
 * event was newly recorded.
 */
async function recordChange(
  guildId: string,
  change: CoreSyncChange,
  snapshot: GuildSnapshot,
  mode: CoreSyncMode,
  sink: Pick<IActivityStorage, "recordActivityEvent">,
  publish: (event: ActivityEvent) => void,
  now: () => string,
): Promise<boolean> {
  const type = ACTIVITY_TYPE[change.entity][change.action];
  if (!type) return false;

  const event: ActivityEvent = {
    id: `reconcile:${guildId}:${change.entity}:${change.action}:${change.id}`,
    type,
    source: "reconciliation",
    severity: change.action === "deactivate" ? "warning" : "info",
    actor: { name: "Reconciliation Job" },
    timestamp: now(),
    description: `[RECONCILE] ${change.summary}`,
    entity: { type: change.entity, id: change.id },
    metadata: {
      reconciliation: true,
      mode,
      snapshotAt: snapshot.generatedAt,
    },
    changes: change.changes,
    schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  };

  const result = await sink.recordActivityEvent(event);
  if (result === "duplicate") return false;
  publish(event);
  return true;
}

// ── Summary ───────────────────────────────────────────────────────────────────

function buildSummary(
  mode: CoreSyncMode,
  guildId: string,
  totals: CoreSyncReport["totals"],
  applied: number,
  totalChanges: number,
): string {
  const drift =
    totalChanges === 0
      ? "no drift"
      : `${totalChanges} change(s): ${totals.added} add, ${totals.updated} update, ${totals.deactivated} deactivate`;
  return mode === "apply"
    ? `Reconciliation (apply) for guild ${guildId}: ${drift}; ${applied} activity event(s) recorded.`
    : `Reconciliation (dry-run) for guild ${guildId}: ${drift}.`;
}
