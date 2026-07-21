import crypto from "crypto";
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
  MemberListQuery,
  PaginatedResult,
  PassListQuery,
} from "../types";
import type { Pass, Guild, Member } from "../../mock-data";
import type { ActivityEvent } from "@/lib/activity/types";
import type { DashboardSettings } from "../../settings";
import { DEFAULT_SETTINGS } from "../../settings";
import { validateSettingsPatch, type FieldError, type SettingsPatchPayload } from "@/lib/validation/settings";
import { computeDiff } from "@/lib/activity/diff";
import { ConflictError } from "@/lib/api-errors";

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
 */
export class DurablePassRepository extends DurableRepository implements IPassRepository {
  async getAll(): Promise<Pass[]> {
    // TODO: Implement against selected backend
    throw new Error("DurablePassRepository not yet implemented. Configure STORAGE_BACKEND in .env");
  }

  async query(_options: PassListQuery = {}): Promise<PaginatedResult<Pass>> {
    // Durable backends should push search/filter/pagination into indexed queries.
    throw new Error("DurablePassRepository not yet implemented. Configure STORAGE_BACKEND in .env");
  }

  async getById(_id: string): Promise<Pass | null> {
    throw new Error("DurablePassRepository not yet implemented");
  }

  async create(_pass: Omit<Pass, "id" | "createdAt">): Promise<Pass> {
    // TODO: Implement with transaction support:
    // 1. INSERT into passes table
    // 2. Call this.recordDiff({}, created, "pass.created", desc, "pass", id, name)
    throw new Error("DurablePassRepository not yet implemented");
  }

  async update(_id: string, _pass: Partial<Pass>): Promise<Pass | null> {
    // TODO: Implement with optimistic locking or version column:
    // 1. SELECT ... FOR UPDATE (or equivalent)
    // 2. Call this.recordDiff(existing, updated, "pass.updated", desc, "pass", id, name)
    // 3. UPDATE
    throw new Error("DurablePassRepository not yet implemented");
  }

