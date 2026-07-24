/**
 * Typed error classes for the HTTP transport.
 *
 * Every error surfaced by HttpClient is one of these, so callers can use
 * `instanceof` to distinguish error classes and render appropriate UI states
 * (e.g. "GuildPass core is temporarily unavailable" for CircuitOpenError
 * vs. a degraded partial-state view for TimeoutError).
 *
 * @module
 */

/**
 * Thrown when a request exceeds its configured timeout.
 *
 * Distinguishable from network errors by its `code === "timeout"` and its
 * distinct constructor name `TimeoutError`.
 */
export class TimeoutError extends Error {
  readonly code = "timeout" as const;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `Request timed out after ${timeoutMs}ms. The upstream may be slow or unreachable.`,
    );
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when an upstream responds with an error status after all retries
 * have been exhausted, or when the transport encounters a non-retryable
 * upstream signal (e.g. a 4xx that wasn't a 429).
 *
 * Carries the HTTP status code so callers can differentiate 503 (overloaded)
 * from 502 (bad gateway) from 404 (not found, treated as non-error by some
 * callers).
 */
export class UpstreamError extends Error {
  readonly code = "upstream" as const;
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText?: string) {
    super(
      `Upstream responded with ${status}${
        statusText ? ` (${statusText})` : ""
      }${
        status >= 500
          ? ". The upstream may be experiencing issues; retry later."
          : ""
      }`,
    );
    this.name = "UpstreamError";
    this.status = status;
    this.statusText = statusText ?? "";
  }
}

/**
 * Thrown when a fetch-level error (network, DNS, TLS, etc.) makes a request
 * impossible — distinct from an upstream that responded with 5xx.
 */
export class NetworkError extends Error {
  readonly code = "network" as const;
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `Network error: ${cause.message}`
        : "A network error occurred while trying to reach the upstream.",
    );
    this.name = "NetworkError";
    this.cause = cause;
  }
}
