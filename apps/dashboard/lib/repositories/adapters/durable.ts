import crypto from "crypto";

/**
 * Generate a unique event ID using crypto.randomUUID (available in Node 18+).
 * Falls back to Math.random-based ID if unavailable.
 */
function generateEventId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Durable repository adapters for production deployments.
 * Backed by PostgreSQL with fallback to in-memory mock storage if the connection string is "mock://conn".
 *
 * Contract: implementations must be server-side only and not expose credentials.
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
  ActivityEventInput,
} from "../types";
import type { Pass, Guild, Member } from "../../mock-data";
import { DEFAULT_GUILD_ID } from "../../mock-data";
import type { ActivityEvent } from "@/lib/activity/types";
import { CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";
import type { DashboardSettings } from "../../settings";
import { DEFAULT_SETTINGS } from "../../settings";
import {
  validateSettingsPatch,
  type FieldError,
  type SettingsPatchPayload,
} from "@/lib/validation/settings";
import { computeDiff } from "@/lib/activity/diff";
import { ConflictError } from "@/lib/api-errors";
import { query, withTransaction } from "../../db";

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
 * Implementations handle connection check and mock fallback check.
 */
abstract class DurableRepository {
  protected connectionString: string;
  protected activityRepo?: IActivityRepository;
  protected isMock: boolean;

  constructor(connectionString: string, activityRepo?: IActivityRepository) {
    this.connectionString = connectionString;
    this.activityRepo = activityRepo;
    this.isMock = !connectionString || connectionString.startsWith("mock://");
    this.validateConnection();
  }

  protected validateConnection(): void {
    if (!this.connectionString) {
      throw new Error("Database connection string is not configured");
    }
  }

  /**
   * Compute and record a field-level audit diff after a mutation.
   */
  protected async recordDiff(
    guildId: string,
    previous: Record<string, unknown> | object,
    next: Record<string, unknown> | object,
    type: ActivityEvent["type"],
    description: string,
    entityType: "pass" | "guild" | "member",
    entityId: string,
    entityName?: string,
  ): Promise<void> {
    if (!this.activityRepo) return;
    const previousRecord = previous as Record<string, unknown>;
    const nextRecord = next as Record<string, unknown>;
    const changes = computeDiff(previousRecord, nextRecord);
    if (changes.length === 0 && Object.keys(previousRecord).length > 0) return;
    await this.activityRepo.append(guildId, {
      type,
      source: "dashboard",
      severity: "info",
      actor: { name: "Admin" },
      description,
      entity: { type: entityType, id: entityId, name: entityName },
      changes: changes.length > 0 ? changes : undefined,
    });
  }
}

// ── Mapping Helpers ─────────────────────────────────────────────────────────

function rowToPass(row: any): Pass {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    status: row.status,
    price: row.price !== null ? Number(row.price) : undefined,
    maxSupply: row.max_supply !== null ? Number(row.max_supply) : null,
    currentSupply: Number(row.current_supply),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

function rowToGuild(row: any): Guild {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    memberCount: Number(row.member_count),
    passCount: Number(row.pass_count),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

function rowToMember(row: any): Member {
  return {
    id: row.id,
    guildId: row.guild_id,
    wallet: row.wallet,
    name: row.name,
    status: row.status,
    roles: Array.isArray(row.roles) ? row.roles : [],
    joinedAt:
      row.joined_at instanceof Date
        ? row.joined_at.toISOString()
        : String(row.joined_at),
    lastActive:
      row.last_active instanceof Date
        ? row.last_active.toISOString()
        : String(row.last_active),
    version: Number(row.version),
  };
}

function rowToActivityEvent(row: any): ActivityEvent {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    severity: row.severity,
    actor: typeof row.actor === "string" ? JSON.parse(row.actor) : row.actor,
    timestamp:
      row.timestamp instanceof Date
        ? row.timestamp.toISOString()
        : String(row.timestamp),
    description: row.description,
    entity:
      typeof row.entity === "string" ? JSON.parse(row.entity) : row.entity,
    metadata:
      typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata,
    changes:
      typeof row.changes === "string" ? JSON.parse(row.changes) : row.changes,
    schemaVersion: Number(row.schema_version),
  };
}

function rowToSettings(row: any): DashboardSettings {
  const settings: DashboardSettings = {
    workspaceName: row.workspace_name,
    timezone: row.timezone,
    displayName: row.display_name,
    email: row.email,
  };
  if (row.webhook_forwarding_secret) {
    settings.webhookForwardingSecret = {
      isSet: true,
      maskedValue: "••••••••",
    };
  }
  return settings;
}

// Duplicate generateEventId removed – use implementation defined earlier



// ── Pass Repository ─────────────────────────────────────────────────────────

export class DurablePassRepository
  extends DurableRepository
  implements IPassRepository
{
  private passes: Map<string, Pass> = new Map();
  private nextId = 1;

  async getAll(guildId: string): Promise<Pass[]> {
    if (this.isMock) {
      return Array.from(this.passes.values()).filter(
        (p) => p.guildId === guildId,
      );
    }
    const result = await query(
      "SELECT * FROM passes WHERE guild_id = $1 ORDER BY created_at DESC",
      [guildId],
    );
    return result.rows.map(rowToPass);
  }

  async query(
    guildId: string,
    options: PassListQuery = {},
  ): Promise<PaginatedResult<Pass>> {
    if (this.isMock) {
      const { filterPasses, paginateItems } = await import("@/lib/pagination");
      const filtered = filterPasses(await this.getAll(guildId), options);
      return paginateItems(filtered, options);
    }

    const conditions: string[] = ["guild_id = $1"];
    const params: any[] = [guildId];
    let paramIdx = 2;

    if (options.search) {
      conditions.push(
        `(name ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`,
      );
      params.push(`%${options.search}%`);
      paramIdx++;
    }

    if (options.status && options.status !== "all") {
      conditions.push(`status = $${paramIdx}`);
      params.push(options.status);
      paramIdx++;
    }

    const where = conditions.join(" AND ");
    const countResult = await query(
      `SELECT COUNT(*)::integer as count FROM passes WHERE ${where}`,
      params,
    );
    const total = countResult.rows[0].count;

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const page = Math.max(options.page ?? 1, 1);
    const offset = (page - 1) * limit;

    const dataResult = await query(
      `SELECT * FROM passes WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${
        paramIdx + 1
      }`,
      [...params, limit, offset],
    );

    const hasNextPage = offset + limit < total;

    return {
      items: dataResult.rows.map(rowToPass),
      total,
      limit,
      page,
      nextCursor: hasNextPage ? `page:${page + 1}` : null,
      hasNextPage,
      hasPreviousPage: page > 1,
    };
  }

  async getById(guildId: string, id: string): Promise<Pass | null> {
    if (this.isMock) {
      const pass = this.passes.get(id);
      return pass && pass.guildId === guildId ? pass : null;
    }
    const result = await query(
      "SELECT * FROM passes WHERE guild_id = $1 AND id = $2",
      [guildId, id],
    );
    return result.rows.length > 0 ? rowToPass(result.rows[0]) : null;
  }

  async create(guildId: string, pass: PassCreateData): Promise<Pass> {
    if (this.isMock) {
      const id = String(this.nextId++);
      const newPass: Pass = {
        ...pass,
        status: pass.status ?? "draft",
        currentSupply: pass.currentSupply ?? 0,
        id,
        guildId,
        createdAt: new Date().toISOString(),
      };
      this.passes.set(id, newPass);
      await this.recordDiff(
        guildId,
        {},
        newPass,
        "pass.created",
        `New pass created: ${newPass.name}`,
        "pass",
        id,
        newPass.name,
      );
      return newPass;
    }

    return withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO passes (guild_id, name, description, status, price, max_supply, current_supply)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          guildId,
          pass.name,
          pass.description,
          pass.status ?? "draft",
          pass.price !== undefined ? pass.price : null,
          pass.maxSupply !== undefined ? pass.maxSupply : null,
          pass.currentSupply ?? 0,
        ],
      );
      const created = rowToPass(result.rows[0]);
      await this.recordDiff(
        guildId,
        {},
        created,
        "pass.created",
        `New pass created: ${created.name}`,
        "pass",
        created.id,
        created.name,
      );
      return created;
    });
  }

  async update(
    guildId: string,
    id: string,
    pass: PassUpdateData,
  ): Promise<Pass | null> {
    if (this.isMock) {
      const existing = await this.getById(guildId, id);
      if (!existing) return null;
      const updated: Pass = {
        ...existing,
        ...pass,
        id,
        guildId: existing.guildId,
      };
      this.passes.set(id, updated);
      await this.recordDiff(
        guildId,
        existing,
        updated,
        "pass.updated",
        `Pass updated: ${updated.name}`,
        "pass",
        id,
        updated.name,
      );
      return updated;
    }

    return withTransaction(async (client) => {
      const existingResult = await client.query(
        "SELECT * FROM passes WHERE guild_id = $1 AND id = $2 FOR UPDATE",
        [guildId, id],
      );
      if (existingResult.rows.length === 0) return null;
      const old = rowToPass(existingResult.rows[0]);

      const setClauses: string[] = [];
      const setParams: any[] = [];
      let idx = 3;

      const fields: Array<{ key: keyof PassUpdateData; col: string }> = [
        { key: "name", col: "name" },
        { key: "description", col: "description" },
        { key: "status", col: "status" },
        { key: "price", col: "price" },
        { key: "maxSupply", col: "max_supply" },
        { key: "currentSupply", col: "current_supply" },
      ];

      for (const f of fields) {
        if (pass[f.key] !== undefined) {
          setClauses.push(`${f.col} = $${idx}`);
          setParams.push(pass[f.key] === undefined ? null : pass[f.key]);
          idx++;
        }
      }

      if (setClauses.length === 0) return old;

      const updateResult = await client.query(
        `UPDATE passes SET ${setClauses.join(
          ", ",
        )} WHERE guild_id = $1 AND id = $2 RETURNING *`,
        [guildId, id, ...setParams],
      );
      const updated = rowToPass(updateResult.rows[0]);
      await this.recordDiff(
        guildId,
        old,
        updated,
        "pass.updated",
        `Pass updated: ${updated.name}`,
        "pass",
        id,
        updated.name,
      );
      return updated;
    });
  }

  async delete(guildId: string, id: string): Promise<boolean> {
    if (this.isMock) {
      const existing = await this.getById(guildId, id);
      if (!existing) return false;
      this.passes.delete(id);
      await this.recordDiff(
        guildId,
        existing,
        {},
        "pass.deleted",
        `Pass deleted: ${existing.name}`,
        "pass",
        id,
        existing.name,
      );
      return true;
    }

    return withTransaction(async (client) => {
      const existingResult = await client.query(
        "SELECT * FROM passes WHERE guild_id = $1 AND id = $2",
        [guildId, id],
      );
      if (existingResult.rows.length === 0) return false;
      const old = rowToPass(existingResult.rows[0]);

      await client.query("DELETE FROM passes WHERE guild_id = $1 AND id = $2", [
        guildId,
        id,
      ]);
      await this.recordDiff(
        guildId,
        old,
        {},
        "pass.deleted",
        `Pass deleted: ${old.name}`,
        "pass",
        id,
        old.name,
      );
      return true;
    });
  }
}

