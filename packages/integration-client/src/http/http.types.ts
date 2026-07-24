import type { CircuitBreakerConfig } from "./circuitBreaker.js";
export type { CircuitBreakerConfig };

// Re-export typed error classes so consumers can import them from a single
// path (@guildpass/integration-client) rather than digging into ./errors.js.
export { TimeoutError, UpstreamError, NetworkError } from "./errors.js";
/**
 * Retry configuration for a single HTTP request (or the default for all
 * requests on a client when set via {@link TransportConfig.retry}).
 *
 * Defaults (used when a field is omitted):
 * - `maxAttempts` defaults to `3` (via DEFAULT_RETRY_CONFIG). Set `maxAttempts: 1` to disable retries.
 * - `delay` defaults to `200` ms between attempts (via DEFAULT_RETRY_CONFIG).
 * - `backoff` defaults to `true` (exponential backoff) (via DEFAULT_RETRY_CONFIG).
 */
export interface RetryConfig {
  /** Maximum number of attempts before giving up. `1` = no retry. */
  maxAttempts: number;
  /** Base delay between attempts, in milliseconds. */
  delay?: number; // ms
  /** When `true`, use exponential backoff: `delay * 2^(attempt-1)`. */
  backoff?: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delay: 200,
  backoff: true,
};

/**
 * Per-request options accepted by `HttpClient.request` and every client method.
 *
 * Extends the standard `RequestInit` (minus `signal`, which is reserved for
 * abort control) and adds `timeout` and `retry`.
 *
 * Note: a per-request `timeout`/`retry` overrides the client-level defaults
 * supplied through {@link TransportConfig}.
 */
export interface HttpRequestOptions extends Omit<RequestInit, "signal"> {
  /** Per-request timeout in milliseconds. Overrides {@link TransportConfig.timeout}. No timeout when omitted. */
  timeout?: number; // ms
  /** Per-request retry strategy. Overrides {@link TransportConfig.retry}. */
  retry?: RetryConfig;
  /** Abort signal for cancelling the request. */
  signal?: AbortSignal;
}

/**
 * Client-level transport configuration for {@link IntegrationClientOptions.transport}.
 *
 * These values become the **defaults** applied to every request unless a
 * per-request {@link HttpRequestOptions} overrides them.
 *
 * Defaults (used when a field is omitted):
 * - `fetch` defaults to the global `fetch`.
 * - `timeout` is **unset** (no timeout) unless provided.
 * - `retry` defaults to `DEFAULT_RETRY_CONFIG` (3 attempts, 200ms base delay, exponential backoff).
 */
export interface TransportConfig {
  /** Custom fetch implementation (e.g. for Node < 18, testing, or proxies). Default: global `fetch`. */
  fetch?: typeof fetch;
  /** Default request timeout in milliseconds. Default: no timeout. */
  timeout?: number;
  /** Default retry strategy for all requests. Default: 3 attempts with backoff. */
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
}
