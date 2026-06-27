import { ActivityEvent, ActivityEventType } from "@guildpass/integration-client";
import { getActivityRepository } from "../repositories/factory";

/**
 * Activity service for managing audit events
 */
class ActivityService {
  /**
   * Create a new activity event and store it
   */
  async createEvent(event: Omit<ActivityEvent, "id" | "timestamp">): Promise<ActivityEvent> {
    const repo = getActivityRepository();
    return repo.append(event);
  }

  /**
   * Get all activity events
   */
  async getEvents(options?: { limit?: number; type?: ActivityEventType }): Promise<ActivityEvent[]> {
    const repo = getActivityRepository();
    return repo.query(options);
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
