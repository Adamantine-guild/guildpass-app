import { test } from "node:test";
import assert from "node:assert";

// Ensure mock mode during tests
process.env.DASHBOARD_API_MODE = "mock";
process.env.DASHBOARD_STORAGE_MODE = "mock";

test("GET /api/settings returns settings", async () => {
  const { GET } = await import("../app/api/settings/route.js");
  const res: any = await GET();
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.ok(data.workspaceName);
});

test("PATCH /api/settings updates settings", async () => {
  const { PATCH } = await import("../app/api/settings/route.js");
  const req = new Request("http://localhost/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ workspaceName: "Updated Name" }),
    headers: { "Content-Type": "application/json" }
  });
  const res: any = await PATCH(req);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.message, "Settings updated successfully");
});

test("PATCH /api/settings fails without workspaceName", async () => {
  const { PATCH } = await import("../app/api/settings/route.js");
  const req = new Request("http://localhost/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ other: "stuff" }),
    headers: { "Content-Type": "application/json" }
  });
  const res: any = await PATCH(req);
  const data = await res.json();

  assert.strictEqual(res.status, 400);
  assert.strictEqual(data.error, "Workspace name is required");
});
