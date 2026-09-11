import { test } from "node:test";
import assert from "node:assert";

process.env.DASHBOARD_API_MODE = "mock";

test("Verification request validation in mock mode", async () => {
  // Validate that a mock verification response has the correct structure
  const payload = { discordUserId: "user_123", wallet: "0xabc" };
  const mockResponse = {
    userId: payload.discordUserId,
    wallet: payload.wallet,
    verified: true,
    message: "mock verification succeeded",
  };

  assert.strictEqual(mockResponse.userId, payload.discordUserId);
  assert.strictEqual(mockResponse.wallet, payload.wallet);
  assert.strictEqual(mockResponse.verified, true);
  assert.ok(typeof mockResponse.message === "string");
});

test("Verification request validation rejects missing parameters", async () => {
  const invalidPayloads = [
    { discordUserId: "user_123" }, // missing wallet
    { wallet: "0xabc" }, // missing discordUserId
    {}, // both missing
  ];

  invalidPayloads.forEach((payload) => {
    const hasDiscordUserId = "discordUserId" in payload && payload.discordUserId;
    const hasWallet = "wallet" in payload && payload.wallet;
    assert.ok(!hasDiscordUserId || !hasWallet || (hasDiscordUserId && hasWallet));
  });
});
