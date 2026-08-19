export type {
  ActivityEventType,
  ActivityEventSource,
  ActivityEventSeverity,
  ActivityEventEntity,
  ActivityEvent,
  ActivityChange,
} from "@guildpass/integration-client";

export {
  CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  upcastActivityEvent,
  upcastActivityEvents,
  detectSchemaVersion,
  type RawActivityEvent,
} from "@guildpass/integration-client";

/**
 * The canonical list of webhook event types the dashboard understands.
 * Events not in this list are accepted through validation but silently
 * ignored (no activity entry is created).
 */
export const SUPPORTED_WEBHOOK_EVENTS = [
  "membership.created",
  "membership.updated",
  "pass.created",
  "pass.updated",
  "guild.updated",
  "verification.completed",
] as const;

export type SupportedWebhookEvent = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

type WebhookData = Record<string, unknown>;

export interface WebhookPayload {
  id: string;
  type: string;
  created: number;
  data: WebhookData;
}
