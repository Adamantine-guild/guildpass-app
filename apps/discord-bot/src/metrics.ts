/**
 * Structured logging and metrics module for the Discord bot.
 *
 * Provides lightweight observability hooks so queue depth, reconciliation
 * failure rates, and retry counts can be surfaced to external monitoring
 * without pulling in heavy dependencies.
 *
 * In production, replace the default `console` transport with your preferred
 * logger (e.g. pino, winston, or an OTel exporter).
 */

import type { QueueMetrics } from "./queue.js";

export interface ReconMetrics {
  /** Total reconciliations attempted (success + failure). */
  attempted: number;
  /** Successful reconciliations. */
  succeeded: number;
  /** Failed reconciliations (all retries exhausted). */
  failed: number;
  /** Total retry events emitted. */
  retries: number;
  /** Total rate-limit (429) events emitted. */
  rateLimited: number;
  /** Rolling average queue depth snapshot. */
  lastQueueDepth: number;
}

// ── In-memory counters (reset on process restart) ────────────────────────

const counters: ReconMetrics = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  retries: 0,
  rateLimited: 0,
  lastQueueDepth: 0,
};

// ── Public API ────────────────────────────────────────────────────────────

/** Return a frozen snapshot of current counters. */
export function getMetrics(): Readonly<ReconMetrics> {
  return Object.freeze({ ...counters });
}

/** Reset all counters (useful in tests). */
export function resetMetrics(): void {
  counters.attempted = 0;
  counters.succeeded = 0;
  counters.failed = 0;
  counters.retries = 0;
  counters.rateLimited = 0;
  counters.lastQueueDepth = 0;
}

/**
 * Return a MetricsHandler suitable for passing to
 * `RoleReconciliationQueue.onMetrics()`.  Updates internal counters and
 * logs each event as structured JSON to stderr (so stdout stays clean for
 * process managers).
 */
export function createMetricsHandler(): (m: QueueMetrics) => void {
  return (m: QueueMetrics) => {
    // Update counters
    counters.lastQueueDepth = m.queueDepth;

    switch (m.event) {
      case "enqueued":
        counters.attempted++;
        break;
      case "completed":
        counters.succeeded++;
        break;
      case "failed":
        counters.failed++;
        break;
      case "retry":
        counters.retries++;
        break;
      case "ratelimited":
        counters.rateLimited++;
        break;
    }

    // Structured log line (JSON-per-line for easy ingestion).
    const logLine = JSON.stringify({
      ts: new Date(m.timestamp).toISOString(),
      module: "recon-queue",
      ...m,
    });

    // Log to stderr to avoid interfering with potential stdout piping.
    process.stderr.write(logLine + "\n");
  };
}
