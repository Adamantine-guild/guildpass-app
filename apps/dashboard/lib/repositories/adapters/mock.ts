/**
 * Mock in-memory repository adapters for local development.
 * All data persists in-memory for the lifetime of the process.
 * Perfect for local dev; resets on server restart.
 */

import type {
  IPassRepository,
  IGuildRepository,
  IMemberRepository,
  IActivityRepository,
} from "../types";
import type { Pass, Guild, Member, Activity } from "../../mock-data";
import type { ActivityEvent, ActivityEventType } from "@/lib/activity/types";
import { mockPasses, mockGuilds, mockMembers, mockActivity } from "../../mock-data";

const ACTIVITY_TYPE_MAP: Record<Activity["type"], ActivityEventType> = {
  member_joined: "member.joined",
  pass_created: "pass.created",
  pass_purchased: "pass.purchased",
  role_changed: "member.roles_changed",
  access_granted: "access.granted",
};

function toActivityEvent(activity: Activity): ActivityEvent {
  return {
    id: activity.id,
    type: ACTIVITY_TYPE_MAP[activity.type] || "system.info",
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
 * Mock pass repository: in-memory storage.
 */
export class MockPassRepository implements IPassRepository {
  private passes: Map<string, Pass> = new Map();
  private nextId = 5;

  constructor() {
    mockPasses.forEach((p) => this.passes.set(p.id, { ...p }));
  }

  async getAll(): Promise<Pass[]> {
    return Array.from(this.passes.values());
  }

  async getById(id: string): Promise<Pass | null> {
    return this.passes.get(id) ?? null;
  }

  async create(pass: Omit<Pass, "id" | "createdAt">): Promise<Pass> {
    const id = String(this.nextId++);
    const newPass: Pass = {
      ...pass,
      id,
      createdAt: new Date().toISOString(),
    };
    this.passes.set(id, newPass);
    return newPass;
  }

  async update(id: string, pass: Partial<Pass>): Promise<Pass | null> {
    const existing = this.passes.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...pass, id };
    this.passes.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.passes.delete(id);
  }
}

/**
 * Mock guild repository: in-memory storage.
 */
export class MockGuildRepository implements IGuildRepository {
  private guilds: Map<string, Guild> = new Map();
  private nextId = 4;

  constructor() {
    mockGuilds.forEach((g) => this.guilds.set(g.id, { ...g }));
  }

  async getAll(): Promise<Guild[]> {
    return Array.from(this.guilds.values());
  }

  async getById(id: string): Promise<Guild | null> {
    return this.guilds.get(id) ?? null;
  }

  async create(guild: Omit<Guild, "id" | "createdAt">): Promise<Guild> {
    const id = String(this.nextId++);
    const newGuild: Guild = {
      ...guild,
      id,
      createdAt: new Date().toISOString(),
    };
    this.guilds.set(id, newGuild);
    return newGuild;
  }

  async update(id: string, guild: Partial<Guild>): Promise<Guild | null> {
    const existing = this.guilds.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...guild, id };
    this.guilds.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.guilds.delete(id);
  }
}

/**
 * Mock member repository: in-memory storage.
 */
export class MockMemberRepository implements IMemberRepository {
  private members: Map<string, Member> = new Map();
  private walletIndex: Map<string, string> = new Map();
  private nextId = 5;

  constructor() {
    mockMembers.forEach((m) => {
      this.members.set(m.id, { ...m });
      this.walletIndex.set(m.wallet, m.id);
    });
  }

  async getAll(): Promise<Member[]> {
    return Array.from(this.members.values());
  }

  async getById(id: string): Promise<Member | null> {
    return this.members.get(id) ?? null;
  }

  async getByWallet(wallet: string): Promise<Member | null> {
    const id = this.walletIndex.get(wallet);
    return id ? this.members.get(id) ?? null : null;
  }

  async create(member: Omit<Member, "id">): Promise<Member> {
    const id = String(this.nextId++);
    const newMember: Member = { ...member, id };
    this.members.set(id, newMember);
    this.walletIndex.set(member.wallet, id);
    return newMember;
  }

  async update(id: string, member: Partial<Member>): Promise<Member | null> {
    const existing = this.members.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...member, id };
    this.members.set(id, updated);
    if (member.wallet && member.wallet !== existing.wallet) {
      this.walletIndex.delete(existing.wallet);
      this.walletIndex.set(member.wallet, id);
    }
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.members.get(id);
    if (existing) {
      this.walletIndex.delete(existing.wallet);
    }
    return this.members.delete(id);
  }
}

/**
 * Mock activity repository: in-memory, append-only storage.
 */
export class MockActivityRepository implements IActivityRepository {
  private events: ActivityEvent[] = [];
  private processedIds: Set<string> = new Set();

  constructor() {
    mockActivity.forEach((a) => {
      const event = toActivityEvent(a);
      this.events.push(event);
      this.processedIds.add(event.id);
    });
  }

  async append(event: Omit<ActivityEvent, "id" | "timestamp"> & { id?: string; timestamp?: string }): Promise<ActivityEvent> {
    if (event.id && this.processedIds.has(event.id)) {
      // In a real scenario we might throw or return existing, but IActivityRepository.append expects Promise<ActivityEvent>
      return this.events.find(e => e.id === event.id)!;
    }

    const fullEvent: ActivityEvent = {
      ...event,
      id: event.id || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: event.timestamp || new Date().toISOString(),
    };

    this.events.unshift(fullEvent);
    this.processedIds.add(fullEvent.id);

    return fullEvent;
  }

  async query(options?: {
    limit?: number;
    type?: ActivityEvent["type"];
    since?: string;
  }): Promise<ActivityEvent[]> {
    let filtered = [...this.events];

    if (options?.type) {
      filtered = filtered.filter((e) => e.type === options.type);
    }

    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= sinceTime);
    }

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  async hasProcessed(eventId: string): Promise<boolean> {
    return this.processedIds.has(eventId);
  }

  async markProcessed(eventId: string): Promise<boolean> {
    if (this.processedIds.has(eventId)) return false;
    this.processedIds.add(eventId);
    return true;
  }
}
