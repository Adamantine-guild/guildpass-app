# @guildpass/integration-client

Typed client for the GuildPass core API, built for integrations that need to
look up guild memberships and verify wallet ownership without reading the
source. It also exposes a thin JSON-RPC client for on-chain reads through the
same transport.

- Package: `@guildpass/integration-client`
- Runtime: Node.js >= 18.17 (uses the global `fetch`)
- Exports: `IntegrationClient`, `ContractClient`, and the types
  `Membership`, `VerificationResult`, `IntegrationClientOptions`,
  `TransportConfig`, `RetryConfig`, `HttpRequestOptions`, plus the contract
  types `JsonRpcRequest`, `JsonRpcResponse`, `ContractCallOptions`.

## Install

```bash
npm install @guildpass/integration-client
```

## Quick start

This mirrors the real usage in
[`apps/dashboard/app/api/verify/route.ts`](../../apps/dashboard/app/api/verify/route.ts):

```ts
import { IntegrationClient, type VerificationResult } from "@guildpass/integration-client";

const client = new IntegrationClient({
  baseUrl: process.env.GUILD_PASS_CORE_URL!, // core API base URL
  apiKey: process.env.GUILD_PASS_API_KEY,    // bearer token (optional)
});

// Verify a Discord user controls a wallet
const result: VerificationResult = await client.verifyWallet(discordUserId, wallet);
// => { userId, wallet, verified, message? }

if (result.verified) {
  // grant access
}
```

### Membership lookups

```ts
// By Discord user id (null if the user has no membership)
const byDiscord = await client.getMembershipByDiscordUser(discordUserId);

// By wallet address (null if the wallet has no membership)
const byWallet = await client.getMembershipByWallet(wallet);

if (byWallet) {
  console.log(byWallet.status); // "active" | "inactive" | "unknown"
  console.log(byWallet.roles);  // RoleKey[]: "admin" | "member" | "contributor"
}
```

A membership lookup throws `Error("core:<status>")` on any non-404 error
response. `404` is treated as "no membership" and returns `null`.

### On-chain reads (ContractClient)

```ts
const contract = client.getContractClient("https://your-rpc.example/v1");

// Raw JSON-RPC call; `call<T>` is generic over the result type.
const owner: string = await contract.call<string>("ownerOf", [tokenId]);
```

`ContractClient.call` throws `Error("RPC_HTTP_ERROR:<status>")` on a
non-OK HTTP response and `Error("RPC_ERROR:<code> <message>")` when the
JSON-RPC payload carries an `error` object.

## API reference

### `new IntegrationClient(options)`

