import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";

test("POST /api/verify forwards to core API in live mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  const previousCoreUrl = process.env.GUILD_PASS_CORE_URL;
  const previousApiKey = process.env.GUILD_PASS_CORE_API_KEY;
  const previousWebhookSecret = process.env.WEBHOOK_SECRET;
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_API_KEY = "test-core-api-key";
  process.env.WEBHOOK_SECRET = "test-webhook-secret";

  // Note: this test requires a mock HTTP server; see live-verify-mockclient for injected version
  const server = http.createServer((req, res) => {
    if (!req.url) return res.end();
    const url = new URL(req.url, `http://localhost`);

    if (url.pathname === "/v1/verify" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        const result = {
          userId: parsed.discordUserId,
          wallet: parsed.wallet,
          verified: true,
          message: "verified by fake core",
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      });
      return;
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
    const { POST } = await import("../app/api/verify/route.js");

    const payload = { discordUserId: "u_live", wallet: "0x742d35cC6634c0532925a3B8879539d43374E290" };
    const req = new Request("http://localhost/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req as any);
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    const data = body.data;
    assert.strictEqual(data.userId, payload.discordUserId);
    assert.strictEqual(data.wallet, payload.wallet);
    assert.strictEqual(data.verified, true);
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
