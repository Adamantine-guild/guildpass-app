/**
 * LeaderElectionService
 *
 * Distributed leader election for horizontally-scaled indexer deployments.
 * Uses a singleton row in the LeaderElection table with:
 *  - CAS-based acquisition (atomic compare-and-swap via raw SQL)
 *  - Time-bounded lease with periodic heartbeat renewal
 *  - Monotonically increasing generation number (fencing token) to prevent
 *    split-brain: a former leader whose process is slow (not crashed) cannot
 *    write after losing leadership because its generation is stale.
 *
 * Design principles:
 *  - Exactly one leader at any time under normal operation.
 *  - Automatic failover: standby instances poll for lease expiry and attempt
 *    to acquire leadership if the lease has lapsed.
 *  - Fencing tokens are written alongside every checkpoint and processedEvent
 *    write. A write with a stale generation is rejected.
 *  - All coordination is database-backed — no external service required.
 */

import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

// ─── Configuration ───────────────────────────────────────────────────────────

/** How long (ms) a lease lasts before it's considered expired. */
const LEASE_TTL_MS = 30_000; // 30 seconds

/** How often (ms) the leader should renew its lease. */
export const LEASE_RENEW_INTERVAL_MS = 10_000; // 10 seconds

/** How often (ms) a standby instance should poll for lease expiry. */
export const STANDBY_POLL_INTERVAL_MS = 5_000; // 5 seconds

// ─── Types ───────────────────────────────────────────────────────────────────

export type LeaderRole = "leader" | "standby";

export interface LeadershipStatus {
  role: LeaderRole;
  instanceId: string;
  generation: number;
  isLeader: boolean;
}

export interface LeaderElectionConfig {
  /** Unique identifier for this instance. Auto-generated if not provided. */
  instanceId?: string;
  /** Custom lease TTL. Defaults to LEASE_TTL_MS. */
  leaseTtlMs?: number;
  /** Custom renew interval. Defaults to LEASE_RENEW_INTERVAL_MS. */
  renewIntervalMs?: number;
  /** Custom standby poll interval. Defaults to STANDBY_POLL_INTERVAL_MS. */
  standbyPollIntervalMs?: number;
}

// ─── Fencing token error ─────────────────────────────────────────────────────

