import { test } from "node:test";
import assert from "node:assert";

// Ensure mock mode during tests
process.env.DASHBOARD_API_MODE = "mock";
process.env.DASHBOARD_STORAGE_MODE = "mock";

test("GET /api/guilds returns guilds in mock mode", async () => {
  const { GET } = await import("../app/api/guilds/route.js");
  const res: any = await GET();
  const data = await res.json();

  assert.ok(Array.isArray(data), "response should be an array");
  assert.ok(data.length > 0, "should return some guilds");
});

test("POST /api/guilds creates a new guild", async () => {
  const { POST } = await import("../app/api/guilds/route.js");
  const req = new Request("http://localhost/api/guilds", {
    method: "POST",
    body: JSON.stringify({ name: "New Test Guild", description: "Test Description", memberCount: 0, passCount: 0 }),
    headers: { "Content-Type": "application/json" }
  });
  const res: any = await POST(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.name, "New Test Guild");
});

test("DELETE /api/guilds fails without id", async () => {
  const { DELETE } = await import("../app/api/guilds/route.js");
  const req = new Request("http://localhost/api/guilds");
  const res: any = await DELETE(req);
  const data = await res.json();

  assert.strictEqual(res.status, 400);
  assert.strictEqual(data.error, "Guild ID is required");
});
