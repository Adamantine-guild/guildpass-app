/**
 * lib/reconciliation/core-sync-types.ts
 *
 * Types for core-state reconciliation (issue #262). Kept separate from
 * types.ts, which belongs to the older counter-drift reconciler, so each
 * reconciler's contract is self-contained.
 */

import type { ActivityChange, ActivityEvent, CoreGuildInfo, CorePassSnapshot, GuildSnapshot, Membership } from "@guildpass/integration-client";
import type { Member, Pass } from "../mock-data";
import type { IGuildRepository, IMemberRepository, IPassRepository } from "../repositories/types";
import type { IActivityStorage } from "../activity/storage";

export type CoreSyncMode = "dry-run" | "apply";

/**
 * Minimal client contract the job needs — satisfied by IntegrationClient,
 * trivially stubbed in tests.
 */
export interface SnapshotClient {
  getGuildSnapshot(guildId: string): Promise<GuildSnapshot | null>;
}

/** A single drifted entity detected by the diff. */
export interface CoreSyncChange {
  entity: "member" | "pass" | "guild";
  action: "add" | "update" | "deactivate";
  /**
   * Identifier used in the deterministic activity event id: local record id
   * when one exists, otherwise the core-side key (normalized wallet / pass id).
   */
  id: string;
  /** Human-readable one-liner for the report and activity description. */
  summary: string;
  /** Field-level drift (before = local, after = core). */
  changes: ActivityChange[];
  /** Context used by the apply step. Not part of the API report payload. */
  localMember?: Member;
  snapshotMember?: Membership;
  localPass?: Pass;
  snapshotPass?: CorePassSnapshot;
  snapshotGuild?: CoreGuildInfo;
}

export interface CoreSyncReport {
  guildId: string;
  mode: CoreSyncMode;
  /** False when core does not implement the snapshot endpoint (404). */
  supported: boolean;
  /** Why reconciliation could not run (only when supported === false). */
  reason?: string;
  /** Snapshot generation time reported by core. */
  snapshotAt?: string;
  changes: CoreSyncChange[];
  totals: {
    added: number;
    updated: number;
    deactivated: number;
    unchanged: number;
  };
  /** Activity events newly recorded (apply mode only; 0 for dry-run). */
  applied: number;
  summary: string;
}

/** Injectable seams for tests. Defaults wire the app's real singletons. */
export interface CoreSyncDeps {
  memberRepo?: IMemberRepository;
  passRepo?: IPassRepository;
  guildRepo?: IGuildRepository;
  activitySink?: Pick<IActivityStorage, "recordActivityEvent">;
  publish?: (event: ActivityEvent) => void;
  now?: () => string;
}
