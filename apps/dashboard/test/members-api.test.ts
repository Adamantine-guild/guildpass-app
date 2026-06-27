import { test } from "node:test";
import assert from "node:assert";

// Ensure mock mode during tests
process.env.DASHBOARD_API_MODE = "mock";
process.env.DASHBOARD_STORAGE_MODE = "mock";

test("GET /api/members returns members in mock mode", async () => {
  const { GET } = await import("../app/api/members/route.js");
  const req = new Request("http://localhost/api/members");
  const res: any = await GET(req);
  const data = await res.json();

  assert.ok(Array.isArray(data), "response should be an array");
  assert.ok(data.length > 0, "should return some members");
});

test("GET /api/members with wallet returns specific member", async () => {
  const { GET } = await import("../app/api/members/route.js");
  const { mockMembers } = await import("../lib/mock-data.js");
  const targetWallet = mockMembers[0].wallet;

  const req = new Request(`http://localhost/api/members?wallet=${targetWallet}`);
  const res: any = await GET(req);
  const data = await res.json();

  assert.ok(Array.isArray(data));
  assert.strictEqual(data.length, 1);
  assert.strictEqual(data[0].wallet, targetWallet);
});

test("POST /api/members fails without wallet", async () => {
  const { POST } = await import("../app/api/members/route.js");
  const req = new Request("http://localhost/api/members", {
    method: "POST",
    body: JSON.stringify({ name: "No Wallet" }),
    headers: { "Content-Type": "application/json" }
  });
  const res: any = await POST(req);
  const data = await res.json();

  assert.strictEqual(res.status, 400);
  assert.strictEqual(data.error, "Wallet address is required");
});
