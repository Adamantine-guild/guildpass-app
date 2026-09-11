import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { activityService } from "../lib/data/activity-service";

/**
 * activity-service.test.ts
 *
 * Tests for ActivityService in lib/data/activity-service.ts.
 *
 * ActivityService wraps InMemoryActivityStorage with a richer API: it generates
 * IDs, stamps timestamps, filters by type, and provides typed event helpers.
 * All tests use unique IDs seeded via the helper methods — no network, no DB.
 */

describe("ActivityService", () => {
  // ── createEvent ─────────────────────────────────────────────────────────────

  describe("createEvent", () => {
    test("returns an event with a generated id string", async () => {
      const event = await activityService.createEvent({
        type: "guild.updated",
        source: "dashboard",
        severity: "info",
        actor: { name: "Admin" },
        description: "Guild settings updated",
      });

      assert.ok(typeof event.id === "string", "id should be a string");
      assert.ok(event.id.length > 0, "id should not be empty");
    });

    test("generates unique ids on every call", async () => {
      const a = await activityService.createEvent({
        type: "guild.updated",
        source: "dashboard",
        severity: "info",
        actor: { name: "Admin" },
        description: "Event A",
      });
      const b = await activityService.createEvent({
        type: "guild.updated",
        source: "dashboard",
        severity: "info",
        actor: { name: "Admin" },
        description: "Event B",
      });

      assert.notEqual(a.id, b.id, "consecutive createEvent calls should produce different IDs");
    });

    test("stamps an ISO 8601 timestamp on the event", async () => {
      const before = Date.now();
      const event = await activityService.createEvent({
        type: "access.granted",
        source: "dashboard",
        severity: "info",
        actor: { name: "Admin" },
        description: "Access granted",
      });
      const after = Date.now();

      const ts = new Date(event.timestamp).getTime();
      assert.ok(!isNaN(ts), "timestamp must be a valid date string");
      assert.ok(ts >= before && ts <= after, "timestamp must fall within the test window");
    });

    test("persists the event so getEvents retrieves it", async () => {
      const event = await activityService.createEvent({
        type: "access.revoked",
        source: "dashboard",
        severity: "warning",
        actor: { name: "Moderator" },
        description: "Access revoked for testing",
      });

      const events = await activityService.getEvents();
      const found = events.find((e) => e.id === event.id);
      assert.ok(found, "created event should be retrievable via getEvents()");
    });
  });

  // ── getEvents ────────────────────────────────────────────────────────────────

  describe("getEvents", () => {
    test("returns an array (possibly seeded)", async () => {
      const events = await activityService.getEvents();
      assert.ok(Array.isArray(events));
    });

    test("limit option caps the number of returned events", async () => {
      // Ensure there are at least 2 events
      await activityService.createEvent({
        type: "guild.updated",
        source: "dashboard",
        severity: "info",
        actor: { name: "Admin" },
        description: "Limit test A",
      });
      await activityService.createEvent({
        type: "guild.updated",
        source: "dashboard",
        severity: "info",
        actor: { name: "Admin" },
        description: "Limit test B",
      });

      const limited = await activityService.getEvents({ limit: 1 });
      assert.equal(limited.length, 1);
    });

    test("type filter returns only events of the requested type", async () => {
      // Create a uniquely-typed event
      await activityService.createEvent({
        type: "guild.deleted",
        source: "dashboard",
        severity: "error",
        actor: { name: "Owner" },
        description: "Guild deleted for filter test",
      });

      const filtered = await activityService.getEvents({ type: "guild.deleted" });
      assert.ok(filtered.length >= 1, "should return at least the event we just created");
      assert.ok(
        filtered.every((e) => e.type === "guild.deleted"),
        "all returned events must match the requested type"
      );
    });

    test("type filter returns empty array when no events of that type exist", async () => {
      // guild.created has never been created in these tests
      const filtered = await activityService.getEvents({ type: "guild.created" });
      assert.equal(filtered.length, 0);
    });

    test("limit and type can be combined", async () => {
      await activityService.createEvent({
        type: "pass.deleted",
        source: "dashboard",
        severity: "warning",
        actor: { name: "Admin" },
        description: "Pass deleted X",
      });
      await activityService.createEvent({
        type: "pass.deleted",
        source: "dashboard",
        severity: "warning",
        actor: { name: "Admin" },
        description: "Pass deleted Y",
      });

      const result = await activityService.getEvents({ type: "pass.deleted", limit: 1 });
      assert.equal(result.length, 1);
      assert.equal(result[0].type, "pass.deleted");
    });
  });

  // ── createPassCreatedEvent ────────────────────────────────────────────────────

  describe("createPassCreatedEvent", () => {
    test("sets type to pass.created", async () => {
      const event = await activityService.createPassCreatedEvent(
        { id: "pass_svc_001", name: "Gold Pass" }
      );
      assert.equal(event.type, "pass.created");
    });

    test("description contains the pass name", async () => {
      const event = await activityService.createPassCreatedEvent(
        { id: "pass_svc_002", name: "Silver Pass" }
      );
      assert.ok(
        event.description.includes("Silver Pass"),
        `description "${event.description}" should include pass name`
      );
    });

    test("entity reflects the pass id and name", async () => {
      const event = await activityService.createPassCreatedEvent(
        { id: "pass_svc_003", name: "Bronze Pass" }
      );
      assert.equal(event.entity?.type, "pass");
      assert.equal(event.entity?.id, "pass_svc_003");
      assert.equal(event.entity?.name, "Bronze Pass");
    });

    test("uses Admin as default actor when none supplied", async () => {
      const event = await activityService.createPassCreatedEvent(
        { id: "pass_svc_004", name: "Default Actor Pass" }
      );
      assert.equal(event.actor.name, "Admin");
    });

    test("accepts a custom actor", async () => {
      const event = await activityService.createPassCreatedEvent(
        { id: "pass_svc_005", name: "Custom Actor Pass" },
        { name: "Alice", wallet: "0xabc" }
      );
      assert.equal(event.actor.name, "Alice");
      assert.equal(event.actor.wallet, "0xabc");
    });
  });

  // ── createMemberJoinedEvent ───────────────────────────────────────────────────

  describe("createMemberJoinedEvent", () => {
    test("sets type to member.joined", async () => {
      const event = await activityService.createMemberJoinedEvent(
        { id: "mem_svc_001", name: "Bob" }
      );
      assert.equal(event.type, "member.joined");
    });

    test("description includes member name when provided", async () => {
      const event = await activityService.createMemberJoinedEvent(
        { id: "mem_svc_002", name: "Carol" }
      );
      assert.ok(event.description.includes("Carol"));
    });

    test("description falls back to wallet when name is absent", async () => {
      const event = await activityService.createMemberJoinedEvent(
        { id: "mem_svc_003", wallet: "0xabcwallet" }
      );
      assert.ok(
        event.description.includes("0xabcwallet"),
        "description should include wallet when name is absent"
      );
    });

    test("entity type is member", async () => {
      const event = await activityService.createMemberJoinedEvent(
        { id: "mem_svc_004", name: "Dave" }
      );
      assert.equal(event.entity?.type, "member");
    });
  });

  // ── createVerificationCompletedEvent ─────────────────────────────────────────

  describe("createVerificationCompletedEvent", () => {
    test("sets type to verification.completed", async () => {
      const event = await activityService.createVerificationCompletedEvent(
        "0xverify_wallet",
        { name: "Verifier" }
      );
      assert.equal(event.type, "verification.completed");
    });

    test("description includes the wallet address", async () => {
      const event = await activityService.createVerificationCompletedEvent(
        "0xverify_wallet_desc",
        { name: "Verifier" }
      );
      assert.ok(event.description.includes("0xverify_wallet_desc"));
    });

    test("metadata includes the wallet address", async () => {
      const event = await activityService.createVerificationCompletedEvent(
        "0xmeta_wallet",
        { name: "Verifier" }
      );
      assert.equal(event.metadata?.wallet, "0xmeta_wallet");
    });

    test("entity type is verification and id equals wallet", async () => {
      const event = await activityService.createVerificationCompletedEvent(
        "0xentity_wallet",
        { name: "Verifier" }
      );
      assert.equal(event.entity?.type, "verification");
      assert.equal(event.entity?.id, "0xentity_wallet");
    });
  });
});