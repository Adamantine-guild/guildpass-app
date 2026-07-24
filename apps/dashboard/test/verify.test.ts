import { test } from "node:test";
import assert from "node:assert";

test("POST /api/verify returns mock verification in mock mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  process.env.DASHBOARD_API_MODE = "mock";

  try {
    const { POST } = await import("../app/api/verify/route.js");

    const payload = { discordUserId: "user_123", wallet: "0x742d35cC6634c0532925a3B8879539d43374E290" };
    const req = new Request("http://localhost/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req as any);
    const body = await res.json();

    // In mock mode we return a mock verification object
    assert.strictEqual(body.ok, true);
    const data = body.data;
    assert.strictEqual(data.wallet, payload.wallet);
    assert.strictEqual(data.userId, payload.discordUserId);
    assert.strictEqual(data.verified, true);
  } finally {
    if (previousMode === undefined) {
      delete process.env.DASHBOARD_API_MODE;
    } else {
      process.env.DASHBOARD_API_MODE = previousMode;
    }
  }
});
