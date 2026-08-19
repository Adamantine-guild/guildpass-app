import { ErrorCodes } from "./errorCodes.js";
import { GuildPassError } from "./GuildPassError.js";
import type { GuildPassErrorOptions } from "./error.types.js";

/**
 * Thrown when a network-level failure occurs (DNS, connection reset, offline, TLS, etc.).
 */
export class NetworkError extends GuildPassError {
  constructor(messageOrCause?: string | unknown, options?: GuildPassErrorOptions) {
    if (typeof messageOrCause === "string") {
      super(messageOrCause, {
        ...options,
        code: options?.code ?? ErrorCodes.NETWORK_ERROR,
      });
    } else {
      const cause = messageOrCause;
      const message =
        cause instanceof Error
          ? `Network error: ${cause.message}`
          : "A network error occurred while communicating with the GuildPass service.";
      super(message, {
        ...options,
        code: options?.code ?? ErrorCodes.NETWORK_ERROR,
        cause: options?.cause ?? cause,
      });
    }
  }
}

/**
 * Thrown when a request exceeds its configured timeout duration.
 */
export class TimeoutError extends GuildPassError {
  readonly timeoutMs: number;

  constructor(
    messageOrTimeoutMs?: string | number,
    options?: GuildPassErrorOptions & { timeoutMs?: number },
  ) {
    if (typeof messageOrTimeoutMs === "number") {
      const timeoutMs = messageOrTimeoutMs;
      super(
        `Request timed out after ${timeoutMs}ms. The upstream may be slow or unreachable.`,
        {
          ...options,
          code: options?.code ?? ErrorCodes.TIMEOUT_ERROR,
          statusCode: options?.statusCode ?? 504,
        },
      );
      this.timeoutMs = timeoutMs;
    } else {
      const timeoutMs = options?.timeoutMs ?? 0;
      super(
        messageOrTimeoutMs ||
          `Request timed out after ${timeoutMs}ms. The upstream may be slow or unreachable.`,
        {
          ...options,
          code: options?.code ?? ErrorCodes.TIMEOUT_ERROR,
          statusCode: options?.statusCode ?? 504,
        },
      );
      this.timeoutMs = timeoutMs;
    }
  }
}

/**
 * Thrown when an upstream service responds with an error status (5xx / 4xx) or unexpected payload.
 */
export class UpstreamError extends GuildPassError {
  readonly status: number;
  readonly statusText: string;

  constructor(
    statusOrMessage?: number | string,
    statusTextOrOptions?: string | (GuildPassErrorOptions & { status?: number; statusText?: string }),
  ) {
    if (typeof statusOrMessage === "number") {
      const status = statusOrMessage;
      const statusText = typeof statusTextOrOptions === "string" ? statusTextOrOptions : undefined;
      const message = `Upstream responded with ${status}${
        statusText ? ` (${statusText})` : ""
      }${
        status >= 500
          ? ". The upstream may be experiencing issues; retry later."
          : ""
      }`;
      super(message, {
        code: ErrorCodes.UPSTREAM_ERROR,
        statusCode: status,
        details: typeof statusTextOrOptions === "object" ? statusTextOrOptions?.details : undefined,
        cause: typeof statusTextOrOptions === "object" ? statusTextOrOptions?.cause : undefined,
      });
      this.status = status;
      this.statusText = statusText ?? "";
    } else {
      const options = typeof statusTextOrOptions === "object" ? statusTextOrOptions : {};
      const status = options?.status ?? options?.statusCode ?? 500;
      super(statusOrMessage || "Upstream service error.", {
        ...options,
        code: options?.code ?? ErrorCodes.UPSTREAM_ERROR,
        statusCode: status,
      });
      this.status = status;
      this.statusText = options?.statusText ?? "";
    }
  }
}

/**
 * Thrown when the circuit breaker is open and fast-fails requests without network I/O.
 */
export class CircuitOpenError extends GuildPassError {
  readonly retryAt: number;

  constructor(
    retryAtOrMessage?: number | string,
    options?: GuildPassErrorOptions & { retryAt?: number },
  ) {
    if (typeof retryAtOrMessage === "number") {
      const retryAt = retryAtOrMessage;
      super(
        "Circuit is open: upstream is failing, request rejected without contacting the network.",
        {
          ...options,
          code: options?.code ?? ErrorCodes.CIRCUIT_OPEN,
          statusCode: options?.statusCode ?? 503,
        },
      );
      this.retryAt = retryAt;
    } else {
      const retryAt = options?.retryAt ?? 0;
      super(
        retryAtOrMessage ||
          "Circuit is open: upstream is failing, request rejected without contacting the network.",
        {
          ...options,
          code: options?.code ?? ErrorCodes.CIRCUIT_OPEN,
          statusCode: options?.statusCode ?? 503,
        },
      );
      this.retryAt = retryAt;
    }
  }
}

/**
 * Thrown when client or SDK configuration is invalid or missing required parameters.
 */
