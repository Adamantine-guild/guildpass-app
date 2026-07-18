/**
 * Durable repository adapters for production deployments.
 * Contract: implementations must be server-side only and not expose credentials.
 *
 * NOTE: Specific backend choice (PostgreSQL, MongoDB, etc.) is implementation-specific.
 * This file provides the interface and placeholder for future backend adapters.
 *
 * ── Count-maintenance decision (issue #136) ──────────────────────────────────
 * Guild.memberCount / Guild.passCount are DERIVED AT READ, not maintained
 * incrementally. On every getAll / getById the guild record's counts are
 * recomputed from the injected member and pass repositories, which are the
 * source of truth. Rationale:
 *
 *   - Correct by construction. A denormalized counter maintained by hand can
 *     drift if any write path forgets to update it or if two concurrent
 *     create/delete operations interleave. Deriving the value on read makes
 *     drift impossible: the number is always whatever the member/pass repos
 *     actually contain.
 *   - The Member and Pass types carry no guildId foreign key (see mock-data.ts):
 *     this dashboard models a single workspace, so a guild's counts reflect the
 *     total membership / pass supply of the workspace. There is no per-guild
 *     partition to sum, which makes read-time derivation both simple and exact.
 *   - Tradeoff: each read pays for a getAll on members and passes. For the
 *     in-memory adapter this is an O(n) Map scan and negligible. A future SQL
 *     backend can swap this for an indexed COUNT(*) or a maintained counter
 *     without changing the public contract.
 *
 * Writes to the guild store (create / update / delete) are serialized through a
 * per-instance async mutex so concurrent mutations cannot interleave and leave a
 * guild record half-written. Because counts are derived rather than stored, the
 * mutex protects only the guild record itself, not the counters.
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
import { DEFAULT_SETTINGS } from "../../settings";
import { validateSettingsPatch, type FieldError } from "@/lib/validation/settings";
import { computeDiff } from "@/lib/activity/diff";

/**
 * Thrown when a settings write is rejected by repository-boundary validation.
 * Carries the same field-level error shape the API route surfaces, so a caller
 * can translate it into a 400 response without re-validating.
 */
export class SettingsValidationError extends Error {
  readonly errors: FieldError[];
  constructor(errors: FieldError[]) {
    super("Settings validation failed at the repository boundary.");
    this.name = "SettingsValidationError";
    this.errors = errors;
  }
}

/**
 * Minimal FIFO async mutex. Serializes async critical sections so that
 * concurrent create/update/delete calls run one-at-a-time and cannot interleave.
 * No timers, no external deps: each acquirer awaits the previous release.
 */
class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  /** Run `fn` exclusively; callers are served in the order they arrive. */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    // Chain onto the current tail, then expose a fresh barrier as the new tail.
    let release!: () => void;
    const next = new Promise<void>((resolve) => (release = resolve));
    const prior = this.tail;
    this.tail = prior.then(() => next);
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

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
 * Implemented with a shared in-memory store and a FIFO async mutex that
 * serializes writes, so concurrent create/delete operations cannot corrupt the
 * guild record. member/pass counts are derived at read time from the injected
 * member and pass repositories (see the file header for the full rationale), so
 * they are always consistent with the underlying data and cannot drift.
 *
 * The member and pass repositories are optional constructor dependencies. When
 * they are absent, the stored count on the guild record is returned unchanged
 * (used only where a live count is unavailable).
 */
export class DurableGuildRepository extends DurableRepository implements IGuildRepository {
  private guilds: Map<string, Guild> = new Map();
  private nextId = 1;
  private readonly writeLock = new AsyncMutex();
  private readonly memberRepo?: IMemberRepository;
  private readonly passRepo?: IPassRepository;

  constructor(
    connectionString: string,
    activityRepo?: IActivityRepository,
    deps?: { memberRepo?: IMemberRepository; passRepo?: IPassRepository; seed?: Guild[] },
  ) {
    super(connectionString, activityRepo);
    this.memberRepo = deps?.memberRepo;
    this.passRepo = deps?.passRepo;
    if (deps?.seed) {
      for (const g of deps.seed) this.guilds.set(g.id, { ...g });
      this.nextId = this.guilds.size + 1;
    }
  }

  /**
   * Return a copy of `guild` with memberCount / passCount recomputed from the
   * source-of-truth repositories. Falls back to the stored values when a repo
   * is not wired up.
   */
  private async withDerivedCounts(guild: Guild): Promise<Guild> {
    const [memberCount, passCount] = await Promise.all([
      this.memberRepo ? this.memberRepo.getAll().then((m) => m.length) : Promise.resolve(guild.memberCount),
      this.passRepo ? this.passRepo.getAll().then((p) => p.length) : Promise.resolve(guild.passCount),
    ]);
    return { ...guild, memberCount, passCount };
  }

  async getAll(): Promise<Guild[]> {
    const stored = Array.from(this.guilds.values());
    return Promise.all(stored.map((g) => this.withDerivedCounts(g)));
  }

  async getById(id: string): Promise<Guild | null> {
    const guild = this.guilds.get(id);
    if (!guild) return null;
    return this.withDerivedCounts(guild);
  }

  async create(guild: Omit<Guild, "id" | "createdAt">): Promise<Guild> {
    return this.writeLock.runExclusive(async () => {
      const id = String(this.nextId++);
      const newGuild: Guild = { ...guild, id, createdAt: new Date().toISOString() };
      this.guilds.set(id, newGuild);
      await this.recordDiff(
        {} as Record<string, unknown>,
        newGuild as unknown as Record<string, unknown>,
        "guild.created",
        `New guild created: ${newGuild.name}`,
        "guild",
        id,
        newGuild.name,
      );
      return this.withDerivedCounts(newGuild);
    });
  }

