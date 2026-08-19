import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  dispatchWebhook,
  verifySignature,
  createSubscriberRegistry,
  loadSubscriberRegistryFromEnv,
  InMemoryDeadLetterStore,
} from "../dist/index.js";

const SECRET = "test-dispatch-secret";

function makeEvent(overrides = {}) {
  return {
    event: "member.joined",
    payload: { memberId: "m_123" },
    timestamp: new Date().toISOString(),
    guildId: "g_1",
    ...overrides,
  };
}

// No real delay/randomness in tests: deterministic sleep + jitter stand-ins.
const noopSleep = async () => {};
const fixedRandom = () => 0.5;

// Minimal fetch Response stand-in — avoids depending on the global Response
// constructor, which not all lint/runtime targets in this repo provide.
function fakeResponse(status) {
  return { ok: status >= 200 && status < 300, status };
}

describe("dispatchWebhook", () => {
  describe("signing and verification symmetry", () => {
    test("signs the outbound payload so verifySignature accepts it", async () => {
      const event = makeEvent();
      let capturedBody;
      let capturedSignature;

      const fetchImpl = async (url, init) => {
        capturedBody = init.body;
        capturedSignature = init.headers["x-guildpass-signature"];
        return fakeResponse(200);
      };

      const result = await dispatchWebhook("https://example.test/hook", event, {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: noopSleep,
      });

      assert.strictEqual(result.delivered, true);
      assert.ok(capturedSignature.includes("t="));
      assert.ok(capturedSignature.includes("v1="));

      const verifyResult = verifySignature({
        signatureHeader: capturedSignature,
        secret: SECRET,
        payload: capturedBody,
      });

      assert.strictEqual(verifyResult.valid, true);
      assert.deepStrictEqual(JSON.parse(capturedBody), event);
    });

    test("a wrong secret fails verification of a dispatched payload", async () => {
      const event = makeEvent();
      let capturedBody;
      let capturedSignature;

      const fetchImpl = async (url, init) => {
        capturedBody = init.body;
        capturedSignature = init.headers["x-guildpass-signature"];
        return fakeResponse(200);
      };

      await dispatchWebhook("https://example.test/hook", event, {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: noopSleep,
      });

      const verifyResult = verifySignature({
        signatureHeader: capturedSignature,
        secret: "wrong-secret",
        payload: capturedBody,
      });

      assert.strictEqual(verifyResult.valid, false);
    });

    test("throws if no secret is provided", async () => {
      await assert.rejects(
        () => dispatchWebhook("https://example.test/hook", makeEvent(), { secret: "" }),
        /secret is required/,
      );
    });
  });

  describe("retry behavior", () => {
    test("succeeds without retrying when the first attempt is ok", async () => {
      let callCount = 0;
      const fetchImpl = async () => {
        callCount++;
        return fakeResponse(200);
      };

      const result = await dispatchWebhook("https://example.test/hook", makeEvent(), {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: noopSleep,
        random: fixedRandom,
      });

      assert.strictEqual(result.delivered, true);
      assert.strictEqual(callCount, 1);
      assert.strictEqual(result.attempts.length, 1);
    });

    test("retries transient failures and succeeds within maxAttempts", async () => {
      let callCount = 0;
      const sleeps = [];
      const fetchImpl = async () => {
        callCount++;
        if (callCount < 3) {
          return fakeResponse(503);
        }
        return fakeResponse(200);
      };

      const result = await dispatchWebhook("https://example.test/hook", makeEvent(), {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: fixedRandom,
        retry: { maxAttempts: 3 },
      });

      assert.strictEqual(result.delivered, true);
      assert.strictEqual(callCount, 3);
      assert.strictEqual(result.attempts.length, 3);
      assert.strictEqual(result.attempts[0].status, 503);
      assert.strictEqual(result.attempts[2].status, 200);
      // Two backoff sleeps between three attempts, growing with attempt number.
      assert.strictEqual(sleeps.length, 2);
      assert.ok(sleeps[1] >= sleeps[0]);
    });

    test("retries network errors (fetch throws), not just non-ok responses", async () => {
      let callCount = 0;
      const fetchImpl = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error("ECONNRESET");
        }
        return fakeResponse(200);
      };

      const result = await dispatchWebhook("https://example.test/hook", makeEvent(), {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: noopSleep,
        random: fixedRandom,
        retry: { maxAttempts: 3 },
      });

      assert.strictEqual(result.delivered, true);
      assert.strictEqual(result.attempts[0].error, "ECONNRESET");
      assert.strictEqual(result.attempts[1].status, 200);
    });

    test("uses exponential backoff with jitter bounded by the growing cap", async () => {
      const randomValues = [0.9, 0.9, 0.9];
      let call = 0;
      const random = () => randomValues[call++];
      const sleeps = [];

      const fetchImpl = async () => fakeResponse(500);

      await dispatchWebhook("https://example.test/hook", makeEvent(), {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: async (ms) => sleeps.push(ms),
        random,
        retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 10_000 },
      });

      // attempt 1 -> cap 100, attempt 2 -> cap 200; jitter is random() * cap.
      assert.strictEqual(sleeps[0], Math.floor(0.9 * 100));
      assert.strictEqual(sleeps[1], Math.floor(0.9 * 200));
    });
  });

  describe("dead-letter handling", () => {
    test("records exhausted deliveries in the dead-letter store", async () => {
      const store = new InMemoryDeadLetterStore();
      const event = makeEvent({ event: "pass.revoked" });

      const fetchImpl = async () => fakeResponse(500);

      const result = await dispatchWebhook("https://example.test/hook", event, {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: noopSleep,
        random: fixedRandom,
        retry: { maxAttempts: 3 },
        deadLetterStore: store,
      });

      assert.strictEqual(result.delivered, false);
      assert.strictEqual(result.deadLettered, true);

      const entries = await store.list();
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].subscriberUrl, "https://example.test/hook");
      assert.deepStrictEqual(entries[0].event, event);
      assert.strictEqual(entries[0].attempts.length, 3);
      assert.ok(entries[0].id);
      assert.ok(entries[0].failedAt);
    });

    test("does not record to the dead-letter store on eventual success", async () => {
      const store = new InMemoryDeadLetterStore();
      let callCount = 0;
      const fetchImpl = async () => {
        callCount++;
        return fakeResponse(callCount < 2 ? 500 : 200);
      };

      await dispatchWebhook("https://example.test/hook", makeEvent(), {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: noopSleep,
        random: fixedRandom,
        retry: { maxAttempts: 3 },
        deadLetterStore: store,
      });

      assert.strictEqual((await store.list()).length, 0);
    });

    test("does not throw when exhausted and no dead-letter store is configured", async () => {
      const fetchImpl = async () => fakeResponse(500);

      const result = await dispatchWebhook("https://example.test/hook", makeEvent(), {
        secret: SECRET,
        fetch: fetchImpl,
        sleep: noopSleep,
        random: fixedRandom,
        retry: { maxAttempts: 2 },
      });

      assert.strictEqual(result.delivered, false);
      assert.strictEqual(result.deadLettered, false);
    });
  });
});

