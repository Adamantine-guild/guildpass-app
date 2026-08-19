import test from "node:test";
import assert from "node:assert";
import { HttpClient } from "../src/http/httpClient.ts";

test("HttpClient - timeout support", async () => {
  const mockFetch = async (url: string, init: any) => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve(new Response(JSON.stringify({ ok: true }))), 100);
      init.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(init.signal.reason);
      });
    });
    return new Response(JSON.stringify({ ok: true }));
  };

  const client = new HttpClient({ fetch: mockFetch as any, retry: { maxAttempts: 1 } });

  // Should succeed if timeout is longer than delay
  const res = await client.request("http://localhost", { timeout: 200 });
  assert.strictEqual(res.ok, true);

  // Should fail if timeout is shorter than delay
  await assert.rejects(
    client.request("http://localhost", { timeout: 50 }),
    (err: any) => err.message.includes("Timeout")
  );
});

test("HttpClient - explicit retry support", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    if (attempts < 3) {
      return new Response("Error", { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }));
  };

  const client = new HttpClient({
    fetch: mockFetch as any,
    retry: { maxAttempts: 3, delay: 10 }
  });

  const res = await client.request("http://localhost");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(attempts, 3);
});

test("HttpClient - abort support", async () => {
  const controller = new AbortController();
  const mockFetch = async (url: string, init: any) => {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve(new Response("ok")), 200);
      init.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(init.signal.reason);
      });
    });
    return new Response("ok");
  };

  const client = new HttpClient({ fetch: mockFetch as any });

  const promise = client.request("http://localhost", { signal: controller.signal });
  setTimeout(() => controller.abort("user cancel"), 50);

  await assert.rejects(promise, (err: any) => err === "user cancel");
});

test("HttpClient - applies DEFAULT_RETRY_CONFIG automatically", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    if (attempts < 3) {
      return new Response("Transient Error", { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true }));
  };

  // Instantiate with NO explicit retry config
  const client = new HttpClient({ fetch: mockFetch as any });

  const res = await client.request("http://localhost");
  assert.strictEqual(res.ok, true);
  // Default config dictates 3 max attempts
  assert.strictEqual(attempts, 3);
});

test("HttpClient - explicit maxAttempts: 1 correctly overrides default", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    return new Response("Transient Error", { status: 502 });
  };

  // Provide explicit override
  const client = new HttpClient({ fetch: mockFetch as any, retry: { maxAttempts: 1 } });

  const res = await client.request("http://localhost");
  assert.strictEqual(res.status, 502);
  assert.strictEqual(attempts, 1);
});

test("HttpClient - gracefully retries on network-level fetch failures", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts++;
    if (attempts < 2) {
      throw new TypeError("fetch failed"); // Simulates ECONNREFUSED/network error
    }
    return new Response("ok", { status: 200 });
  };

  const client = new HttpClient({ fetch: mockFetch as any });
  const res = await client.request("http://localhost");

  assert.strictEqual(res.status, 200);
  assert.strictEqual(attempts, 2);
});