import { ActivityEvent, CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";
import { ActivityQuery, ActivityQueryResult } from "../activity/query";
import { activityStorage } from "../activity/storage";

export interface ActivityStats {
  totalEvents: number;
  lastEventAt: string | null;
  eventsByType: Record<string, number>;
  eventsBySource: Record<string, number>;
}

/**
 * Activity service for managing audit events.
 *
 * Wraps the storage layer with a higher-level API that includes
 * incremental polling support (getEventsSince) and aggregated stats.
 */
class ActivityService {
  /**
   * Create a new activity event and store it
   */
  async createEvent(event: Omit<ActivityEvent, "id" | "timestamp" | "schemaVersion"> & Partial<Pick<ActivityEvent, "schemaVersion">>): Promise<ActivityEvent> {
    const fullEvent: ActivityEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      schemaVersion: event.schemaVersion ?? CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
    };

    await activityStorage.addEvent(fullEvent);
    return fullEvent;
  }

  /**
   * Get all activity events, optionally filtered by type and capped by limit.
   */
  async getEvents(options?: ActivityQuery): Promise<ActivityEvent[]> {
    if (!options) {
      return activityStorage.getEvents();
    }

    const result = await this.queryEvents(options);
    return result.events;
  }

  async queryEvents(options?: ActivityQuery): Promise<ActivityQueryResult> {
    return activityStorage.queryEvents(options);
  }

  /**
   * Return activity events strictly newer than the supplied timestamp.
   */
  async getEventsSince(
    timestamp: string,
    options: Omit<ActivityQuery, "from" | "cursor"> = {}
  ): Promise<ActivityEvent[]> {
    const cutoff = new Date(timestamp).getTime();
    if (Number.isNaN(cutoff)) return [];

    const result = await this.queryEvents({
      ...options,
      from: new Date(cutoff + 1).toISOString(),
    });
    return result.events;
  }

  /**
   * Check whether a given event ID has already been recorded (dedup guard).
   */
  async hasProcessedEvent(eventId: string): Promise<boolean> {
    return activityStorage.hasProcessedEvent(eventId);
  }

  /**
   * Return aggregate stats about stored activity events.
   */
  async getStats(): Promise<ActivityStats> {
    const events = await activityStorage.getEvents() as ActivityEvent[];
    const totalEvents = events.length;
    const lastEventAt = events.length > 0 ? events[0].timestamp : null;

    const eventsByType: Record<string, number> = {};
    const eventsBySource: Record<string, number> = {};

    for (const e of events) {
      eventsByType[e.type] = (eventsByType[e.type] || 0) + 1;
      eventsBySource[e.source] = (eventsBySource[e.source] || 0) + 1;
    }

    return { totalEvents, lastEventAt, eventsByType, eventsBySource };
  }

  /**
   * Helper to create a pass.created event
   */
  async createPassCreatedEvent(pass: { id: string; name: string }, actor: { name?: string; wallet?: string } = { name: "Admin" }): Promise<ActivityEvent> {
    return this.createEvent({
      type: "pass.created",
      source: "dashboard",
      severity: "info",
      actor,
      description: `Created new pass: ${pass.name}`,
      entity: { type: "pass", id: pass.id, name: pass.name },
    });
  }

  /**
   * Helper to create a member.joined event
   */
  async createMemberJoinedEvent(member: { id: string; name?: string; wallet?: string }, actor?: { name?: string; wallet?: string }): Promise<ActivityEvent> {
    const description = member.name
      ? `${member.name} joined the guild`
      : `New member joined: ${member.wallet}`;

    return this.createEvent({
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      actor: actor || member,
      description,
      entity: { type: "member", id: member.id, name: member.name },
    });
  }

  /**
   * Helper to create a verification.completed event
   */
  async createVerificationCompletedEvent(wallet: string, actor: { name?: string; wallet?: string }): Promise<ActivityEvent> {
    return this.createEvent({
      type: "verification.completed",
      source: "dashboard",
      severity: "info",
      actor,
      description: `Verification completed for ${wallet}`,
      entity: { type: "verification", id: wallet },
      metadata: { wallet },
    });
  }
}

/**
 * Singleton instance of the activity service
 */
export const activityService = new ActivityService();
