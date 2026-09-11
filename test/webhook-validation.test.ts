import { test } from "node:test";
import assert from "node:assert";
import { validateWebhookPayload } from "../lib/activity/validation";

test("validateWebhookPayload rejects malformed JSON", () => {
  const result = validateWebhookPayload("invalid json");
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.field, "body");
});

test("validateWebhookPayload rejects missing required fields", () => {
  const result = validateWebhookPayload(JSON.stringify({ id: "123" })); // Missing type, created, data
  assert.strictEqual(result.valid, false);
});

test("validateWebhookPayload accepts a valid payload", () => {
  const validPayload = {
    id: "evt_123",
    type: "membership.created",
    created: 1715000000,
    data: { name: "Alice", wallet: "0x742d35cC6634c0532925a3B8879539d43374E290" },
  };
  const result = validateWebhookPayload(JSON.stringify(validPayload));
  assert.strictEqual(result.valid, true);
});

test("validateWebhookPayload rejects invalid event data shape", () => {
  const invalidData = {
    id: "evt_123",
    type: "pass.created",
    created: 1715000000,
    data: { name: 123 },
  };
  const result = validateWebhookPayload(JSON.stringify(invalidData));
  assert.strictEqual(result.valid, false);
});
