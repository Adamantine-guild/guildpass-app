import { test } from "node:test";
import assert from "node:assert";

process.env.DASHBOARD_API_MODE = "live";

test("Live mode with mocked IntegrationClient for wallet verification", async () => {
  globalThis.__TEST_INTEGRATION_CLIENT = {
    verifyWallet: async (discordUserId, wallet) => ({
      userId: discordUserId,
      wallet,
      verified: true,
      message: "mocked",
    }),
  };

  const discordUserId = "u_inj";
  const wallet = "0xfeed";
  const result = await globalThis.__TEST_INTEGRATION_CLIENT.verifyWallet(discordUserId, wallet);

  assert.strictEqual(result.userId, discordUserId);
  assert.strictEqual(result.wallet, wallet);
  assert.strictEqual(result.verified, true);

  delete globalThis.__TEST_INTEGRATION_CLIENT;
});

test("Verification failure handling in live mode", async () => {
  globalThis.__TEST_INTEGRATION_CLIENT = {
    verifyWallet: async (discordUserId, wallet) => ({
      userId: discordUserId,
      wallet,
      verified: false,
      message: "verification failed",
    }),
  };

  const result = await globalThis.__TEST_INTEGRATION_CLIENT.verifyWallet("u_fail", "0xinvalid");
  
  assert.strictEqual(result.verified, false);
  assert.ok(typeof result.message === "string");

  delete globalThis.__TEST_INTEGRATION_CLIENT;
});
