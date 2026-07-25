import { test, describe } from "node:test";
import assert from "node:assert";
import { CircuitBreaker, CircuitOpenError } from "../dist/http/circuitBreaker.js";
import { HttpClient } from "../dist/http/httpClient.js";

describe("CircuitBreaker (state machine)", () => {
  test("opens after the configured number of consecutive failures", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
    assert.strictEqual(cb.getStatus().state, "closed");
    cb.recordFailure();
    cb.recordFailure();
    assert.strictEqual(cb.getStatus().state, "closed");
    cb.recordFailure();
    assert.strictEqual(cb.getStatus().state, "open");
  });

  test("a success resets the failure count while closed", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, now: () => 0 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    assert.strictEqual(cb.getStatus().failureCount, 0);
    cb.recordFailure();
    cb.recordFailure();
    assert.strictEqual(cb.getStatus().state, "closed");
  });

  test("rejects requests while open and before cooldown elapses", () => {
    let clock = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => clock });
    cb.recordFailure();
    assert.strictEqual(cb.getStatus().state, "open");
    clock = 500;
    assert.strictEqual(cb.canRequest(), false);
  });

  test("allows a single probe (half-open) once cooldown elapses", () => {
    let clock = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => clock });
    cb.recordFailure();
    clock = 1000;
    assert.strictEqual(cb.canRequest(), true);
    assert.strictEqual(cb.getStatus().state, "half-open");
  });

  test("a successful probe closes the circuit", () => {
    let clock = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => clock });
    cb.recordFailure();
    clock = 1000;
    cb.canRequest();
    cb.recordSuccess();
    assert.strictEqual(cb.getStatus().state, "closed");
    assert.strictEqual(cb.getStatus().failureCount, 0);
  });

  test("a failed probe re-opens the circuit and restarts the cooldown", () => {
    let clock = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => clock });
    cb.recordFailure();
    clock = 1000;
    cb.canRequest();
    cb.recordFailure();
    assert.strictEqual(cb.getStatus().state, "open");
    assert.strictEqual(cb.getStatus().retryAt, 2000);
    clock = 1500;
    assert.strictEqual(cb.canRequest(), false);
  });
});

describe("HttpClient + circuit breaker (integration)", () => {
  test("trips after N failures, then fails fast without calling fetch", async () => {
    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      return new Response("err", { status: 500 });
    };
    const client = new HttpClient({
      fetch: mockFetch,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 2, cooldownMs: 10000 },
    });

    await client.request("http://x").catch(() => {});
    await client.request("http://x").catch(() => {});
    assert.strictEqual(fetchCalls, 2);

    await assert.rejects(
      () => client.request("http://x"),
      (err) => err instanceof CircuitOpenError && err.code === "circuit_open",
    );
    assert.strictEqual(fetchCalls, 2, "fetch must not be called while the circuit is open");
  });

  test("a 404 does not trip the breaker (upstream is responding)", async () => {
    const mockFetch = async () => new Response("not found", { status: 404 });
    const client = new HttpClient({
      fetch: mockFetch,
      retry: { maxAttempts: 1 },
      circuitBreaker: { failureThreshold: 2, cooldownMs: 10000 },
    });

    await client.request("http://x");
    await client.request("http://x");
    await client.request("http://x");
    assert.strictEqual(client.getStatus().state, "closed");
  });

  test("a retry-then-success counts as one success, not per-attempt failures", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts < 3) return new Response("transient", { status: 503 });
      return new Response("ok", { status: 200 });
    };
    const client = new HttpClient({
      fetch: mockFetch,
      retry: { maxAttempts: 3, delay: 1 },
      circuitBreaker: { failureThreshold: 2, cooldownMs: 10000 },
    });

    const res = await client.request("http://x");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(client.getStatus().state, "closed");
  });

  test("getStatus returns null when no breaker is configured", () => {
    const client = new HttpClient({ fetch: async () => new Response("ok") });
    assert.strictEqual(client.getStatus(), null);
  });
});
