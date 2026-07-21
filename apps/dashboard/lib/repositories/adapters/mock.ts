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
  ISettingsRepository,
  MemberListQuery,
  PaginatedResult,
  PassListQuery,
} from "../types";
import type { Pass, Guild, Member } from "../../mock-data";
import type { ActivityEvent } from "@/lib/activity/types";
import { CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";
import type { DashboardSettings } from "../../settings";
import { mockPasses, mockGuilds, mockMembers } from "../../mock-data";
import { DEFAULT_SETTINGS } from "../../settings";
import { filterMembers, filterPasses, paginateItems } from "@/lib/pagination";

/**
 * Mock pass repository: in-memory storage.
 */
export class MockPassRepository implements IPassRepository {
  private passes: Map<string, Pass> = new Map();
  private nextId = 5;
  private activityRepo?: IActivityRepository;

  constructor(activityRepo?: IActivityRepository) {
    mockPasses.forEach((p) => this.passes.set(p.id, { ...p }));
    this.activityRepo = activityRepo;
  }

  async getAll(): Promise<Pass[]> {
    return Array.from(this.passes.values());
  }

  async query(options: PassListQuery = {}): Promise<PaginatedResult<Pass>> {
    const filtered = filterPasses(await this.getAll(), options);
    return paginateItems(filtered, options);
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

    // Record activity with structured diff
    const changes = computeDiff({} as Record<string, unknown>, newPass as unknown as Record<string, unknown>);
    await this.recordActivity("pass.created", `New pass created: ${newPass.name}`, newPass, changes);

    return newPass;
  }

  async update(id: string, pass: Partial<Pass>): Promise<Pass | null> {
    const existing = this.passes.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...pass, id };
    this.passes.set(id, updated);

    // Compute diff and record activity
    const changes = computeDiff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    if (changes.length > 0) {
      await this.recordActivity("pass.updated", `Pass updated: ${updated.name}`, updated, changes);
    }

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.passes.get(id);
    const deleted = this.passes.delete(id);
    if (deleted && existing) {
      await this.recordActivity("pass.deleted", `Pass deleted: ${existing.name}`, existing);
    }
    return deleted;
  }

  private async recordActivity(
    type: ActivityEvent["type"],
    description: string,
    entity: Pass,
    changes?: ActivityEvent["changes"],
  ): Promise<void> {
    if (!this.activityRepo) return;
    await this.activityRepo.append({
      type,
      source: "dashboard",
      severity: "info",
      actor: { name: "Admin" },
      description,
      entity: { type: "pass", id: entity.id, name: entity.name },
      changes,
    });
  }
}

/**
 * Mock guild repository: in-memory storage.
 */
export class MockGuildRepository implements IGuildRepository {
  private guilds: Map<string, Guild> = new Map();
  private nextId = 4;
  private activityRepo?: IActivityRepository;

  constructor(activityRepo?: IActivityRepository) {
    mockGuilds.forEach((g) => this.guilds.set(g.id, { ...g }));
    this.activityRepo = activityRepo;
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

    const changes = computeDiff({} as Record<string, unknown>, newGuild as unknown as Record<string, unknown>);
    await this.recordActivity("guild.created", `New guild created: ${newGuild.name}`, newGuild, changes);

    return newGuild;
  }

  async update(id: string, guild: Partial<Guild>): Promise<Guild | null> {
    const existing = this.guilds.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...guild, id };
    this.guilds.set(id, updated);

    const changes = computeDiff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    if (changes.length > 0) {
      await this.recordActivity("guild.updated", `Guild updated: ${updated.name}`, updated, changes);
    }

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.guilds.get(id);
    const deleted = this.guilds.delete(id);
    if (deleted && existing) {
      await this.recordActivity("guild.deleted", `Guild deleted: ${existing.name}`, existing);
    }
    return deleted;
  }

  private async recordActivity(
    type: ActivityEvent["type"],
    description: string,
    entity: Guild,
    changes?: ActivityEvent["changes"],
  ): Promise<void> {
    if (!this.activityRepo) return;
    await this.activityRepo.append({
      type,
      source: "dashboard",
      severity: "info",
      actor: { name: "Admin" },
      description,
      entity: { type: "guild", id: entity.id, name: entity.name },
      changes,
    });
  }
}