export class InvalidConfigError extends GuildPassError {
  constructor(
    message = "Invalid or missing configuration provided.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.INVALID_CONFIG,
      statusCode: options?.statusCode ?? 400,
    });
  }
}

/**
 * Thrown when access to a resource or action is denied due to permission constraints.
 */
export class AccessDeniedError extends GuildPassError {
  constructor(
    message = "Access denied. You do not have permission to perform this action.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.ACCESS_DENIED,
      statusCode: options?.statusCode ?? 403,
    });
  }
}

/**
 * Thrown when authentication credentials are missing, invalid, or expired (HTTP 401).
 */
export class UnauthorizedError extends GuildPassError {
  constructor(
    message = "Authentication required. Missing or invalid credentials.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.UNAUTHORIZED,
      statusCode: options?.statusCode ?? 401,
    });
  }
}

/**
 * Thrown when authenticated caller is forbidden from performing the requested action (HTTP 403).
 */
export class ForbiddenError extends GuildPassError {
  constructor(
    message = "Forbidden. You do not have permission to access this resource.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.FORBIDDEN,
      statusCode: options?.statusCode ?? 403,
    });
  }
}

/**
 * Thrown when a requested resource does not exist (HTTP 404).
 */
export class NotFoundError extends GuildPassError {
  constructor(
    message = "The requested resource was not found.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.NOT_FOUND,
      statusCode: options?.statusCode ?? 404,
    });
  }
}

/**
 * Thrown when request payload or parameters fail validation checks.
 */
export class ValidationError extends GuildPassError {
  readonly fields?: Array<{ field: string; message: string }>;

  constructor(
    message = "Validation failed for the provided input.",
    options?: GuildPassErrorOptions & {
      fields?: Array<{ field: string; message: string }>;
    },
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.VALIDATION_ERROR,
      statusCode: options?.statusCode ?? 400,
    });
    this.fields = options?.fields;
  }
}

/**
 * Thrown when rate limit thresholds have been exceeded (HTTP 429).
 */
export class RateLimitError extends GuildPassError {
  readonly retryAfter?: number;

  constructor(
    message = "Rate limit exceeded. Please retry later.",
    options?: GuildPassErrorOptions & { retryAfter?: number },
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.RATE_LIMIT_EXCEEDED,
      statusCode: options?.statusCode ?? 429,
    });
    this.retryAfter = options?.retryAfter;
  }
}

export { RateLimitError as RateLimitExceededError };

/**
 * Thrown when a request conflicts with the current resource state (HTTP 409).
 */
export class ConflictError extends GuildPassError {
  constructor(
    message = "A conflict occurred with the current state of the resource.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.CONFLICT,
      statusCode: options?.statusCode ?? 409,
    });
  }
}

/**
 * Thrown when an internal server or unexpected operational error occurs (HTTP 500).
 */
export class InternalError extends GuildPassError {
  constructor(
    message = "An internal server error occurred.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.INTERNAL_ERROR,
      statusCode: options?.statusCode ?? 500,
    });
  }
}

/**
 * Thrown when a smart contract interaction, RPC invocation, or decoding fails.
 */
export class ContractError extends GuildPassError {
  constructor(
    message = "Smart contract invocation or RPC error occurred.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.CONTRACT_ERROR,
    });
  }
}

/**
 * Thrown when cryptographic signature verification fails.
 */
export class InvalidSignatureError extends GuildPassError {
  constructor(
    message = "Cryptographic signature is missing or invalid.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.INVALID_SIGNATURE,
      statusCode: options?.statusCode ?? 401,
    });
  }
}

/**
 * Thrown when the client request is malformed or bad (HTTP 400).
 */
export class BadRequestError extends GuildPassError {
  constructor(
    message = "Bad request. The request could not be understood.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.BAD_REQUEST,
      statusCode: options?.statusCode ?? 400,
    });
  }
}

/**
 * Thrown when an unsupported operation or feature is requested.
 */
export class UnsupportedError extends GuildPassError {
  constructor(
    message = "This operation or feature is not supported in the current environment.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.UNSUPPORTED,
      statusCode: options?.statusCode ?? 501,
    });
  }
}

/**
 * Thrown when a guild membership is not found.
 */
export class MembershipNotFoundError extends NotFoundError {
  constructor(
    message = "Membership record not found.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.MEMBERSHIP_NOT_FOUND,
    });
  }
}

/**
 * Thrown when a guild is not found.
 */
export class GuildNotFoundError extends NotFoundError {
  constructor(
    message = "Guild not found.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.GUILD_NOT_FOUND,
    });
  }
}

/**
 * Thrown when a pass is not found.
 */
export class PassNotFoundError extends NotFoundError {
  constructor(
    message = "Pass not found.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.PASS_NOT_FOUND,
    });
  }
}

/**
 * Thrown when an unknown or unclassified error occurs.
 */
export class UnknownError extends GuildPassError {
  constructor(
    message = "An unknown error occurred.",
    options?: GuildPassErrorOptions,
  ) {
    super(message, {
      ...options,
      code: options?.code ?? ErrorCodes.UNKNOWN_ERROR,
    });
  }
}
