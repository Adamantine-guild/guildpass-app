import { describe, test } from "node:test";
import assert from "node:assert";
import type { ActivityEvent } from "@guildpass/integration-client";
import { parseActivityQuery } from "../lib/activity/query.ts";
import { queryActivityEvents } from "../lib/activity/storage.ts";

const events: ActivityEvent[] = [
  {
    id: "evt_a",
    type: "member.joined",
    source: "dashboard",
    severity: "info",
    actor: { name: "Alice" },
    timestamp: "2025-06-12T10:00:00Z",
    description: "Alice joined",
    entity: { type: "member", id: "mem_1", name: "Alice" },
  },
  {
    id: "evt_b",
    type: "pass.created",
    source: "webhook",
    severity: "warning",
    actor: { name: "Admin" },
    timestamp: "2025-06-12T10:00:00Z",
    description: "Pass created",
    entity: { type: "pass", id: "pass_1" },
  },
  {
    id: "evt_c",
    type: "guild.updated",
    source: "core_api",
    severity: "error",
    actor: { wallet: "0x123" },
    timestamp: "2025-06-11T10:00:00Z",
    description: "Guild updated",
    entity: { type: "guild", id: "guild_1" },
  },
  {
    id: "evt_d",
    type: "verification.completed",
    source: "webhook",
    severity: "info",
    actor: { name: "Bob" },
    timestamp: "2025-06-10T10:00:00Z",
    description: "Verification completed",
    entity: { type: "verification", id: "0x456" },
  },
];

describe("activity queries", () => {
  test("returns bounded deterministic pages", () => {
    const firstPage = queryActivityEvents(events, { limit: 2 });

    assert.deepStrictEqual(firstPage.events.map((event) => event.id), [
      "evt_b",
      "evt_a",
    ]);
    assert.ok(firstPage.nextCursor);

    const secondPage = queryActivityEvents(events, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    });

    assert.deepStrictEqual(secondPage.events.map((event) => event.id), [
      "evt_c",
      "evt_d",
    ]);
    assert.strictEqual(secondPage.nextCursor, null);
  });

  test("filters by type, source, severity, entity, actor, and timestamp", () => {
    assert.deepStrictEqual(
      queryActivityEvents(events, { type: "pass.created" }).events.map((event) => event.id),
      ["evt_b"]
    );
    assert.deepStrictEqual(
      queryActivityEvents(events, { source: "webhook" }).events.map((event) => event.id),
      ["evt_b", "evt_d"]
    );
    assert.deepStrictEqual(
      queryActivityEvents(events, { severity: "error" }).events.map((event) => event.id),
      ["evt_c"]
    );
    assert.deepStrictEqual(
      queryActivityEvents(events, { entityType: "guild" }).events.map((event) => event.id),
      ["evt_c"]
    );
    assert.deepStrictEqual(
      queryActivityEvents(events, { actor: "ali" }).events.map((event) => event.id),
      ["evt_a"]
    );
    assert.deepStrictEqual(
      queryActivityEvents(events, { from: "2025-06-12T00:00:00Z" }).events.map((event) => event.id),
      ["evt_b", "evt_a"]
    );
  });

  test("returns a clear empty result shape", () => {
    assert.deepStrictEqual(queryActivityEvents(events, { type: "pass.deleted" }), {
      events: [],
      nextCursor: null,
    });
  });

  test("rejects invalid query parameters", () => {
    for (const query of [
      "limit=0",
      "limit=101",
      "type=pass.minted",
      "source=bot",
      "severity=fatal",
      "entityType=team",
      "from=not-a-date",
      "cursor=bad",
    ]) {
      assert.ok("error" in parseActivityQuery(new URLSearchParams(query)), query);
    }
  });
});