// ── Guild Repository ────────────────────────────────────────────────────────

export class DurableGuildRepository
  extends DurableRepository
  implements IGuildRepository
{
  private guilds: Map<string, Guild> = new Map();
  private nextId = 1;
  private readonly writeLock = new AsyncMutex();
  private readonly memberRepo?: IMemberRepository;
  private readonly passRepo?: IPassRepository;

  constructor(
    connectionString: string,
    activityRepo?: IActivityRepository,
    deps?: {
      memberRepo?: IMemberRepository;
      passRepo?: IPassRepository;
      seed?: Guild[];
    },
  ) {
    super(connectionString, activityRepo);
    this.memberRepo = deps?.memberRepo;
    this.passRepo = deps?.passRepo;
    if (deps?.seed) {
      for (const g of deps.seed) this.guilds.set(g.id, { ...g });
      this.nextId = this.guilds.size + 1;
    }
  }

  private async withDerivedCounts(guild: Guild): Promise<Guild> {
    const [memberCount, passCount] = await Promise.all([
      this.memberRepo
        ? this.memberRepo.getAll(guild.id).then((m) => m.length)
        : Promise.resolve(guild.memberCount),
      this.passRepo
        ? this.passRepo.getAll(guild.id).then((p) => p.length)
        : Promise.resolve(guild.passCount),
    ]);
    return { ...guild, memberCount, passCount };
  }

  async getAll(): Promise<Guild[]> {
    if (this.isMock) {
      const stored = Array.from(this.guilds.values());
      return Promise.all(stored.map((g) => this.withDerivedCounts(g)));
    }

    const result = await query(
      `SELECT g.*,
              COALESCE(mc.cnt, 0) AS member_count,
              COALESCE(pc.cnt, 0) AS pass_count
       FROM guilds g
       LEFT JOIN (SELECT guild_id, COUNT(*) AS cnt FROM members GROUP BY guild_id) mc ON mc.guild_id = g.id
       LEFT JOIN (SELECT guild_id, COUNT(*) AS cnt FROM passes GROUP BY guild_id) pc ON pc.guild_id = g.id
       ORDER BY g.created_at DESC`,
    );
    return result.rows.map(rowToGuild);
  }

  async getById(id: string): Promise<Guild | null> {
    if (this.isMock) {
      const guild = this.guilds.get(id);
      if (!guild) return null;
      return this.withDerivedCounts(guild);
    }

    const result = await query(
      `SELECT g.*,
              COALESCE(mc.cnt, 0) AS member_count,
              COALESCE(pc.cnt, 0) AS pass_count
       FROM guilds g
       LEFT JOIN (SELECT guild_id, COUNT(*) AS cnt FROM members WHERE guild_id = $1 GROUP BY guild_id) mc ON mc.guild_id = g.id
       LEFT JOIN (SELECT guild_id, COUNT(*) AS cnt FROM passes WHERE guild_id = $1 GROUP BY guild_id) pc ON pc.guild_id = g.id
       WHERE g.id = $1`,
      [id],
    );
    return result.rows.length > 0 ? rowToGuild(result.rows[0]) : null;
  }

  async create(guild: Omit<Guild, "id" | "createdAt">): Promise<Guild> {
    if (this.isMock) {
      return this.writeLock.runExclusive(async () => {
        const id = String(this.nextId++);
        const newGuild: Guild = {
          ...guild,
          id,
          createdAt: new Date().toISOString(),
        };
        this.guilds.set(id, newGuild);
        await this.recordDiff(
          id,
          {},
          newGuild,
          "guild.created",
          `New guild created: ${newGuild.name}`,
          "guild",
          id,
          newGuild.name,
        );
        return this.withDerivedCounts(newGuild);
      });
    }

    return this.writeLock.runExclusive(async () => {
      const result = await query(
        `INSERT INTO guilds (name, description, member_count, pass_count) VALUES ($1, $2, $3, $4) RETURNING *`,
        [guild.name, guild.description, guild.memberCount, guild.passCount],
      );
      const created = rowToGuild(result.rows[0]);
      await this.recordDiff(
        created.id,
        {},
        created,
        "guild.created",
        `New guild created: ${created.name}`,
        "guild",
        created.id,
        created.name,
      );
      return created;
    });
  }

  async update(id: string, guild: Partial<Guild>): Promise<Guild | null> {
    if (this.isMock) {
      return this.writeLock.runExclusive(async () => {
        const existing = this.guilds.get(id);
        if (!existing) return null;
        const patch = { ...guild };
        delete patch.memberCount;
        delete patch.passCount;
        const updated = { ...existing, ...patch, id };
        this.guilds.set(id, updated);
        await this.recordDiff(
          id,
          existing,
          updated,
          "guild.updated",
          `Guild updated: ${updated.name}`,
          "guild",
          id,
          updated.name,
        );
        return this.withDerivedCounts(updated);
      });
    }

    return this.writeLock.runExclusive(async () => {
      const existing = await this.getById(id);
      if (!existing) return null;

      const setClauses: string[] = [];
      const setParams: any[] = [];
      let idx = 2;

      const fields: Array<{ key: keyof Guild; col: string }> = [
        { key: "name", col: "name" },
        { key: "description", col: "description" },
      ];

      for (const f of fields) {
        if (guild[f.key] !== undefined) {
          setClauses.push(`${f.col} = $${idx}`);
          setParams.push(guild[f.key]);
          idx++;
        }
      }

      if (setClauses.length > 0) {
        await query(
          `UPDATE guilds SET ${setClauses.join(", ")} WHERE id = $1`,
          [id, ...setParams],
        );
      }

      const updated = await this.getById(id);
      if (!updated) return null;
      await this.recordDiff(
        id,
        existing,
        updated,
        "guild.updated",
        `Guild updated: ${updated.name}`,
        "guild",
        id,
        updated.name,
      );
      return updated;
    });
  }

  async delete(id: string): Promise<boolean> {
    if (this.isMock) {
      return this.writeLock.runExclusive(async () => {
        const existing = this.guilds.get(id);
        if (!existing) return false;
        this.guilds.delete(id);
        await this.recordDiff(
          id,
          existing,
          {},
          "guild.deleted",
          `Guild deleted: ${existing.name}`,
          "guild",
          id,
          existing.name,
        );
        return true;
      });
    }

    return this.writeLock.runExclusive(async () => {
      const existing = await this.getById(id);
      if (!existing) return false;

      await query("DELETE FROM guilds WHERE id = $1", [id]);
      await this.recordDiff(
        id,
        existing,
        {},
        "guild.deleted",
        `Guild deleted: ${existing.name}`,
        "guild",
        id,
        existing.name,
      );
      return true;
    });
  }
}

