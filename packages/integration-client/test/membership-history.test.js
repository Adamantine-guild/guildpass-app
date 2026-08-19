import test from "node:test";
import assert from "node:assert/strict";
import { IntegrationClient, UpstreamError } from "../dist/index.js";

const wallet = "0xAbC123";

test("membership.getHistory fetches a typed paginated history", async () => {
  let requestedUrl = "";
  let requestedHeaders;
  const client = new IntegrationClient({
    baseUrl: "https://core.example/",
    apiKey: "test-key",
    transport: {
      fetch: async (url, init) => {
        requestedUrl = url;
        requestedHeaders = init?.headers;
        return new Response(JSON.stringify({
          events: [{ id: "event-1", wallet, type: "joined", occurredAt: "2026-08-19T12:00:00.000Z", roles: ["member"] }],
          nextCursor: "cursor-2",
          hasMore: true,
        }));
      },
      retry: { maxAttempts: 1 },
    },
  });

  const history = await client.membership.getHistory(wallet, {
    cursor: "cursor-1",
    limit: 25,
    eventTypes: ["joined", "role_changed"],
  });

  assert.equal(requestedUrl, "https://core.example/v1/memberships/wallet/0xAbC123/history?cursor=cursor-1&limit=25&eventTypes=joined%2Crole_changed");
  assert.equal(requestedHeaders.authorization, "Bearer test-key");
  assert.equal(history.events[0].type, "joined");
  assert.equal(history.nextCursor, "cursor-2");
  assert.equal(history.hasMore, true);
});

test("membership.getHistory returns an empty page", async () => {
  const client = new IntegrationClient({
    baseUrl: "https://core.example",
    transport: { fetch: async () => new Response(JSON.stringify({ events: [], nextCursor: null, hasMore: false })) },
  });

  const history = await client.membership.getHistory(wallet);

  assert.deepEqual(history, { events: [], nextCursor: null, hasMore: false });
});

test("membership.getHistory propagates HTTP errors", async () => {
  const client = new IntegrationClient({
    baseUrl: "https://core.example",
    transport: {
      fetch: async () => new Response("Unavailable", { status: 503, statusText: "Service Unavailable" }),
      retry: { maxAttempts: 1 },
    },
  });

  await assert.rejects(
    client.membership.getHistory(wallet),
    (error) => error instanceof UpstreamError && error.status === 503,
  );
});