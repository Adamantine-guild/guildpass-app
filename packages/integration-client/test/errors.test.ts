import test from "node:test";
import assert from "node:assert";
import {
  GuildPassError,
  ErrorCodes,
  NetworkError,
  TimeoutError,
  UpstreamError,
  CircuitOpenError,
  InvalidConfigError,
  AccessDeniedError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  RateLimitExceededError,
  ConflictError,
  InternalError,
  ContractError,
  InvalidSignatureError,
  BadRequestError,
  UnsupportedError,
  MembershipNotFoundError,
  GuildNotFoundError,
  PassNotFoundError,
  UnknownError,
} from "../src/index.js";

test("GuildPassError - base error class behavior", () => {
  const err = new GuildPassError("Something failed", {
    code: ErrorCodes.INTERNAL_ERROR,
    statusCode: 500,
    details: { reason: "Database unavailable" },
  });

  assert.strictEqual(err instanceof Error, true);
  assert.strictEqual(err instanceof GuildPassError, true);
  assert.strictEqual(err.name, "GuildPassError");
  assert.strictEqual(err.message, "Something failed");
  assert.strictEqual(err.code, "INTERNAL_ERROR");
  assert.strictEqual(err.statusCode, 500);
  assert.deepStrictEqual(err.details, { reason: "Database unavailable" });

  const json = err.toJSON();
  assert.strictEqual(json.name, "GuildPassError");
  assert.strictEqual(json.code, "INTERNAL_ERROR");
  assert.strictEqual(json.message, "Something failed");
  assert.strictEqual(json.statusCode, 500);
});

test("GuildPassError - defaults when instantiated without options", () => {
  const err = new GuildPassError();
  assert.strictEqual(err instanceof GuildPassError, true);
  assert.strictEqual(err.code, ErrorCodes.INTERNAL_ERROR);
  assert.ok(err.message.length > 0);
});

test("Typed error subclasses - instanceof and code checks for every subclass", () => {
  const testCases: Array<{
    name: string;
    instance: GuildPassError;
    expectedClass: any;
    expectedCode: string;
  }> = [
    {
      name: "NetworkError",
      instance: new NetworkError("DNS resolution failed"),
      expectedClass: NetworkError,
      expectedCode: ErrorCodes.NETWORK_ERROR,
    },
    {
      name: "NetworkError with Error cause",
      instance: new NetworkError(new TypeError("fetch failed")),
      expectedClass: NetworkError,
      expectedCode: ErrorCodes.NETWORK_ERROR,
    },
    {
      name: "TimeoutError",
      instance: new TimeoutError(5000),
      expectedClass: TimeoutError,
      expectedCode: ErrorCodes.TIMEOUT_ERROR,
    },
    {
      name: "TimeoutError with custom message",
      instance: new TimeoutError("Custom timeout message", { timeoutMs: 3000 }),
      expectedClass: TimeoutError,
      expectedCode: ErrorCodes.TIMEOUT_ERROR,
    },
    {
      name: "UpstreamError",
      instance: new UpstreamError(503, "Service Unavailable"),
      expectedClass: UpstreamError,
      expectedCode: ErrorCodes.UPSTREAM_ERROR,
    },
    {
      name: "UpstreamError with message",
      instance: new UpstreamError("Upstream gateway error", { status: 502 }),
      expectedClass: UpstreamError,
      expectedCode: ErrorCodes.UPSTREAM_ERROR,
    },
    {
      name: "CircuitOpenError",
      instance: new CircuitOpenError(Date.now() + 30000),
      expectedClass: CircuitOpenError,
      expectedCode: ErrorCodes.CIRCUIT_OPEN,
    },
    {
      name: "InvalidConfigError",
      instance: new InvalidConfigError("Missing API key"),
      expectedClass: InvalidConfigError,
      expectedCode: ErrorCodes.INVALID_CONFIG,
    },
    {
      name: "AccessDeniedError",
      instance: new AccessDeniedError("Role insufficient"),
      expectedClass: AccessDeniedError,
      expectedCode: ErrorCodes.ACCESS_DENIED,
    },
    {
      name: "UnauthorizedError",
      instance: new UnauthorizedError("Invalid token"),
      expectedClass: UnauthorizedError,
      expectedCode: ErrorCodes.UNAUTHORIZED,
    },
    {
      name: "ForbiddenError",
      instance: new ForbiddenError("Forbidden resource"),
      expectedClass: ForbiddenError,
      expectedCode: ErrorCodes.FORBIDDEN,
    },
    {
      name: "NotFoundError",
      instance: new NotFoundError("Guild not found"),
      expectedClass: NotFoundError,
      expectedCode: ErrorCodes.NOT_FOUND,
    },
    {
      name: "ValidationError",
      instance: new ValidationError("Invalid payload", {
        fields: [{ field: "name", message: "Name is required" }],
      }),
      expectedClass: ValidationError,
      expectedCode: ErrorCodes.VALIDATION_ERROR,
    },
    {
      name: "RateLimitError",
      instance: new RateLimitError("Too many requests", { retryAfter: 60 }),
      expectedClass: RateLimitError,
      expectedCode: ErrorCodes.RATE_LIMIT_EXCEEDED,
    },
    {
      name: "RateLimitExceededError alias",
      instance: new RateLimitExceededError("Too many requests"),
      expectedClass: RateLimitError,
      expectedCode: ErrorCodes.RATE_LIMIT_EXCEEDED,
    },
    {
      name: "ConflictError",
      instance: new ConflictError("Resource already exists"),
      expectedClass: ConflictError,
      expectedCode: ErrorCodes.CONFLICT,
    },
    {
      name: "InternalError",
      instance: new InternalError("Unhandled database exception"),
      expectedClass: InternalError,
      expectedCode: ErrorCodes.INTERNAL_ERROR,
    },
    {
      name: "ContractError",
      instance: new ContractError("Reverted in contract call"),
      expectedClass: ContractError,
      expectedCode: ErrorCodes.CONTRACT_ERROR,
    },
    {
      name: "InvalidSignatureError",
      instance: new InvalidSignatureError("Signature mismatch"),
      expectedClass: InvalidSignatureError,
      expectedCode: ErrorCodes.INVALID_SIGNATURE,
    },
    {
      name: "BadRequestError",
      instance: new BadRequestError("Invalid JSON input"),
      expectedClass: BadRequestError,
      expectedCode: ErrorCodes.BAD_REQUEST,
    },
    {
      name: "UnsupportedError",
      instance: new UnsupportedError("Feature not enabled"),
      expectedClass: UnsupportedError,
      expectedCode: ErrorCodes.UNSUPPORTED,
    },
    {
      name: "MembershipNotFoundError",
      instance: new MembershipNotFoundError("No membership found"),
      expectedClass: MembershipNotFoundError,
      expectedCode: ErrorCodes.MEMBERSHIP_NOT_FOUND,
    },
    {
      name: "GuildNotFoundError",
      instance: new GuildNotFoundError("Guild 123 not found"),
      expectedClass: GuildNotFoundError,
      expectedCode: ErrorCodes.GUILD_NOT_FOUND,
    },
    {
      name: "PassNotFoundError",
      instance: new PassNotFoundError("Pass 456 not found"),
      expectedClass: PassNotFoundError,
      expectedCode: ErrorCodes.PASS_NOT_FOUND,
    },
    {
      name: "UnknownError",
      instance: new UnknownError("Unknown problem"),
      expectedClass: UnknownError,
      expectedCode: ErrorCodes.UNKNOWN_ERROR,
    },
  ];

  for (const { name, instance, expectedClass, expectedCode } of testCases) {
    assert.strictEqual(
      instance instanceof Error,
      true,
      `${name} must be instanceof Error`,
    );
    assert.strictEqual(
      instance instanceof GuildPassError,
      true,
      `${name} must be instanceof GuildPassError`,
    );
    assert.strictEqual(
      instance instanceof expectedClass,
      true,
      `${name} must be instanceof its specific class`,
    );
    assert.strictEqual(
      instance.code,
      expectedCode,
      `${name} code must match ${expectedCode}`,
    );
  }
});

