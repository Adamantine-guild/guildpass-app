import type { ErrorCode } from "./errorCodes.js";
import { ErrorCodes } from "./errorCodes.js";
import type { GuildPassErrorOptions, IGuildPassError } from "./error.types.js";

/**
 * Base error class for all GuildPass SDK and platform errors.
 *
 * Every specific error subclass inherits from `GuildPassError`, preserving
 * `instanceof GuildPassError` checks and maintaining the `code` property for
 * backward compatibility with string-based checks.
 */
export class GuildPassError extends Error implements IGuildPassError {
  readonly code: ErrorCode;
  readonly statusCode?: number;
  readonly details?: unknown;
  readonly cause?: unknown;

  constructor(message?: string, options: GuildPassErrorOptions = {}) {
    const msg = message || options.message || "An unexpected GuildPass error occurred.";
    super(msg);
    this.name = new.target.name || "GuildPassError";
    this.code = options.code ?? ErrorCodes.INTERNAL_ERROR;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.cause = options.cause;

    // Restore prototype chain for proper `instanceof` support across transpilation targets
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Format the error as a JSON object suitable for serialization or logging.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.statusCode !== undefined ? { statusCode: this.statusCode } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.cause !== undefined ? { cause: this.cause } : {}),
    };
  }
}
