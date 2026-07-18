/**
 * Durable repository adapters for production deployments.
 * Contract: implementations must be server-side only and not expose credentials.
 * 
 * NOTE: Specific backend choice (PostgreSQL, MongoDB, etc.) is implementation-specific.
 * This file provides the interface and placeholder for future backend adapters.
 */

import type {
  IPassRepository,
  IGuildRepository,
  IMemberRepository,
  IActivityRepository,
  ISettingsRepository,
  MemberCreateData,
  MemberListQuery,
  MemberUpdateData,
  PaginatedResult,
  PassCreateData,
  PassListQuery,
  PassUpdateData,
} from "../types";
import type { Pass, Guild, Member } from "../../mock-data";
import type { ActivityEvent } from "@/lib/activity/types";
import type { DashboardSettings } from "../../settings";
import { computeDiff } from "@/lib/activity/diff";

/**
 * Base class for durable repositories.
 * Implementations should handle connection pooling, retries, and error handling.
 */
abstract class DurableRepository {
  protected connectionString: string;
  protected activityRepo?: IActivityRepository;

  constructor(connectionString: string, activityRepo?: IActivityRepository) {
    this.connectionString = connectionString;
    this.activityRepo = activityRepo;
    this.validateConnection();
  }

  protected validateConnection(): void {
    if (!this.connectionString) {
      throw new Error("Database connection string is not configured");
    }
  }

  /**
   * Compute and record a field-level audit diff after a mutation.
   * Subclasses should call this within the same transaction as the write.
   *
   * @param previous Pre-mutation entity state
   * @param next     Post-mutation entity state
   * @param type     Activity event type to emit
   * @param description Human-readable description
   * @param entityType  Entity discriminator for the activity record
   * @param entityId    Entity identifier
   * @param entityName  Optional display name
   */
  protected async recordDiff<T extends Record<string, unknown>>(
    previous: T,
    next: T,
    type: ActivityEvent["type"],
    description: string,
    entityType: "pass" | "guild" | "member",
    entityId: string,
    entityName?: string,
  ): Promise<void> {
    if (!this.activityRepo) return;
    const changes = computeDiff(previous, next);
    if (changes.length === 0) return;
    await this.activityRepo.append({
      type,
      source: "dashboard",
      severity: "info",
      actor: { name: "Admin" },
      description,
      entity: { type: entityType, id: entityId, name: entityName },
      changes,
    });
  }
}

/**
 * Durable pass repository.
 *
 * Backend implementations MUST:
 * - Store connection credentials securely (environment variables only)
 * - Never log sensitive data
 * - Return 404 for missing records, not errors
 * - Handle concurrent writes gracefully
 *
 * Multi-tenant isolation (see docs/multi-tenancy.md):
 * - The `passes` table MUST carry a NOT NULL `guild_id` foreign key
 * - Every statement MUST filter on it (`WHERE guild_id = $1 AND id = $2`) —
 *   never look a record up by `id` alone and compare afterwards
 * - `guild_id` is immutable: INSERT sets it from the scope parameter,
 *   UPDATE must never include it in the SET clause
 * - A scoped query that matches a record in another guild returns
 *   null/false, identical to a missing record
 * - Implementations must pass the isolation contract suites in
 *   apps/dashboard/test/repositories/contracts.ts
 */
export class DurablePassRepository extends DurableRepository implements IPassRepository {
  async getAll(_guildId: string): Promise<Pass[]> {
    // TODO: Implement against selected backend (SELECT ... WHERE guild_id = $1)
    throw new Error("DurablePassRepository not yet implemented. Configure STORAGE_BACKEND in .env");
  }

  async query(_guildId: string, _options: PassListQuery = {}): Promise<PaginatedResult<Pass>> {
    // Durable backends should push search/filter/pagination into indexed
    // queries; every predicate must be ANDed with guild_id = $1.
    throw new Error("DurablePassRepository not yet implemented. Configure STORAGE_BACKEND in .env");
  }

  async getById(_guildId: string, _id: string): Promise<Pass | null> {
    // TODO: SELECT ... WHERE guild_id = $1 AND id = $2
    throw new Error("DurablePassRepository not yet implemented");
  }

  async create(_guildId: string, _pass: PassCreateData): Promise<Pass> {
    // TODO: Implement with transaction support:
    // 1. INSERT into passes table with guild_id from the scope parameter
    // 2. Call this.recordDiff({}, created, "pass.created", desc, "pass", id, name)
    throw new Error("DurablePassRepository not yet implemented");
  }

  async update(_guildId: string, _id: string, _pass: PassUpdateData): Promise<Pass | null> {
    // TODO: Implement with optimistic locking or version column:
    // 1. SELECT ... WHERE guild_id = $1 AND id = $2 FOR UPDATE (or equivalent)
    // 2. Call this.recordDiff(existing, updated, "pass.updated", desc, "pass", id, name)
    // 3. UPDATE (guild_id must never appear in the SET clause)
    throw new Error("DurablePassRepository not yet implemented");
  }

  async delete(_guildId: string, _id: string): Promise<boolean> {
    // TODO: Implement soft-delete pattern for audit trail
    // (DELETE/UPDATE ... WHERE guild_id = $1 AND id = $2)
    throw new Error("DurablePassRepository not yet implemented");
  }
}

