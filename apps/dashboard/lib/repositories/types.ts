/**
 * Repository interfaces for dashboard entities.
 * Defines contracts for persistence across mock (in-memory) and durable (backend) storage.
 */

import type { Pass, Guild, Member } from "../mock-data";
import type { ActivityEvent } from "@/lib/activity/types";
import type { DashboardSettings } from "../settings";
import type { PaginatedResponse } from "../api-contracts";

/**
 * Input type for appending an activity event.
 * `schemaVersion` defaults to the current version when omitted.
 */
export type ActivityEventInput = Omit<ActivityEvent, "id" | "timestamp" | "schemaVersion"> &
  Partial<Pick<ActivityEvent, "schemaVersion">>;

export interface PaginationOptions {
  limit?: number;
  cursor?: string | null;
  page?: number;
}

export type PaginatedResult<T> = PaginatedResponse<T>;

export interface PassListQuery extends PaginationOptions {
  search?: string;
  status?: Pass["status"] | "all";
}

export interface MemberListQuery extends PaginationOptions {
  search?: string;
  status?: Member["status"] | "all";
  role?: string | "all";
}

/**
 * Create input for a pass. `guildId` is intentionally excluded: the owning
 * guild comes only from the explicit `guildId` scope parameter, so a payload
 * can never assign a record to a different tenant.
 */
export type PassCreateData = Omit<Pass, "id" | "createdAt" | "guildId">;

/**
 * Update input for a pass. `id` and `guildId` are excluded so a patch can
 * never re-identify a record or move it to another tenant.
 */
export type PassUpdateData = Partial<Omit<Pass, "id" | "guildId">>;

/** Create input for a member. See {@link PassCreateData} for the rationale. */
export type MemberCreateData = Omit<Member, "id" | "guildId">;

/** Update input for a member. See {@link PassUpdateData} for the rationale. */
export type MemberUpdateData = Partial<Omit<Member, "id" | "guildId">>;

/**
 * Repository for managing passes.
 *
 * Multi-tenant isolation guarantee: every method requires an explicit
 * `guildId` scope as its first parameter — omitting it is a compile error,
 * not a runtime possibility. Implementations MUST guarantee that a call
 * scoped to guild A can never read, modify, or delete guild B's data, even
 * when given an ID that exists in another guild (such calls behave exactly
 * as if the record does not exist). See docs/multi-tenancy.md.
 */
export interface IPassRepository {
  /**
   * Get all passes belonging to the given guild.
   */
  getAll(guildId: string): Promise<Pass[]>;

  /**
   * Query the guild's passes with filtering and bounded pagination.
   */
  query(guildId: string, options?: PassListQuery): Promise<PaginatedResult<Pass>>;

  /**
   * Get a pass by ID. Returns null when the pass does not exist
   * or belongs to a different guild.
   */
  getById(guildId: string, id: string): Promise<Pass | null>;

  /**
   * Create a new pass owned by the given guild.
   */
  create(guildId: string, pass: PassCreateData): Promise<Pass>;

  /**
   * Update an existing pass. Returns null when the pass does not exist
   * or belongs to a different guild. The owning guild can never change.
   */
  update(guildId: string, id: string, pass: PassUpdateData): Promise<Pass | null>;

  /**
   * Delete a pass. Returns false when the pass does not exist
   * or belongs to a different guild.
   */
  delete(guildId: string, id: string): Promise<boolean>;
}

/**
 * Repository for managing guild settings and metadata.
 */
export interface IGuildRepository {
  /**
   * Get all guilds.
   */
  getAll(): Promise<Guild[]>;

  /**
   * Get a guild by ID.
   */
  getById(id: string): Promise<Guild | null>;

  /**
   * Create a new guild.
   */
  create(guild: Omit<Guild, "id" | "createdAt">): Promise<Guild>;

  /**
   * Update guild settings.
   */
  update(id: string, guild: Partial<Guild>): Promise<Guild | null>;

  /**
   * Delete a guild.
   */
  delete(id: string): Promise<boolean>;
}

/**
 * Repository for managing members.
 *
 * Multi-tenant isolation guarantee: every method requires an explicit
 * `guildId` scope as its first parameter — omitting it is a compile error,
 * not a runtime possibility. Implementations MUST guarantee that a call
 * scoped to guild A can never read, modify, or delete guild B's data, even
 * when given an ID or wallet that exists in another guild (such calls behave
 * exactly as if the record does not exist). See docs/multi-tenancy.md.
 */
export interface IMemberRepository {
  /**
   * Get all members belonging to the given guild.
   */
  getAll(guildId: string): Promise<Member[]>;

  /**
   * Query the guild's members with filtering and bounded pagination.
   */
  query(guildId: string, options?: MemberListQuery): Promise<PaginatedResult<Member>>;

  /**
   * Get a member by ID. Returns null when the member does not exist
   * or belongs to a different guild.
   */
  getById(guildId: string, id: string): Promise<Member | null>;

  /**
   * Get a member of the given guild by wallet address. Returns null when no
   * member with that wallet exists in this guild, even if the same wallet is
   * a member of another guild.
   */
  getByWallet(guildId: string, wallet: string): Promise<Member | null>;

  /**
   * Create a new member owned by the given guild.
   */
  create(guildId: string, member: MemberCreateData): Promise<Member>;

  /**
   * Update a member. Returns null when the member does not exist
   * or belongs to a different guild. The owning guild can never change.
   */
  update(guildId: string, id: string, member: MemberUpdateData): Promise<Member | null>;

  /**
   * Delete a member. Returns false when the member does not exist
   * or belongs to a different guild.
   */
  delete(guildId: string, id: string): Promise<boolean>;
}

/**
 * Repository for managing activity events.
 * Supports append-only semantics for audit trail.
 */
export interface IActivityRepository {
  /**
   * Append an activity event. `schemaVersion` defaults to the current version
   * when omitted.
   */
  append(event: ActivityEventInput): Promise<ActivityEvent>;

  /**
   * Query activity events with optional filtering.
   */
  query(options?: {
    limit?: number;
    type?: ActivityEvent["type"];
    since?: string; // ISO date
  }): Promise<ActivityEvent[]>;

  /**
   * Check if an event was already processed (idempotency).
   */
  hasProcessed(eventId: string): Promise<boolean>;

  /**
   * Mark an event as processed.
   */
  markProcessed(eventId: string): Promise<boolean>;
}

/**
 * Repository for workspace dashboard settings.
 *
 * Settings are a single workspace-level document (not a keyed collection), so
 * the contract is a simple get / partial-update pair rather than CRUD.
 */
export interface ISettingsRepository {
  /** Read the current dashboard settings. */
  get(): Promise<DashboardSettings>;

  /** Merge a partial update into the stored settings and return the result. */
  update(patch: Partial<DashboardSettings>): Promise<DashboardSettings>;
}

/**
 * Factory for creating repository instances based on storage mode.
 */
export interface IRepositoryFactory {
  passRepository(): IPassRepository;
  guildRepository(): IGuildRepository;
  memberRepository(): IMemberRepository;
  activityRepository(): IActivityRepository;
  settingsRepository(): ISettingsRepository;
}
