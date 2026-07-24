# Core-State Reconciliation (Webhook Backfill)

Issue: [#262](https://github.com/Adamantine-guild/guildpass-app/issues/262)

Webhooks are best-effort. When the dashboard is down, mid-deploy, or its
idempotency store is unavailable, core events can be permanently missed and
local state silently drifts from reality. This document describes the
recovery path: a reconciliation pass that diffs local state against
GuildPass core's authoritative state and applies corrections.

## The core contract (needs core-side support)

The dashboard asks core for a **point-in-time snapshot** per guild:

```
GET /v1/guilds/:guildId/snapshot
```

```json
{
  "guildId": "1",
  "generatedAt": "2026-07-24T00:00:00.000Z",
  "guild": { "name": "...", "description": "..." },
  "members": [{ "userId": "...", "wallet": "0x...", "status": "active", "roles": ["admin"], "updatedAt": "..." }],
  "passes": [{ "id": "...", "name": "...", "status": "active", "price": 10, "maxSupply": 100, "currentSupply": 3 }]
}
```

Semantics:

- `members` is the **complete** membership list at `generatedAt`. A local
  wallet-member absent from the snapshot is treated as no longer a member
  and deactivated locally.
- `passes` is the complete list of **core-managed** passes.
- A snapshot is a full-state pull, not an event log. It cannot tell us
  *what happened* while we were down (no history of joins/leaves), only
  *what is true now*. If core later exposes an event-log range endpoint,
  the same job can be extended to replay it; the snapshot diff remains the
  fallback.
- `guildpass-core` is a separate repository (see SECURITY.md scope notes)
  and does not implement this endpoint yet. Core responds 404, the client
  surfaces `null`, and the job reports `supported: false` — the dashboard
  side is fully implemented and tested against stubbed snapshots, ready to
  light up the moment core ships the endpoint.

## Matching rules

- **Members** match on wallet, case-insensitive. Snapshot members without a
  wallet are skipped — there is no safe join key, and guessing could
  deactivate the wrong local record.
- **Passes** match on `id` first, then on exact `name`. Local pass ids are
  repository-generated, so a pass created locally by a previous
  reconciliation run has a different id than core's; the name fallback
  keeps repeat runs idempotent.
- **Local-only passes are never touched.** Core cannot distinguish a
  dashboard-created draft from a pass deleted in core, so reconciliation
  conservatively leaves local passes that are absent from the snapshot
  alone. (Members do not get this treatment because the snapshot's member
  list is explicitly complete.)
- Local member `name` is never overwritten — core only knows `userId`, and
  names may be human-curated.

## Running a pass

Manual trigger (admin/owner, `settings:write`):

```
POST /api/integrations/reconcile
{ "mode": "dry-run" }   # report only, zero writes
{ "mode": "apply" }     # writes corrections + activity entries
```

Or from the UI: **Integrations → Core reconciliation** has dry-run and
apply buttons and renders the resulting report.

Every run returns a `CoreSyncReport`: the full change list (entity, action,
field-level before/after), totals, and a summary line. Dry-run and apply
produce identical diffs; apply additionally writes and counts recorded
activity events.

Interval-based triggering is intentionally not built yet: the manual
trigger plus dry-run covers the operational need (post-incident recovery),
and an interval is a one-line cron once core's endpoint exists.

## Activity tagging and idempotency

- Every applied change produces exactly one activity event with
  `source: "reconciliation"`, actor `Reconciliation Job`, and
  `metadata.reconciliation: true`. The activity feed has a
  "Reconciliation" source filter and a distinct badge, so admins can tell
  corrected data apart from live webhooks.
- Events go through the same idempotent write path as webhooks
  (`activityStorage.recordActivityEvent`) with deterministic ids
  (`reconcile:<guildId>:<entity>:<action>:<id>`), so a retried run never
  double-records.
- A run with no drift performs **zero** writes and **zero** activity
  entries. Running apply twice in a row is a no-op the second time.
- Repository mutations themselves still emit their normal activity entries
  (unchanged existing behavior); the reconciliation event is the audit
  marker that ties a correction to the pass that caused it.

## Tests

`apps/dashboard/test/core-reconciliation.test.ts` covers, against a stubbed
core client: no-drift no-op, partial drift (dry-run purity + apply +
re-run idempotency), full resync of an empty guild, wallet-less snapshot
members, and cores without snapshot support.