// ── Member Repository ───────────────────────────────────────────────────────

export class DurableMemberRepository
  extends DurableRepository
  implements IMemberRepository
{
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

  private walletKey(guildId: string, wallet: string): string {
    return `${guildId}::${wallet}`;
  }

  private getScoped(guildId: string, id: string): Member | null {
    const member = this.members.get(id);
    return member && member.guildId === guildId ? member : null;
  }

  async getAll(guildId: string): Promise<Member[]> {
    if (this.isMock) {
      return Array.from(this.members.values()).filter(
        (m) => m.guildId === guildId,
      );
    }
    const result = await query(
      "SELECT * FROM members WHERE guild_id = $1 ORDER BY joined_at DESC",
      [guildId],
    );
    return result.rows.map(rowToMember);
  }

  async query(
    guildId: string,
    options: MemberListQuery = {},
  ): Promise<PaginatedResult<Member>> {
    if (this.isMock) {
      const { filterMembers, paginateItems } = await import("@/lib/pagination");
      const filtered = filterMembers(await this.getAll(guildId), options);
      return paginateItems(filtered, options);
    }

    const conditions: string[] = ["guild_id = $1"];
    const params: any[] = [guildId];
    let paramIdx = 2;

    if (options.search) {
      conditions.push(`(name ILIKE $${paramIdx} OR wallet ILIKE $${paramIdx})`);
      params.push(`%${options.search}%`);
      paramIdx++;
    }

    if (options.status && options.status !== "all") {
      conditions.push(`status = $${paramIdx}`);
      params.push(options.status);
      paramIdx++;
    }

    if (options.role && options.role !== "all") {
      conditions.push(`roles @> $${paramIdx}::jsonb`);
      params.push(JSON.stringify([options.role]));
      paramIdx++;
    }

    const where = conditions.join(" AND ");
    const countResult = await query(
      `SELECT COUNT(*)::integer as count FROM members WHERE ${where}`,
      params,
    );
    const total = countResult.rows[0].count;

    const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
    const page = Math.max(options.page ?? 1, 1);
    const offset = (page - 1) * limit;

    const dataResult = await query(
      `SELECT * FROM members WHERE ${where} ORDER BY joined_at DESC LIMIT $${paramIdx} OFFSET $${
        paramIdx + 1
      }`,
      [...params, limit, offset],
    );

    const hasNextPage = offset + limit < total;

    return {
      items: dataResult.rows.map(rowToMember),
      total,
      limit,
      page,
      nextCursor: hasNextPage ? `page:${page + 1}` : null,
      hasNextPage,
      hasPreviousPage: page > 1,
    };
  }

  async getById(guildId: string, id: string): Promise<Member | null> {
    if (this.isMock) {
      return this.getScoped(guildId, id);
    }
    const result = await query(
      "SELECT * FROM members WHERE guild_id = $1 AND id = $2",
      [guildId, id],
    );
    return result.rows.length > 0 ? rowToMember(result.rows[0]) : null;
  }

  async getByWallet(guildId: string, wallet: string): Promise<Member | null> {
    if (this.isMock) {
      const id = this.walletIndex.get(this.walletKey(guildId, wallet));
      return id ? this.getScoped(guildId, id) : null;
    }
    const result = await query(
      "SELECT * FROM members WHERE guild_id = $1 AND wallet = $2",
      [guildId, wallet],
    );
    return result.rows.length > 0 ? rowToMember(result.rows[0]) : null;
  }

  async create(guildId: string, member: MemberCreateData): Promise<Member> {
    if (this.isMock) {
      return this.writeLock.runExclusive(async () => {
        const id = String(this.nextId++);
        const now = new Date().toISOString();
        const newMember: Member = {
          ...member,
          status: member.status ?? "pending",
          roles: member.roles ?? [],
          joinedAt: member.joinedAt ?? now,
          lastActive: member.lastActive ?? now,
          id,
          guildId,
          version: 1,
        };
        this.members.set(id, newMember);
        this.walletIndex.set(this.walletKey(guildId, member.wallet), id);
        await this.recordDiff(
          guildId,
          {},
          newMember,
          "member.joined",
          `${newMember.name} joined`,
          "member",
          id,
          newMember.name,
        );
        return newMember;
      });
    }

    return this.writeLock.runExclusive(async () => {
      const now = new Date().toISOString();
      const result = await query(
        `INSERT INTO members (guild_id, wallet, name, status, roles, joined_at, last_active, version)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 1) RETURNING *`,
        [
          guildId,
          member.wallet,
          member.name,
          member.status ?? "pending",
          JSON.stringify(member.roles ?? []),
          member.joinedAt ?? now,
          member.lastActive ?? now,
        ],
      );
      const created = rowToMember(result.rows[0]);
      await this.recordDiff(
        guildId,
        {},
        created,
        "member.joined",
        `${created.name} joined`,
        "member",
        created.id,
        created.name,
      );
      return created;
    });
  }

  async update(
    guildId: string,
    id: string,
    member: MemberUpdateData,
    expectedVersion?: number,
  ): Promise<Member | null> {
    if (this.isMock) {
      return this.writeLock.runExclusive(async () => {
        const existing = this.getScoped(guildId, id);
        if (!existing) return null;

        if (
          expectedVersion !== undefined &&
          existing.version !== expectedVersion
        ) {
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
          this.walletIndex.delete(
            this.walletKey(existing.guildId, existing.wallet),
          );
          this.walletIndex.set(
            this.walletKey(existing.guildId, member.wallet),
            id,
          );
        }

        const changes = computeDiff({ ...existing }, { ...updated });
        if (changes.length > 0 && this.activityRepo) {
          const hasRoleChange = changes.some((c) => c.field === "roles");
          const eventType: ActivityEvent["type"] = hasRoleChange
            ? "member.roles_changed"
            : "member.left";
          const desc = hasRoleChange
            ? `${updated.name}'s roles changed`
            : `Member ${updated.name} updated`;
          await this.activityRepo.append(guildId, {
            type: eventType,
            source: "dashboard",
            severity: "info",
            actor: { name: updated.name, wallet: updated.wallet },
            description: desc,
            entity: { type: "member", id: updated.id, name: updated.name },
            changes,
          });
        }
        return updated;
      });
    }

    return this.writeLock.runExclusive(async () => {
      const existing = await this.getById(guildId, id);
      if (!existing) return null;

      if (
        expectedVersion !== undefined &&
        existing.version !== expectedVersion
      ) {
        throw new ConflictError(
          "This member was updated elsewhere — refresh and retry.",
        );
      }

      const setClauses: string[] = ["version = version + 1"];
      const setParams: any[] = [];
      let idx = 3;

      const fields: Array<{
        key: keyof MemberUpdateData;
        col: string;
        transform?: (v: any) => any;
      }> = [
        { key: "name", col: "name" },
        { key: "wallet", col: "wallet" },
        { key: "status", col: "status" },
        { key: "roles", col: "roles", transform: (v) => JSON.stringify(v) },
        { key: "joinedAt", col: "joined_at" },
        { key: "lastActive", col: "last_active" },
      ];

      for (const f of fields) {
        if (member[f.key] !== undefined) {
          setClauses.push(`${f.col} = $${idx}`);
          setParams.push(
            f.transform ? f.transform(member[f.key]) : member[f.key],
          );
          idx++;
        }
      }

      const result = await query(
        `UPDATE members SET ${setClauses.join(
          ", ",
        )} WHERE guild_id = $1 AND id = $2 RETURNING *`,
        [guildId, id, ...setParams],
      );
      const updated = rowToMember(result.rows[0]);

      const changes = computeDiff({ ...existing }, { ...updated });
      if (changes.length > 0 && this.activityRepo) {
        const hasRoleChange = changes.some((c) => c.field === "roles");
        const eventType: ActivityEvent["type"] = hasRoleChange
          ? "member.roles_changed"
          : "member.left";
        const desc = hasRoleChange
          ? `${updated.name}'s roles changed`
          : `Member ${updated.name} updated`;
        await this.activityRepo.append(guildId, {
          type: eventType,
          source: "dashboard",
          severity: "info",
          actor: { name: updated.name, wallet: updated.wallet },
          description: desc,
          entity: { type: "member", id: updated.id, name: updated.name },
          changes,
        });
      }

      return updated;
    });
  }

  async delete(guildId: string, id: string): Promise<boolean> {
    if (this.isMock) {
      return this.writeLock.runExclusive(async () => {
        const existing = this.getScoped(guildId, id);
        if (!existing) return false;
        this.walletIndex.delete(
          this.walletKey(existing.guildId, existing.wallet),
        );
        this.members.delete(id);
        await this.recordDiff(
          guildId,
          existing,
          {},
          "member.left",
          `${existing.name} left`,
          "member",
          id,
          existing.name,
        );
        return true;
      });
    }

    return this.writeLock.runExclusive(async () => {
      const existing = await this.getById(guildId, id);
      if (!existing) return false;

      await query("DELETE FROM members WHERE guild_id = $1 AND id = $2", [
        guildId,
        id,
      ]);
      await this.recordDiff(
        guildId,
        existing,
        {},
        "member.left",
        `${existing.name} left`,
        "member",
        id,
        existing.name,
      );
      return true;
    });
  }

  async *streamAll(guildId: string, chunkSize = 500): AsyncIterable<Member[]> {
    if (this.isMock) {
      const members = Array.from(this.members.values()).filter(
        (m) => m.guildId === guildId,
      );
      for (let i = 0; i < members.length; i += chunkSize) {
        yield members.slice(i, i + chunkSize);
      }
      return;
    }

    let offset = 0;
    while (true) {
      const result = await query(
        "SELECT * FROM members WHERE guild_id = $1 ORDER BY id LIMIT $2 OFFSET $3",
        [guildId, chunkSize, offset],
      );
      if (result.rows.length === 0) break;
      yield result.rows.map(rowToMember);
      if (result.rows.length < chunkSize) break;
      offset += chunkSize;
    }
  }
}

