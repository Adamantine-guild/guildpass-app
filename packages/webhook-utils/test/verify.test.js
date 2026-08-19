import { test, describe } from "node:test";
import assert from "node:assert";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { verifySignature, generateSignature } from "../dist/index.js";

describe("verifySignature", () => {
  const SECRET = "test-webhook-secret-key";
  const PAYLOAD = JSON.stringify({ event: "member.joined", memberId: "123" });

  describe("Valid signatures", () => {
    test("should verify a valid signature", () => {
      const { signature, timestamp } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
      assert.strictEqual(result.timestamp, timestamp);
    });

    test("should verify signature with Buffer payload", () => {
      const bufferPayload = Buffer.from(PAYLOAD, "utf8");
      const { signature } = generateSignature({
        secret: SECRET,
        payload: bufferPayload,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: bufferPayload,
      });

      assert.strictEqual(result.valid, true);
    });

    test("should verify with custom timestamp", () => {
      const customTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
        timestamp: customTimestamp,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
        tolerance: 300, // 5 minutes
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.timestamp, customTimestamp);
    });

    test("should verify when tolerance is 0 (disabled)", () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
        timestamp: oldTimestamp,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
        tolerance: 0, // Disabled
      });

      assert.strictEqual(result.valid, true);
    });
  });

  describe("Invalid signatures", () => {
    test("should reject tampered payload", () => {
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      const tamperedPayload = JSON.stringify({
        event: "member.joined",
        memberId: "999", // Changed
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: tamperedPayload,
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Invalid signature");
    });

    test("should reject wrong secret", () => {
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: "wrong-secret",
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Invalid signature");
    });

    test("should reject invalid signature format", () => {
      const result = verifySignature({
        signatureHeader: "invalid-format",
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error);
    });

    test("should reject signature with non-hex characters", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const result = verifySignature({
        signatureHeader: `t=${timestamp},v1=not-a-hex-value!!!`,
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
    });
  });

  describe("Timestamp validation (replay protection)", () => {
    test("should reject stale timestamp", () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
        timestamp: staleTimestamp,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
        tolerance: 300, // 5 minutes
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("too old"));
      assert.strictEqual(result.timestamp, staleTimestamp);
    });

    test("should reject future timestamp", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 400; // 400 seconds in future
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
        timestamp: futureTimestamp,
      });
      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
        tolerance: 300,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("future"));
    });

    test("should accept future timestamp within tolerance", () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 120;
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
        timestamp: futureTimestamp,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
        tolerance: 300,
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.timestamp, futureTimestamp);
    });
      

    test("should accept timestamp within tolerance", () => {
      const recentTimestamp = Math.floor(Date.now() / 1000) - 200; // 200 seconds ago
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
        timestamp: recentTimestamp,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
        tolerance: 300,
      });

      assert.strictEqual(result.valid, true);
    });
  });

  describe("Malformed headers", () => {
    test("should reject missing signature header", () => {
      const result = verifySignature({
        signatureHeader: "",
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Missing or invalid signature header");
    });

    test("should reject missing timestamp", () => {
      const result = verifySignature({
        signatureHeader: "v1=abc123",
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("timestamp"));
    });

    test("should reject missing v1 signature", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const result = verifySignature({
        signatureHeader: `t=${timestamp}`,
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("signature"));
    });

    test("should reject non-numeric timestamp", () => {
      const result = verifySignature({
        signatureHeader: "t=not-a-number,v1=abc123",
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("timestamp"));
    });

    test("should reject empty v1 signature value", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const result = verifySignature({
        signatureHeader: `t=${timestamp},v1=`,
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("signature"));
    });

    test("should accept valid header when segments are reordered and extra metadata is present", () => {
      const { signature, timestamp } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });
      const [, v1] = signature.split(",");

      const result = verifySignature({
        signatureHeader: `ignored=metadata,${v1},t=${timestamp}`,
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.timestamp, timestamp);
    });

    test("should reject same-length wrong signature", () => {
      const { signature, timestamp } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });
      const [, v1] = signature.split(",");
      const sameLengthWrongSignature = `${v1.slice(0, -2)}aa`;

      const result = verifySignature({
        signatureHeader: `t=${timestamp},${sameLengthWrongSignature}`,
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Invalid signature");
    });
  
    test("should reject header containing only whitespace", () => {
      const result = verifySignature({
        signatureHeader: "   ",
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Invalid or missing timestamp in signature");
    });

    test("should reject header with trailing or leading malformed commas", () => {
      const result = verifySignature({
        signatureHeader: ",,,",
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
    });

    test("should reject header with float/decimal timestamp", () => {
      const result = verifySignature({
        signatureHeader: "t=12345.678,v1=abc123",
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
    });
  });

  describe("Missing or invalid inputs", () => {
    test("should reject missing secret", () => {
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: "",
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Missing or invalid secret");
    });

    test("should reject null payload", () => {
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: null,
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Missing payload");
    });

    test("should reject undefined payload", () => {
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: undefined,
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Missing payload");
    });

    test("should handle empty payload", () => {
      const emptyPayload = "";
      const { signature } = generateSignature({
        secret: SECRET,
        payload: emptyPayload,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: emptyPayload,
      });

      assert.strictEqual(result.valid, true);
    });
  });

  describe("Body tampering detection", () => {
    test("should detect single character change", () => {
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      const tamperedPayload = PAYLOAD.replace("123", "124");

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: tamperedPayload,
      });

      assert.strictEqual(result.valid, false);
    });

    test("should detect added whitespace", () => {
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      const tamperedPayload = PAYLOAD + " ";

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: tamperedPayload,
      });

      assert.strictEqual(result.valid, false);
    });

    test("should detect encoding changes", () => {
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
      });

      // Try to verify with Buffer when string was signed
      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: Buffer.from(PAYLOAD + "x", "utf8"),
      });

      assert.strictEqual(result.valid, false);
    });
  });
  describe("Timing-safe comparison smoke test", () => {
    test("should use Node timingSafeEqual for same-length signature comparison", () => {
      const source = readFileSync(new URL("../src/verify.ts", import.meta.url), "utf8");

      assert.match(source, /timingSafeEqual/);
      assert.match(source, /signatureBuffer\.length !== expectedBuffer\.length/);
    });
  });

  describe("Additional edge cases", () => {
    test("should reject header with duplicate v1 values where the trailing value is bogus", () => {
      const { signature } = generateSignature({ secret: SECRET, payload: PAYLOAD });
      const [tPart, v1Part] = signature.split(",");
      const bogusV1 = `v1=${"a".repeat(64)}`;
      const headerWithDuplicateV1 = `${tPart},${v1Part},${bogusV1}`;

      const result = verifySignature({
        signatureHeader: headerWithDuplicateV1,
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
    });

    test("should reject header with timestamp present but signature value made only of whitespace", () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const result = verifySignature({
        signatureHeader: `t=${timestamp},v1=   `,
        secret: SECRET,
        payload: PAYLOAD,
      });

      assert.strictEqual(result.valid, false);
    });

    test("should reject signature verified against a semantically equal but differently serialized payload", () => {
      const orderedPayload = JSON.stringify({ event: "member.joined", memberId: "123" });
      const reorderedPayload = JSON.stringify({ memberId: "123", event: "member.joined" });

      const { signature } = generateSignature({ secret: SECRET, payload: orderedPayload });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: reorderedPayload,
      });

      assert.strictEqual(result.valid, false);
    });

    test("should accept timestamp exactly at the tolerance boundary", () => {
      const boundaryTimestamp = Math.floor(Date.now() / 1000) - 300;
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
        timestamp: boundaryTimestamp,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
        tolerance: 300,
      });

      assert.strictEqual(result.valid, true);
    });

    test("should reject timestamp exactly one second outside the tolerance boundary", () => {
      const justOutsideTimestamp = Math.floor(Date.now() / 1000) - 301;
      const { signature } = generateSignature({
        secret: SECRET,
        payload: PAYLOAD,
        timestamp: justOutsideTimestamp,
      });

      const result = verifySignature({
        signatureHeader: signature,
        secret: SECRET,
        payload: PAYLOAD,
        tolerance: 300,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("too old"));
    });
  });
});

