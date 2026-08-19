import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";

test("GET /api/members performs live wallet lookup via core API", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  const previousCoreUrl = process.env.GUILD_PASS_CORE_URL;
  const previousApiKey = process.env.GUILD_PASS_CORE_API_KEY;
  const previousWebhookSecret = process.env.WEBHOOK_SECRET;
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_API_KEY = "test-core-api-key";
  process.env.WEBHOOK_SECRET = "test-webhook-secret";

  // Note: this test requires a mock HTTP server; see live-members-mockclient for injected version
  // Start a tiny HTTP server that mimics the core API
  const server = http.createServer((req, res) => {
    if (!req.url) return res.end();

    const url = new URL(req.url, `http://localhost`);

    if (url.pathname.startsWith("/v1/memberships/wallet/")) {
      const wallet = decodeURIComponent(url.pathname.replace("/v1/memberships/wallet/", ""));
      const payload = {
        userId: `user_${wallet.slice(-6)}`,
        wallet,
        status: "active",
        roles: ["member"],
        updatedAt: new Date().toISOString(),
      };
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(payload));
    }

    if (url.pathname.startsWith("/v1/memberships/discord/")) {
      const id = decodeURIComponent(url.pathname.replace("/v1/memberships/discord/", ""));
      const payload = {
        userId: id,
        wallet: "0xdeadbeef",
        status: "active",
        roles: ["member"],
        updatedAt: new Date().toISOString(),
      };
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(payload));
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to start server");
  const port = addr.port;

  process.env.GUILD_PASS_CORE_URL = `http://127.0.0.1:${port}`;

  try {
    const { GET } = await import("../app/api/members/route");

    const req = new Request("http://localhost/api/members?wallet=0xabc123");
    const res: Response = await GET(req as any);
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    const data = body.data;
    assert.ok(Array.isArray(data));
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].wallet, "0xabc123");
  } finally {
    if (server.listening) {
      server.close();
    }

    if (previousMode === undefined) {
      delete process.env.DASHBOARD_API_MODE;
    } else {
      process.env.DASHBOARD_API_MODE = previousMode;
    }

    if (previousCoreUrl === undefined) {
      delete process.env.GUILD_PASS_CORE_URL;
    } else {
      process.env.GUILD_PASS_CORE_URL = previousCoreUrl;
    }

    if (previousApiKey === undefined) {
      delete process.env.GUILD_PASS_CORE_API_KEY;
    } else {
      process.env.GUILD_PASS_CORE_API_KEY = previousApiKey;
    }

    if (previousWebhookSecret === undefined) {
      delete process.env.WEBHOOK_SECRET;
    } else {
      process.env.WEBHOOK_SECRET = previousWebhookSecret;
    }
  }
});
