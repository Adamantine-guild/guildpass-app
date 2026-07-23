import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  filterActivityEvents,
  parseActivityQuery,
} from "../lib/activity/query";
import { makeActivityEvent } from "./fixtures";

const events = [
  makeActivityEvent({
    id: "evt_query_004",
    type: "pass.created",
    source: "dashboard",
    severity: "info",
    timestamp: "2025-01-15T12:04:00.000Z",
    entity: { type: "pass", id: "pass_004", name: "VIP" },
    actor: { name: "Admin" },
  }),
  makeActivityEvent({
    id: "evt_query_003",
    type: "verification.completed",
    source: "webhook",
    severity: "warning",
    timestamp: "2025-01-15T12:03:00.000Z",
    entity: { type: "verification", id: "0xabc" },
    actor: { wallet: "0xabc" },
  }),
  makeActivityEvent({
    id: "evt_query_002",
    type: "member.joined",
    source: "dashboard",
    severity: "info",
    timestamp: "2025-01-15T12:02:00.000Z",
    entity: { type: "member", id: "member_002", name: "Bob" },
    actor: { name: "Bob" },
  }),
  makeActivityEvent({
    id: "evt_query_001",
    type: "member.joined",
    source: "webhook",
    severity: "error",
    timestamp: "2025-01-15T12:01:00.000Z",
    entity: { type: "member", id: "member_001", name: "Alice" },
    actor: { name: "Alice" },
  }),
];

describe("activity query contract", () => {
  test("returns bounded deterministic pages with a cursor", () => {
    const firstPage = filterActivityEvents(events, { limit: 2 });

    assert.deepEqual(
      firstPage.events.map((event) => event.id),
      ["evt_query_004", "evt_query_003"]
    );
    assert.equal(firstPage.nextCursor, "evt_query_003");

    const secondPage = filterActivityEvents(events, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    assert.deepEqual(
      secondPage.events.map((event) => event.id),
      ["evt_query_002", "evt_query_001"]
    );
    assert.equal(secondPage.nextCursor, null);
  });

  test("filters by type, source, severity, entity type, actor, and lower timestamp bound", () => {
    const result = filterActivityEvents(events, {
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      entityType: "member",
      actor: "bob",
      from: "2025-01-15T12:02:00.000Z",
      limit: 10,
    });

  test("sorts oldest first when requested", () => {
    const result = filterActivityEvents(events, { limit: 3, sort: "oldest" });

    assert.deepEqual(
      result.events.map((event) => event.id),
      ["evt_query_001", "evt_query_002", "evt_query_003"]
    );
    assert.equal(result.nextCursor, "evt_query_003");
  });
    assert.deepEqual(
      result.events.map((event) => event.id),
      ["evt_query_002"]
    );
    assert.equal(result.nextCursor, null);
  });

  test("returns an empty page for valid filters with no matches", () => {
    const result = filterActivityEvents(events, {
      type: "guild.deleted",
      source: "core_api",
      limit: 10,
    });

    assert.deepEqual(result.events, []);
    assert.equal(result.nextCursor, null);
  });

  test("parses and bounds valid URL query parameters", () => {
    const parsed = parseActivityQuery(
      new URL("https://example.test/api/activity?limit=250&type=member.joined&source=webhook&severity=error&entityType=member&actor=alice&from=2025-01-01T00:00:00.000Z&sort=oldest")
        .searchParams
    );

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(parsed.value.limit, 100);
    assert.equal(parsed.value.type, "member.joined");
    assert.equal(parsed.value.source, "webhook");
    assert.equal(parsed.value.severity, "error");
    assert.equal(parsed.value.entityType, "member");
    assert.equal(parsed.value.actor, "alice");
    assert.equal(parsed.value.from, "2025-01-01T00:00:00.000Z");`n    assert.equal(parsed.value.sort, "oldest");
  });

  test("rejects invalid query parameters with field-specific errors", () => {
    const parsed = parseActivityQuery(
      new URL("https://example.test/api/activity?limit=abc&type=not-real&from=tomorrow&sort=sideways")
        .searchParams
    );

    assert.equal(parsed.ok, false);
    if (parsed.ok) return;

    assert.deepEqual(
      parsed.errors.map((error) => error.field),
      ["limit", "type", "sort", "from"]
    );
  });
});