// ── Activity Repository ─────────────────────────────────────────────────────

export class DurableActivityRepository
  extends DurableRepository
  implements IActivityRepository
{
  private events: ActivityEvent[] = [];
  /** eventId -> owning guildId (mock branch only). Not part of the public ActivityEvent shape. */
  private eventGuildIds: Map<string, string> = new Map();
  private processedIds: Set<string> = new Set();

  async append(
    guildId: string,
    event: Omit<ActivityEvent, "id" | "timestamp" | "schemaVersion"> &
      Partial<Pick<ActivityEvent, "schemaVersion">>,
  ): Promise<ActivityEvent> {
    if (!guildId) throw new Error("append requires a guildId scope");

    if (this.isMock) {
      const fullEvent: ActivityEvent = {
        ...event,
        id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        schemaVersion:
          event.schemaVersion ?? CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
      this.events.unshift(fullEvent);
      this.eventGuildIds.set(fullEvent.id, guildId);
      this.processedIds.add(fullEvent.id);
      return fullEvent;
    }

    const id = generateEventId();
    const now = new Date().toISOString();
    const schemaVersion =
      event.schemaVersion ?? CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION;

    const result = await query(
      `INSERT INTO activity_events (id, guild_id, type, source, severity, actor, timestamp, description, entity, metadata, changes, schema_version)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12) RETURNING *`,
      [
        id,
        guildId,
        event.type,
        event.source,
        event.severity,
        JSON.stringify(event.actor),
        now,
        event.description,
        event.entity ? JSON.stringify(event.entity) : null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.changes ? JSON.stringify(event.changes) : null,
        schemaVersion,
      ],
    );

    await query(
      "INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [id],
    );
    return rowToActivityEvent(result.rows[0]);
  }

  async query(guildId: string, options?: {
    limit?: number;
    type?: ActivityEvent["type"];
    since?: string;
  }): Promise<ActivityEvent[]> {
    if (!guildId) throw new Error("query requires a guildId scope");

    if (this.isMock) {
      let filtered = this.events.filter((e) => this.eventGuildIds.get(e.id) === guildId);
      if (options?.type) {
        filtered = filtered.filter((e) => e.type === options.type);
      }
      if (options?.since) {
        const sinceTime = new Date(options.since).getTime();
        filtered = filtered.filter(
          (e) => new Date(e.timestamp).getTime() >= sinceTime,
        );
      }
      if (options?.limit) {
        filtered = filtered.slice(0, options.limit);
      }
      return filtered;
    }

    const conditions: string[] = ["guild_id = $1"];
    const params: any[] = [guildId];
    let idx = 2;

    if (options?.type) {
      conditions.push(`type = $${idx}`);
      params.push(options.type);
      idx++;
    }

    if (options?.since) {
      conditions.push(`timestamp >= $${idx}`);
      params.push(options.since);
      idx++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = options?.limit ? `LIMIT $${idx}` : "";
    if (options?.limit) params.push(options.limit);

    const result = await query(
      `SELECT * FROM activity_events ${where} ORDER BY timestamp DESC ${limit}`,
      params,
    );
    return result.rows.map(rowToActivityEvent);
  }

  async hasProcessed(eventId: string): Promise<boolean> {
    if (this.isMock) {
      return this.processedIds.has(eventId);
    }
    const result = await query(
      "SELECT 1 FROM processed_events WHERE event_id = $1",
      [eventId],
    );
    return result.rows.length > 0;
  }

  async markProcessed(eventId: string): Promise<boolean> {
    if (this.isMock) {
      if (this.processedIds.has(eventId)) return false;
      this.processedIds.add(eventId);
      return true;
    }
    const result = await query(
      "INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [eventId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

// ── Settings Repository ─────────────────────────────────────────────────────

export class DurableSettingsRepository
  extends DurableRepository
  implements ISettingsRepository
{
  private settings: DashboardSettings = { ...DEFAULT_SETTINGS };
  private encryptedSecrets: Map<string, string> = new Map();
  private readonly writeLock = new AsyncMutex();

  async get(): Promise<DashboardSettings> {
    if (this.isMock) {
      const response: DashboardSettings = { ...this.settings };
      if (this.encryptedSecrets.has("webhookForwardingSecret")) {
        response.webhookForwardingSecret = {
          isSet: true,
          maskedValue: "••••••••",
        };
      }
      return response;
    }

    const result = await query("SELECT * FROM settings WHERE id = 'default'");
    if (result.rows.length === 0) {
      return { ...DEFAULT_SETTINGS };
    }
    return rowToSettings(result.rows[0]);
  }

  async update(
    patch: SettingsPatchPayload | Partial<DashboardSettings>,
  ): Promise<DashboardSettings> {
    const result = validateSettingsPatch(patch);
    if (!result.ok) {
      throw new SettingsValidationError(result.errors);
    }

    const previous = await this.get();
    const { webhookForwardingSecret, ...publicPatch } = result.value;

    if (this.isMock) {
      return this.writeLock.runExclusive(async () => {
        if (webhookForwardingSecret !== undefined) {
          if (
            webhookForwardingSecret !== null &&
            webhookForwardingSecret !== ""
          ) {
            const encrypted = this.encryptSecret(webhookForwardingSecret);
            this.encryptedSecrets.set("webhookForwardingSecret", encrypted);
          } else {
            this.encryptedSecrets.delete("webhookForwardingSecret");
          }
        }

        this.settings = {
          ...this.settings,
          ...publicPatch,
        } as DashboardSettings;
        // Settings are a single workspace-level document, not yet guild-scoped
        // (see docs/multi-tenancy.md) — tagged under the default guild until
        // settings gain per-guild scope.
        await this.recordDiff(
          DEFAULT_GUILD_ID,
          previous,
          this.settings,
          "guild.updated",
          `Settings updated: ${Object.keys(result.value).join(", ")}`,
          "guild",
          "settings",
          this.settings.workspaceName,
        );
        return this.get();
      });
    }

    return this.writeLock.runExclusive(async () => {
      const setClauses: string[] = ["updated_at = NOW()"];
      const setParams: any[] = [];
      let idx = 2;

      const fields: Array<{ key: string; col: string }> = [
        { key: "workspaceName", col: "workspace_name" },
        { key: "timezone", col: "timezone" },
        { key: "displayName", col: "display_name" },
        { key: "email", col: "email" },
      ];

      for (const f of fields) {
        const val = (publicPatch as any)[f.key];
        if (val !== undefined) {
          setClauses.push(`${f.col} = $${idx}`);
          setParams.push(val);
          idx++;
        }
      }

      if (webhookForwardingSecret !== undefined) {
        if (
          webhookForwardingSecret !== null &&
          webhookForwardingSecret !== ""
        ) {
          const encrypted = this.encryptSecret(webhookForwardingSecret);
          setClauses.push(`webhook_forwarding_secret = $${idx}`);
          setParams.push(encrypted);
          idx++;
        } else {
          setClauses.push(`webhook_forwarding_secret = NULL`);
        }
      }

      await query(
        "INSERT INTO settings (id) VALUES ('default') ON CONFLICT DO NOTHING",
      );
      if (setClauses.length > 1 || webhookForwardingSecret !== undefined) {
        await query(
          `UPDATE settings SET ${setClauses.join(", ")} WHERE id = $1`,
          ["default", ...setParams],
        );
      }

      const updated = await this.get();
      // Settings are a single workspace-level document, not yet guild-scoped
      // (see docs/multi-tenancy.md) — tagged under the default guild until
      // settings gain per-guild scope.
      await this.recordDiff(
        DEFAULT_GUILD_ID,
        previous,
        updated,
        "guild.updated",
        `Settings updated: ${Object.keys(result.value).join(", ")}`,
        "guild",
        "settings",
        updated.workspaceName,
      );
      return updated;
    });
  }

  private encryptSecret(plaintext: string): string {
    const algo = "aes-256-gcm";
    const rawKey =
      process.env.SETTINGS_ENCRYPTION_KEY || "default_dev_key_only";
    const key = crypto.createHash("sha256").update(rawKey).digest();

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(algo, key, iv);
    let ciphertext = cipher.update(plaintext, "utf8", "base64");
    ciphertext += cipher.final("base64");
    const authTag = cipher.getAuthTag().toString("base64");

    return JSON.stringify({
      iv: iv.toString("base64"),
      authTag,
      ciphertext,
    });
  }
}
