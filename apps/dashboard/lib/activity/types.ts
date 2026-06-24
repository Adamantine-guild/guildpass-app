export type {
  ActivityEventType,
  ActivityEventSource,
  ActivityEventSeverity,
  ActivityEventEntity,
  ActivityEvent,
} from "@guildpass/integration-client";

import type {
  ActivityEventEntity,
  ActivityEventSeverity,
  ActivityEventSource,
  ActivityEventType,
} from "@guildpass/integration-client";

export const ACTIVITY_EVENT_TYPES = [
  "pass.created",
  "pass.updated",
  "pass.purchased",
  "pass.deleted",
  "guild.created",
  "guild.updated",
  "guild.deleted",
  "member.joined",
  "member.left",
  "member.roles_changed",
  "access.granted",
  "access.revoked",
  "verification.completed",
  "webhook.received",
] as const satisfies readonly ActivityEventType[];

export const ACTIVITY_EVENT_SOURCES = [
  "dashboard",
  "webhook",
  "core_api",
] as const satisfies readonly ActivityEventSource[];

export const ACTIVITY_EVENT_SEVERITIES = [
  "info",
  "warning",
  "error",
  "critical",
] as const satisfies readonly ActivityEventSeverity[];

export const ACTIVITY_ENTITY_TYPES = [
  "pass",
  "guild",
  "member",
  "verification",
  "webhook",
] as const satisfies readonly ActivityEventEntity["type"][];

export interface ActivityQuery {
  limit?: number;
  cursor?: string;
  type?: ActivityEventType;
  source?: ActivityEventSource;
  severity?: ActivityEventSeverity;
  entityType?: ActivityEventEntity["type"];
  actor?: string;
  from?: string;
}

export interface ActivityQueryResult {
  events: import("@guildpass/integration-client").ActivityEvent[];
  nextCursor: string | null;
}

export interface WebhookPayload {
  id: string;
  type: string;
  created: number;
  data: Record<string, any>;
}
