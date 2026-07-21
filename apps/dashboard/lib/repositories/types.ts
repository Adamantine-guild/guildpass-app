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
export type ActivityEventInput = Omit<ActivityEvent, "id" | "timestamp"> &
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
<<<<<<< HEAD
=======
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

/** Create input for a member. See {@link PassCreateData} for the rationale.
 * `version` is excluded — the server always initializes it to 1. */
export type MemberCreateData = Omit<Member, "id" | "guildId" | "version">;

/** Update input for a member. See {@link PassUpdateData} for the rationale. */
export type MemberUpdateData = Partial<Omit<Member, "id" | "guildId">>;

/**
>>>>>>> main
 * Repository for managing passes.
 */
export interface IPassRepository {
  /**
   * Get all passes.
   */
  getAll(): Promise<Pass[]>;

  /**
   * Query passes with filtering and bounded pagination.
   */
  query(options?: PassListQuery): Promise<PaginatedResult<Pass>>;

  /**
   * Get a pass by ID.
   */
  getById(id: string): Promise<Pass | null>;

  /**
   * Create a new pass.
   */
  create(pass: Omit<Pass, "id" | "createdAt">): Promise<Pass>;

  /**
   * Update an existing pass.
   */
  update(id: string, pass: Partial<Pass>): Promise<Pass | null>;

  /**
   * Delete a pass.
   */
  delete(id: string): Promise<boolean>;
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
 */
export interface IMemberRepository {
  /**
   * Get all members.
   */
  getAll(): Promise<Member[]>;

  /**
   * Query members with filtering and bounded pagination.
   */
  query(options?: MemberListQuery): Promise<PaginatedResult<Member>>;

  /**
   * Get a member by ID.
   */
  getById(id: string): Promise<Member | null>;

  /**
   * Get a member by wallet address.
   */
  getByWallet(wallet: string): Promise<Member | null>;

  /**
   * Create a new member.
   */
  create(member: Omit<Member, "id">): Promise<Member>;

  /**
<<<<<<< HEAD
   * Update a member.
   */
  update(id: string, member: Partial<Member>): Promise<Member | null>;
=======
   * Update a member. Returns null when the member does not exist
   * or belongs to a different guild. The owning guild can never change.
   *
   * When `expectedVersion` is provided the update is only applied when the
   * stored version matches — a mismatch results in a thrown ConflictError
   * rather than a silent overwrite.
   */
  update(guildId: string, id: string, member: MemberUpdateData, expectedVersion?: number): Promise<Member | null>;
>>>>>>> main

  /**
   * Delete a member.
   */
<<<<<<< HEAD
  delete(id: string): Promise<boolean>;
=======
  delete(guildId: string, id: string): Promise<boolean>;

  /**
   * Stream all members for a guild in bounded-size chunks.
   *
   * The async iterator yields pages internally (cursor-based when backed by
   * a database); callers simply iterate without managing cursors. Never
   * materializes the full result set — each page is fetched on demand so
   * memory usage stays proportional to `chunkSize`, not the total count.
   */
  streamAll(guildId: string, chunkSize?: number): AsyncIterable<Member[]>;
>>>>>>> main
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
