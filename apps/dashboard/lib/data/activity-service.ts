import type { ActivityEvent } from "@guildpass/integration-client";
import { activityStorage } from "../activity/storage.ts";
import type { ActivityQuery, ActivityQueryResult } from "../activity/types.ts";

/**
 * Activity service for managing audit events
 */
class ActivityService {
  /**
   * Create a new activity event and store it
   */
  async createEvent(event: Omit<ActivityEvent, "id" | "timestamp">): Promise<ActivityEvent> {
    const fullEvent: ActivityEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    await activityStorage.addEvent(fullEvent);
    return fullEvent;
  }

  /**
   * Get activity events with bounded pagination and filters.
   */
  async getEvents(query?: ActivityQuery): Promise<ActivityQueryResult> {
    return activityStorage.getEvents(query);
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
