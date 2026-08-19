import type { GuildMember } from "discord.js";
import { config } from "./config.js";
import type { Membership } from "@guildpass/integration-client";
import {
  RoleReconciliationQueue,
  type QueueOptions,
} from "./queue.js";

export type RoleMap = Record<string, string>;

// ── Per-member reconciliation lock ────────────────────────────────────────
//
// Serializes role reconciliation calls per Discord member (user ID) with
// request coalescing. When multiple reconciliation requests arrive for the
// same member before the first completes, only the latest desired-roles
// set is applied — avoiding redundant, potentially flip-flopping API calls.
//
// Conflict resolution policy: LAST WRITE WINS
// - The final role state deterministically matches the most recently
//   requested desired-roles set for that member.
// - This is the expected behavior: the latest membership state should win.

export interface PendingReconciliation {
  member: GuildMember;
  desiredRoleIds: string[];
  resolve: (result: ReconciliationResult) => void;
  reject: (error: unknown) => void;
}

export interface ReconciliationResult {
  added: string[];
  removed: string[];
}

/**
 * Per-member mutex with request coalescing for role reconciliation.
 *
 * Key properties:
 * - At most one reconciliation runs at a time for a given member (userId)
 * - Multiple concurrent requests coalesce to the latest desired state
 * - Reconciliation for different members remains fully concurrent
 * - "Last write wins" conflict resolution is deterministic
 *
 * Conflict resolution semantics:
 * - The first request for a member starts immediately
 * - Subsequent requests while the first is running are queued and coalesced
 * - When the first completes, the coalesced pending request runs with the
 *   LATEST desired state (intermediate states are skipped)
 */
export class MemberReconciliationLock {
  /** Members currently being reconciled (in-flight). */
  private readonly activeLocks = new Set<string>();

  /** Pending reconciliation per member — only the latest is kept (coalescing). */
  private readonly pending = new Map<string, PendingReconciliation>();

  /** Waiters for the CURRENTLY RUNNING reconciliation. */
  private readonly activeWaiters = new Map<string, Array<{
    resolve: (result: ReconciliationResult) => void;
    reject: (error: unknown) => void;
  }>>();

  /** Waiters for PENDING (not yet started) reconciliation. */
  private readonly pendingWaiters = new Map<string, Array<{
    resolve: (result: ReconciliationResult) => void;
    reject: (error: unknown) => void;
  }>>();

  /**
   * Acquire the lock for a member, coalescing with any pending request.
   *
   * If a reconciliation is already in-flight for this member, this request
   * is queued and will coalesce with other pending requests. Only the most
   * recent desired-roles set will be applied when the current one completes.
   */
  async acquire(
    member: GuildMember,
    desiredRoleIds: string[],
  ): Promise<ReconciliationResult> {
    const userId = member.user.id;

    return new Promise<ReconciliationResult>((resolve, reject) => {
      const waiter = { resolve, reject };

      if (this.activeLocks.has(userId)) {
        // A reconciliation is already running — queue for the PENDING batch.
        // Update the pending request to the latest desired state (coalescing).
        this.pending.set(userId, { member, desiredRoleIds, resolve, reject });

        // Add to pending waiters
        if (!this.pendingWaiters.has(userId)) {
          this.pendingWaiters.set(userId, []);
        }
        this.pendingWaiters.get(userId)!.push(waiter);
      } else {
        // No reconciliation running — this request starts immediately.
        this.pending.set(userId, { member, desiredRoleIds, resolve, reject });

        if (!this.activeWaiters.has(userId)) {
          this.activeWaiters.set(userId, []);
        }
        this.activeWaiters.get(userId)!.push(waiter);

        this.processNext(userId);
      }
    });
  }

