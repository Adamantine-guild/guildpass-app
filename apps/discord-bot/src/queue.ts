/**
 * Rate-limit-aware reconciliation queue for Discord role operations.
 *
 * Key properties:
 * - Bounded concurrency: at most `maxConcurrency` reconciliations run at once,
 *   configurable via QUEUE_MAX_CONCURRENCY env var (default 5).
 * - Per-guild serialization: operations for the same guild are always serialized
 *   even if they arrive concurrently — this avoids two syncs racing on the same
 *   member set and producing flapping add/remove cycles.
 * - Retry with jittered exponential backoff: transient failures (HTTP 429, 5xx,
 *   network errors) are retried up to `maxRetries` times before giving up.
 * - 429-aware: when Discord returns Retry-After, the operation sleeps for exactly
 *   that duration before retrying.
 * - Metrics emission: every enqueue / dequeue / success / failure fires a
 *   callback so callers can funnel data into structured-logging/metrics systems.
 *
 * Usage:
 * ```ts
 * const queue = new RoleReconciliationQueue({ maxConcurrency: 3 });
 * queue.onMetrics((event) => logger.info("queue", event));
 * await queue.enqueue(guildId, async () => {
 *   await reconcileMemberRoles(member, desired);
 * });
 * ```
 */

export interface QueueMetrics {
  event: "enqueued" | "dequeued" | "completed" | "failed" | "retry" | "ratelimited";
  guildId: string;
  timestamp: number;
  queueDepth: number;
  activeCount: number;
  /** Present on retry / ratelimited events */
  attempt?: number;
  /** Present on failed events */
  error?: string;
}

export type MetricsHandler = (metrics: QueueMetrics) => void;

export interface QueueOptions {
  /** Maximum concurrent reconciliations across all guilds (default 5). */
  maxConcurrency?: number;
  /** Maximum retry attempts for transient failures (default 3). */
  maxRetries?: number;
  /** Base backoff delay in ms (default 1000). Doubles each attempt with jitter. */
  baseBackoffMs?: number;
  /** Maximum backoff cap in ms (default 30000). */
  maxBackoffMs?: number;
}

