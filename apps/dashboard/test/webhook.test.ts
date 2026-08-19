import { test, describe } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ActivityEvent } from "../lib/activity/types.js";
import { CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";
import { validateWebhookPayload } from "../lib/activity/validation.js";
import { sanitiseWebhookData, getSanitisedDescription } from "../lib/activity/sanitise.js";

const { generateSignature } = await import("@guildpass/webhook-utils");
const { activityStorage, FileActivityStorage } = await import("../lib/activity/storage.js");

describe("Webhook Ingestion", () => {
  const secret = "test-secret";

  test("should correctly verify a valid signature", async () => {
    const payload = JSON.stringify({
      id: "evt_123",
      type: "membership.created",
      created: Math.floor(Date.now() / 1000),
      data: { wallet: "0x123", name: "Alice" }
    });

    const { signature } = generateSignature({ secret, payload });

    const { verifySignature } = await import("@guildpass/webhook-utils");
    const result = verifySignature({
      signatureHeader: signature,
      secret,
      payload
    });

    assert.strictEqual(result.valid, true);
  });

  test("should reject an invalid signature", async () => {
    const payload = "tampered payload";
    const { signature } = generateSignature({ secret: "wrong-secret", payload });

    const { verifySignature } = await import("@guildpass/webhook-utils");
    const result = verifySignature({
      signatureHeader: signature,
      secret,
      payload
    });

    assert.strictEqual(result.valid, false);
  });

  test("should handle duplicate events idempotently", async () => {
    const eventId = "duplicate_123";
    const event: ActivityEvent = {
      id: eventId,
      type: "pass.created" as const,
      source: "webhook" as const,
      severity: "info" as const,
      description: "Test Pass",
      timestamp: new Date().toISOString(),
      actor: {
        name: "Admin",
      },
      schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
    };

    await activityStorage.addEvent(event);
    const isDuplicate = await activityStorage.isDuplicate(eventId);
    assert.strictEqual(isDuplicate, true);

    const countBefore = (await activityStorage.getEvents()).length;
    await activityStorage.addEvent(event);
    const countAfter = (await activityStorage.getEvents()).length;

    assert.strictEqual(countBefore, countAfter);
  });

  test("file storage keeps processed webhook IDs across restarts", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "guildpass-activity-"));

    try {
      const firstStore = new FileActivityStorage(storeDir);
      const event: ActivityEvent = {
        id: "evt_persistent_123",
        type: "member.joined",
        source: "webhook",
        severity: "info",
        actor: {
          name: "Alice"
        },
        timestamp: new Date().toISOString(),
        description: "New member joined: Alice",
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };

      assert.strictEqual(await firstStore.recordActivityEvent(event), "recorded");

      const restartedStore = new FileActivityStorage(storeDir);
      assert.strictEqual(await restartedStore.hasProcessedEvent(event.id), true);
      assert.strictEqual(await restartedStore.recordActivityEvent(event), "duplicate");
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  test("file storage records only one event for concurrent duplicate submissions", async () => {
    const storeDir = await mkdtemp(join(tmpdir(), "guildpass-activity-"));

    try {
      const storage = new FileActivityStorage(storeDir);
      const event: ActivityEvent = {
        id: "evt_concurrent_123",
        type: "pass.updated",
        source: "webhook",
        severity: "info",
        actor: {
          name: "Admin"
        },
        timestamp: new Date().toISOString(),
        description: "Pass updated: Gold Pass",
        schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
      };

      const results = await Promise.all([
        storage.recordActivityEvent(event),
        storage.recordActivityEvent(event),
        storage.recordActivityEvent(event)
      ]);

      assert.strictEqual(results.filter((result) => result === "recorded").length, 1);
      assert.strictEqual(results.filter((result) => result === "duplicate").length, 2);
      assert.strictEqual((await storage.getEvents()).length, 1);
    } finally {
      await rm(storeDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Payload Validation
// ---------------------------------------------------------------------------

function validPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "evt_val_1",
    type: "membership.created",
    created: Math.floor(Date.now() / 1000),
    data: { wallet: "0x742d35cC6634c0532925a3B8879539d43374E290", name: "Bob" },
    ...overrides,
  });
}

describe("validateWebhookPayload", () => {
  test("accepts a well-formed payload", () => {
    const body = validPayload();
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, true);
    if (result.valid) {
      assert.strictEqual(result.payload.id, "evt_val_1");
    }
  });

  test("rejects malformed JSON", () => {
    const result = validateWebhookPayload("{bad json}");
    assert.strictEqual(result.valid, false);
    if (!result.valid) assert.match(result.error, /JSON/i);
  });

  test("rejects non-object JSON", () => {
    const result = validateWebhookPayload('"just a string"');
    assert.strictEqual(result.valid, false);
  });

  test("rejects missing id", () => {
    const body = validPayload({ id: undefined });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
    if (!result.valid) assert.match(result.error, /id/i);
  });

  test("rejects empty string id", () => {
    const body = validPayload({ id: "" });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
  });

  test("rejects missing type", () => {
    const body = validPayload({ type: undefined });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
    if (!result.valid) assert.match(result.error, /type/i);
  });

  test("rejects missing created", () => {
    const body = validPayload({ created: undefined });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
    if (!result.valid) assert.match(result.error, /created/i);
  });

  test("rejects non-number created", () => {
    const body = validPayload({ created: "not-a-number" });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
    if (!result.valid) assert.match(result.error, /created/i);
  });

  test("rejects negative created", () => {
    const body = validPayload({ created: -1 });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
  });

  test("rejects zero created", () => {
    const body = validPayload({ created: 0 });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
  });

  test("rejects non-object data", () => {
    const body = validPayload({ data: "not an object" });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
    if (!result.valid) assert.match(result.error, /data/i);
  });

  test("rejects null data", () => {
    const body = validPayload({ data: null });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
  });

  test("accepts unsupported but well-formed event type", () => {
    const body = validPayload({ type: "some.future.event" });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, true);
  });

  test("accepts all 6 supported event types", () => {
    const types = [
      "membership.created",
      "membership.updated",
      "pass.created",
      "pass.updated",
      "guild.updated",
      "verification.completed",
    ];
    for (const type of types) {
      const body = validPayload({ type });
      const result = validateWebhookPayload(body);
      assert.strictEqual(result.valid, true);
    }
  });

  test("validates event-specific required data fields for membership.created", () => {
    const body = validPayload({ type: "membership.created", data: {} });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, true);
  });

  test("rejects non-string data.wallet for membership events", () => {
    const body = validPayload({ type: "membership.created", data: { wallet: 123 } });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
  });

  test("error messages do not expose payload values", () => {
    const body = JSON.stringify({ id: "secret-123", type: 42, created: "bad", data: null });
    const result = validateWebhookPayload(body);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.ok(!result.error.includes("secret-123"));
      assert.ok(!result.error.includes("42"));
    }
  });
});

