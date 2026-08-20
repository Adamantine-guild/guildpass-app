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

export {
  TimeoutError,
  UpstreamError,
  NetworkError,
} from "../errors/index.js";
