import { test } from "node:test";
import assert from "node:assert";
import { privateKeyToAccount } from "viem/accounts";

// Hardhat/Anvil dev account #0 (public test key)
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

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
    const { resetVerificationChallengeStore } = await import("../lib/verification-challenge.js");
    resetVerificationChallengeStore();

    (globalThis as any).__TEST_INTEGRATION_CLIENT = {
      verifyWallet: async (discordUserId: string, wallet: string) => ({
        userId: discordUserId,
        wallet,
        verified: true,
        message: "mocked",
      }),
    };

    const { POST: challengePOST } = await import("../app/api/verify/challenge/route.js");
    const challengeRes = await challengePOST(
      new Request("http://localhost/api/verify/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordUserId: "u_inj", wallet: TEST_WALLET }),
      }) as any,
    );
    const challengeBody = await challengeRes.json();
    const { nonce, message } = challengeBody.data;

    const account = privateKeyToAccount(TEST_KEY);
    const signature = await account.signMessage({ message });

    const { POST } = await import("../app/api/verify/route.js");
    const res = await POST(
      new Request("http://localhost/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordUserId: "u_inj", wallet: TEST_WALLET, nonce, signature }),
      }) as any,
    );
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    const data = body.data;
    assert.strictEqual(data.userId, "u_inj");
    assert.strictEqual(data.wallet, TEST_WALLET);
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