// ---------------------------------------------------------------------------
// Payload Sanitisation
// ---------------------------------------------------------------------------

describe("sanitiseWebhookData", () => {
  test("drops unknown fields for membership events", () => {
    const result = sanitiseWebhookData("membership.created", {
      id: "m1",
      name: "Alice",
      wallet: "0xabc",
      ssn: "123-45-6789",
      internal_token: "sk-secret",
    });
    assert.deepStrictEqual(result, { id: "m1", name: "Alice", wallet: "0xabc" });
  });

  test("drops unknown fields for pass events", () => {
    const result = sanitiseWebhookData("pass.created", {
      id: "p1",
      name: "Gold Pass",
      price: 100,
      internal_note: "top secret",
    });
    assert.deepStrictEqual(result, { id: "p1", name: "Gold Pass" });
  });

  test("drops unknown fields for guild events", () => {
    const result = sanitiseWebhookData("guild.updated", {
      id: "g1",
      name: "Guild",
      invite_code: "super-secret-code",
    });
    assert.deepStrictEqual(result, { id: "g1", name: "Guild" });
  });

  test("drops unknown fields for verification events", () => {
    const result = sanitiseWebhookData("verification.completed", {
      id: "v1",
      wallet: "0xabc",
      proof: "sensitive-proof-data",
      ip: "127.0.0.1",
    });
    assert.deepStrictEqual(result, { id: "v1", wallet: "0xabc" });
  });

  test("returns empty object for unsupported event types", () => {
    const result = sanitiseWebhookData("some.future.event", { id: "x", name: "X" });
    assert.deepStrictEqual(result, {});
  });

  test("preserve wallet address for membership events", () => {
    const result = sanitiseWebhookData("membership.created", {
      id: "m1",
      wallet: "0x742d35Cc6634C0532925a3b8879539d43374e290",
    });
    assert.strictEqual(result.wallet, "0x742d35Cc6634C0532925a3b8879539d43374e290");
  });
});

describe("getSanitisedDescription", () => {
  test("descriptions do not contain raw payload data beyond name/wallet", () => {
    const desc = getSanitisedDescription("membership.created", {
      name: "Alice",
      wallet: "0xabc",
      id: "secret-id",
    });
    assert.ok(desc.includes("Alice"));
    assert.ok(!desc.includes("secret-id"));
  });
});
