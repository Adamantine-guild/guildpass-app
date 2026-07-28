# Audit Log Schema & Filtering

This document describes the structured audit event schema that backs the
dashboard's `/activity` page, the filters and pagination model built on top
of it, and the indexing strategy a future real datastore should adopt.

There is a single audit event type in this codebase: `ActivityEvent`,
defined in `packages/integration-client/src/types.ts` and re-exported
through `apps/dashboard/lib/activity/types.ts`. It is shared by the
dashboard, the webhook ingestion path, and is intended to be reused by a
future webhook dispatch system — there is no separate "AuditEvent" type.

## Schema

```ts
type ActivityEvent = {
  id: string;
  type: ActivityEventType;
  source: ActivityEventSource;
  severity: ActivityEventSeverity;
  actor: { id?: string; name?: string; wallet?: string };
  timestamp: string; // ISO 8601
  description: string;
  entity?: ActivityEventEntity;
  metadata?: Record<string, any>;
  changes?: ActivityChange[];
  schemaVersion: number;
};
```

| Field         | Description                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `id`          | Stable, unique event identifier (webhook payload id, or a generated id for dashboard mutations). |
| `type`        | What happened — a closed union, see below.                                                       |
| `source`      | Where the event originated: `dashboard`, `webhook`, `core_api`, or `reconciliation`.             |
| `severity`    | `info`, `warning`, `error`, or `critical`.                                                       |
| `actor`       | Who did it. All fields optional — a webhook may only know a wallet, a system action may know neither. |
| `timestamp`   | ISO 8601 timestamp of when the event occurred.                                                   |
| `description` | Human-readable summary shown in the UI.                                                          |
| `entity`      | The object the event is about: `{ type: "pass" \| "guild" \| "member" \| "verification" \| "webhook", id, name? }`. |
| `metadata`    | Free-form, event-type-specific data. For webhook-sourced events this is built via an explicit per-type field allowlist (`lib/activity/sanitise.ts`) — arbitrary webhook payload fields are never stored verbatim. |
| `changes`     | Field-level before/after diff for mutation events (see `lib/activity/diff.ts`). Fields in `SENSITIVE_AUDIT_FIELDS` (`apiKey`, `password`, `token`, etc.) are unconditionally excluded from diffs. |
| `schemaVersion` | Explicit schema version for backward-compatible reads (see below). |

`ActivityEventType` is a closed union of 15 values covering pass, guild,
member, access, settings, verification, and webhook lifecycle events (see
`packages/integration-client/src/types.ts` for the full list).

### Tenant scoping

