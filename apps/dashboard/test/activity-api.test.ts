import { test } from "node:test";
import assert from "node:assert";

// Ensure mock mode during tests
process.env.DASHBOARD_API_MODE = "mock";
process.env.DASHBOARD_STORAGE_MODE = "mock";

test("GET /api/activity returns events", async () => {
  const { GET } = await import("../app/api/activity/route.js");
  const req = new Request("http://localhost/api/activity");
  const res: any = await GET(req);
  const data = await res.json();

  assert.ok(Array.isArray(data), "response should be an array");
});

test("GET /api/activity with limit", async () => {
  const { GET } = await import("../app/api/activity/route.js");
  const req = new Request("http://localhost/api/activity?limit=2");
  const res: any = await GET(req);
  const data = await res.json();

  assert.ok(Array.isArray(data));
  assert.ok(data.length <= 2);
});
