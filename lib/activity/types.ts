/**
 * Activity event types used by the GuildPass frontend.
 *
 * These are local frontend contracts for the V2 app. They are intentionally
 * decoupled from the legacy @guildpass/integration-client package.
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

export type ActivityEventSource =
  | "dashboard"
  | "webhook"
  | "core_api"
  | "reconciliation";

export type ActivityEventSeverity =
  | "info"
  | "warning"
  | "error"
  | "critical";

export type ActivityEventEntity = {
  type: "pass" | "guild" | "member" | "verification" | "webhook";
  id: string;
  name?: string;
};

export type ActivityChange = {
  field: string;
  before?: unknown;
  after?: unknown;
};

export const SENSITIVE_AUDIT_FIELDS: ReadonlySet<string> = new Set([
  "apiKey",
  "clientSecret",
  "password",
  "privateKey",
  "secret",
  "token",
  "webhookSecret",
]);

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
  metadata?: Record<string, unknown>;
  changes?: ActivityChange[];
  schemaVersion: number;
};

/**
 * The canonical list of webhook event types currently understood by the
 * frontend.
 *
 * Unknown webhook event types may still be accepted by validation layers, but
 * they should not automatically become frontend activity entries.
 */
export const SUPPORTED_WEBHOOK_EVENTS = [
  "membership.created",
  "membership.updated",
  "pass.created",
  "pass.updated",
  "guild.updated",
  "verification.completed",
] as const;

export type SupportedWebhookEvent =
  (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

export type WebhookData = Record<string, unknown>;

export interface WebhookPayload {
  id: string;
  type: string;
  created: number;
  data: WebhookData;
}