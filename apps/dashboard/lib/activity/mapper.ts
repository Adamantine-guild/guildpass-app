import type { ActivityEvent, WebhookPayload } from "./types";
import { CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";

function displayValue(...values: Array<unknown>): string {
  const value = values.find((item) => typeof item === "string" && item.length > 0);
  return typeof value === "string" ? value : "Unknown";
}

function entityId(...values: Array<unknown>): string {
  return displayValue(...values);
}

export function mapWebhookToActivity(payload: WebhookPayload): ActivityEvent | null {
  const { type, data, id, created } = payload;
  const timestamp = new Date(created * 1000).toISOString();

  switch (type) {
    case "membership.created": {
      const memberLabel = displayValue(data.name, data.wallet, data.id);

      return {
        id,
        type: "member.joined",
        source: "webhook",
        severity: "info",
        actor: {
          name: typeof data.name === "string" ? data.name : undefined,
          wallet: typeof data.wallet === "string" ? data.wallet : undefined,
        },
        description: `New member joined: ${memberLabel}`,
        timestamp,
        entity: {
          type: "member",
          id: entityId(data.id, data.wallet, data.name),
          name: typeof data.name === "string" ? data.name : undefined,
        },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    }

    case "membership.updated": {
      const memberLabel = displayValue(data.name, data.wallet, data.id);

      return {
        id,
        type: "member.left",
        source: "webhook",
        severity: "info",
        actor: {
          name: typeof data.name === "string" ? data.name : undefined,
          wallet: typeof data.wallet === "string" ? data.wallet : undefined,
        },
        description: `Member ${memberLabel} updated`,
        timestamp,
        entity: {
          type: "member",
          id: entityId(data.id, data.wallet, data.name),
          name: typeof data.name === "string" ? data.name : undefined,
        },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    }

    case "pass.created": {
      const passLabel = displayValue(data.name, data.id);

      return {
        id,
        type: "pass.created",
        source: "webhook",
        severity: "info",
        actor: {
          name: "Admin",
        },
        description: `New pass created: ${passLabel}`,
        timestamp,
        entity: {
          type: "pass",
          id: entityId(data.id, data.name),
          name: typeof data.name === "string" ? data.name : undefined,
        },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    }

    case "pass.updated": {
      const passLabel = displayValue(data.name, data.id);

      return {
        id,
        type: "pass.updated",
        source: "webhook",
        severity: "info",
        actor: {
          name: "Admin",
        },
        description: `Pass updated: ${passLabel}`,
        timestamp,
        entity: {
          type: "pass",
          id: entityId(data.id, data.name),
          name: typeof data.name === "string" ? data.name : undefined,
        },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    }

    case "guild.updated": {
      const guildLabel = displayValue(data.name, data.id);

      return {
        id,
        type: "guild.updated",
        source: "webhook",
        severity: "info",
        actor: {
          name: "Admin",
        },
        description: `Guild settings updated: ${guildLabel}`,
        timestamp,
        entity: {
          type: "guild",
          id: entityId(data.id, data.name),
          name: typeof data.name === "string" ? data.name : undefined,
        },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    }

    case "verification.completed":
      return {
        id,
        type: "verification.completed",
        source: "webhook",
        severity: "info",
        actor: {
          wallet: typeof data.wallet === "string" ? data.wallet : undefined,
        },
        description: `Verification completed for ${displayValue(data.wallet)}`,
        timestamp,
        entity: {
          type: "verification",
          id: entityId(data.wallet),
        },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };

    default:
      return null;
  }
}