test("Hierarchy inheritance - domain not found errors extend NotFoundError", () => {
  const membershipErr = new MembershipNotFoundError();
  assert.strictEqual(membershipErr instanceof MembershipNotFoundError, true);
  assert.strictEqual(membershipErr instanceof NotFoundError, true);
  assert.strictEqual(membershipErr instanceof GuildPassError, true);
  assert.strictEqual(membershipErr instanceof Error, true);

  const guildErr = new GuildNotFoundError();
  assert.strictEqual(guildErr instanceof GuildNotFoundError, true);
  assert.strictEqual(guildErr instanceof NotFoundError, true);
  assert.strictEqual(guildErr instanceof GuildPassError, true);

  const passErr = new PassNotFoundError();
  assert.strictEqual(passErr instanceof PassNotFoundError, true);
  assert.strictEqual(passErr instanceof NotFoundError, true);
  assert.strictEqual(passErr instanceof GuildPassError, true);
});

test("Pattern matching / catch block distinguishing", () => {
  function throwsError(type: "network" | "config" | "access" | "timeout") {
    switch (type) {
      case "network":
        throw new NetworkError("Connection refused");
      case "config":
        throw new InvalidConfigError("Missing baseUrl");
      case "access":
        throw new AccessDeniedError("Insufficient permissions");
      case "timeout":
        throw new TimeoutError(1000);
    }
  }

  try {
    throwsError("network");
    assert.fail("Should have thrown");
  } catch (err) {
    assert.strictEqual(err instanceof NetworkError, true);
    assert.strictEqual(err instanceof InvalidConfigError, false);
    assert.strictEqual(err instanceof AccessDeniedError, false);
    assert.strictEqual(err instanceof GuildPassError, true);
  }

  try {
    throwsError("config");
    assert.fail("Should have thrown");
  } catch (err) {
    assert.strictEqual(err instanceof InvalidConfigError, true);
    assert.strictEqual(err instanceof NetworkError, false);
  }

  try {
    throwsError("access");
    assert.fail("Should have thrown");
  } catch (err) {
    assert.strictEqual(err instanceof AccessDeniedError, true);
    assert.strictEqual(err instanceof ForbiddenError, false);
  }

  try {
    throwsError("timeout");
    assert.fail("Should have thrown");
  } catch (err) {
    assert.strictEqual(err instanceof TimeoutError, true);
    if (err instanceof TimeoutError) {
      assert.strictEqual(err.timeoutMs, 1000);
    }
  }
});