  async update(id: string, guild: Partial<Guild>): Promise<Guild | null> {
    return this.writeLock.runExclusive(async () => {
      const existing = this.guilds.get(id);
      if (!existing) return null;
      // id is immutable; counts are derived, so ignore any attempt to set them.
      const { memberCount: _mc, passCount: _pc, ...patch } = guild;
      const updated: Guild = { ...existing, ...patch, id };
      this.guilds.set(id, updated);
      await this.recordDiff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
        "guild.updated",
        `Guild updated: ${updated.name}`,
        "guild",
        id,
        updated.name,
      );
      return this.withDerivedCounts(updated);
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.writeLock.runExclusive(async () => {
      const existing = this.guilds.get(id);
      const deleted = this.guilds.delete(id);
      if (deleted && existing) {
        await this.recordDiff(
          existing as unknown as Record<string, unknown>,
          {} as Record<string, unknown>,
          "guild.deleted",
          `Guild deleted: ${existing.name}`,
          "guild",
          id,
          existing.name,
        );
      }
      return deleted;
    });
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

  async *streamAll(_guildId: string, _chunkSize?: number): AsyncIterable<Member[]> {
    // TODO: Use keyset/cursor pagination (ORDER BY id LIMIT $1) in a loop.
    // Each iteration fetches one page and yields it, so the full result set
    // is never held in memory.  Example pattern:
    //   let cursor: string | null = null;
    //   do {
    //     const page = await this.query(guildId, { cursor, limit: _chunkSize ?? 500 });
    //     yield page.items;
    //     cursor = page.nextCursor;
    //   } while (cursor);
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
 * Persists the single workspace settings document in a shared in-memory store,
 * seeded from DEFAULT_SETTINGS, and serializes updates through a FIFO async
 * mutex so concurrent patches cannot interleave into a half-applied document.
 *
 * ── Repository-boundary validation (issue #139) ──────────────────────────────
 * Every update is validated with validateSettingsPatch BEFORE it touches the
 * store — the same validator the PATCH /api/settings route uses. Enforcing it
 * here, not only in the route, means any caller (a future job, a different
 * transport, a direct repository consumer) gets the same guarantees. Invalid
 * patches throw SettingsValidationError carrying field-level errors; the store
 * is left untouched. Only the validator's sanitized `value` is merged, so
 * unknown / passthrough keys from the raw input never reach the persisted
 * document.
 *
 * ── Secret-field extension point ─────────────────────────────────────────────
 * DashboardSettings holds PUBLIC settings only (see lib/settings.ts). Secret
 * values (e.g. an API key) must NOT be added to that model. When a secret is
 * introduced later it belongs in a SEPARATE, write-only store — see the
 * `writeSecret` seam below, which is intentionally left unimplemented so the
 * schema decision (public document here, secrets elsewhere and write-only) is
 * explicit rather than accidental. A production backend should back this with a
 * distinct table/column that is never returned by `get`.
 */
export class DurableSettingsRepository extends DurableRepository implements ISettingsRepository {
  private settings: DashboardSettings = { ...DEFAULT_SETTINGS };
  private readonly writeLock = new AsyncMutex();

  async get(): Promise<DashboardSettings> {
    // Return a copy so callers cannot mutate the stored document by reference.
    return { ...this.settings };
  }

  async update(patch: Partial<DashboardSettings>): Promise<DashboardSettings> {
    return this.writeLock.runExclusive(async () => {
      // Validate at the repository boundary using the shared validator. This is
      // the same check the API route runs, so the guarantee holds for every
      // caller, not just HTTP requests.
      const result = validateSettingsPatch(patch);
      if (!result.ok) {
        throw new SettingsValidationError(result.errors);
      }

      const previous = { ...this.settings };
      // Merge only the validator's sanitized value — never the raw input.
      this.settings = { ...this.settings, ...result.value };

      await this.recordDiff(
        previous as unknown as Record<string, unknown>,
        this.settings as unknown as Record<string, unknown>,
        "guild.updated",
        `Settings updated: ${Object.keys(result.value).join(", ")}`,
        "guild",
        "settings",
        this.settings.workspaceName,
      );

      return { ...this.settings };
    });
  }

  /**
   * Extension seam for future write-only secret fields (issue #139 acceptance
   * criterion 3). Secrets are deliberately NOT part of DashboardSettings and
   * must never be readable via `get`. A production backend should implement this
   * against a separate, write-only store (e.g. an encrypted column or a secrets
   * manager) and expose no corresponding read method here.
   *
   * Left unimplemented on purpose: it documents where secrets go without
   * inventing a store the project has not yet chosen.
   */
  protected async writeSecret(_key: string, _value: string): Promise<void> {
    throw new Error(
      "Write-only secret storage is not implemented. Add a dedicated, " +
        "server-side, write-only store before persisting secret settings.",
    );
  }
  async update(_patch: Partial<DashboardSettings>): Promise<DashboardSettings> {
    // TODO: Within transaction — read current, apply patch, call
    // this.recordDiff(previous, updated, "guild.updated", desc, "guild", "settings", name),
    // then write back.
    throw new Error("DurableSettingsRepository not yet implemented");
  }
}