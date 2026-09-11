import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { fetchActivity } from "../lib/mock-data";

describe("fetchActivity", () => {
  test("passes activity query parameters through to the API", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];

    globalThis.fetch = async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({ ok: true, data: { events: [], nextCursor: null, total: 0 } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    try {
      const result = await fetchActivity({
        limit: 5,
        cursor: "evt_123",
        type: "member.joined",
        source: "webhook",
        severity: "error",
        actor: "alice",
      });

      assert.deepEqual(result, { events: [], nextCursor: null, total: 0 });
      assert.equal(
        urls[0],
        "/api/activity?limit=5&cursor=evt_123&type=member.joined&source=webhook&severity=error&actor=alice"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
