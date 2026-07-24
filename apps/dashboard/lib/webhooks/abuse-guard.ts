import type { NextRequest } from "next/server";

/**
 * Abuse guards for the webhook ingestion endpoint: payload size limiting,
 * rate limiting of repeated failed verifications, and structured rejection
 * logging. Lives in the dashboard (not @guildpass/webhook-utils) because
 * these are transport concerns around the cryptographic verification step.
 */

export const WEBHOOK_REJECTION_REASONS = [
  "oversized_payload",
  "invalid_signature",
  "expired_timestamp",
  "rate_limited",
  "malformed_header",
] as const;

export type WebhookRejectionReason = (typeof WEBHOOK_REJECTION_REASONS)[number];

export type WebhookAbuseLimits = {
  /** Maximum accepted request body size in bytes (default 256 KB). */
  maxBodyBytes: number;
  /** Failed verifications allowed per source per window before 429 (default 10). */
  invalidAttemptLimit: number;
  /** Sliding window length in milliseconds (default 60_000). */
  windowMs: number;
};

const DEFAULT_LIMITS: WebhookAbuseLimits = {
  maxBodyBytes: 256 * 1024,
  invalidAttemptLimit: 10,
  windowMs: 60_000,
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

/** Read limits from the environment, falling back to documented defaults. */
export function getWebhookAbuseLimits(
  env: Record<string, string | undefined> = process.env
): WebhookAbuseLimits {
  return {
    maxBodyBytes: parsePositiveInt(env.WEBHOOK_MAX_BODY_BYTES, DEFAULT_LIMITS.maxBodyBytes),
    invalidAttemptLimit: parsePositiveInt(
      env.WEBHOOK_INVALID_ATTEMPT_LIMIT,
      DEFAULT_LIMITS.invalidAttemptLimit
    ),
    windowMs: parsePositiveInt(env.WEBHOOK_RATE_LIMIT_WINDOW_MS, DEFAULT_LIMITS.windowMs),
  };
}

/**
 * Best-effort source identifier for rate limiting and logs. Uses the first
 * address of x-forwarded-for, then x-real-ip, then "unknown". Never logs
 * anything beyond this identifier.
 */
export function getClientSource(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  return "unknown";
}

/**
 * Map a verifySignature error message to a stable rejection reason. Kept
 * string-based so the mapping never leaks the underlying error detail to
 * clients or logs beyond the reason enum.
 */
export function classifyVerificationError(error: string | undefined): WebhookRejectionReason {
  if (!error) return "invalid_signature";
  const lower = error.toLowerCase();
  if (lower.includes("timestamp too old") || lower.includes("timestamp in future")) {
    return "expired_timestamp";
  }
  if (
    lower.includes("missing or invalid signature header") ||
    lower.includes("invalid or missing timestamp") ||
    lower.includes("invalid or missing signature")
  ) {
    return "malformed_header";
  }
  return "invalid_signature";
}

/**
 * Emit one structured JSON log line per webhook rejection. NEVER include the
 * webhook secret, the signature header value, or the request body here —
 * only metadata needed for alerting.
 */
export function logWebhookRejection(entry: {
  reason: WebhookRejectionReason;
  source: string;
  endpoint: string;
  status: number;
  contentLength?: number;
}): void {
  console.warn(
    JSON.stringify({
      event: "webhook_rejected",
      reason: entry.reason,
      source: entry.source,
      endpoint: entry.endpoint,
      status: entry.status,
      ...(entry.contentLength !== undefined ? { contentLength: entry.contentLength } : {}),
      ts: new Date().toISOString(),
    })
  );
}

/**
 * In-process sliding-window rate limiter counting failed verification
 * attempts per source key. Successful verifications reset the source's
 * window so legitimate senders with an occasional bad clock are not
 * punished. State is per-process; for multi-instance deployments back this
 * with the shared storage abstraction instead.
 */
export class WebhookRateLimiter {
  private failures = new Map<string, number[]>();
  private limit: number;
  private windowMs: number;
  private readonly now: () => number;

  constructor(opts: { limit: number; windowMs: number; now?: () => number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  private prune(key: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    const kept = (this.failures.get(key) ?? []).filter((ts) => ts > cutoff);
    if (kept.length === 0) {
      this.failures.delete(key);
    } else {
      this.failures.set(key, kept);
    }
    return kept;
  }

  /** True when the source has exhausted its failed-attempt budget. */
  isLimited(key: string): boolean {
    return this.prune(key, this.now()).length >= this.limit;
  }

  /** Record one failed verification attempt for the source. */
  recordFailure(key: string): void {
    const kept = this.prune(key, this.now());
    kept.push(this.now());
    this.failures.set(key, kept);
  }

  /** Clear the failure window after a successful verification. */
  recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  /** Test hook: drop all tracked state. */
  clear(): void {
    this.failures.clear();
  }

  /** Update limit/window without dropping tracked state. */
  reconfigure(limits: { limit: number; windowMs: number }): void {
    this.limit = limits.limit;
    this.windowMs = limits.windowMs;
  }
}

let sharedLimiter: WebhookRateLimiter | undefined;

/**
 * Limiter singleton used by the webhook route. Config is re-read from the
 * environment on every call so env changes apply without a restart, while
 * tracked state survives reconfiguration.
 */
export function getSharedWebhookRateLimiter(): WebhookRateLimiter {
  const limits = getWebhookAbuseLimits();
  if (!sharedLimiter) {
    sharedLimiter = new WebhookRateLimiter({
      limit: limits.invalidAttemptLimit,
      windowMs: limits.windowMs,
    });
  } else {
    sharedLimiter.reconfigure({
      limit: limits.invalidAttemptLimit,
      windowMs: limits.windowMs,
    });
  }
  return sharedLimiter;
}
