import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  upcastActivityEvent,
  upcastActivityEvents,
  detectSchemaVersion,
} from "@guildpass/integration-client";
import {
  CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  type ActivityEvent,
} from "../lib/activity/types";

/**
 * activity-event-migration.test.ts
 *
 * Tests for the ActivityEvent schema versioning and upcast chain.
 *
 * Acceptance criteria from #183:
 * - ActivityEvent carries an explicit, checked schema version.
 * - A deliberately old-shaped stored event fixture is correctly upcast/migrated.
 * - No behavior change for current-version events (upcast is a no-op).
 * - The process for adding new event types/fields is documented.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A V1 event: no schemaVersion field at all (legacy shape). */
const V1_EVENT_FIXTURE = {
  id: "evt_legacy_001",
  type: "member.joined",
  source: "dashboard",
  severity: "info",
  actor: { name: "Alice", wallet: "0xabc" },
  timestamp: "2025-01-15T12:00:00.000Z",
  description: "Alice joined the guild",
};

/** A V1 event with entity (also legacy). */
const V1_EVENT_WITH_ENTITY = {
  id: "evt_legacy_002",
  type: "pass.created",
  source: "webhook",
  severity: "info",
  actor: { name: "Admin" },
  timestamp: "2025-01-15T13:00:00.000Z",
  description: "Created new pass: Founder Pass",
  entity: { type: "pass", id: "pass_001", name: "Founder Pass" },
};

/** A V1 event with metadata (also legacy). */
const V1_EVENT_WITH_METADATA = {
  id: "evt_legacy_003",
  type: "verification.completed",
  source: "webhook",
  severity: "info",
  actor: { wallet: "0xabc" },
  timestamp: "2025-01-15T14:00:00.000Z",
  description: "Verification completed for 0xabc",
  metadata: { wallet: "0xabc", provider: "alchemy" },
};

/** A current-version event (V2). */
const CURRENT_VERSION_EVENT: ActivityEvent = {
  id: "evt_current_001",
  type: "guild.updated",
  source: "dashboard",
  severity: "info",
  actor: { name: "Admin" },
  timestamp: "2025-01-15T15:00:00.000Z",
  description: "Guild settings updated",
  schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
};

