import { test } from "node:test";
import assert from "node:assert";

test("POST /api/verify uses injected IntegrationClient in live mode via mock client", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  const previousApiKey = process.env.GUILD_PASS_CORE_API_KEY;
  const previousWebhookSecret = process.env.WEBHOOK_SECRET;
  const previousCoreUrl = process.env.GUILD_PASS_CORE_URL;
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_API_KEY = "test-core-api-key";
  process.env.WEBHOOK_SECRET = "test-webhook-secret";
  process.env.GUILD_PASS_CORE_URL = "http://127.0.0.1:1";

  try {
    (globalThis as any).__TEST_INTEGRATION_CLIENT = {
      verifyWallet: async (discordUserId: string, wallet: string) => ({
        userId: discordUserId,
        wallet,
        verified: true,
        message: "mocked",
      }),
    };

    const { POST } = await import("../app/api/verify/route.js");

    const payload = { discordUserId: "u_inj", wallet: "0x742d35cC6634c0532925a3B8879539d43374E290" };
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
    delete (globalThis as any).__TEST_INTEGRATION_CLIENT;

    if (previousMode === undefined) {
      delete process.env.DASHBOARD_API_MODE;
    } else {
      process.env.DASHBOARD_API_MODE = previousMode;
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

    if (previousCoreUrl === undefined) {
      delete process.env.GUILD_PASS_CORE_URL;
    } else {
      process.env.GUILD_PASS_CORE_URL = previousCoreUrl;
    }
  }
});
