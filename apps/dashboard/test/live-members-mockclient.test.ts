import { test } from "node:test";
import assert from "node:assert";

test("GET /api/members uses injected IntegrationClient in live mode via mock client", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  const previousApiKey = process.env.GUILD_PASS_CORE_API_KEY;
  const previousWebhookSecret = process.env.WEBHOOK_SECRET;
  const previousCoreUrl = process.env.GUILD_PASS_CORE_URL;
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_API_KEY = "test-core-api-key";
  process.env.WEBHOOK_SECRET = "test-webhook-secret";
  process.env.GUILD_PASS_CORE_URL = "http://127.0.0.1:1";

  try {
    // inject a fake client
    (globalThis as any).__TEST_INTEGRATION_CLIENT = {
      getMembershipByWallet: async (wallet: string) => ({
        userId: `u_${wallet.slice(-4)}`,
        wallet,
        status: "active",
        roles: ["member"],
        updatedAt: new Date().toISOString(),
      }),
      getMembershipByDiscordUser: async (id: string) => ({
        userId: id,
        wallet: "0xtest",
        status: "active",
        roles: ["member"],
        updatedAt: new Date().toISOString(),
      }),
    };

    const { GET } = await import("../app/api/members/route.js");
    const req = new Request("http://localhost/api/members?wallet=0xabc123");
    const res = await GET(req);
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    const data = body.data;
    assert.ok(Array.isArray(data));
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].wallet, "0xabc123");
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
