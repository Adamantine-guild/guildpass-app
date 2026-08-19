import type { ErrorCode } from "./errorCodes.js";

/**
 * Options for constructing a GuildPassError or one of its subclasses.
 */
export interface GuildPassErrorOptions {
  /** A human-readable description of the error. */
  message?: string;
  /** The error code identifying the type of error. */
  code?: ErrorCode;
  /** Optional HTTP status code associated with the error. */
  statusCode?: number;
  /** Additional structured metadata or details. */
  details?: unknown;
  /** The underlying cause of the error. */
  cause?: unknown;
}

/**
 * Interface representing common error properties across GuildPass errors.
 */
export interface IGuildPassError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly statusCode?: number;
  readonly details?: unknown;
  readonly cause?: unknown;
}
