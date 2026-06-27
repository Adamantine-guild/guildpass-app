import { test } from "node:test";
import assert from "node:assert";

// Ensure mock mode during tests
process.env.DASHBOARD_API_MODE = "mock";
process.env.DASHBOARD_STORAGE_MODE = "mock";

test("GET /api/passes returns passes in mock mode", async () => {
  const { GET } = await import("../app/api/passes/route.js");
  const res: any = await GET();
  const data = await res.json();

  assert.ok(Array.isArray(data), "response should be an array");
  assert.ok(data.length > 0, "should return some passes");
  assert.ok(data[0].id, "pass should have an id");
});

test("POST /api/passes creates a new pass", async () => {
  const { POST } = await import("../app/api/passes/route.js");
  const req = new Request("http://localhost/api/passes", {
    method: "POST",
    body: JSON.stringify({ name: "New Test Pass", description: "Test Description", status: "active", currentSupply: 0 }),
    headers: { "Content-Type": "application/json" }
  });
  const res: any = await POST(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.name, "New Test Pass");
});

test("POST /api/passes fails without name", async () => {
  const { POST } = await import("../app/api/passes/route.js");
  const req = new Request("http://localhost/api/passes", {
    method: "POST",
    body: JSON.stringify({ description: "No Name" }),
    headers: { "Content-Type": "application/json" }
  });
  const res: any = await POST(req);
  const data = await res.json();

  assert.strictEqual(res.status, 400);
  assert.ok(data.error, "should return an error message");
});
