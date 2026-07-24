import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  WebhookRateLimiter,
  classifyVerificationError,
  getClientSource,
  getWebhookAbuseLimits,
  WEBHOOK_REJECTION_REASONS,
} from "../lib/webhooks/abuse-guard";

const { generateSignature } = await import("@guildpass/webhook-utils");
const { POST } = await import("../app/api/webhooks/route");

const SECRET = "abuse-test-secret";

function badSignature(): string {
  return `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`;
}

const ENV_KEYS = [
  "WEBHOOK_SECRET",
  "WEBHOOK_MAX_BODY_BYTES",
  "WEBHOOK_INVALID_ATTEMPT_LIMIT",
  "WEBHOOK_RATE_LIMIT_WINDOW_MS",
];

function validPayload(): string {
  return JSON.stringify({
    id: `evt_abuse_${Math.random().toString(36).slice(2)}`,
    type: "membership.created",
    created: Math.floor(Date.now() / 1000),
    data: { wallet: "0x742d35cC6634c0532925a3B8879539d43374E290", name: "Abuse Test" },
  });
}

function webhookRequest(
  body: string,
  opts: { signature?: string; ip?: string; contentLength?: string } = {}
) {
  const headers = new Headers();
  if (opts.signature) headers.set("x-guildpass-signature", opts.signature);
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  if (opts.contentLength !== undefined) headers.set("content-length", opts.contentLength);
  return new Request("https://example.test/api/webhooks", {
    method: "POST",
    headers,
    body,
  }) as never;
}

function captureWarnings() {
  const lines: Array<Record<string, unknown>> = [];
  const original = console.warn;
  console.warn = (arg: unknown) => {
    lines.push(JSON.parse(String(arg)));
  };
  return {
    lines,
    restore() {
      console.warn = original;
    },
  };
}

describe("webhook abuse guards", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  test("rejects oversized declared content-length before verification with 413", async () => {
    process.env.WEBHOOK_MAX_BODY_BYTES = "64";
    const capture = captureWarnings();
    try {
      const response = await POST(
        webhookRequest("small body", {
          signature: badSignature(),
          ip: "10.0.0.1",
          contentLength: "100000",
        })
      );
      assert.equal(response.status, 413);
      assert.equal(capture.lines.length, 1);
      assert.equal(capture.lines[0].event, "webhook_rejected");
      assert.equal(capture.lines[0].reason, "oversized_payload");
      assert.equal(capture.lines[0].source, "10.0.0.1");
      assert.equal(capture.lines[0].contentLength, 100000);
    } finally {
      capture.restore();
    }
  });

  test("rejects oversized actual body without content-length with 413", async () => {
    process.env.WEBHOOK_MAX_BODY_BYTES = "64";
    const bigBody = "x".repeat(1024);
    const { signature } = generateSignature({ secret: SECRET, payload: bigBody });
    const capture = captureWarnings();
    try {
      const response = await POST(
        webhookRequest(bigBody, { signature, ip: "10.0.0.2" })
      );
      assert.equal(response.status, 413);
      assert.equal(capture.lines[0].reason, "oversized_payload");
    } finally {
      capture.restore();
    }
  });

  test("rate limits repeated invalid signatures from the same source with 429", async () => {
    process.env.WEBHOOK_INVALID_ATTEMPT_LIMIT = "3";
    const ip = "10.0.0.3";
    const capture = captureWarnings();
    try {
      for (let i = 0; i < 3; i++) {
        const response = await POST(
          webhookRequest("payload", { signature: badSignature(), ip })
        );
        assert.equal(response.status, 401, `attempt ${i} should be 401`);
      }
      const limited = await POST(
        webhookRequest("payload", { signature: badSignature(), ip })
      );
      assert.equal(limited.status, 429);
      const reasons = capture.lines.map((line) => line.reason);
      assert.deepEqual(reasons, [
        "invalid_signature",
        "invalid_signature",
        "invalid_signature",
        "rate_limited",
      ]);
    } finally {
      capture.restore();
    }
  });

  test("tracks sources independently", async () => {
    process.env.WEBHOOK_INVALID_ATTEMPT_LIMIT = "2";
    for (let i = 0; i < 2; i++) {
      await POST(webhookRequest("p", { signature: badSignature(), ip: "10.0.0.4" }));
    }
    const limited = await POST(
      webhookRequest("p", { signature: badSignature(), ip: "10.0.0.4" })
    );
    assert.equal(limited.status, 429);
    const otherSource = await POST(
      webhookRequest("p", { signature: badSignature(), ip: "10.0.0.5" })
    );
    assert.equal(otherSource.status, 401);
  });

  test("missing signature header counts toward the limit and logs malformed_header", async () => {
    process.env.WEBHOOK_INVALID_ATTEMPT_LIMIT = "2";
    const ip = "10.0.0.6";
    const capture = captureWarnings();
    try {
      const first = await POST(webhookRequest("p", { ip }));
      assert.equal(first.status, 401);
      const second = await POST(webhookRequest("p", { ip }));
      assert.equal(second.status, 401);
      const third = await POST(webhookRequest("p", { ip }));
      assert.equal(third.status, 429);
      assert.deepEqual(
        capture.lines.map((line) => line.reason),
        ["malformed_header", "malformed_header", "rate_limited"]
      );
    } finally {
      capture.restore();
    }
  });

  test("successful verification resets the failure window for that source", async () => {
    process.env.WEBHOOK_INVALID_ATTEMPT_LIMIT = "2";
    const ip = "10.0.0.7";
    for (let i = 0; i < 5; i++) {
      await POST(webhookRequest("p", { signature: badSignature(), ip }));
      const body = validPayload();
      const { signature } = generateSignature({ secret: SECRET, payload: body });
      const ok = await POST(webhookRequest(body, { signature, ip }));
      assert.notEqual(ok.status, 429, "legitimate traffic must never be rate limited");
      assert.notEqual(ok.status, 401);
    }
  });

  test("expired timestamps are logged as expired_timestamp and count toward the limit", async () => {
    process.env.WEBHOOK_INVALID_ATTEMPT_LIMIT = "5";
    const ip = "10.0.0.8";
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const body = validPayload();
    const { signature } = generateSignature({ secret: SECRET, payload: body, timestamp: stale });
    const capture = captureWarnings();
    try {
      const response = await POST(webhookRequest(body, { signature, ip }));
      assert.equal(response.status, 401);
      assert.equal(capture.lines[0].reason, "expired_timestamp");
    } finally {
      capture.restore();
    }
  });

  test("rejection logs never contain the secret or signature material", async () => {
    const ip = "10.0.0.9";
    const body = validPayload();
    const { signature } = generateSignature({ secret: SECRET, payload: body });
    const badSignature = signature.replace(/v1=[0-9a-f]/, "v1=0");
    const capture = captureWarnings();
    try {
      await POST(webhookRequest(body, { signature: badSignature, ip }));
      await POST(webhookRequest(body, { ip }));
      const raw = JSON.stringify(capture.lines);
      assert.ok(!raw.includes(SECRET), "log must not contain the secret");
      assert.ok(!raw.includes(badSignature), "log must not contain the signature header");
      assert.ok(!raw.includes("v1="), "log must not contain signature fragments");
      for (const line of capture.lines) {
        assert.ok(WEBHOOK_REJECTION_REASONS.includes(line.reason as never));
        assert.equal(line.endpoint, "/api/webhooks");
        assert.ok(typeof line.ts === "string");
      }
    } finally {
      capture.restore();
    }
  });
});

