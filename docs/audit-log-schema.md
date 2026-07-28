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

## Tamper-evident PostgreSQL chain

Durable rows in PostgreSQL's `activity_events` table form one global,
append-only hash chain. This is a global chain because the persisted
`ActivityEvent` model does not have a reliable first-class `guildId`; splitting
the chain by a derived JSON value would leave unscoped events ambiguous. Both
durable writers (`DASHBOARD_STORAGE_MODE=durable` and
`ACTIVITY_STORAGE_MODE=durable`) append to this same chain.

This protection applies only to PostgreSQL rows. In-memory events, the local
JSONL file adapter, and synthetic events merged into the `/api/activity` feed
are unchanged and are not attested by this chain.

### Chain fields, order, and genesis

Migration `0002_activity_hash_chain.sql` adds:

| Field | Meaning |
| --- | --- |
| `chain_sequence` | Positive, unique `BIGINT` defining the authoritative total order. |
| `previous_hash` | Lowercase 64-character SHA-256 hex digest of the predecessor, or genesis for sequence 1. |
| `entry_hash` | Lowercase 64-character SHA-256 digest for this entry. |

The genesis predecessor is exactly 64 zero characters. A singleton
`activity_chain_head` row records the latest sequence, hash, and entry ID for
the global chain.

### Canonical hash input

Hash format version 1 binds these final database values, in this exact order:

1. `chain_sequence`;
2. `id`, `type`, `source`, and `severity`;
3. `actor`;
4. `timestamp`;
5. `description`;
6. `entity`, `metadata`, and `changes`;
7. `schema_version`.

PostgreSQL normalizes every would-be value before hashing. JSON values use
PostgreSQL's `JSONB` text form, so object insertion order and insignificant
whitespace do not affect the hash; array order remains significant. SQL NULL
is distinct from JSON `null`. Timestamps use UTC with all six PostgreSQL
fractional digits (`YYYY-MM-DDTHH:mm:ss.ffffffZ`), and numeric database values
are decimal strings so JavaScript rounding cannot change them.

The outer serialization does not use arbitrary-object `JSON.stringify`.
Fields have a fixed order and are UTF-8 byte-length framed; SQL NULL uses the
separate `-1:` marker. The SHA-256 input also includes a domain identifier,
format version, and the separately framed predecessor hash. The chain format
version is immutable for existing rows: a future format change requires a
version-aware migration/verifier, not changing the version-1 constant in
place.

### Atomic append and concurrency

A durable append runs in one PostgreSQL transaction:

1. normalize the final persisted values;
2. lock the singleton head row with `SELECT ... FOR UPDATE`;
3. confirm the head still matches the persisted tail;
4. allocate `last_sequence + 1` and compute SHA-256;
5. insert the event and update the head;
6. commit.

The head row lock and compare-and-set update serialize concurrent writers, so
two successful appends cannot use the same predecessor. Webhook idempotency's
`processed_events` marker is written in the same transaction; hashing or
insert failure rolls back both. Durable mode never falls back to an unhashed
insert.

### Migration and existing durable rows

The migration runner backfills existing rows in deterministic
`timestamp ASC, id COLLATE "C" ASC` order while holding exclusive table locks,
then makes every chain field `NOT NULL`. It refuses mixed chain state, a
non-genesis initial head, or a populated corrupt chain; it never silently
rehashes an existing corrupt history. A populated intact chain is a no-op on
safe recovery.

The TypeScript data-migration hook is security-critical. Applying the SQL file
directly does **not** run the backfill or `NOT NULL` enforcement. Deployments
must stop old writers, run `pnpm db:migrate`, and then start the new
application version. The backfill currently scans and updates the log while
holding an exclusive lock, so a large production log requires a planned
maintenance window.

### Verification API

`verifyDurableActivityChain()` scans the PostgreSQL chain in sequence order in
a read-only, repeatable-read transaction. It recomputes each hash and returns
the first invalid sequence, predecessor, stored hash, or content-bound hash.
It also compares the verified tail with the database-local head.

Owners and admins can call:

```text
GET /api/activity/verify
```

The route uses the existing `guilds:write` authorization check and returns the
normal `{ ok, data }` API envelope. Detected corruption is a successful
verification result (`HTTP 200`, `data.intact: false`); authentication and
database failures retain their normal error statuses. When neither PostgreSQL
activity mode is enabled, the route returns `501 UNSUPPORTED`.

### Threat model and external anchoring

The chain detects an isolated historical edit because the stored entry hash no
longer matches its canonical content. Deleting a middle row creates a sequence
gap and breaks the successor relationship. Changing a stored hash is detected
at that row. The database-local head also detects an isolated latest-row
deletion when the head is left unchanged.

This is tamper-evident, not tamper-proof. The activity data, all hashes, and the
head are in the same mutable PostgreSQL trust domain. An attacker with
unrestricted database access can replace history, recompute all subsequent
hashes, and replace the head. The same attacker can delete an unanchored tail
and roll the database-local head back, which the remaining internally
consistent prefix cannot reveal.

Protecting against full-chain replacement or a deliberately adjusted tail
requires a trusted external anchor. A future design could periodically record
the chain scope, latest sequence, latest hash, and timestamp in an immutable
logging service, append-only object store, signed checkpoint system, or
separate security datastore. External anchoring is intentionally deferred by
this issue.

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
