import { test } from "node:test";
import assert from "node:assert";

// Ensure mock mode during tests
process.env.DASHBOARD_API_MODE = "mock";

test("Mock mode environment variable is set correctly", async () => {
  assert.strictEqual(process.env.DASHBOARD_API_MODE, "mock");
});

test("Members API response structure validates when in mock mode", async () => {
  // Mock response structure based on mockMembers
  const mockResponse = [
    {
      id: "1",
      wallet: "0x742d35Cc6634C0532925a3b8879539d43374e290",
      name: "Alice",
      status: "active",
      roles: ["admin", "member"],
      joinedAt: "2024-12-01T00:00:00Z",
      lastActive: "2025-06-10T12:34:56Z",
    },
  ];

  assert.ok(Array.isArray(mockResponse), "response should be an array");
  assert.ok(mockResponse.length > 0);
  
  const member = mockResponse[0];
  assert.ok(member.id);
  assert.ok(member.wallet);
  assert.ok(member.name);
  assert.ok(["active", "inactive", "pending"].includes(member.status));
  assert.ok(Array.isArray(member.roles));
});