describe("subscriber registry", () => {
  test("createSubscriberRegistry resolves single and multiple URLs per guild", () => {
    const registry = createSubscriberRegistry({
      g_1: "https://a.test/hook",
      g_2: ["https://b.test/hook", "https://c.test/hook"],
    });

    assert.deepStrictEqual(registry.getSubscriberUrls("g_1"), ["https://a.test/hook"]);
    assert.deepStrictEqual(registry.getSubscriberUrls("g_2"), [
      "https://b.test/hook",
      "https://c.test/hook",
    ]);
    assert.deepStrictEqual(registry.getSubscriberUrls("unknown"), []);
  });

  test("loadSubscriberRegistryFromEnv reads a JSON-mapped env var", () => {
    const env = {
      WEBHOOK_SUBSCRIBERS: JSON.stringify({ g_1: "https://a.test/hook" }),
    };

    const registry = loadSubscriberRegistryFromEnv("WEBHOOK_SUBSCRIBERS", env);
    assert.deepStrictEqual(registry.getSubscriberUrls("g_1"), ["https://a.test/hook"]);
  });

  test("loadSubscriberRegistryFromEnv returns an empty registry when unset", () => {
    const registry = loadSubscriberRegistryFromEnv("WEBHOOK_SUBSCRIBERS", {});
    assert.deepStrictEqual(registry.getSubscriberUrls("g_1"), []);
  });

  test("loadSubscriberRegistryFromEnv rejects malformed JSON", () => {
    assert.throws(
      () => loadSubscriberRegistryFromEnv("WEBHOOK_SUBSCRIBERS", { WEBHOOK_SUBSCRIBERS: "{not json" }),
      /valid JSON/,
    );
  });
});

describe("no hard-coded secrets in dispatcher config", () => {
  test("dispatch.ts does not embed a webhook secret literal", () => {
    const source = readFileSync(new URL("../src/dispatch.ts", import.meta.url), "utf8");
    // Secrets must flow in via DispatchOptions.secret, never a literal default.
    assert.doesNotMatch(source, /secret\s*=\s*["'`][^"'`]+["'`]/i);
    assert.doesNotMatch(source, /whsec_/i);
  });

  test("registry.ts does not embed subscriber URLs or secrets", () => {
    const source = readFileSync(new URL("../src/registry.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /https?:\/\/(?!example\.(test|com))/i);
    assert.doesNotMatch(source, /whsec_/i);
  });

  test(".env.example documents dispatch config without real secret values", () => {
    const envExample = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    assert.match(envExample, /WEBHOOK_DISPATCH_SECRET=\s*$/m);
    assert.match(envExample, /WEBHOOK_SUBSCRIBERS=\s*$/m);
  });
});
