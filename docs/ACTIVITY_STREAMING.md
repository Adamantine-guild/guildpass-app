# Activity Streaming

The dashboard loads its initial activity page through `GET /api/activity` and
then prefers `GET /api/activity/stream` for live updates. Both endpoints require
the same dashboard session and `activity:read` permission.

Webhook events are published only after idempotent storage reports that a new
event was recorded. Dashboard mutation events are published after their
append-only activity repository write completes. The client deduplicates event
IDs and retains its existing filters, pagination, and manual refresh behavior.

The stream registers its subscriber before sending a client-visible `ready`
event. On that handshake, the client performs one REST reconciliation so an
event committed between the initial REST snapshot and stream subscription
cannot be missed. Live deliveries also schedule a short, coalesced REST
reconciliation. That authoritative snapshot keeps the total correct even when
a delayed event's timestamp sorts it outside the returned page.

If `EventSource` is unavailable, the stream reports an error, the `ready`
handshake times out, or client-visible heartbeats stop, the client closes the
stream and starts visibility-aware REST polling. Configure the fallback
interval with `NEXT_PUBLIC_ACTIVITY_REFRESH_MS`; setting it to `0` disables both
automatic transports while leaving initial load and manual refresh available.

## Multi-Instance Delivery (Pub/Sub)

The subscriber registry is now backed by a pluggable pub/sub abstraction
(`apps/dashboard/lib/activity/pubsub.ts`). Two implementations exist:

### LocalPubSub (mock mode — single instance)

Used when `DASHBOARD_STORAGE_MODE=mock` (the default). Identical to the
previous `globalThis`-based `Set` — events are delivered only to subscribers
within the same process. No database required. Single-instance behavior is
unchanged from prior releases.

### PostgresPubSub (durable mode — horizontal scaling)

Used when `DASHBOARD_STORAGE_MODE=durable` and `DATABASE_URL` points to a
shared Postgres instance. Uses Postgres `LISTEN`/`NOTIFY` to broadcast activity
events to all connected dashboard instances:

- **Publish side** (`publish()`): sends `SELECT pg_notify('activity_channel', $1)`
  via the shared connection pool. The event JSON is serialised as the payload.
- **Subscribe side** (`subscribe()`): acquires a dedicated listener connection
  from the pool, issues `LISTEN "activity_channel"`, and dispatches incoming
  notifications to local SSE clients.
- **Cleanup**: when the last SSE client disconnects, the listener connection
  issues `UNLISTEN` and is released back to the pool.

#### Trade-off: Postgres LISTEN/NOTIFY vs. Redis

| Concern                | Postgres LISTEN/NOTIFY                                 | Redis Pub/Sub                                     |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| New infrastructure     | None (Postgres already required for durable mode)      | Requires a Redis instance                         |
| Payload limit          | 8000 bytes (plenty for small activity events)          | Unlimited (with streams)                          |
| Delivery semantics     | At-most-once                                           | At-most-once (pub/sub) or at-least-once (streams) |
| Throughput             | Moderate (limited by Postgres notification throughput) | Very high                                         |
| Operational complexity | Low (no new service to manage)                         | Moderate (requires Redis expertise)               |

Postgres LISTEN/NOTIFY was chosen for this implementation because it adds zero
new infrastructure dependencies and the at-most-once semantics are already
mitigated by the client-side polling fallback (`NEXT_PUBLIC_ACTIVITY_REFRESH_MS`)
and ready-handshake REST reconciliation.

If your team already runs Redis and needs higher throughput, swap the
`PostgresPubSubImpl` class for a `RedisPubSubImpl` that implements the same
`ILocalPubSub` interface.

### Backfill in a Multi-Instance World

Backfill (reconnect) behaviour works correctly across instances because:

1. The initial REST snapshot (`GET /api/activity`) reads from shared durable
   storage (`activity_events` table), not instance-local memory.
2. The ready-handshake HTTP reconciliation re-fetches the authoritative
   snapshot from shared storage after the SSE channel is established.
3. A client that reconnects to a different instance (e.g., after a load
   balancer rebalance) will still receive the correct backfill because the
   query is scoped to the shared database.

### Local Multi-Instance Testing

Two methods are available for validating cross-instance delivery:

**Option A: Docker Compose** (recommended for CI/reviewers)

```bash
docker compose up -d postgres dashboard dashboard-2
```

This starts two dashboard instances on ports 3000 and 3002, both connected to
the same Postgres. Send a webhook to either instance and observe the event
appear on both.

**Option B: Local dev script**

```bash
bash scripts/multi-instance-test.sh
```

This starts two `pnpm dev` processes on ports 3000 and 3001 with durable mode
pointed at your local Postgres.

Proxies must allow long-lived responses and should not buffer
`text/event-stream`. The route emits a client-visible `heartbeat` event every
15 seconds and returns `Cache-Control: no-cache, no-transform` plus
`X-Accel-Buffering: no`. Each connection also has a bounded 32-frame output
queue; a slow consumer is disconnected when that queue fills so its client can
activate polling fallback instead of growing server memory without limit.