`ActivityEvent` has no first-class `guildId` field. Guild scope is derived
by `activityEventGuildId()` in `apps/dashboard/lib/data/guild-scoped.ts`,
which prefers `metadata.guildId` and falls back to `entity.id` when
`entity.type === "guild"`. `filterActivityEventsByGuild()` applies this scope
*before* the filters described below run, and events with no derivable guild
are excluded once a tenant is selected — unscoped data is never leaked into
a guild-scoped feed. See [Migration notes](#migration-notes-for-a-future-datastore)
for why a real datastore should promote this to a column.

### Schema versioning

`CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION` (currently `2`) is stamped on every
event. `packages/integration-client/src/activity-event-migration.ts` holds an
ordered chain of migrations keyed by source version; `upcastActivityEvent()`
walks a raw stored event through that chain until it matches the current
shape. Events written before `schemaVersion` existed are treated as V1.
Adding a field means: bump the constant, add a `MIGRATIONS.set(n, ...)`
entry, and add a fixture at the old version to the migration test suite.

## Supported filters

Filtering and validation live in `apps/dashboard/lib/activity/query.ts`.

| Filter       | Query param  | Behavior                                                                 |
| ------------ | ------------ | ------------------------------------------------------------------------- |
| Event type   | `type`       | Exact match against `ActivityEventType`.                                  |
| Source       | `source`     | Exact match against `ActivityEventSource`.                                |
| Severity     | `severity`   | Exact match against `ActivityEventSeverity`.                              |
| Entity type  | `entityType` | Exact match against `entity.type`.                                       |
| Actor        | `actor`      | Case-insensitive substring match against `actor.id`, `actor.name`, and `actor.wallet`. |
| Date range   | `from`       | Lower bound (inclusive) on `timestamp`, parsed as an ISO timestamp. There is currently no upper-bound (`to`) parameter — add one the same way if a bounded range becomes a requirement. |
| Sort order   | `sort`       | `newest` (default) or `oldest`, by `timestamp` then `id` as a tiebreaker. |

Filters combine with AND semantics — e.g. `type=member.joined&source=dashboard&entityType=member`
returns only events matching all three. `parseActivityQuery()` validates raw
`URLSearchParams` and returns field-specific errors (`{ field, message }[]`)
for unknown enum values or malformed timestamps, surfaced by
`GET /api/activity` as a `400 VALIDATION_ERROR` response.

Guild scope (`guildId`) is applied separately, via a request header
(`GUILD_ID_HEADER`) rather than a query parameter — see
[Tenant scoping](#tenant-scoping).

## Pagination

Pagination is cursor-based, implemented by `filterActivityEvents()`:

1. All matching events are filtered and sorted first.
2. `limit` bounds the page size (default 20, max 100 — see `DEFAULT_ACTIVITY_LIMIT` / `MAX_ACTIVITY_LIMIT`).
3. `cursor` is the `id` of the last event from the previous page. The next
   page starts immediately after that event's position in the sorted list.
4. The response includes `nextCursor` (the last event id in the current
   page, or `null` when there are no more results) and `total` (the count of
   all events matching the filters, independent of `limit`).

This is intentionally structured as if it were already backed by a real,
indexed query — the in-memory implementation is a stand-in for the query
shape, not the target architecture.

## Migration notes for a future datastore

The current storage layer (`apps/dashboard/lib/activity/storage.ts`) has
three interchangeable implementations behind `IActivityStorage`
(`InMemoryActivityStorage`, `FileActivityStorage`,
`DurableActivityStorage` for Postgres), selected via
`ACTIVITY_STORAGE_MODE`. All three funnel through the same
`filterActivityEvents()` function, so query semantics don't change when the
backing store does.

Moving to a real, high-volume datastore should change two things:

1. **Promote `guildId` to a first-class column.** It currently lives inside
   `metadata` by convention (see [Tenant scoping](#tenant-scoping)), which is
   fine for an in-memory array scan but unindexable as a JSON blob at scale.
2. **Replace id-position cursors with keyset pagination.** The in-memory
   cursor works by finding `cursor`'s array index in the already-sorted list.
   A real query should instead do:
   ```sql
   WHERE (timestamp, id) < (:cursor_timestamp, :cursor_id)  -- for "newest first"
   ORDER BY timestamp DESC, id DESC
   LIMIT :limit
   ```
   which means the opaque `cursor` string should encode both `timestamp` and
   `id`, not just `id`.

Recommended composite indexes, based on the filters above:

| Index                                | Supports                                                        |
| ------------------------------------- | ----------------------------------------------------------------- |
| `(guildId, timestamp)`                | The default guild-scoped, newest/oldest-first feed (the common case). |
| `(actor, timestamp)`                  | Actor substring/exact-match filtering combined with date range.  |
| `(entityType, entityId, timestamp)`   | "Show me the history of this pass/member/guild" drill-downs.     |

`type`, `source`, and `severity` are low-cardinality enums best served as
secondary filters within one of the above indexes (or a partial index) rather
than indexed independently.

`DurableActivityStorage.queryEvents()` currently reads the full
`activity_events` table into memory and filters in application code
(`getEvents()` then `filterActivityEvents()`); once volume justifies it, this
should push the filters, sort, and `LIMIT`/keyset pagination down into SQL
using the indexes above instead.
