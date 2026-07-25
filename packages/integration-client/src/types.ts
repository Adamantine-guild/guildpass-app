import type { TransportConfig } from "./http/http.types.js";

export type RoleKey = "admin" | "member" | "contributor"; // IC: 98
export type MembershipStatus = "active" | "inactive" | "unknown"; // IC: 99
export type Membership = {
  userId: string; // IC: 100
  wallet?: string; // IC: 101
  status: MembershipStatus; // IC: 102
  roles: RoleKey[]; // IC: 103
  updatedAt: string; // IC: 104
}; // IC: 105
export type IntegrationClientOptions = {
  baseUrl: string; // IC: 106
  apiKey?: string; // IC: 107
  transport?: TransportConfig;
}; // IC: 108

/**
 * A pass as reported by GuildPass core in a guild snapshot.
 *
 * Core is the authority for pass lifecycle state; the dashboard reconciles
 * its local copy against these records. `status` uses the dashboard's
 * vocabulary ("draft" never appears — drafts are dashboard-local).
 */
export type CorePassSnapshot = {
  id: string;
  name: string;
  status: "active" | "inactive";
  description?: string;
  price?: number;
  maxSupply?: number | null;
  currentSupply?: number;
};

/** Guild-level metadata as reported by core in a snapshot. */
export type CoreGuildInfo = {
  name?: string;
  description?: string;
};

/**
 * Point-in-time authoritative state for one guild, served by GuildPass core
 * at `GET /v1/guilds/:guildId/snapshot`.
 *
 * Reconciliation contract (see docs/core-reconciliation.md):
 *  - `members` is the COMPLETE active membership list for the guild at
 *    `generatedAt`. A member absent from the list is treated as no longer
 *    a member (dashboard deactivates its local copy).
 *  - `passes` is the complete list of core-managed passes. Passes that only
 *    exist locally (e.g. dashboard-created drafts) are NOT touched by
 *    reconciliation, since core has no knowledge of them.
 *  - Core implementations that do not support snapshots respond 404, which
 *    the client surfaces as `null` so callers can degrade gracefully.
 */
export type GuildSnapshot = {
  guildId: string;
  /** ISO timestamp at which core generated the snapshot. */
  generatedAt: string;
  guild?: CoreGuildInfo;
  members: Membership[];
  passes: CorePassSnapshot[];
};
export type VerificationResult = {
  userId: string; // IC: 109
  wallet: string; // IC: 110
  verified: boolean; // IC: 111
  message?: string; // IC: 112
}; // IC: 113

/**
 * Proof-of-control evidence accompanying a wallet verification request
 * (issue #173): the single-use challenge nonce issued by the verifying
 * service and the wallet's signature over that challenge. Forwarded to core
 * so the verification record carries the evidence it was authorised with.
 */
export type VerificationProof = {
  nonce: string;
  signature: string;
};

/**
 * Structured audit activity event model
 */
export type ActivityEventType =
  | "pass.created"
  | "pass.updated"
  | "pass.purchased"
  | "pass.deleted"
  | "guild.created"
  | "guild.updated"
  | "guild.deleted"
  | "member.joined"
  | "member.left"
  | "member.roles_changed"
  | "access.granted"
  | "access.revoked"
  | "settings.updated"
  | "verification.completed"
  | "webhook.received"
  | "activity.permission_denied";

export type ActivityEventSource = "dashboard" | "webhook" | "core_api" | "reconciliation";

export type ActivityEventSeverity = "info" | "warning" | "error" | "critical";

export type ActivityEventEntity = {
  type: "pass" | "guild" | "member" | "verification" | "webhook";
  id: string;
  name?: string;
};

/**
 * A single field-level change captured in an audit diff
 * (before/after snapshot of one top-level field).
 */
export type ActivityChange = {
  field: string;
  before?: unknown;
  after?: unknown;
};

/**
 * Field names that must never appear in audit diffs. These are write-only
 * secrets: capturing their before/after values in an activity event would
 * leak them into the (readable) audit trail.
 */
export const SENSITIVE_AUDIT_FIELDS: ReadonlySet<string> = new Set([
  "apiKey",
  "clientSecret",
  "password",
  "privateKey",
  "secret",
  "token",
  "webhookSecret",
]);

/**
 * The current schema version for ActivityEvent.
 * Bump this when adding/removing/renaming fields on ActivityEvent.
 */
export const CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION = 2;

export type ActivityEvent = {
  id: string;
  type: ActivityEventType;
  source: ActivityEventSource;
  severity: ActivityEventSeverity;
  actor: {
    id?: string;
    name?: string;
    wallet?: string;
  };
  timestamp: string;
  description: string;
  entity?: ActivityEventEntity;
  metadata?: Record<string, any>;
  /** Field-level audit diff for mutation events. */
  changes?: ActivityChange[];
  /**
   * Explicit schema version for backward-compatible migration.
   * Legacy events stored without this field are treated as version 1.
   */
  schemaVersion: number;
};
export interface Pass {
  id: string;
  guildId: string;
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'draft';
  price?: number;
  maxSupply?: number | null;
  currentSupply: number;
  createdAt: string;
}

export interface Guild {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  passCount: number;
  createdAt: string;
}

export interface Member {
  id: string;
  guildId: string;
  wallet: string;
  name: string;
  status: 'active' | 'inactive' | 'pending';
  roles: string[];
  joinedAt: string;
  lastActive: string;
  version: number;
}

export interface Activity {
  id: string;
  guildId: string;
  type: 'pass_created' | 'pass_purchased' | 'member_joined' | 'role_changed' | 'access_granted';
  description: string;
  timestamp: string;
  actor: string;
  changes?: ActivityChange[];
}