  /**
   * Process the next pending reconciliation for a member.
   */
  private processNext(userId: string): void {
    const pendingReq = this.pending.get(userId);
    if (!pendingReq) {
      // No more pending work for this member.
      return;
    }

    // Mark as in-flight.
    this.activeLocks.add(userId);
    this.pending.delete(userId);

    // Move pending waiters to active (they'll be notified when this completes)
    const pendingW = this.pendingWaiters.get(userId);
    if (pendingW && pendingW.length > 0) {
      if (!this.activeWaiters.has(userId)) {
        this.activeWaiters.set(userId, []);
      }
      this.activeWaiters.get(userId)!.push(...pendingW);
      this.pendingWaiters.delete(userId);
    }

    // Run the reconciliation.
    reconcileMemberRoles(pendingReq.member, pendingReq.desiredRoleIds)
      .then((result) => {
        this.onComplete(userId, result, null);
      })
      .catch((err) => {
        this.onComplete(userId, null, err);
      });
  }

  /**
   * Handle reconciliation completion: notify active waiters, then process
   * any newly pending request (which may have arrived during execution).
   */
  private onComplete(
    userId: string,
    result: ReconciliationResult | null,
    error: unknown,
  ): void {
    // Release the lock.
    this.activeLocks.delete(userId);

    // Notify active waiters.
    const waiters = this.activeWaiters.get(userId) ?? [];
    this.activeWaiters.delete(userId);

    for (const waiter of waiters) {
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve(result!);
      }
    }

    // If new requests arrived while we were reconciling, process the next.
    if (this.pending.has(userId)) {
      this.processNext(userId);
    }
  }

  /** Expose current state for observability and testing. */
  get state() {
    return {
      activeLocks: this.activeLocks.size,
      pending: this.pending.size,
      waiters: Array.from(this.activeWaiters.entries()).map(([k, v]) => ({
        userId: k,
        count: v.length,
      })),
    };
  }

  /** Clear all state (for testing). */
  reset(): void {
    this.activeLocks.clear();
    this.pending.clear();
    this.activeWaiters.clear();
    this.pendingWaiters.clear();
  }
}

// ── Singleton queue and lock ──────────────────────────────────────────────

let _queue: RoleReconciliationQueue | null = null;
let _memberLock: MemberReconciliationLock | null = null;

/** Get or create the shared role-reconciliation queue. */
export function getReconciliationQueue(
  options?: QueueOptions,
): RoleReconciliationQueue {
  if (!_queue) {
    _queue = new RoleReconciliationQueue(options);
  }
  return _queue;
}

/** Replace the singleton queue (mainly for testing). */
export function setReconciliationQueue(q: RoleReconciliationQueue): void {
  _queue = q;
}

/** Get or create the shared per-member reconciliation lock. */
export function getMemberLock(): MemberReconciliationLock {
  if (!_memberLock) {
    _memberLock = new MemberReconciliationLock();
  }
  return _memberLock;
}

/** Replace the singleton lock (mainly for testing). */
export function setMemberLock(lock: MemberReconciliationLock): void {
  _memberLock = lock;
}

/** Reset both singletons (for testing). */
export function resetReconciliationState(): void {
  _queue = null;
  if (_memberLock) {
    _memberLock.reset();
  }
  _memberLock = null;
}

// ── Role resolution ──────────────────────────────────────────────────────

export function resolveDesiredRoles(m: Membership, map: RoleMap): string[] {
  const desired = new Set<string>();
  for (const r of m.roles) {
    const id = map[r];
    if (id) desired.add(id);
  }
  return Array.from(desired);
}

// ── Retry helpers ────────────────────────────────────────────────────────

export interface RetryOptions {
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  const status =
    typeof e.status === "number"
      ? e.status
      : typeof e.httpStatus === "number"
        ? e.httpStatus
        : null;
  // Retry on 429 (rate limit), 5xx (server errors), and network errors (no status).
  return status === 429 || (status !== null && status >= 500) || status === null;
}

/**
 * Retry an async operation with jittered exponential backoff.
 * Only retries on transient errors (429, 5xx, network).
 */