| Option      | Type                                            | Required | Description                                                                 |
| ----------- | ----------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `baseUrl`   | `string`                                        | yes      | Core API base URL. Trailing slashes are stripped.                           |
| `apiKey`    | `string`                                         | no       | Bearer token sent as `Authorization: Bearer <apiKey>`. Omit for public endpoints. |
| `transport` | [`TransportConfig`](#transportconfig)           | no       | Default `fetch` implementation, timeout, and retry behaviour.               |

### Methods

| Method                                            | Returns                  | Throws on error            |
| ------------------------------------------------- | ------------------------ | -------------------------- |
| `getContractClient(rpcUrl)`                       | `ContractClient`         | —                          |
| `getMembershipByDiscordUser(discordUserId, opts?)`| `Membership \| null`     | `core:<status>` (non-404)  |
| `getMembershipByWallet(wallet, opts?)`            | `Membership \| null`     | `core:<status>` (non-404)  |
| `verifyWallet(discordUserId, wallet, opts?)`      | `VerificationResult`     | `core:<status>`            |

Every method accepts an optional per-request
[`HttpRequestOptions`](#httprequestoptions) as its last argument.

## Transport: timeout, retry & backoff

All requests flow through an internal `HttpClient`. Retry and timeout can be
configured **per request** (via `HttpRequestOptions`) or as **client defaults**
(via `IntegrationClientOptions.transport`). A per-request value always wins
over the client default.

### `TransportConfig` (client defaults)

| Field      | Type                              | Default                                  |
| ---------- | --------------------------------- | ---------------------------------------- |
| `fetch`    | `typeof fetch`                    | global `fetch`                           |
| `timeout`  | `number` (ms)                     | **unset — no timeout** unless provided   |
| `retry`    | [`RetryConfig`](#retryconfig)     | **unset — single attempt (no retry)**    |

### `RetryConfig`

| Field         | Type      | Default                              |
| ------------- | --------- | ------------------------------------ |
| `maxAttempts` | `number`  | **no default** — omit `retry` and the request is attempted **once** |
| `delay`       | `number`  | **1000 ms** between attempts         |
| `backoff`     | `boolean` | **false** (fixed delay). When `true`, delay grows as `delay * 2^(attempt-1)` (exponential backoff) |

**Retry semantics:**

- Only **transient** failures are retried: HTTP `429` (rate limited) and any
  `5xx` status. `4xx` responses (other than `429`) are returned/throw
  immediately — they are not retried.
- A request is retried up to `maxAttempts - 1` times (so `maxAttempts: 3`
  means the original attempt plus two retries).
- Network errors are retried up to `maxAttempts`; on the final failed attempt
  the original error is re-thrown.
- If neither `retry` nor `maxAttempts` is supplied, the request is sent once
  and never retried.

### Examples

```ts
// Client-wide: 5s timeout, retry up to 3 times with exponential backoff.
const client = new IntegrationClient({
  baseUrl: process.env.GUILD_PASS_CORE_URL!,
  apiKey: process.env.GUILD_PASS_API_KEY,
  transport: {
    timeout: 5000,
    retry: { maxAttempts: 3, delay: 500, backoff: true },
  },
});

// Override per request: this one call gets a longer timeout, no retry.
const m = await client.getMembershipByWallet(wallet, {
  timeout: 10000,
  retry: { maxAttempts: 1 },
});
```

### Aborting a request

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 3000);

try {
  await client.getMembershipByDiscordUser(userId, { signal: controller.signal });
} catch (err) {
  // AbortError (or the abort reason) is propagated
}
```

## Types

```ts
type Membership = {
  userId: string;
  wallet?: string;
  status: "active" | "inactive" | "unknown";
  roles: ("admin" | "member" | "contributor")[];
  updatedAt: string; // ISO timestamp
};

type VerificationResult = {
  userId: string;
  wallet: string;
  verified: boolean;
  message?: string;
};
```

The full set of exported types (including the `ActivityEvent` audit model and
the contract JSON-RPC types) is available from the package root:

```ts
import type {
  Membership,
  VerificationResult,
  IntegrationClientOptions,
  TransportConfig,
  RetryConfig,
  HttpRequestOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  ContractCallOptions,
  ActivityEvent,
  CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
} from "@guildpass/integration-client";

import {
  upcastActivityEvent,
  upcastActivityEvents,
  detectSchemaVersion,
} from "@guildpass/integration-client";
```

## Shared domain types

`Pass`, `Guild`, and `Member` are the canonical shapes for these entities,
shared between `apps/dashboard` and `apps/discord-bot` so the two apps can't
drift apart:

```ts
import type { Pass, Guild, Member } from "@guildpass/integration-client";

type Pass = {
  id: string;
  guildId: string;
  name: string;
  description: string;
  status: "active" | "inactive" | "draft";
  price?: number;
  maxSupply?: number | null;
  currentSupply: number;
  createdAt: string;
};

type Guild = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  passCount: number;
  createdAt: string;
};

type Member = {
  id: string;
  guildId: string;
  wallet: string;
  name: string;
  status: "active" | "inactive" | "pending";
  roles: string[];
  joinedAt: string;
  lastActive: string;
  version: number; // optimistic concurrency control
};
```

The audit/event equivalent is `ActivityEvent` (see below), which models a
single logged activity item rather than a core entity.

## ActivityEvent schema versioning

`ActivityEvent` carries an explicit `schemaVersion` field so that historical
events stored in durable storage remain readable as the type evolves.

### How it works

1. Every new event is written with `schemaVersion` set to
   `CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION`.
2. Events stored **before** versioning was introduced (V1) have no
   `schemaVersion` field. They are treated as version 1.
3. When reading events from storage, call `upcastActivityEvent()` (or
   `upcastActivityEvents()` for batches) to walk the event through the
   migration chain. The returned object always conforms to the current
   `ActivityEvent` shape.

```ts
import {
  upcastActivityEvent,
  upcastActivityEvents,
  CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
} from "@guildpass/integration-client";

// Single event (e.g. reading from a JSONL line)
const raw = JSON.parse(jsonLine);
const event = upcastActivityEvent(raw);
// event.schemaVersion === CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION

// Batch (e.g. reading all events from storage)
const raws = lines.map((line) => JSON.parse(line));
const events = upcastActivityEvents(raws);
```

### Adding a new field or event type (contributor guide)

Follow these steps to safely evolve `ActivityEvent` without breaking stored
data or older consumers during a rolling deployment:

#### Adding a new optional field

1. Add the field to `ActivityEvent` in `packages/integration-client/src/types.ts`
   as **optional**.
2. Bump `CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION` by 1.
3. Add a migration entry in `packages/integration-client/src/activity-event-migration.ts`:

   ```ts
   // V2 → V3
   MIGRATIONS.set(2, (event) => ({
     ...event,
     schemaVersion: 3,
     newField: event.newField ?? "default value",
   }));
   ```

4. All producers (mapper, service, etc.) should start setting the new field.
5. Add a test with a V2 fixture that asserts correct upcast to V3 with the
   default value.
6. Run `pnpm -r typecheck` and `pnpm -r test`.

#### Adding a new event type

1. Add the string to the `ActivityEventType` union in `types.ts`.
2. No migration entry is needed — existing events don't reference the new type.
3. Add mapping logic in the dashboard mapper and any consumers.
4. Document the new type in code comments.

#### Removing or renaming a field

This is a **breaking change** for stored data. Avoid it if possible. If
unavoidable:

1. Keep the old field as optional in the type (deprecated).
2. Add the new field alongside it.
3. Write a migration that copies the old value to the new field.
4. Remove the old field in a future version after all stored data has been
   migrated.

### Exports

| Export | Description |
| --- | --- |
| `CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION` | The current schema version number (bump on each change) |
| `upcastActivityEvent(raw)` | Migrate a single stored event to the current shape |
| `upcastActivityEvents(raws)` | Migrate an array of stored events |
| `detectSchemaVersion(event)` | Return the schema version of a raw event (defaults to 1) |
| `RawActivityEvent` | Loose type for raw/stored events before upcasting |

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # emit to dist/
npm run lint        # eslint
```
