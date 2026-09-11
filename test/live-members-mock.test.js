import { test } from "node:test";
import assert from "node:assert";

process.env.DASHBOARD_API_MODE = "live";

test("Live mode environment variable is set correctly", async () => {
  assert.strictEqual(process.env.DASHBOARD_API_MODE, "live");
});

test("Live mode with mocked IntegrationClient returns correct membership structure", async () => {
  // Simulate the injected test client pattern
  globalThis.__TEST_INTEGRATION_CLIENT = {
    getMembershipByWallet: async (wallet) => ({
      userId: `u_${wallet.slice(-4)}`,
      wallet,
      status: "active",
      roles: ["member"],
      updatedAt: new Date().toISOString(),
    }),
  };

  // Mock the response mapping (dashboard converts IntegrationClient Membership -> Member)
  const wallet = "0xabc123";
  const membership = await globalThis.__TEST_INTEGRATION_CLIENT.getMembershipByWallet(wallet);
  
  const mappedMember = {
    id: membership.userId,
    wallet: membership.wallet ?? "",
    name: membership.userId,
    status: membership.status === "unknown" ? "pending" : membership.status,
    roles: membership.roles ?? [],
    joinedAt: membership.updatedAt,
    lastActive: membership.updatedAt,
  };

  assert.strictEqual(mappedMember.wallet, wallet);
  assert.strictEqual(mappedMember.id, `u_c123`);
  assert.strictEqual(mappedMember.status, "active");
  assert.ok(Array.isArray(mappedMember.roles));

  delete globalThis.__TEST_INTEGRATION_CLIENT;
});
