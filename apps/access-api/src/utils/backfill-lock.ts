/**
 * BackfillLock
 *
 * Provides mutual exclusion between a running live MembershipIndexer and the
 * backfill CLI.  The lock is stored as a row in the BackfillLock table so it
 * survives process boundaries (no in-process shared state required).
 *
 * Design principles:
 *  - A live indexer acquires and periodically refreshes a "live" lock so the
 *    backfill CLI can detect it is running.
 *  - The backfill CLI acquires a "backfill" lock and verifies that the
 *    requested range does not overlap the live indexer's current head.
 *  - Stale locks (heartbeat older than LOCK_TTL_MS) are treated as released.
 *  - All coordination is advisory — callers must still handle the case where
 *    a stale lock was erroneously held (e.g. after a crash).
 */

import { PrismaClient } from "@prisma/client";

/** How long (ms) before a lock heartbeat is considered stale. */
const LOCK_TTL_MS = 60_000; // 1 minute

/** How often (ms) the live indexer should call refreshLiveLock(). */
export const LIVE_LOCK_REFRESH_INTERVAL_MS = 20_000; // 20 seconds

export type LockHolder = "live-indexer" | "backfill";

export interface LockInfo {
  holder: LockHolder;
  acquiredAt: Date;
  /** Block the live indexer last wrote (undefined for backfill lock). */
  liveHead?: bigint;
}

export class BackfillLock {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // ─── Live-indexer side ──────────────────────────────────────────────────────

  /**
   * Called by the live indexer on startup to register its presence.
   * If a stale live lock exists it is overwritten.
   */
  async acquireLiveLock(currentHead: bigint): Promise<void> {
    await this.prisma.backfillLock.upsert({
      where: { holder: "live-indexer" },
      update: {
        acquiredAt: new Date(),
        liveHead: currentHead,
      },
      create: {
        holder: "live-indexer",
        acquiredAt: new Date(),
        liveHead: currentHead,
      },
    });
  }

  /**
   * Refreshes the live lock heartbeat and updates the current chain head.
   * Call this from the poll loop every LIVE_LOCK_REFRESH_INTERVAL_MS.
   */
  async refreshLiveLock(currentHead: bigint): Promise<void> {
    await this.prisma.backfillLock.upsert({
      where: { holder: "live-indexer" },
      update: { acquiredAt: new Date(), liveHead: currentHead },
      create: {
        holder: "live-indexer",
        acquiredAt: new Date(),
        liveHead: currentHead,
      },
    });
  }

  /** Called when the live indexer shuts down cleanly. */
  async releaseLiveLock(): Promise<void> {
    await this.prisma.backfillLock
      .delete({ where: { holder: "live-indexer" } })
      .catch(() => {}); // Already gone is fine
  }

  // ─── Backfill-CLI side ──────────────────────────────────────────────────────

  /**
   * Attempt to acquire the backfill lock.
   *
   * Throws if:
   *  - Another backfill is already running (non-stale lock exists).
   *  - A live indexer is running AND its current head overlaps [fromBlock, toBlock].
   *
   * Returns the stale flag for the caller to log/warn about.
   */
  async acquireBackfillLock(
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<{ staleLiveIndexerDetected: boolean }> {
    const now = Date.now();

    // ── 1. Check for a concurrent backfill ───────────────────────────────────
    const existingBackfill = await this.prisma.backfillLock.findUnique({
      where: { holder: "backfill" },
    });

    if (existingBackfill) {
      const age = now - existingBackfill.acquiredAt.getTime();
      if (age < LOCK_TTL_MS) {
        throw new BackfillLockError(
          `Another backfill is already running (lock acquired ${Math.round(age / 1000)}s ago). ` +
            `If that process crashed, wait ${Math.round((LOCK_TTL_MS - age) / 1000)}s for the lock to expire, ` +
            `or manually delete the row WHERE holder='backfill' in the BackfillLock table.`
        );
      }
      // Stale – overwrite below
    }

    // ── 2. Check for a live indexer whose range overlaps ours ────────────────
    const liveLock = await this.prisma.backfillLock.findUnique({
      where: { holder: "live-indexer" },
    });

    let staleLiveIndexerDetected = false;

    if (liveLock) {
      const age = now - liveLock.acquiredAt.getTime();

      if (age >= LOCK_TTL_MS) {
        // Stale live lock – the indexer probably crashed
        staleLiveIndexerDetected = true;
      } else {
        // Live indexer is running – check for range overlap
        const liveHead = liveLock.liveHead ?? 0n;

        // The live indexer processes from its current head forward.
        // We block if [fromBlock, toBlock] intersects [liveHead - depth, ∞).
        // Using a conservative threshold: block if toBlock >= liveHead - buffer.
        const BLOCK_BUFFER = 64n; // ~13 min of headroom at 12s/block
        if (toBlock >= liveHead - BLOCK_BUFFER) {
          throw new BackfillLockError(
            `Live indexer is running and its current head is block ${liveHead}. ` +
              `Your requested range [${fromBlock}, ${toBlock}] overlaps or is too close to the live head. ` +
              `Either wait until the live indexer advances past ${toBlock + BLOCK_BUFFER} or ` +
              `stop the live indexer before running backfill.`
          );
        }
      }
    }

    // ── 3. Write our lock ────────────────────────────────────────────────────
    await this.prisma.backfillLock.upsert({
      where: { holder: "backfill" },
      update: { acquiredAt: new Date(), liveHead: null },
      create: { holder: "backfill", acquiredAt: new Date(), liveHead: null },
    });

    return { staleLiveIndexerDetected };
  }

  /** Release the backfill lock when the CLI exits (success or failure). */
  async releaseBackfillLock(): Promise<void> {
    await this.prisma.backfillLock
      .delete({ where: { holder: "backfill" } })
      .catch(() => {});
  }

  // ─── Inspection ─────────────────────────────────────────────────────────────

  /** Returns all currently-held (possibly stale) locks. */
  async listLocks(): Promise<LockInfo[]> {
    const rows = await this.prisma.backfillLock.findMany();
    return rows.map((r) => ({
      holder: r.holder as LockHolder,
      acquiredAt: r.acquiredAt,
      liveHead: r.liveHead ?? undefined,
    }));
  }

  /** True if a non-stale backfill lock is held by any process. */
  async isBackfillRunning(): Promise<boolean> {
    const row = await this.prisma.backfillLock.findUnique({
      where: { holder: "backfill" },
    });
    if (!row) return false;
    return Date.now() - row.acquiredAt.getTime() < LOCK_TTL_MS;
  }
}

/** Thrown when the lock cannot be acquired safely. */
export class BackfillLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackfillLockError";
  }
}
