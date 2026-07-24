import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  upcastActivityEvents,
} from "@guildpass/integration-client";

import { query } from "../db";
import { type Activity, mockActivity } from "../mock-data";
import { ActivityQuery, ActivityQueryResult, filterActivityEvents } from "./query";
import { ActivityEvent } from "./types";
import {
  DurableIdempotencyStore,
  FileIdempotencyStore,
  InMemoryIdempotencyStore,
} from "../idempotency/store";

/**
 * Result for idempotent activity writes.
 */
export type ActivityWriteResult = "recorded" | "duplicate";

/**
 * Durable boundary for webhook idempotency and activity writes.
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

interface ActivityStorageOptions {
  maxEvents?: number;
  ttlSeconds?: number;
}

/**
 * Convert old-style mock activities to new ActivityEvent format.
 */
function convertMockActivityToEvent(activity: Activity): ActivityEvent {
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
    schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  };
}

function rowToActivityEvent(row: Record<string, unknown>): ActivityEvent {
  return {
    id: String(row.id),
    type: String(row.type) as ActivityEvent["type"],
    source: String(row.source) as ActivityEvent["source"],
    severity: String(row.severity) as ActivityEvent["severity"],
    actor: typeof row.actor === "string" ? JSON.parse(row.actor) : row.actor,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
    description: String(row.description),
    entity: typeof row.entity === "string" ? JSON.parse(row.entity) : row.entity,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    changes: typeof row.changes === "string" ? JSON.parse(row.changes) : row.changes,
    schemaVersion: Number(row.schema_version),
  };
}

/**
 * In-memory implementation of activity storage.
 * Note: This will reset on server restart.
 */
export class InMemoryActivityStorage implements IActivityStorage {
  private events: ActivityEvent[] = [];
  private readonly idempotencyStore: InMemoryIdempotencyStore;
  private readonly maxEvents: number;

  constructor(options: ActivityStorageOptions = {}) {
    this.maxEvents = options.maxEvents ?? 1000;
    this.idempotencyStore = new InMemoryIdempotencyStore(options.ttlSeconds);

    mockActivity.forEach((activity) => {
      this.events.unshift(convertMockActivityToEvent(activity));
      this.idempotencyStore.markSeen(activity.id);
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
    if (this.events.length > this.maxEvents) {
      this.events.pop();
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
    return this.idempotencyStore.hasSeen(eventId);
  }

  async recordProcessedEvent(eventId: string): Promise<ActivityWriteResult> {
    return (await this.idempotencyStore.markSeen(eventId)) ? "recorded" : "duplicate";
  }

  async reset(): Promise<void> {
    this.events = [];
    mockActivity.forEach((activity) => {
      this.events.unshift(convertMockActivityToEvent(activity));
      this.idempotencyStore.markSeen(activity.id);
    });
  }
}

/**
 * File-backed adapter for local persistent mode.
 */
export class FileActivityStorage implements IActivityStorage {
  private readonly processedStore: FileIdempotencyStore;
  private readonly eventsPath: string;
  private readonly maxEvents: number;

  constructor(rootDir: string, options: ActivityStorageOptions = {}) {
    this.processedStore = new FileIdempotencyStore(rootDir, options.ttlSeconds);
    this.eventsPath = join(rootDir, "activity-events.jsonl");
    this.maxEvents = options.maxEvents ?? 1000;
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
      const raws = file
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .reverse();
      return upcastActivityEvents(raws);
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
      const events = upcastActivityEvents(
        raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .reverse()
      );

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
    return this.processedStore.hasSeen(eventId);
  }

  async recordProcessedEvent(eventId: string): Promise<ActivityWriteResult> {
    return (await this.processedStore.markSeen(eventId)) ? "recorded" : "duplicate";
  }

  async reset(): Promise<void> {
    await rm(join(this.eventsPath, ".."), { recursive: true, force: true });
    await this.ensureStore();
  }

  private async ensureStore(): Promise<void> {
    await mkdir(join(this.eventsPath, ".."), { recursive: true });
  }
}

/**
 * Durable PostgreSQL-backed activity storage.
 *
 * This is the multi-instance-safe mode for webhook idempotency.
 */
export class DurableActivityStorage implements IActivityStorage {
  private readonly idempotencyStore: DurableIdempotencyStore;
  private readonly maxEvents: number;

  constructor(options: ActivityStorageOptions = {}) {
    this.idempotencyStore = new DurableIdempotencyStore(options.ttlSeconds);
    this.maxEvents = options.maxEvents ?? 1000;
  }

  async addEvent(event: ActivityEvent): Promise<void> {
    await this.recordActivityEvent(event);
  }

  async getEvents(limit?: number): Promise<ActivityEvent[]> {
    const queryLimit = limit ? `LIMIT ${limit}` : "";
    const result = await query(
      `SELECT * FROM activity_events ORDER BY timestamp DESC ${queryLimit}`,
    );
    return result.rows.map((row) => rowToActivityEvent(row));
  }

  async queryEvents(queryOptions: ActivityQuery = {}): Promise<ActivityQueryResult> {
    const events = await this.getEvents();
    return filterActivityEvents(events, queryOptions);
  }

  async isDuplicate(eventId: string): Promise<boolean> {
    return this.hasProcessedEvent(eventId);
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    return this.idempotencyStore.hasSeen(eventId);
  }

  async recordProcessedEvent(eventId: string): Promise<ActivityWriteResult> {
    return (await this.idempotencyStore.markSeen(eventId)) ? "recorded" : "duplicate";
  }

  async recordActivityEvent(event: ActivityEvent): Promise<ActivityWriteResult> {
    const result = await this.recordProcessedEvent(event.id);
    if (result === "duplicate") {
      return "duplicate";
    }

    await query(
      `INSERT INTO activity_events (
        id, type, source, severity, actor, timestamp, description, entity, metadata, changes, schema_version
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)
      ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.type,
        event.source,
        event.severity,
        JSON.stringify(event.actor),
        event.timestamp,
        event.description,
        event.entity ? JSON.stringify(event.entity) : null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.changes ? JSON.stringify(event.changes) : null,
        event.schemaVersion,
      ],
    );

    return "recorded";
  }
}

function createActivityStorage(): IActivityStorage {
  const mode = (process.env.ACTIVITY_STORAGE_MODE || "memory").toLowerCase();

  if (mode === "durable") {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when ACTIVITY_STORAGE_MODE=durable");
    }
    return new DurableActivityStorage();
  }

  if (mode === "file") {
    return new FileActivityStorage(
      process.env.ACTIVITY_STORAGE_DIR ?? join(process.cwd(), ".guildpass-activity"),
    );
  }

  return new InMemoryActivityStorage();
}

// Global instance for the dashboard app
export const activityStorage = createActivityStorage();