/**
 * Mock member repository: in-memory storage.
 */
export class MockMemberRepository implements IMemberRepository {
  private members: Map<string, Member> = new Map();
  private walletIndex: Map<string, string> = new Map();
  private nextId = 5;
  private activityRepo?: IActivityRepository;

  constructor(activityRepo?: IActivityRepository) {
    mockMembers.forEach((m) => {
      this.members.set(m.id, { ...m });
      this.walletIndex.set(m.wallet, m.id);
    });
    this.activityRepo = activityRepo;
  }

  async getAll(): Promise<Member[]> {
    return Array.from(this.members.values());
  }

  async query(options: MemberListQuery = {}): Promise<PaginatedResult<Member>> {
    const filtered = filterMembers(await this.getAll(), options);
    return paginateItems(filtered, options);
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

    const changes = computeDiff({} as Record<string, unknown>, newMember as unknown as Record<string, unknown>);
    await this.recordActivity("member.joined", `${newMember.name} joined`, newMember, changes);

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

    // Compute diff to determine what changed and what event type to emit
    const changes = computeDiff(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    if (changes.length > 0) {
      const hasRoleChange = changes.some((c) => c.field === "roles");
      const eventType: ActivityEvent["type"] = hasRoleChange
        ? "member.roles_changed"
        : "member.left"; // status/other changes use member.left as generic update
      const desc = hasRoleChange
        ? `${updated.name}'s roles changed`
        : `Member ${updated.name} updated`;
      await this.recordActivity(eventType, desc, updated, changes);
    }

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = this.members.get(id);
    if (existing) {
      this.walletIndex.delete(existing.wallet);
    }
    const deleted = this.members.delete(id);
    if (deleted && existing) {
      await this.recordActivity("member.left", `${existing.name} left`, existing);
    }
    return deleted;
  }

  private async recordActivity(
    type: ActivityEvent["type"],
    description: string,
    entity: Member,
    changes?: ActivityEvent["changes"],
  ): Promise<void> {
    if (!this.activityRepo) return;
    await this.activityRepo.append({
      type,
      source: "dashboard",
      severity: "info",
      actor: { name: entity.name, wallet: entity.wallet },
      description,
      entity: { type: "member", id: entity.id, name: entity.name },
      changes,
    });
  }
}

/**
 * Mock activity repository: in-memory, append-only storage.
 */
export class MockActivityRepository implements IActivityRepository {
  private events: ActivityEvent[] = [];
  private processedIds: Set<string> = new Set();

  async append(event: Omit<ActivityEvent, "id" | "timestamp"> & Partial<Pick<ActivityEvent, "schemaVersion">>): Promise<ActivityEvent> {
    const fullEvent: ActivityEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      schemaVersion: event.schemaVersion ?? CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
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

/**
 * Mock settings repository: a single in-memory settings document, seeded from
 * DEFAULT_SETTINGS. Updates merge and persist for the lifetime of the process,
 * so a read after an update reflects the saved values.
 */
export class MockSettingsRepository implements ISettingsRepository {
  private settings: DashboardSettings = { ...DEFAULT_SETTINGS };
  private activityRepo?: IActivityRepository;

  constructor(activityRepo?: IActivityRepository) {
    this.activityRepo = activityRepo;
  }

  async get(): Promise<DashboardSettings> {
    return { ...this.settings };
  }

  async update(patch: Partial<DashboardSettings>): Promise<DashboardSettings> {
    const previous = { ...this.settings };
    this.settings = { ...this.settings, ...patch };

    // Compute field-level diff and record activity
    const changes = computeDiff(
      previous as unknown as Record<string, unknown>,
      this.settings as unknown as Record<string, unknown>,
    );
    if (changes.length > 0 && this.activityRepo) {
      await this.activityRepo.append({
        type: "guild.updated",
        source: "dashboard",
        severity: "info",
        actor: { name: "Admin" },
        description: `Settings updated: ${changes.map((c) => c.field).join(", ")}`,
        entity: { type: "guild", id: "settings", name: this.settings.workspaceName },
        changes,
      });
    }

    return { ...this.settings };
  }
}
