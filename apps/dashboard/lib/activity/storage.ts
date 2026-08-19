import { mkdir, open, readFile, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { ActivityEvent } from "./types";
import type { ActivityQuery, ActivityQueryResult } from "./query";
import { filterActivityEvents } from "./query";
import { type Activity, mockActivity } from "../mock-data";

/**
 * Result for idempotent activity writes.
 */
export type ActivityWriteResult = "recorded" | "duplicate";

/**
 * Durable boundary for webhook idempotency and activity writes.
 *
 * Production deployments can implement this against a database table with a
 * unique constraint on event id. Local development keeps the in-memory adapter.
 */
export interface IActivityStorage {
  addEvent(event: ActivityEvent): Promise<void>;
  getEvents(limit?: number): Promise<ActivityEvent[]>;
  queryEvents(query?: ActivityQuery): Promise<ActivityQueryResult>;
  isDuplicate(eventId: string): Promise<boolean>;
  hasProcessedEvent(eventId: string): Promise<boolean>;
  recordProcessedEvent(eventId: string): Promise<ActivityWriteResult>;
  recordActivityEvent(event: ActivityEvent): Promise<ActivityWriteResult>;
  reset?(): Promise<void>;
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
    await this.recordActivityEvent(event);
  }

  async recordActivityEvent(event: ActivityEvent): Promise<ActivityWriteResult> {
    const result = await this.recordProcessedEvent(event.id);
    if (result === "duplicate") {
      return "duplicate";
    }

    this.events.unshift(event);

    // Keep a reasonable limit in memory
    if (this.events.length > 1000) {
      const removed = this.events.pop();
      if (removed) this.processedIds.delete(removed.id);
    }

    return "recorded";
  }

  async getEvents(limit?: number): Promise<ActivityEvent[]> {
    if (limit) {
      return this.queryEvents({ limit }).then((result) => result.events);
    }

    return [...this.events];
  }

  async queryEvents(query: ActivityQuery = {}): Promise<ActivityQueryResult> {
    return filterActivityEvents(this.events, query);
  }

  async isDuplicate(eventId: string): Promise<boolean> {
    return this.hasProcessedEvent(eventId);
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    return this.processedIds.has(eventId);
  }

  async recordProcessedEvent(eventId: string): Promise<ActivityWriteResult> {
    if (this.processedIds.has(eventId)) {
      return "duplicate";
    }

    this.processedIds.add(eventId);
    return "recorded";
  }

  async reset(): Promise<void> {
    this.events = [];
    this.processedIds.clear();
    mockActivity.forEach((activity) => {
      this.events.unshift(convertMockActivityToEvent(activity));
      this.processedIds.add(activity.id);
    });
  }
}

/**
 * File-backed adapter for local durable mode.
 *
 * The processed-event marker uses exclusive file creation, which gives us an
 * atomic insert-or-conflict behavior for retries in the same shared directory.
 * Hosted production should use the same interface with a database-backed
 * adapter and a unique index on the webhook event id.
 */
export class FileActivityStorage implements IActivityStorage {
  private processedDir: string;
  private eventsPath: string;

  constructor(private rootDir: string) {
    this.processedDir = join(rootDir, "processed-webhooks");
    this.eventsPath = join(rootDir, "activity-events.jsonl");
  }

  async addEvent(event: ActivityEvent): Promise<void> {
    await this.recordActivityEvent(event);
  }

  async recordActivityEvent(event: ActivityEvent): Promise<ActivityWriteResult> {
    const result = await this.recordProcessedEvent(event.id);
    if (result === "duplicate") {
      return "duplicate";
    }

    await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
    return "recorded";
  }

  async getEvents(limit?: number): Promise<ActivityEvent[]> {
    if (limit) {
      return this.queryEvents({ limit }).then((result) => result.events);
    }

    await this.ensureStore();

    try {
      const file = await readFile(this.eventsPath, "utf8");
      return file
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ActivityEvent)
        .reverse();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async queryEvents(query: ActivityQuery = {}): Promise<ActivityQueryResult> {
    await this.ensureStore();

    try {
      const raw = await readFile(this.eventsPath, "utf8");
      const events = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ActivityEvent)
        .reverse();

      return filterActivityEvents(events, query);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return filterActivityEvents([], query);
      }
      throw error;
    }
  }

  async isDuplicate(eventId: string): Promise<boolean> {
    return this.hasProcessedEvent(eventId);
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    await this.ensureStore();

    try {
      await readFile(this.markerPath(eventId), "utf8");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async recordProcessedEvent(eventId: string): Promise<ActivityWriteResult> {
    await this.ensureStore();

    try {
      const marker = await open(this.markerPath(eventId), "wx");
      await marker.writeFile(new Date().toISOString(), "utf8");
      await marker.close();
      return "recorded";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return "duplicate";
      }
      throw error;
    }
  }

  async reset(): Promise<void> {
    await rm(this.rootDir, { recursive: true, force: true });
    await this.ensureStore();
  }

  private markerPath(eventId: string): string {
    return join(this.processedDir, encodeURIComponent(eventId));
  }

  private async ensureStore(): Promise<void> {
    await mkdir(this.processedDir, { recursive: true });
  }
}

function createActivityStorage(): IActivityStorage {
  if (process.env.ACTIVITY_STORAGE_MODE === "file") {
    return new FileActivityStorage(
      process.env.ACTIVITY_STORAGE_DIR ?? join(process.cwd(), ".guildpass-activity")
    );
  }

  return new InMemoryActivityStorage();
}

// Global instance for the dashboard app
export const activityStorage = createActivityStorage();
