/**
 * lib/api-errors.ts
 *
 * Typed API errors that distinguish *expected, client-safe* failures from
 * *unexpected, internal* ones.
 *
 * Why this exists: `handleApiError` used to return `err.message` verbatim for
 * every thrown error, which leaks repository/config/stack-derived details to
 * dashboard clients. Errors that extend `PublicApiError` opt in to having their
 * message and status returned to the client; everything else is treated as an
 * internal failure and answered with a generic 500 (full detail stays in the
 * server logs, correlated by an error id).
 */

/**
 * Base class for errors whose message is safe to return to the client.
 * Carries an explicit HTTP status code.
 */
export class PublicApiError extends Error {
  readonly statusCode: number;
  /** Marker the error handler checks so only intentional errors are exposed. */
  readonly expose = true as const;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "PublicApiError";
    this.statusCode = statusCode;
  }
}

/** 400 — the request was malformed or failed validation. */
export class ValidationError extends PublicApiError {
  /** Optional field-level details, mirroring the existing activity route shape. */
  readonly fields?: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    fields?: Array<{ field: string; message: string }>
  ) {
    super(message, 400);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

/** 403 — the caller is authenticated but lacks permission. */
export class ForbiddenError extends PublicApiError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends PublicApiError {
  constructor(message = "Resource not found.") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

/** 409 — the request conflicts with the current server state (e.g. version mismatch). */
export class ConflictError extends PublicApiError {
  constructor(message = "This resource was updated elsewhere — refresh and retry.") {
    super(message, 409);
    this.name = "ConflictError";
  }
}

/**
 * Type guard: does this value carry a client-safe message + status?
 * Accepts `PublicApiError` and any other error that opts in with the same
 * `expose` + numeric `statusCode` contract (e.g. PermissionDeniedError).
 */
export function isPublicApiError(
  err: unknown
): err is { message: string; statusCode: number } {
  if (err instanceof PublicApiError) return true;
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number" &&
    "expose" in err &&
    (err as { expose: unknown }).expose === true
  );
}
