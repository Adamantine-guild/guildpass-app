import type { ActivityEvent, ActivityEventType, ActivityEventEntity, ActivityEventSeverity } from "./types";
import { CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";
import { getActivityRepository } from "@/lib/repositories/factory";
import type { Session } from "@/lib/auth/session";
import { publishActivityEvent } from "./stream";

interface DashboardActivityInput {
  type: ActivityEventType;
  entity?: ActivityEventEntity;
  actor?: { id?: string; name?: string; wallet?: string };
  description?: string;
  severity?: ActivityEventSeverity;
  metadata?: Record<string, any>;
}

function safeDescription(type: ActivityEventType, entity?: ActivityEventEntity): string {
  const name = entity?.name ?? entity?.id ?? "unknown";
  switch (type) {
    case "pass.created":
      return `Created pass: ${name}`;
    case "pass.updated":
      return `Updated pass: ${name}`;
    case "pass.deleted":
      return `Deactivated pass: ${name}`;
    case "guild.created":
      return `Created guild: ${name}`;
    case "guild.updated":
      return `Updated guild: ${name}`;
    case "guild.deleted":
      return `Deleted guild: ${name}`;
    case "member.joined":
      return `Added member: ${name}`;
    case "member.left":
      return `Removed member: ${name}`;
    case "member.roles_changed":
      return `Changed roles for: ${name}`;
    case "settings.updated":
      return "Settings updated";
    default:
      return `${type} — ${name}`;
  }
}

function actorFromSession(session?: Session): { id?: string; name?: string; wallet?: string } {
  if (!session) return { name: "Admin" };
  return { id: session.userId, name: session.name };
}

export async function recordDashboardActivity(
  guildId: string,
  input: DashboardActivityInput
): Promise<ActivityEvent> {
  const event = await getActivityRepository().append(guildId, {
    type: input.type,
    source: "dashboard",
    severity: input.severity ?? "info",
    actor: input.actor ?? { name: "Admin" },
    description: input.description ?? safeDescription(input.type, input.entity),
    entity: input.entity,
    metadata: input.metadata,
    schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  });
  publishActivityEvent(event);
  return event;
}

export function actorFromRequest(session?: Session): { id?: string; name?: string; wallet?: string } {
  return actorFromSession(session);
}