interface QueueEntry {
  guildId: string;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class RoleReconciliationQueue {
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  /** Global FIFO queue for pending operations. */
  private readonly pending: QueueEntry[] = [];
  /** How many operations are currently in-flight. */
  private activeCount = 0;
  /** Per-guild locks: while a guild has an active op, subsequent ops for that
   * guild wait in the pending queue (not skipped).  We enforce strict per-guild
   * serialization via a simple Set of guilds with in-flight work. */
  private readonly activeGuilds = new Set<string>();
  /** Metrics subscribers. */
  private metricsHandlers: MetricsHandler[] = [];

  constructor(options: QueueOptions = {}) {
    this.maxConcurrency =
      options.maxConcurrency ??
      (typeof process !== "undefined"
        ? parseInt(process.env.QUEUE_MAX_CONCURRENCY ?? "5", 10)
        : 5);
    this.maxRetries = options.maxRetries ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30000;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Register a callback to receive structured metrics events. */
  onMetrics(handler: MetricsHandler): void {
    this.metricsHandlers.push(handler);
  }

  // For testing
  removeAllMetricsHandlers(): void {
    this.metricsHandlers = [];
  }

  /**
   * Enqueue a role-reconciliation task for a specific guild.
   * Tasks for the same guild are guaranteed to run sequentially.
   * Returns a promise that resolves/rejects with the task's outcome.
   */
  enqueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        guildId,
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.emitMetrics({
        event: "enqueued",
        guildId,
        timestamp: Date.now(),
        queueDepth: this.pending.length,
        activeCount: this.activeCount,
      });

      // Kick the processing loop (idempotent — will no-op if at capacity).
      this.processNext();
    });
  }

  /** Expose current state for observability. */
  get state() {
    return {
      pending: this.pending.length,
      active: this.activeCount,
      activeGuilds: this.activeGuilds.size,
    };
  }

  // ── Internal processing ─────────────────────────────────────────────────

  private processNext(): void {
    // Drain as many tasks as concurrency allows.
    while (this.activeCount < this.maxConcurrency && this.pending.length > 0) {
      // Find the first pending task whose guild is not currently active.
      const idx = this.pending.findIndex(
        (entry) => !this.activeGuilds.has(entry.guildId),
      );

      if (idx === -1) {
        // All pending tasks are for guilds that already have work in-flight.
        // We must wait for those to finish before we can pick up the next one
        // for the same guild — this is the per-guild serialization guarantee.
        break;
      }

      const [entry] = this.pending.splice(idx, 1);
      this.activeCount++;
      this.activeGuilds.add(entry.guildId);

      this.emitMetrics({
        event: "dequeued",
        guildId: entry.guildId,
        timestamp: Date.now(),
        queueDepth: this.pending.length,
        activeCount: this.activeCount,
      });

      // Fire-and-forget the task; processNext will be called again on completion.
      void this.executeWithRetries(entry).finally(() => {
        // noop — cleanup is inside executeWithRetries
      });
    }
  }

  private async executeWithRetries(entry: QueueEntry): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await entry.task();

        // Success path
        this.onTaskComplete(entry, null);
        entry.resolve(result);
        return;
      } catch (err: unknown) {
        lastError = err;

        // Determine if this is retryable.
        const statusCode = extractHttpStatus(err);
        const retryable =
          statusCode === 429 || // rate limited
          (statusCode !== null && statusCode >= 500) || // server error
          !statusCode; // network error (no HTTP status)

        if (!retryable || attempt >= this.maxRetries) {
          break; // give up
        }

        // Handle 429 with Retry-After header.
        if (statusCode === 429) {
          const retryAfter = extractRetryAfter(err);
          this.emitMetrics({
            event: "ratelimited",
            guildId: entry.guildId,
            timestamp: Date.now(),
            queueDepth: this.pending.length,
            activeCount: this.activeCount,
            attempt: attempt + 1,
          });

          if (retryAfter > 0) {
            await sleep(retryAfter * 1000);
            continue;
          }
        }

        // Exponential backoff with jitter.
        const delay = Math.min(
          this.baseBackoffMs * Math.pow(2, attempt) + Math.random() * 1000,
          this.maxBackoffMs,
        );

        this.emitMetrics({
          event: "retry",
          guildId: entry.guildId,
          timestamp: Date.now(),
          queueDepth: this.pending.length,
          activeCount: this.activeCount,
          attempt: attempt + 1,
        });

        await sleep(delay);
      }
    }

    // All retries exhausted — terminal failure.
    this.emitMetrics({
      event: "failed",
      guildId: entry.guildId,
      timestamp: Date.now(),
      queueDepth: this.pending.length,
      activeCount: this.activeCount,
      error: String(lastError),
    });

    this.onTaskComplete(entry, lastError);
    entry.reject(lastError);
  }

  private onTaskComplete(entry: QueueEntry, error: unknown): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.activeGuilds.delete(entry.guildId);

    if (!error) {
      this.emitMetrics({
        event: "completed",
        guildId: entry.guildId,
        timestamp: Date.now(),
        queueDepth: this.pending.length,
        activeCount: this.activeCount,
      });
    }

    // Try to drain the queue again now that we freed a slot.
    this.processNext();
  }

  private emitMetrics(m: QueueMetrics): void {
    for (const handler of this.metricsHandlers) {
      try {
        handler(m);
      } catch {
        // Metrics should never crash the queue.
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Attempt to extract an HTTP status code from an error object.
 * discord.js REST errors carry the HTTP status in `error.status` or `error.httpStatus`.
 */
function extractHttpStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as Record<string, unknown>;
  if (typeof e.status === "number") return e.status as number;
  if (typeof e.httpStatus === "number") return e.httpStatus as number;
  if (typeof e.code === "number") return e.code as number;
  return null;
}

/**
 * Extract `Retry-After` (seconds) from a Discord 429 error.
 * discord.js stores this in `error.retryAfter` (ms) or raw response headers.
 */
function extractRetryAfter(err: unknown): number {
  if (typeof err !== "object" || err === null) return 0;
  const e = err as Record<string, unknown>;

  // discord.js REST errors expose retryAfter in milliseconds.
  if (typeof e.retryAfter === "number") {
    return Math.ceil((e.retryAfter as number) / 1000);
  }

  // Raw response path (unlikely but defensive).
  const raw = e.rawError as Record<string, unknown> | undefined;
  if (raw?.retry_after && typeof raw.retry_after === "number") {
    return raw.retry_after as number;
  }

  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