/**
 * Durable guild repository.
 * 
 * Backend implementations MUST maintain guild settings durability
 * and support atomic updates to member/pass counts.
 */
export class DurableGuildRepository extends DurableRepository implements IGuildRepository {
  async getAll(): Promise<Guild[]> {
    throw new Error("DurableGuildRepository not yet implemented");
  }

  async getById(_id: string): Promise<Guild | null> {
    throw new Error("DurableGuildRepository not yet implemented");
  }

  async create(_guild: Omit<Guild, "id" | "createdAt">): Promise<Guild> {
    throw new Error("DurableGuildRepository not yet implemented");
  }

  async update(_id: string, _guild: Partial<Guild>): Promise<Guild | null> {
    throw new Error("DurableGuildRepository not yet implemented");
  }

  async delete(_id: string): Promise<boolean> {
    throw new Error("DurableGuildRepository not yet implemented");
  }
}

/**
 * Durable member repository.
 *
 * Backend implementations MUST:
 * - Maintain wallet uniqueness per guild (composite constraint on
 *   (guild_id, wallet) — the same wallet may join multiple guilds)
 * - Support efficient lookups by wallet for verification flows
 * - Track member status changes for audit purposes
 *
 * Multi-tenant isolation (see docs/multi-tenancy.md):
 * - The `members` table MUST carry a NOT NULL `guild_id` foreign key
 * - Every statement MUST filter on it (`WHERE guild_id = $1 AND ...`) —
 *   never look a record up by `id` or `wallet` alone and compare afterwards
 * - `guild_id` is immutable: INSERT sets it from the scope parameter,
 *   UPDATE must never include it in the SET clause
 * - A scoped query that matches a record in another guild returns
 *   null/false, identical to a missing record
 * - Implementations must pass the isolation contract suites in
 *   apps/dashboard/test/repositories/contracts.ts
 */
export class DurableMemberRepository extends DurableRepository implements IMemberRepository {
  async getAll(_guildId: string): Promise<Member[]> {
    // TODO: SELECT ... WHERE guild_id = $1
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async query(_guildId: string, _options: MemberListQuery = {}): Promise<PaginatedResult<Member>> {
    // Durable backends should push search/filter/pagination into indexed
    // queries; every predicate must be ANDed with guild_id = $1.
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async getById(_guildId: string, _id: string): Promise<Member | null> {
    // TODO: SELECT ... WHERE guild_id = $1 AND id = $2
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async getByWallet(_guildId: string, _wallet: string): Promise<Member | null> {
    // High-traffic operation; should be indexed on (guild_id, wallet)
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async create(_guildId: string, _member: MemberCreateData): Promise<Member> {
    // TODO: Within transaction — INSERT with guild_id from the scope parameter,
    // then this.recordDiff({}, created, "member.joined", desc, "member", id, name)
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async update(_guildId: string, _id: string, _member: MemberUpdateData): Promise<Member | null> {
    // TODO: Within transaction — SELECT ... WHERE guild_id = $1 AND id = $2
    // FOR UPDATE, compute diff via
    // this.recordDiff(existing, updated, eventType, desc, "member", id, name),
    // then UPDATE (guild_id must never appear in the SET clause).
    // Use member.roles_changed when roles differ, otherwise member.left.
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async delete(_guildId: string, _id: string): Promise<boolean> {
    // TODO: DELETE ... WHERE guild_id = $1 AND id = $2
    throw new Error("DurableMemberRepository not yet implemented");
  }
}

/**
 * Durable activity repository.
 * 
 * Backend implementations MUST:
 * - Use append-only pattern for audit integrity
 * - Guarantee idempotency via event ID uniqueness constraint
 * - Support efficient queries by type and timestamp
 * - Keep raw JSON metadata for future schema evolution
 */
export class DurableActivityRepository extends DurableRepository implements IActivityRepository {
  async append(_event: Omit<ActivityEvent, "id" | "timestamp" | "schemaVersion"> & Partial<Pick<ActivityEvent, "schemaVersion">>): Promise<ActivityEvent> {
    throw new Error("DurableActivityRepository not yet implemented");
  }

  async query(_options?: {
    limit?: number;
    type?: ActivityEvent["type"];
    since?: string;
  }): Promise<ActivityEvent[]> {
    throw new Error("DurableActivityRepository not yet implemented");
  }

  async hasProcessed(_eventId: string): Promise<boolean> {
    throw new Error("DurableActivityRepository not yet implemented");
  }

  async markProcessed(_eventId: string): Promise<boolean> {
    throw new Error("DurableActivityRepository not yet implemented");
  }
}

/**
 * Durable settings repository.
 *
 * Backend implementations MUST:
 * - Persist the single settings document per workspace
 * - Never store secret values in this public settings model
 */
export class DurableSettingsRepository extends DurableRepository implements ISettingsRepository {
  async get(): Promise<DashboardSettings> {
    throw new Error("DurableSettingsRepository not yet implemented. Configure STORAGE_BACKEND in .env");
  }

  async update(_patch: Partial<DashboardSettings>): Promise<DashboardSettings> {
    // TODO: Within transaction — read current, apply patch, call
    // this.recordDiff(previous, updated, "guild.updated", desc, "guild", "settings", name),
    // then write back.
    throw new Error("DurableSettingsRepository not yet implemented");
  }
}