describe("WebhookRateLimiter (unit)", () => {
  test("window expiry restores access", () => {
    let now = 1_000_000;
    const limiter = new WebhookRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    limiter.recordFailure("src");
    limiter.recordFailure("src");
    assert.equal(limiter.isLimited("src"), true);
    now += 1001;
    assert.equal(limiter.isLimited("src"), false);
  });

  test("recordSuccess clears the window", () => {
    const limiter = new WebhookRateLimiter({ limit: 2, windowMs: 60_000 });
    limiter.recordFailure("src");
    limiter.recordFailure("src");
    assert.equal(limiter.isLimited("src"), true);
    limiter.recordSuccess("src");
    assert.equal(limiter.isLimited("src"), false);
  });

  test("reconfigure applies new limits without losing state", () => {
    const limiter = new WebhookRateLimiter({ limit: 5, windowMs: 60_000 });
    limiter.recordFailure("src");
    limiter.recordFailure("src");
    limiter.reconfigure({ limit: 2, windowMs: 60_000 });
    assert.equal(limiter.isLimited("src"), true);
  });
});

describe("classifyVerificationError", () => {
  test("maps verifySignature error strings to stable reasons", () => {
    assert.equal(classifyVerificationError("Timestamp too old: 400s (tolerance: 300s)"), "expired_timestamp");
    assert.equal(classifyVerificationError("Timestamp in future: 400s"), "expired_timestamp");
    assert.equal(classifyVerificationError("Missing or invalid signature header"), "malformed_header");
    assert.equal(classifyVerificationError("Invalid or missing timestamp in signature"), "malformed_header");
    assert.equal(classifyVerificationError("Invalid or missing signature (v1)"), "malformed_header");
    assert.equal(classifyVerificationError("Invalid signature"), "invalid_signature");
    assert.equal(classifyVerificationError(undefined), "invalid_signature");
  });
});

describe("getWebhookAbuseLimits / getClientSource", () => {
  test("defaults and env overrides", () => {
    const defaults = getWebhookAbuseLimits({});
    assert.deepEqual(defaults, {
      maxBodyBytes: 262144,
      invalidAttemptLimit: 10,
      windowMs: 60000,
    });
    const overrides = getWebhookAbuseLimits({
      WEBHOOK_MAX_BODY_BYTES: "1024",
      WEBHOOK_INVALID_ATTEMPT_LIMIT: "3",
      WEBHOOK_RATE_LIMIT_WINDOW_MS: "5000",
    });
    assert.deepEqual(overrides, { maxBodyBytes: 1024, invalidAttemptLimit: 3, windowMs: 5000 });
    const junk = getWebhookAbuseLimits({ WEBHOOK_MAX_BODY_BYTES: "abc", WEBHOOK_INVALID_ATTEMPT_LIMIT: "-2" });
    assert.equal(junk.maxBodyBytes, 262144);
    assert.equal(junk.invalidAttemptLimit, 10);
  });

  test("source extraction prefers first x-forwarded-for entry", () => {
    const req = new Request("https://example.test", {
      headers: { "x-forwarded-for": "  203.0.113.1 , 10.1.2.3" },
    });
    assert.equal(getClientSource(req as never), "203.0.113.1");
    const realIp = new Request("https://example.test", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    assert.equal(getClientSource(realIp as never), "198.51.100.7");
    const none = new Request("https://example.test");
    assert.equal(getClientSource(none as never), "unknown");
  });
});
