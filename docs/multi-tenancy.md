# GuildPass Dashboard — Multi-Tenant Data Isolation

This document describes the guild (tenant) isolation guarantee enforced by
the dashboard's repository layer, why it is structural rather than
conventional, and what any new repository implementation must do to conform.

---

## The Guarantee

**A repository call scoped to guild A can never read, modify, or delete
guild B's data.**

Concretely:

- Every `Pass` and `Member` record carries an explicit `guildId` foreign key
  identifying the single guild that owns it.
- Every method on `IPassRepository`, `IMemberRepository`, and
  `IActivityRepository` (`append`/`query`) requires an explicit `guildId`
  scope as its **first parameter**. There is no unscoped variant, and the
  parameter is not an optional filter — omitting it is a **compile error**,
  not a runtime possibility. The activity adapters additionally throw at
  runtime if `guildId` is empty, for callers that bypass the type system.
- A scoped call that references a record belonging to a different guild
  behaves exactly as if the record does not exist: reads return `null`,
  updates return `null`, deletes return `false`. Existence of another
  guild's record is never revealed.
- The owning guild of a record is **immutable**. `create` derives `guildId`
  from the scope parameter only, and the create/update input types
  (`PassCreateData`, `PassUpdateData`, `MemberCreateData`,
  `MemberUpdateData`) exclude `guildId`, so a payload cannot assign or move
  a record to another tenant. Adapters additionally pin `guildId` at
  runtime, so even a caller that bypasses the type system (plain JS,
  `as`-casts, JSON from the network) cannot smuggle a foreign `guildId`.
- Wallet lookups are guild-scoped: `getByWallet(guildId, wallet)` only
  resolves members of that guild. The same wallet may exist independently in
  several guilds; wallet uniqueness is per guild
  (`(guildId, wallet)`), not global.

Guilds themselves (`IGuildRepository`) are the tenant boundary, so they are
not scoped further. Guild lifecycle activity (`guild.created`/`updated`/
`deleted`) is tagged with the guild's own id, since a guild is its own tenant
boundary. Settings remain a single workspace-level document (`ISettingsRepository`
is not guild-scoped); the activity events it emits are tagged under
`DEFAULT_GUILD_ID` until settings gain per-guild rows and adopt the same
pattern. `hasProcessed`/`markProcessed` on `IActivityRepository` are webhook
idempotency bookkeeping keyed by opaque event id, not a data query, so they
remain workspace-wide.

## Why Structural

A "remembered to add a WHERE clause" convention fails open: one forgotten
filter in one route handler leaks one guild's members or passes to an admin
of an entirely different guild. By moving the requirement into the method
signatures, forgetting the scope no longer compiles, and by re-checking
ownership inside the adapters, even adversarial callers cannot cross the
boundary at runtime. Defense in depth:

1. **Type level** — `guildId` is a required parameter; create/update inputs
   exclude it.
2. **Adapter level** — every lookup resolves through a scoped helper that
   treats a guild mismatch as "not found"; `create`/`update` overwrite/pin
   `guildId` from the scope parameter.
3. **API level** — `guildId` is a server-owned field in mutation payload
   validation (`lib/validation/mutations.ts`); clients sending it get a
   `400`. Route handlers resolve the scope server-side via
   `getActiveGuildId()` (`lib/guild-context.ts`), never from client input.
4. **Test level** — shared isolation contract suites prove the guarantee
   against every adapter.

## Contract Tests

The behavioural contracts in
[`apps/dashboard/test/repositories/contracts.ts`](../apps/dashboard/test/repositories/contracts.ts)
include dedicated isolation suites that every conforming implementation
(mock included) must register and pass:

- `passRepositoryIsolationContract`
- `memberRepositoryIsolationContract`
- `activityRepositoryIsolationContract`

They seed two guilds with distinct records and assert, for every repository
method, that querying with guild A's scope never returns, modifies, or
deletes guild B's records — including adversarial cases:

- passing a record ID that belongs to a different guild than the scope;
- looking up a wallet that only exists in another guild;
- payloads that smuggle a foreign `guildId` past the type system on both
  `create` and `update`;
- verifying the same wallet can exist independently in two guilds without
  either lookup observing the other.

New durable adapters must register these suites with their own factory,
exactly as
[`mock-contract.test.ts`](../apps/dashboard/test/repositories/mock-contract.test.ts)
does for the mock adapter.

## Requirements for Durable Backends

When implementing `DurablePassRepository`/`DurableMemberRepository` against
a real database:

- `passes` and `members` tables carry a `NOT NULL guild_id` column with a
  foreign key to `guilds`.
- **Every** statement filters on it: `WHERE guild_id = $1 AND id = $2`.
  Never fetch by `id` alone and compare in application code.
- `guild_id` never appears in an `UPDATE ... SET` clause.
- Member wallet uniqueness is a composite constraint on
  `(guild_id, wallet)`; the wallet lookup index is `(guild_id, wallet)`.
- A scoped query matching another guild's record returns `null`/`false`,
  indistinguishable from a missing record.
- Run the isolation contract suites against the adapter before shipping.

## Guild Scope Resolution

Operators can switch the active guild from the dashboard sidebar or via
`/guilds/[guildId]`. Server routes resolve the tenant scope through
`getActiveGuildId(request)` in
[`apps/dashboard/lib/guild-context.ts`](../apps/dashboard/lib/guild-context.ts):

1. `X-Guild-Id` request header (set by the dashboard client for the selected guild)
2. `guildpass_guild_id` cookie (persisted selection)
3. `DEFAULT_GUILD_ID` (`"1"`) fallback for unscoped callers (tests, scripts)

Route handlers must call `getActiveGuildId(request)` — never hard-code a
guild id. Once per-guild RBAC (issue #67) lands, that helper should also
verify the authenticated session is allowed to act on the resolved guild.

## Known Gaps

Two paths still fall outside the structural guarantee above and rely on
best-effort filtering instead. Both are pre-existing and out of scope for the
repository-layer enforcement described here; they're called out so they
aren't mistaken for covered:

- **Webhook-sourced activity.** Incoming webhook payloads
  (`app/api/webhooks/route.ts`) carry no `guildId` field in their schema, so
  events ingested via `activityStorage` (a persistence path separate from
  `IActivityRepository`) aren't guild-tagged at write time. `GET
  /api/activity` still filters these via the `metadata.guildId` convention
  (`lib/data/guild-scoped.ts`), which only recognizes events that happen to
  carry it — closing this fully requires adding `guildId` to the webhook
  contract.
- **The live activity SSE stream** (`app/api/activity/stream/route.ts`)
  broadcasts every published event to every connected client; tenant
  separation on that path is enforced client-side only
  (`useActivityFeed.ts`), not server-side, because `EventSource` cannot send
  the `X-Guild-Id` header the rest of the app uses for scoping.

## Related Documents

- [permissions.md](permissions.md) — role-based access control (who may
  act); this document covers tenant isolation (which data they may act on).
- [`apps/dashboard/lib/repositories/README.md`](../apps/dashboard/lib/repositories/README.md)
  — repository layer architecture and adapter implementation guide.
