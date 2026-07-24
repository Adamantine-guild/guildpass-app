import { test, describe } from "node:test";
import assert from "node:assert";
import { IntegrationClient } from "../dist/client.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWithFetch(fetchImpl) {
  return new IntegrationClient({
    baseUrl: "https://core.example",
    apiKey: "test-key",
    transport: { fetch: fetchImpl, retry: { maxAttempts: 1 } },
  });
}

describe("IntegrationClient.getGuildSnapshot", () => {
  test("returns the parsed snapshot on 200", async () => {
    const snapshot = {
      guildId: "guild-1",
      generatedAt: "2026-07-24T00:00:00.000Z",
      guild: { name: "Core Guild" },
      members: [
        { userId: "u1", wallet: "0xabc", status: "active", roles: ["admin"], updatedAt: "2026-07-24T00:00:00.000Z" },
      ],
      passes: [{ id: "p1", name: "Gold", status: "active", currentSupply: 3 }],
    };
    let seenUrl;
    let seenAuth;
    const client = clientWithFetch(async (url, init) => {
      seenUrl = url;
      seenAuth = init?.headers?.authorization;
      return jsonResponse(200, snapshot);
    });

    const result = await client.getGuildSnapshot("guild-1");
    assert.deepStrictEqual(result, snapshot);
    assert.strictEqual(seenUrl, "https://core.example/v1/guilds/guild-1/snapshot");
    assert.strictEqual(seenAuth, "Bearer test-key");
  });

  test("URL-encodes the guild id", async () => {
    let seenUrl;
    const client = clientWithFetch(async (url) => {
      seenUrl = url;
      return jsonResponse(200, { guildId: "a/b", generatedAt: "x", members: [], passes: [] });
    });
    await client.getGuildSnapshot("a/b");
    assert.strictEqual(seenUrl, "https://core.example/v1/guilds/a%2Fb/snapshot");
  });

  test("returns null on 404 (core does not support snapshots)", async () => {
    const client = clientWithFetch(async () => jsonResponse(404, { error: "not found" }));
    const result = await client.getGuildSnapshot("guild-1");
    assert.strictEqual(result, null);
  });

  test("throws core:<status> on other non-OK responses", async () => {
    const client = clientWithFetch(async () => jsonResponse(500, { error: "boom" }));
    await assert.rejects(() => client.getGuildSnapshot("guild-1"), /core:500/);
  });
});
