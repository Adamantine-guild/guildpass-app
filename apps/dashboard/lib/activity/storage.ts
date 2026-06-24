import type { Activity } from "../mock-data.ts";
import { mockActivity } from "../mock-data.ts";
import type { ActivityEvent, ActivityQuery, ActivityQueryResult } from "./types.ts";

export const DEFAULT_ACTIVITY_LIMIT = 20;
export const MAX_ACTIVITY_LIMIT = 100;

/**
 * Interface for activity storage. 
 * Allows swapping in-memory with database later.
 */
export interface IActivityStorage {
  addEvent(event: ActivityEvent): Promise<void>;
  getEvents(query?: ActivityQuery): Promise<ActivityQueryResult>;
  isDuplicate(eventId: string): Promise<boolean>;
}

/**
 * Convert old-style mock activities to new ActivityEvent format
 */
function convertMockActivityToEvent(activity: Activity): ActivityEvent {
  // Map old type strings to new ActivityEventType
  const typeMap: Record<Activity["type"], ActivityEvent["type"]> = {
    member_joined: "member.joined",
    pass_created: "pass.created",
    pass_purchased: "pass.purchased",
    role_changed: "member.roles_changed",
    access_granted: "access.granted",
  };

  return {
    id: activity.id,
    type: typeMap[activity.type] || "webhook.received",
    source: "dashboard",
    severity: "info",
    actor: {
      name: activity.actor,
    },
    timestamp: activity.timestamp,
    description: activity.description,
  };
}

function encodeCursor(event: ActivityEvent): string {
  return `${encodeURIComponent(event.timestamp)}|${encodeURIComponent(event.id)}`;
}

function decodeCursor(cursor?: string): { timestamp: string; id: string } | null {
  if (!cursor) return null;
  const parts = cursor.split("|");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    return {
      timestamp: decodeURIComponent(parts[0]),
      id: decodeURIComponent(parts[1]),
    };
  } catch {
    return null;
  }
}

function normalizeLimit(limit?: number): number {
  if (!limit) return DEFAULT_ACTIVITY_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_ACTIVITY_LIMIT);
}

export function queryActivityEvents(
  events: ActivityEvent[],
  query: ActivityQuery = {}
): ActivityQueryResult {
  const fromTime = query.from ? Date.parse(query.from) : undefined;
  const actor = query.actor?.toLowerCase();

  const filtered = events
    .filter((event) => !query.type || event.type === query.type)
    .filter((event) => !query.source || event.source === query.source)
    .filter((event) => !query.severity || event.severity === query.severity)
    .filter((event) => !query.entityType || event.entity?.type === query.entityType)
    .filter((event) => fromTime === undefined || Date.parse(event.timestamp) >= fromTime)
    .filter((event) => {
      if (!actor) return true;
      return [event.actor.id, event.actor.name, event.actor.wallet]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(actor));
    })
    .sort((a, b) => {
      const byTimestamp = Date.parse(b.timestamp) - Date.parse(a.timestamp);
      return byTimestamp || b.id.localeCompare(a.id);
    });

  const cursor = decodeCursor(query.cursor);
  const start = cursor
    ? filtered.findIndex(
        (event) => event.timestamp === cursor.timestamp && event.id === cursor.id
      ) + 1
    : 0;
  const limit = normalizeLimit(query.limit);
  const page = filtered.slice(Math.max(start, 0), Math.max(start, 0) + limit);

  return {
    events: page,
    nextCursor:
      page.length === limit && filtered.length > Math.max(start, 0) + limit
        ? encodeCursor(page[page.length - 1])
        : null,
  };
}

/**
 * In-memory implementation of activity storage.
 * Note: This will reset on server restart.
 */
class InMemoryActivityStorage implements IActivityStorage {
  private events: ActivityEvent[] = [];
  private processedIds = new Set<string>();

  constructor() {
    // Seed with existing mock data converted to new format
    mockActivity.forEach((activity) => {
      this.events.unshift(convertMockActivityToEvent(activity));
      this.processedIds.add(activity.id);
    });
  }

  async addEvent(event: ActivityEvent): Promise<void> {
    if (this.processedIds.has(event.id)) {
      return;
    }
    
    this.events.unshift(event);
    this.processedIds.add(event.id);
    
    // Keep a reasonable limit in memory
    if (this.events.length > 1000) {
      const removed = this.events.pop();
      if (removed) this.processedIds.delete(removed.id);
    }
  }

  async getEvents(query?: ActivityQuery): Promise<ActivityQueryResult> {
    return queryActivityEvents(this.events, query);
  }

  async isDuplicate(eventId: string): Promise<boolean> {
    return this.processedIds.has(eventId);
  }
}

// Global instance for the dashboard app
export const activityStorage = new InMemoryActivityStorage();