  async delete(_id: string): Promise<boolean> {
    // TODO: Implement soft-delete pattern for audit trail
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
      this.memberRepo ? this.memberRepo.getAll(guild.id).then((m) => m.length) : Promise.resolve(guild.memberCount),
      this.passRepo ? this.passRepo.getAll(guild.id).then((p) => p.length) : Promise.resolve(guild.passCount),
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
 * - Maintain wallet uniqueness constraint
 * - Support efficient lookups by wallet for verification flows
 * - Track member status changes for audit purposes
 */
export class DurableMemberRepository extends DurableRepository implements IMemberRepository {
<<<<<<< HEAD
  async getAll(): Promise<Member[]> {
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async query(_options: MemberListQuery = {}): Promise<PaginatedResult<Member>> {
    // Durable backends should push search/filter/pagination into indexed queries.
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async getById(_id: string): Promise<Member | null> {
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async getByWallet(_wallet: string): Promise<Member | null> {
    // High-traffic operation; should be indexed
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async create(_member: Omit<Member, "id">): Promise<Member> {
    // TODO: Within transaction — INSERT, then this.recordDiff({}, created, "member.joined", desc, "member", id, name)
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async update(_id: string, _member: Partial<Member>): Promise<Member | null> {
    // TODO: Within transaction — SELECT FOR UPDATE, compute diff via
    // this.recordDiff(existing, updated, eventType, desc, "member", id, name),
    // then UPDATE. Use member.roles_changed when roles differ, otherwise member.left.
    throw new Error("DurableMemberRepository not yet implemented");
  }

  async delete(_id: string): Promise<boolean> {
    throw new Error("DurableMemberRepository not yet implemented");
=======
  private members: Map<string, Member> = new Map();
  private walletIndex: Map<string, string> = new Map();
  private nextId = 1;
  private readonly writeLock = new AsyncMutex();

  constructor(
    connectionString: string,
    activityRepo?: IActivityRepository,
    deps?: { seed?: Member[] },
  ) {
    super(connectionString, activityRepo);
    if (deps?.seed) {
      for (const m of deps.seed) {
        this.members.set(m.id, { ...m });
        this.walletIndex.set(this.walletKey(m.guildId, m.wallet), m.id);
      }
      this.nextId = this.members.size + 1;
    }
  }

  /** Composite wallet-index key: wallets are unique per guild, not globally. */
  private walletKey(guildId: string, wallet: string): string {
    return `${guildId}::${wallet}`;
  }

  /** Resolve a member only if it belongs to the given guild. */
  private getScoped(guildId: string, id: string): Member | null {
    const member = this.members.get(id);
    return member && member.guildId === guildId ? member : null;
  }

  async getAll(guildId: string): Promise<Member[]> {
    return Array.from(this.members.values()).filter((m) => m.guildId === guildId);
  }

  async query(guildId: string, options: MemberListQuery = {}): Promise<PaginatedResult<Member>> {
    const { filterMembers, paginateItems } = await import("@/lib/pagination");
    const filtered = filterMembers(await this.getAll(guildId), options);
    return paginateItems(filtered, options);
  }

  async getById(guildId: string, id: string): Promise<Member | null> {
    return this.getScoped(guildId, id);
  }

  async getByWallet(guildId: string, wallet: string): Promise<Member | null> {
    const id = this.walletIndex.get(this.walletKey(guildId, wallet));
    return id ? this.getScoped(guildId, id) : null;
  }

  async create(guildId: string, member: MemberCreateData): Promise<Member> {
    return this.writeLock.runExclusive(async () => {
      const id = String(this.nextId++);
      const newMember: Member = { ...member, id, guildId, version: 1 };
      this.members.set(id, newMember);
      this.walletIndex.set(this.walletKey(guildId, member.wallet), id);

      await this.recordDiff(
        {} as Record<string, unknown>,
        newMember as unknown as Record<string, unknown>,
        "member.joined",
        `${newMember.name} joined`,
        "member",
        id,
        newMember.name,
      );

      return newMember;
    });
  }

  async update(
    guildId: string,
    id: string,
    member: MemberUpdateData,
    expectedVersion?: number,
  ): Promise<Member | null> {
    return this.writeLock.runExclusive(async () => {
      const existing = this.getScoped(guildId, id);
      if (!existing) return null;

      // Optimistic concurrency control: reject if version doesn't match
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new ConflictError(
          "This member was updated elsewhere — refresh and retry.",
        );
      }

      const updated: Member = {
        ...existing,
        ...member,
        id,
        guildId: existing.guildId,
        version: existing.version + 1,
      };
      this.members.set(id, updated);
      if (member.wallet && member.wallet !== existing.wallet) {
        this.walletIndex.delete(this.walletKey(existing.guildId, existing.wallet));
        this.walletIndex.set(this.walletKey(existing.guildId, member.wallet), id);
      }

      const changes = computeDiff(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      );
      if (changes.length > 0) {
        const hasRoleChange = changes.some((c) => c.field === "roles");
        const eventType: ActivityEvent["type"] = hasRoleChange
          ? "member.roles_changed"
          : "member.left";
        const desc = hasRoleChange
          ? `${updated.name}'s roles changed`
          : `Member ${updated.name} updated`;
        await this.recordDiff(
          existing as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
          eventType,
          desc,
          "member",
          id,
          updated.name,
        );
      }

      return updated;
    });
  }

  async delete(guildId: string, id: string): Promise<boolean> {
    return this.writeLock.runExclusive(async () => {
      const existing = this.getScoped(guildId, id);
      if (!existing) return false;
      this.walletIndex.delete(this.walletKey(existing.guildId, existing.wallet));
      const deleted = this.members.delete(id);
      if (deleted) {
        await this.recordDiff(
          existing as unknown as Record<string, unknown>,
          {} as Record<string, unknown>,
          "member.left",
          `${existing.name} left`,
          "member",
          id,
          existing.name,
        );
      }
      return deleted;
    });
  }

  async *streamAll(guildId: string, chunkSize = 500): AsyncIterable<Member[]> {
    const members = Array.from(this.members.values()).filter(
      (m) => m.guildId === guildId,
    );

    for (let i = 0; i < members.length; i += chunkSize) {
      yield members.slice(i, i + chunkSize);
    }
>>>>>>> main
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
  async append(_event: Omit<ActivityEvent, "id" | "timestamp"> & Partial<Pick<ActivityEvent, "schemaVersion">>): Promise<ActivityEvent> {
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
  private encryptedSecrets: Map<string, string> = new Map();
  private readonly writeLock = new AsyncMutex();

  async get(): Promise<DashboardSettings> {
    const response: DashboardSettings = { ...this.settings };
    if (this.encryptedSecrets.has("webhookForwardingSecret")) {
      response.webhookForwardingSecret = { isSet: true, maskedValue: "••••••••" };
    }
    return response;
  }

  async update(patch: SettingsPatchPayload | Partial<DashboardSettings>): Promise<DashboardSettings> {
    return this.writeLock.runExclusive(async () => {
      const result = validateSettingsPatch(patch);
      if (!result.ok) {
        throw new SettingsValidationError(result.errors);
      }

      const previous = { ...this.settings };
      const { webhookForwardingSecret, ...publicPatch } = result.value;

      if (webhookForwardingSecret !== undefined) {
         if (webhookForwardingSecret !== null && webhookForwardingSecret !== "") {
             const encrypted = this.encryptSecret(webhookForwardingSecret);
             await this.writeSecret("webhookForwardingSecret", encrypted);
         } else {
             this.encryptedSecrets.delete("webhookForwardingSecret");
         }
      }

      this.settings = { ...this.settings, ...publicPatch } as DashboardSettings;

      await this.recordDiff(
        previous as unknown as Record<string, unknown>,
        this.settings as unknown as Record<string, unknown>,
        "guild.updated",
        `Settings updated: ${Object.keys(result.value).join(", ")}`,
        "guild",
        "settings",
        this.settings.workspaceName,
      );

      return this.get();
    });
  }

  protected async writeSecret(key: string, value: string): Promise<void> {
    this.encryptedSecrets.set(key, value);
  }

  private encryptSecret(plaintext: string): string {
    const algo = "aes-256-gcm";
    const rawKey = process.env.SETTINGS_ENCRYPTION_KEY || "default_dev_key_only";
    // Ensure exact 32-byte derivation
    const key = crypto.createHash("sha256").update(rawKey).digest();

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(algo, key, iv);
    let ciphertext = cipher.update(plaintext, "utf8", "base64");
    ciphertext += cipher.final("base64");
    const authTag = cipher.getAuthTag().toString("base64");

    return JSON.stringify({
      iv: iv.toString("base64"),
      authTag,
      ciphertext
    });
  }
}