describe("generateSignature", () => {
  const SECRET = "test-secret";
  const PAYLOAD = '{"test":true}';

  test("should generate valid signature format", () => {
    const { signature, timestamp } = generateSignature({
      secret: SECRET,
      payload: PAYLOAD,
    });

    assert.ok(signature.includes("t="));
    assert.ok(signature.includes("v1="));
    assert.ok(signature.includes(","));
    assert.ok(typeof timestamp === "number");
  });

  test("should use custom timestamp when provided", () => {
    const customTimestamp = 1234567890;
    const { signature, timestamp } = generateSignature({
      secret: SECRET,
      payload: PAYLOAD,
      timestamp: customTimestamp,
    });

    assert.strictEqual(timestamp, customTimestamp);
    assert.ok(signature.includes(`t=${customTimestamp}`));
  });

  test("should work with Buffer payload", () => {
    const bufferPayload = Buffer.from(PAYLOAD, "utf8");
    const { signature } = generateSignature({
      secret: SECRET,
      payload: bufferPayload,
    });

    assert.ok(signature.includes("v1="));
  });

  test("should generate different signatures for different payloads", () => {
    const { signature: sig1 } = generateSignature({
      secret: SECRET,
      payload: '{"id":1}',
      timestamp: 1000,
    });

    const { signature: sig2 } = generateSignature({
      secret: SECRET,
      payload: '{"id":2}',
      timestamp: 1000,
    });

    assert.notStrictEqual(sig1, sig2);
  });

  test("should generate different signatures for different secrets", () => {
    const timestamp = 1000;
    const { signature: sig1 } = generateSignature({
      secret: "secret1",
      payload: PAYLOAD,
      timestamp,
    });

    const { signature: sig2 } = generateSignature({
      secret: "secret2",
      payload: PAYLOAD,
      timestamp,
    });

    assert.notStrictEqual(sig1, sig2);
  });
});
