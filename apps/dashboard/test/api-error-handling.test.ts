import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { handleApiError } from "../lib/api-helpers";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../lib/api-errors";
import { PermissionDeniedError } from "../lib/permissions";

describe("handleApiError — internal error leakage", () => {
  test("an unexpected error returns a generic 500 without the internal message", async () => {
    const secret = "connect ECONNREFUSED 10.0.0.5:5432 (postgres password=hunter2)";
    const response = await handleApiError(async () => {
      throw new Error(secret);
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.code, "SERVER_ERROR");
    assert.equal(body.error, "An unexpected error occurred");
    // The raw internal detail must never reach the client.
    assert.ok(!JSON.stringify(body).includes("ECONNREFUSED"));
    assert.ok(!JSON.stringify(body).includes("hunter2"));
    // A correlation id is returned so the client can quote it in a report.
    assert.equal(typeof body.errorId, "string");
    assert.ok(body.errorId.length > 0);
  });

  test("a non-Error throw (string) still yields a generic 500", async () => {
    const response = await handleApiError(async () => {
      throw "raw string failure with internal path /etc/secrets";
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.code, "SERVER_ERROR");
    assert.equal(body.error, "An unexpected error occurred");
    assert.ok(!JSON.stringify(body).includes("/etc/secrets"));
  });

  test("a ValidationError returns its intentional 400 message and field errors", async () => {
    const response = await handleApiError(async () => {
      throw new ValidationError("Invalid settings payload", [
        { field: "timezone", message: "Unknown timezone" },
      ]);
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.equal(body.error, "Invalid settings payload");
    assert.deepEqual(body.fields, [
      { field: "timezone", message: "Unknown timezone" },
    ]);
  });

  test("a NotFoundError returns its intentional 404 message", async () => {
    const response = await handleApiError(async () => {
      throw new NotFoundError("Member not found.");
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.error, "Member not found.");
  });

  test("a ForbiddenError returns its intentional 403 message", async () => {
    const response = await handleApiError(async () => {
      throw new ForbiddenError();
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.code, "FORBIDDEN");
    assert.equal(body.error, "You do not have permission to perform this action.");
  });

  test("a PermissionDeniedError is treated as a client-safe 403", async () => {
    const response = await handleApiError(async () => {
      throw new PermissionDeniedError("members:write", "1");
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.code, "FORBIDDEN");
    assert.ok(body.error.includes("members:write"));
  });

  test("a returned NextResponse passes through untouched", async () => {
    const response = await handleApiError(async () => {
      return Response.json({ ok: true }, { status: 201 });
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(body, { ok: true });
  });

  test("validateLiveModeEnv throws a PublicApiError listing missing variables", async () => {
    const { validateLiveModeEnv } = await import("../lib/env");

    const origMode = process.env.DASHBOARD_API_MODE;
    const origUrl = process.env.GUILD_PASS_CORE_URL;
    const origKey = process.env.GUILD_PASS_CORE_API_KEY;
    const origSecret = process.env.WEBHOOK_SECRET;

    try {
      process.env.DASHBOARD_API_MODE = "live";
      delete process.env.GUILD_PASS_CORE_URL;
      delete process.env.GUILD_PASS_CORE_API_KEY;
      delete process.env.WEBHOOK_SECRET;

      const response = await handleApiError(async () => {
        validateLiveModeEnv();
        return Response.json({ ok: true });
      });
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.ok, false);
      assert.equal(body.code, "SERVER_ERROR");
      assert.ok(body.error.includes("GUILD_PASS_CORE_URL"));
      assert.ok(body.error.includes("GUILD_PASS_CORE_API_KEY"));
      assert.ok(body.error.includes("WEBHOOK_SECRET"));
    } finally {
      process.env.DASHBOARD_API_MODE = origMode;
      if (origUrl !== undefined) process.env.GUILD_PASS_CORE_URL = origUrl; else delete process.env.GUILD_PASS_CORE_URL;
      if (origKey !== undefined) process.env.GUILD_PASS_CORE_API_KEY = origKey; else delete process.env.GUILD_PASS_CORE_API_KEY;
      if (origSecret !== undefined) process.env.WEBHOOK_SECRET = origSecret; else delete process.env.WEBHOOK_SECRET;
    }
  });
});
