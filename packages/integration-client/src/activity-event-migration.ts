import {
  CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  type ActivityEvent,
} from "./types.js";

/**
 * A raw event as it may exist in durable storage — possibly missing the
 * `schemaVersion` field (V1 legacy) or carrying an older version number.
 *
 * We deliberately keep this loose (using `Record<string, any>` for the shape)
 * so that truly ancient shapes still flow through the upcast chain without
 * type errors at the migration boundary.
 */
export type RawActivityEvent = Record<string, any>;

type MigrationFn = (event: RawActivityEvent) => RawActivityEvent;

/**
 * Ordered chain of migrations.  Each entry maps a source version number to the
 * function that upgrades it to the next version.  To add a new migration:
 *
 *   1. Bump `CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION` in types.ts.
 *   2. Add an entry to `MIGRATIONS` keyed by the **previous** version number.
 *   3. Write tests with an event fixture at the old version.
 *
 * Example – upgrading from V2 to V3:
 *
 *   MIGRATIONS.set(2, (e) => ({
 *     ...e,
 *     schemaVersion: 3,
 *     newField: e.newField ?? "default",
 *   }));
 */
const MIGRATIONS: Map<number, MigrationFn> = new Map();

// ── V1 → V2 ────────────────────────────────────────────────────────────────
// V1 events have no `schemaVersion` field at all.
// V2 adds the explicit `schemaVersion` property.
MIGRATIONS.set(1, (event) => ({
  ...event,
  schemaVersion: 2,
}));

/**
 * Determine the schema version of a raw stored event.
 * Events without an explicit `schemaVersion` field are treated as V1.
 */
export function detectSchemaVersion(event: RawActivityEvent): number {
  if (typeof event.schemaVersion === "number") {
    return event.schemaVersion;
  }
  return 1;
}

/**
 * Run a raw stored event through the migration chain so it matches the
 * current in-memory `ActivityEvent` shape.
 *
 * - Events already at `CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION` are returned
 *   as-is (no-op).
 * - Events from older versions are walked through each intermediate migration.
 * - Unknown fields are preserved through every step so that forward-compatible
 *   data (e.g. written by a newer dashboard version) is not silently stripped.
 *
 * @returns A fully upcast event whose shape conforms to the current `ActivityEvent`.
 */
export function upcastActivityEvent(raw: RawActivityEvent): ActivityEvent {
  let current: RawActivityEvent = { ...raw };
  let version = detectSchemaVersion(current);

  while (version < CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS.get(version);
    if (!migrate) {
      // Should never happen unless a migration step was removed from the chain.
      throw new Error(
        `ActivityEvent migration chain is broken: no migration found for V${version}`
      );
    }
    current = migrate(current);
    version = detectSchemaVersion(current);
  }

  return current as ActivityEvent;
}

/**
 * Upcast an array of stored events.  Useful when reading a batch from
 * durable storage.
 */
export function upcastActivityEvents(raws: RawActivityEvent[]): ActivityEvent[] {
  return raws.map(upcastActivityEvent);
}