/** A future-version event (simulating forward compatibility). */
const FUTURE_VERSION_EVENT = {
  id: "evt_future_001",
  type: "pass.created",
  source: "core_api",
  severity: "warning",
  actor: { name: "System" },
  timestamp: "2025-06-01T10:00:00.000Z",
  description: "Pass auto-created",
  schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION + 1,
  hypotheticalNewField: "forward-compatible data",
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ActivityEvent migration", () => {
  describe("detectSchemaVersion", () => {
    test("returns 1 for events without schemaVersion", () => {
      assert.equal(detectSchemaVersion(V1_EVENT_FIXTURE), 1);
    });

    test("returns the explicit schemaVersion when present", () => {
      assert.equal(
        detectSchemaVersion(CURRENT_VERSION_EVENT),
        CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION
      );
    });

    test("returns 1 for completely empty objects", () => {
      assert.equal(detectSchemaVersion({}), 1);
    });
  });

  describe("upcastActivityEvent", () => {
    test("upcasts a V1 event to the current schema version", () => {
      const result = upcastActivityEvent(V1_EVENT_FIXTURE);

      assert.equal(result.id, "evt_legacy_001");
      assert.equal(result.type, "member.joined");
      assert.equal(result.source, "dashboard");
      assert.equal(result.severity, "info");
      assert.equal(result.description, "Alice joined the guild");
      assert.equal(result.timestamp, "2025-01-15T12:00:00.000Z");
      assert.deepEqual(result.actor, { name: "Alice", wallet: "0xabc" });
      assert.equal(
        result.schemaVersion,
        CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
        "V1 event should be upcast to current schema version"
      );
    });

    test("upcasts a V1 event with entity", () => {
      const result = upcastActivityEvent(V1_EVENT_WITH_ENTITY);

      assert.equal(result.type, "pass.created");
      assert.deepEqual(result.entity, {
        type: "pass",
        id: "pass_001",
        name: "Founder Pass",
      });
      assert.equal(
        result.schemaVersion,
        CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION
      );
    });

    test("upcasts a V1 event with metadata", () => {
      const result = upcastActivityEvent(V1_EVENT_WITH_METADATA);

      assert.equal(result.type, "verification.completed");
      assert.deepEqual(result.metadata, {
        wallet: "0xabc",
        provider: "alchemy",
      });
      assert.equal(
        result.schemaVersion,
        CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION
      );
    });

    test("preserves all existing fields during upcast", () => {
      const result = upcastActivityEvent(V1_EVENT_FIXTURE);

      assert.equal(result.id, V1_EVENT_FIXTURE.id);
      assert.equal(result.type, V1_EVENT_FIXTURE.type);
      assert.equal(result.source, V1_EVENT_FIXTURE.source);
      assert.equal(result.severity, V1_EVENT_FIXTURE.severity);
      assert.deepEqual(result.actor, V1_EVENT_FIXTURE.actor);
      assert.equal(result.timestamp, V1_EVENT_FIXTURE.timestamp);
      assert.equal(result.description, V1_EVENT_FIXTURE.description);
    });

    test("is a no-op for current-version events", () => {
      const result = upcastActivityEvent(CURRENT_VERSION_EVENT);

      assert.deepEqual(result, CURRENT_VERSION_EVENT);
      assert.equal(
        result.schemaVersion,
        CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION
      );
    });

    test("preserves unknown fields for forward compatibility", () => {
      const result = upcastActivityEvent(FUTURE_VERSION_EVENT);

      assert.equal(result.id, "evt_future_001");
      assert.equal(
        (result as any).hypotheticalNewField,
        "forward-compatible data"
      );
    });

    test("handles events with no optional fields", () => {
      const minimal = {
        id: "evt_minimal",
        type: "settings.updated",
        source: "core_api" as const,
        severity: "info" as const,
        actor: {},
        timestamp: "2025-01-15T16:00:00.000Z",
        description: "Settings updated",
      };

      const result = upcastActivityEvent(minimal);

      assert.equal(result.schemaVersion, CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION);
      assert.ok(!result.entity, "entity should remain undefined");
      assert.ok(!result.metadata, "metadata should remain undefined");
    });
  });

  describe("upcastActivityEvents", () => {
    test("upcasts an array of mixed-version events", () => {
      const events = upcastActivityEvents([
        V1_EVENT_FIXTURE,
        CURRENT_VERSION_EVENT,
        V1_EVENT_WITH_ENTITY,
      ]);

      assert.equal(events.length, 3);

      for (const event of events) {
        assert.equal(
          event.schemaVersion,
          CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
          `event ${event.id} should be upcast to current version`
        );
      }
    });

    test("returns empty array for empty input", () => {
      const events = upcastActivityEvents([]);
      assert.deepEqual(events, []);
    });
  });

  describe("no-op for current-version data", () => {
    test("round-trips a current-version event without mutation", () => {
      const original = { ...CURRENT_VERSION_EVENT };
      const result = upcastActivityEvent(CURRENT_VERSION_EVENT);

      assert.deepEqual(result, original);
      assert.deepEqual(CURRENT_VERSION_EVENT, original, "original should not be mutated");
    });
  });

  describe("integration: reading from FileActivityStorage shape", () => {
    test("a JSON-parsed V1 event (as would be read from disk) upcasts correctly", () => {
      // Simulate reading a V1 event from JSONL storage
      const jsonLine = JSON.stringify(V1_EVENT_FIXTURE);
      const parsed = JSON.parse(jsonLine);

      const result = upcastActivityEvent(parsed);

      assert.equal(
        result.schemaVersion,
        CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION
      );
      assert.equal(result.id, "evt_legacy_001");
      assert.equal(result.type, "member.joined");
    });
  });
});