async function withRetry<T>(
  op: () => Promise<T>,
  label: string,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries, baseBackoffMs, maxBackoffMs } = {
    ...DEFAULT_RETRY,
    ...options,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await op();
    } catch (err: unknown) {
      if (!isRetryable(err) || attempt >= maxRetries) {
        throw err;
      }

      // Respect Retry-After header on 429s.
      const retryAfterSec = extractRetryAfterSec(err);
      const delay = retryAfterSec
        ? retryAfterSec * 1000
        : Math.min(
            baseBackoffMs * Math.pow(2, attempt) + Math.random() * 1000,
            maxBackoffMs,
          );

      console.warn(
        `[roles] retry #${attempt + 1} for ${label} after ${Math.round(delay)}ms: ${String(err).slice(0, 200)}`,
      );
      await sleep(delay);
    }
  }

  // Unreachable — the loop either returns or throws.
  throw new Error("unreachable");
}

function extractRetryAfterSec(err: unknown): number {
  if (typeof err !== "object" || err === null) return 0;
  const e = err as Record<string, unknown>;
  if (typeof e.retryAfter === "number") return Math.ceil(e.retryAfter / 1000);
  const raw = e.rawError as Record<string, unknown> | undefined;
  if (raw?.retry_after && typeof raw.retry_after === "number")
    return raw.retry_after as number;
  return 0;
}

// ── Core reconciliation ──────────────────────────────────────────────────

/**
 * Reconcile a member's Discord roles to match the desired set.
 *
 * Only guild-managed roles (admin, member, contributor) are ever removed;
 * externally-assigned roles are left untouched.
 *
 * Each `roles.add` / `roles.remove` call is individually retried on transient
 * Discord API failures (429, 5xx, network errors).
 */
export async function reconcileMemberRoles(
  member: GuildMember,
  desiredRoleIds: string[],
): Promise<{ added: string[]; removed: string[] }> {
  const currentIds = member.roles.cache.map((r) => r.id);

  // Roles that are desired but missing.
  const toAdd = desiredRoleIds.filter((id) => !currentIds.includes(id));

  // Guild-managed roles that are present but no longer desired.
  const managedRoles = [
    config.roles.admin,
    config.roles.member,
    config.roles.contributor,
  ];
  const toRemove = currentIds.filter(
    (id) => managedRoles.includes(id) && !desiredRoleIds.includes(id),
  );

  if (toAdd.length > 0) {
    await withRetry(
      () => member.roles.add(toAdd),
      `roles.add(${toAdd.join(",")})`,
    );
  }

  if (toRemove.length > 0) {
    await withRetry(
      () => member.roles.remove(toRemove),
      `roles.remove(${toRemove.join(",")})`,
    );
  }

  return { added: toAdd, removed: toRemove };
}

/**
 * Queue-aware wrapper: enqueues the reconciliation via the shared queue
 * so that per-guild concurrency is bounded and rate-limit-aware.
 *
 * **Concurrency guarantees:**
 * 1. Per-member serialization: Only one reconciliation runs at a time for a
 *    given member (Discord user ID). Concurrent triggers never interleave
 *    their read-modify-write cycles.
 * 2. Request coalescing: Multiple concurrent requests for the same member
 *    coalesce to the latest desired-roles set ("last write wins").
 * 3. Per-guild rate limiting: Operations for the same guild are serialized
 *    to respect Discord's rate limits.
 * 4. Cross-member concurrency: Reconciliation for different members remains
 *    fully concurrent (up to the guild queue's maxConcurrency limit).
 *
 * @param guildId - The Discord guild (server) ID for rate-limit isolation.
 * @param member - The GuildMember to reconcile.
 * @param desiredRoleIds - The target role set.
 */
export async function reconcileMemberRolesQueued(
  guildId: string,
  member: GuildMember,
  desiredRoleIds: string[],
  queueOptions?: QueueOptions,
): Promise<{ added: string[]; removed: string[] }> {
  const queue = getReconciliationQueue(queueOptions);
  const memberLock = getMemberLock();

  // The per-member lock ensures:
  // 1. At most one reconciliation runs at a time per member
  // 2. Concurrent requests coalesce to the latest desired state
  // 3. "Last write wins" conflict resolution
  //
  // The guild queue ensures:
  // 1. Per-guild rate limiting
  // 2. Bounded global concurrency
  return queue.enqueue(guildId, () =>
    memberLock.acquire(member, desiredRoleIds),
  );
}