/** Thrown when an operation is attempted with a stale fencing token. */
export class FencingTokenError extends Error {
  constructor(
    message: string,
    public readonly expectedGeneration: number,
    public readonly currentGeneration: number,
  ) {
    super(message);
    this.name = "FencingTokenError";
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class LeaderElectionService {
  private prisma: PrismaClient;
  private instanceId: string;
  private leaseTtlMs: number;
  private renewIntervalMs: number;
  private standbyPollIntervalMs: number;

  private currentGeneration: number = 0;
  private isLeaderFlag: boolean = false;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Callback invoked when this instance becomes the leader. */
  public onBecomeLeader: (() => void | Promise<void>) | null = null;
  /** Callback invoked when this instance loses leadership. */
  public onLoseLeadership: (() => void | Promise<void>) | null = null;

  constructor(prisma: PrismaClient, config: LeaderElectionConfig = {}) {
    this.prisma = prisma;
    this.instanceId = config.instanceId ?? randomUUID();
    this.leaseTtlMs = config.leaseTtlMs ?? LEASE_TTL_MS;
    this.renewIntervalMs = config.renewIntervalMs ?? LEASE_RENEW_INTERVAL_MS;
    this.standbyPollIntervalMs =
      config.standbyPollIntervalMs ?? STANDBY_POLL_INTERVAL_MS;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Unique identifier for this instance. */
  getInstanceId(): string {
    return this.instanceId;
  }

  /** Current fencing token (generation). 0 if never been leader. */
  getGeneration(): number {
    return this.currentGeneration;
  }

  /** Whether this instance currently believes it is the leader. */
  isLeader(): boolean {
    return this.isLeaderFlag;
  }

  /** Current leadership status snapshot. */
  getStatus(): LeadershipStatus {
    return {
      role: this.isLeaderFlag ? "leader" : "standby",
      instanceId: this.instanceId,
      generation: this.currentGeneration,
      isLeader: this.isLeaderFlag,
    };
  }

  /**
   * Start the leader election loop.
   * - Immediately attempts to acquire leadership.
   * - If successful, starts lease renewal on a timer.
   * - If not, starts polling for lease expiry on a timer.
   */
  async start(): Promise<void> {
    // Ensure the singleton row exists
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "LeaderElection" (id, "leaderInstanceId", generation, "leaseExpiresAt", "updatedAt")
       VALUES ('singleton', '', 0, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`
    );

    // Initial acquisition attempt
    await this.tryBecomeLeader();

    // Start the appropriate loop
    if (this.isLeaderFlag) {
      this.startRenewLoop();
    } else {
      this.startPollLoop();
    }
  }

  /**
   * Stop all timers and voluntarily relinquish leadership if held.
   */
  async stop(): Promise<void> {
    this.clearTimers();

    if (this.isLeaderFlag) {
      await this.relinquishLeadership();
    }
  }

  /**
   * Verify we still hold leadership with the current generation.
   * Call this before performing any write that requires leader exclusivity.
   *
   * @throws FencingTokenError if we lost leadership
   */
  async verifyLeadershipOrThrow(): Promise<void> {
    if (!this.isLeaderFlag) {
      throw new FencingTokenError(
        `Instance ${this.instanceId} is not the leader`,
        this.currentGeneration,
        -1,
      );
    }

    const row = await this.prisma.leaderElection.findUnique({
      where: { id: "singleton" },
    });

    if (!row) {
      this.isLeaderFlag = false;
      throw new FencingTokenError(
        "LeaderElection row missing",
        this.currentGeneration,
        -1,
      );
    }

    if (
      row.leaderInstanceId !== this.instanceId ||
      row.generation !== this.currentGeneration
    ) {
      const wasLeader = this.isLeaderFlag;
      const ourGen = this.currentGeneration;
      const theirGen = row.generation;
      this.isLeaderFlag = false;
      this.currentGeneration = 0;

      if (wasLeader) {
        await this.onLoseLeadership?.();
      }

      throw new FencingTokenError(
        `Instance ${this.instanceId} lost leadership to ${row.leaderInstanceId} (our gen: ${ourGen}, current gen: ${theirGen})`,
        ourGen,
        theirGen,
      );
    }

    // Also check lease hasn't expired (defensive)
    if (new Date() > new Date(row.leaseExpiresAt)) {
      const ourGen = this.currentGeneration;
      const theirGen = row.generation;
      this.isLeaderFlag = false;
      this.currentGeneration = 0;
      await this.onLoseLeadership?.();
      throw new FencingTokenError(
        "Lease expired",
        ourGen,
        theirGen,
      );
    }
  }

  /**
   * Attempt to become the leader.
   * Safe to call at any time — if already leader this is a no-op.
   *
   * @returns true if this instance is now the leader
   */
  async tryBecomeLeader(): Promise<boolean> {
    const newExpiresAt = new Date(Date.now() + this.leaseTtlMs);

    // Atomic CAS: acquire leadership only if:
    //   1. The lease has expired (no current leader), OR
    //   2. We are already the leader (re-acquisition after e.g. restart)
    //
    // Uses UPDATE ... RETURNING for true atomicity — a single round-trip
    // that atomically tests the condition, increments generation, and
    // returns the result. No follow-up read needed.
    const result: Array<{
      generation: number;
      leaderInstanceId: string;
    }> = await this.prisma.$queryRawUnsafe(
      `UPDATE "LeaderElection"
       SET "leaderInstanceId" = $1,
           "generation" = "generation" + 1,
           "leaseExpiresAt" = $2,
           "updatedAt" = NOW()
       WHERE id = 'singleton'
         AND (
           "leaseExpiresAt" < NOW()
           OR "leaderInstanceId" = $1
         )
       RETURNING "generation", "leaderInstanceId"`,
      this.instanceId,
      newExpiresAt,
    );

    if (result.length > 0 && result[0].leaderInstanceId === this.instanceId) {
      const previousGeneration = this.currentGeneration;
      this.currentGeneration = result[0].generation;
      this.isLeaderFlag = true;

      console.log(
        `[LeaderElection] Instance ${this.instanceId} ACQUIRED leadership (generation: ${this.currentGeneration})`,
      );

      if (previousGeneration === 0) {
        // Fresh acquisition, not a renewal
        await this.onBecomeLeader?.();
      }

      return true;
    }

    // We did not acquire leadership — read current state for diagnostics
    const current = await this.prisma.leaderElection.findUnique({
      where: { id: "singleton" },
    });

    if (current && current.leaderInstanceId !== this.instanceId) {
      const remainingMs =
        new Date(current.leaseExpiresAt).getTime() - Date.now();
      console.log(
        `[LeaderElection] Instance ${this.instanceId} is STANDBY. ` +
          `Current leader: ${current.leaderInstanceId} (gen: ${current.generation}), ` +
          `lease expires in ${Math.max(0, Math.round(remainingMs / 1000))}s`,
      );
    }

    return false;
  }

  /**
   * Renew the lease. Must already be the leader.
   * If renewal fails (we lost leadership), transitions to standby.
   *
   * @returns true if renewal succeeded
   */
  async renewLease(): Promise<boolean> {
    if (!this.isLeaderFlag) return false;

    const newExpiresAt = new Date(Date.now() + this.leaseTtlMs);

    // Atomic renewal: only succeeds if we're still the leader with the
    // expected generation.
    const result: Array<{ generation: number }> =
      await this.prisma.$queryRawUnsafe(
        `UPDATE "LeaderElection"
         SET "leaseExpiresAt" = $1,
             "updatedAt" = NOW()
         WHERE id = 'singleton'
           AND "leaderInstanceId" = $2
           AND "generation" = $3
         RETURNING "generation"`,
        newExpiresAt,
        this.instanceId,
        this.currentGeneration,
      );

    if (result.length > 0) {
      // Successful renewal
      return true;
    }

    // Renewal failed — we lost leadership
    console.warn(
      `[LeaderElection] Instance ${this.instanceId} FAILED to renew lease (gen: ${this.currentGeneration}). Lost leadership.`,
    );

    this.isLeaderFlag = false;
    this.currentGeneration = 0;
    this.clearTimers();

    await this.onLoseLeadership?.();

    // Start polling to try to re-acquire
    this.startPollLoop();

    return false;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private startRenewLoop(): void {
    this.clearTimers();
    this.renewTimer = setInterval(() => {
      void this.renewLease().catch((err) => {
        console.error("[LeaderElection] Lease renewal error:", err);
      });
    }, this.renewIntervalMs);
  }

  private startPollLoop(): void {
    this.clearTimers();
    this.pollTimer = setInterval(() => {
      void this.tryBecomeLeader()
        .then((became) => {
          if (became) {
            // Switch from polling to renewing
            this.clearTimers();
            this.startRenewLoop();
          }
        })
        .catch((err) => {
          console.error("[LeaderElection] Poll error:", err);
        });
    }, this.standbyPollIntervalMs);
  }

  private clearTimers(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Voluntarily give up leadership. Sets lease to expired so a standby
   * can take over immediately.
   */
  private async relinquishLeadership(): Promise<void> {
    console.log(
      `[LeaderElection] Instance ${this.instanceId} relinquishing leadership (gen: ${this.currentGeneration})`,
    );

    await this.prisma.$executeRawUnsafe(
      `UPDATE "LeaderElection"
       SET "leaseExpiresAt" = NOW() - INTERVAL '1 second',
           "updatedAt" = NOW()
       WHERE id = 'singleton'
         AND "leaderInstanceId" = $1
         AND "generation" = $2`,
      this.instanceId,
      this.currentGeneration,
    );

    this.isLeaderFlag = false;
    this.currentGeneration = 0;
  }
}
