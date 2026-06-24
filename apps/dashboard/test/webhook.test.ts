import { test, describe } from "node:test";
import assert from "node:assert";
import { generateSignature } from "@guildpass/webhook-utils";
import { activityStorage } from "../lib/activity/storage.ts";

// Note: In a real Next.js environment, we'd use a more sophisticated test runner
// but for this task, we're demonstrating the core logic verification.

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
    
    // This mimics the logic in our route handler
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
    const event = {
      id: eventId,
      type: "pass.created" as const,
      source: "dashboard" as const,
      severity: "info" as const,
      description: "Test Pass",
      timestamp: new Date().toISOString(),
      actor: { name: "Admin" },
    };

    await activityStorage.addEvent(event);
    const isDuplicate = await activityStorage.isDuplicate(eventId);
    assert.strictEqual(isDuplicate, true);
    
    const countBefore = (await activityStorage.getEvents()).events.length;
    await activityStorage.addEvent(event);
    const countAfter = (await activityStorage.getEvents()).events.length;
    
    assert.strictEqual(countBefore, countAfter);
  });
});
