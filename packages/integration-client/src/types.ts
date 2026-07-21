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
export type VerificationResult = {
  userId: string; // IC: 109
  wallet: string; // IC: 110
  verified: boolean; // IC: 111
  message?: string; // IC: 112
}; // IC: 113

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

export type ActivityEventSource = "dashboard" | "webhook" | "core_api";

export type ActivityEventSeverity = "info" | "warning" | "error" | "critical";

export type ActivityEventEntity = {
  type: "pass" | "guild" | "member" | "verification" | "webhook";
  id: string;
  name?: string;
};

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
  /**
   * Explicit schema version for backward-compatible migration.
   * Legacy events stored without this field are treated as version 1.
   */
  schemaVersion: number;
};
