import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WEBHOOK_FIXTURES, makeWebhookPayload } from "./fixtures";
import type { ActivityEvent, WebhookPayload } from "../lib/activity/types";
import { CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";

/**
 * webhook-mapper.test.ts
 *
 * Tests the webhook-to-ActivityEvent mapping logic extracted from the
 * POST handler in app/api/webhooks/route.ts.
 *
 * mapWebhookToActivity is a pure function — it takes a WebhookPayload and
 * returns ActivityEvent | null — so we replicate it here to test it in
 * isolation without importing Next.js server-only modules.
 *
 * If the real function is ever extracted to its own file, replace the
 * local copy below with an import.
 */

// ── Local copy of the pure mapper (mirrors route.ts exactly) ──────────────────

function mapWebhookToActivity(payload: WebhookPayload): ActivityEvent | null {
  const { type, data, id, created } = payload;
  const timestamp = new Date(created * 1000).toISOString();
  const name = stringField(data, "name");
  const wallet = stringField(data, "wallet");
  const entityId = stringField(data, "id") ?? wallet ?? id;

  switch (type) {
    case "membership.created":
      return {
        id,
        type: "member.joined",
        source: "webhook",
        severity: "info",
        actor: { name, wallet },
        description: `New member joined: ${name || wallet}`,
        timestamp,
        entity: { type: "member", id: entityId, name },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    case "membership.updated":
      return {
        id,
        type: "member.left",
        source: "webhook",
        severity: "info",
        actor: { name, wallet },
        description: `Member ${name || wallet} updated`,
        timestamp,
        entity: { type: "member", id: entityId, name },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    case "pass.created":
      return {
        id,
        type: "pass.created",
        source: "webhook",
        severity: "info",
        actor: { name: "Admin" },
        description: `New pass created: ${name}`,
        timestamp,
        entity: { type: "pass", id: entityId, name },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    case "pass.updated":
      return {
        id,
        type: "pass.updated",
        source: "webhook",
        severity: "info",
        actor: { name: "Admin" },
        description: `Pass updated: ${name}`,
        timestamp,
        entity: { type: "pass", id: entityId, name },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    case "guild.updated":
      return {
        id,
        type: "guild.updated",
        source: "webhook",
        severity: "info",
        actor: { name: "Admin" },
        description: `Guild settings updated: ${name}`,
        timestamp,
        entity: { type: "guild", id: entityId, name },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    case "verification.completed":
      return {
        id,
        type: "verification.completed",
        source: "webhook",
        severity: "info",
        actor: { wallet },
        description: `Verification completed for ${wallet}`,
        timestamp,
        entity: { type: "verification", id: entityId },
        metadata: data,
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };
    default:
      return null;
  }
}

function stringField(
  data: Record<string, unknown>,
  field: string
): string | undefined {
  const value = data[field];
  return typeof value === "string" ? value : undefined;
}

// ── Shared field assertions ────────────────────────────────────────────────────

function assertCommonFields(
  result: ActivityEvent,
  payload: WebhookPayload,
  expectedType: ActivityEvent["type"]
): void {
  assert.equal(result.id, payload.id, "id must pass through unchanged");
  assert.equal(result.type, expectedType, "activity type mismatch");
  assert.equal(result.source, "webhook", "source must be 'webhook'");
  assert.equal(result.severity, "info", "severity must be 'info'");
  assert.equal(
    result.timestamp,
    new Date(payload.created * 1000).toISOString(),
    "timestamp must be derived from created unix seconds"
  );
}

// ── Per-event-type tests ───────────────────────────────────────────────────────

describe("mapWebhookToActivity", () => {
  // membership.created → member.joined
  describe("membership.created", () => {
    const payload = WEBHOOK_FIXTURES["membership.created"];
    const result = mapWebhookToActivity(payload)!;

    test("returns a non-null ActivityEvent", () => {
      assert.ok(result !== null);
    });

    test("maps to member.joined with correct common fields", () => {
      assertCommonFields(result, payload, "member.joined");
    });

    test("sets actor name and wallet from payload data", () => {
      assert.equal(result.actor.name, payload.data.name!);
      assert.equal(result.actor.wallet, payload.data.wallet!);
    });

    test("description includes member name when present", () => {
      assert.ok(
        result.description.includes(requiredStringField(payload.data, "name")),
        `description "${result.description}" should include member name`
      );
    });

    test("falls back to wallet in description when name is absent", () => {
      const noName = makeWebhookPayload({
        id: "whk_mc_noname",
        type: "membership.created",
        data: { id: "m1", wallet: "0xfallback" },
      });
      const r = mapWebhookToActivity(noName)!;
      assert.ok(
        r.description.includes("0xfallback"),
        "description should fall back to wallet when name is absent"
      );
    });

    test("entity type is 'member'", () => {
      assert.equal(result.entity?.type, "member");
      assert.equal(result.entity?.id, payload.data.id!);
    });

    test("metadata equals raw payload data", () => {
      assert.deepEqual(result.metadata, payload.data);
    });
  });

  // membership.updated → member.left
  describe("membership.updated", () => {
    const payload = WEBHOOK_FIXTURES["membership.updated"];
    const result = mapWebhookToActivity(payload)!;

    test("returns a non-null ActivityEvent", () => {
      assert.ok(result !== null);
    });

    test("maps to member.left with correct common fields", () => {
      assertCommonFields(result, payload, "member.left");
    });

    test("description includes member name when present", () => {
      assert.ok(result.description.includes(requiredStringField(payload.data, "name")));
    });

    test("falls back to wallet in description when name is absent", () => {
      const noName = makeWebhookPayload({
        id: "whk_mu_noname",
        type: "membership.updated",
        data: { id: "m1", wallet: "0xwallet_mu" },
      });
      const r = mapWebhookToActivity(noName)!;
      assert.ok(r.description.includes("0xwallet_mu"));
    });
  });

  // pass.created
  describe("pass.created", () => {
    const payload = WEBHOOK_FIXTURES["pass.created"];
    const result = mapWebhookToActivity(payload)!;

    test("returns a non-null ActivityEvent", () => {
      assert.ok(result !== null);
    });

    test("maps to pass.created with correct common fields", () => {
      assertCommonFields(result, payload, "pass.created");
    });

    test("actor defaults to Admin", () => {
      assert.equal(result.actor.name, "Admin");
    });

    test("description includes pass name", () => {
      assert.ok(result.description.includes(requiredStringField(payload.data, "name")));
    });

    test("entity type is 'pass'", () => {
      assert.equal(result.entity?.type, "pass");
      assert.equal(result.entity?.name, payload.data.name!);
    });
  });

  // pass.updated
  describe("pass.updated", () => {
    const payload = WEBHOOK_FIXTURES["pass.updated"];
    const result = mapWebhookToActivity(payload)!;

    test("returns a non-null ActivityEvent", () => {
      assert.ok(result !== null);
    });

    test("maps to pass.updated with correct common fields", () => {
      assertCommonFields(result, payload, "pass.updated");
    });

    test("actor defaults to Admin", () => {
      assert.equal(result.actor.name, "Admin");
    });

    test("description includes pass name", () => {
      assert.ok(result.description.includes(requiredStringField(payload.data, "name")));
    });
  });

  // guild.updated
  describe("guild.updated", () => {
    const payload = WEBHOOK_FIXTURES["guild.updated"];
    const result = mapWebhookToActivity(payload)!;

    test("returns a non-null ActivityEvent", () => {
      assert.ok(result !== null);
    });

    test("maps to guild.updated with correct common fields", () => {
      assertCommonFields(result, payload, "guild.updated");
    });

    test("actor defaults to Admin", () => {
      assert.equal(result.actor.name, "Admin");
    });

    test("description includes guild name", () => {
      assert.ok(result.description.includes(requiredStringField(payload.data, "name")));
    });

    test("entity type is 'guild'", () => {
      assert.equal(result.entity?.type, "guild");
    });
  });

  // verification.completed
  describe("verification.completed", () => {
    const payload = WEBHOOK_FIXTURES["verification.completed"];
    const result = mapWebhookToActivity(payload)!;

    test("returns a non-null ActivityEvent", () => {
      assert.ok(result !== null);
    });

    test("maps to verification.completed with correct common fields", () => {
      assertCommonFields(result, payload, "verification.completed");
    });

    test("actor.wallet is set from payload data.wallet", () => {
      assert.equal(result.actor.wallet, payload.data.wallet!);
    });

    test("description includes wallet address", () => {
      assert.ok(result.description.includes(requiredStringField(payload.data, "wallet")));
    });

    test("entity type is 'verification' and id equals wallet", () => {
      assert.equal(result.entity?.type, "verification");
      assert.equal(result.entity?.id, payload.data.wallet!);
    });
  });

  // unsupported / unknown event types
  describe("unsupported event types", () => {
    test("returns null for an unknown event type", () => {
      const payload = makeWebhookPayload({
        id: "whk_unknown_001",
        type: "some.unknown.event",
        data: {},
      });
      const result = mapWebhookToActivity(payload);
      assert.equal(result, null);
    });

    test("returns null for an empty-string event type", () => {
      const payload = makeWebhookPayload({ id: "whk_empty_type", type: "", data: {} });
      const result = mapWebhookToActivity(payload);
      assert.equal(result, null);
    });
  });

  // timestamp conversion
  describe("timestamp conversion", () => {
    test("correctly converts unix seconds to ISO 8601 string", () => {
      const unix = 1700000000;
      const payload = makeWebhookPayload({
        id: "whk_ts_001",
        type: "pass.created",
        created: unix,
        data: { id: "p1", name: "TS Pass" },
      });
      const result = mapWebhookToActivity(payload)!;
      assert.equal(result.timestamp, new Date(unix * 1000).toISOString());
    });
  });
});

function requiredStringField(
  data: Record<string, unknown>,
  field: string
): string {
  const value = stringField(data, field);
  assert.ok(value, `${field} should be a string`);
  return value;
}
