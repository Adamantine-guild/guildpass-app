# Repository Pattern & Persistence Layer

This document explains the persistence layer architecture for the GuildPass dashboard.

## Overview

The dashboard uses a **repository pattern** to abstract data storage, enabling seamless switching between:

- **Mock mode** (in-memory, local development): Fast iteration without external dependencies
- **Durable mode** (production backends): PostgreSQL, MongoDB, etc.

All storage access is **server-side only** — repositories are never exposed to client-side JavaScript.

## Multi-Tenant Isolation

Passes and members belong to exactly one guild (tenant). Every
`IPassRepository`/`IMemberRepository` method requires an explicit `guildId`
as its first parameter, so guild-unscoped queries are a **compile error**,
not a runtime possibility. A call scoped to guild A structurally cannot
read, modify, or delete guild B's data — even when handed an ID or wallet
that exists in another guild. This guarantee is enforced against every
adapter (mock included) by the isolation contract suites in
[test/repositories/contracts.ts](../../test/repositories/contracts.ts).
See [docs/multi-tenancy.md](../../../../docs/multi-tenancy.md) for the full
policy.

## Architecture

```
┌─────────────────────────────────────────┐
│      Dashboard Pages & API Routes       │
└─────────────────────│───────────────────┘
                      │ Uses
                      ↓
           ┌──────────────────────┐
           │   Factory Pattern    │
           │  getPassRepository() │
           │  etc.               │
           └──────────│───────────┘
                      │
          ┌───────────┴────────────┐
          │                        │
    MOCK MODE              DURABLE MODE
  (in-memory)        (backend database)
    Storage              Storage
```

## Quick Start

### Using a Repository

```typescript
import { apiResponse } from "@/lib/api-helpers";
import { getActiveGuildId } from "@/lib/guild-context";
import { getPassRepository } from "@/lib/repositories";

// In an API route or server component:
export async function GET() {
  const passRepository = getPassRepository();
  const passes = await passRepository.getAll(getActiveGuildId());
  return apiResponse(passes);
}
```

### Creating a Pass

```typescript
const repo = getPassRepository();
const newPass = await repo.create(getActiveGuildId(), {
  name: "VIP Pass",
  price: 10.0,
  description: "Exclusive access",
});
```

### Looking Up a Member by Wallet

```typescript
const memberRepo = getMemberRepository();
// Scoped lookup: only resolves members of the given guild.
const member = await memberRepo.getByWallet(getActiveGuildId(), "0x123abc...");
if (member) {
  console.log(`Found member: ${member.name}`);
}
```

### Appending to Activity Log

```typescript
const activityRepo = getActivityRepository();

const result = await activityRepo.append({
  id: "evt_unique_id",
  type: "member.joined",
  source: "dashboard",
  severity: "info",
  actor: { name: "system" },
  timestamp: new Date().toISOString(),
  description: "User joined guild",
});

if (result === "duplicate") {
  console.log("Event already recorded (idempotent)");
} else {
  console.log("Event recorded");
}
```

## Repository Interfaces

### IPassRepository

All methods are guild-scoped; a mismatched `guildId` behaves exactly like a
missing record.

```typescript
interface IPassRepository {
  getAll(guildId: string): Promise<Pass[]>;
  query(guildId: string, options?: PassListQuery): Promise<PaginatedResult<Pass>>;
  getById(guildId: string, id: string): Promise<Pass | null>;
  create(guildId: string, pass: PassCreateData): Promise<Pass>;
  update(guildId: string, id: string, pass: PassUpdateData): Promise<Pass | null>;
  delete(guildId: string, id: string): Promise<boolean>;
}
```

### IGuildRepository

```typescript
interface IGuildRepository {
  getAll(): Promise<Guild[]>;
  getById(id: string): Promise<Guild | null>;
  create(guild: Omit<Guild, "id" | "createdAt">): Promise<Guild>;
  update(id: string, guild: Partial<Guild>): Promise<Guild | null>;
  delete(id: string): Promise<boolean>;
}
```

### IMemberRepository

All methods are guild-scoped; a mismatched `guildId` (or a wallet that only
exists in another guild) behaves exactly like a missing record.

```typescript
interface IMemberRepository {
  getAll(guildId: string): Promise<Member[]>;
  query(guildId: string, options?: MemberListQuery): Promise<PaginatedResult<Member>>;
  getById(guildId: string, id: string): Promise<Member | null>;
  getByWallet(guildId: string, wallet: string): Promise<Member | null>;
  create(guildId: string, member: MemberCreateData): Promise<Member>;
  update(guildId: string, id: string, member: MemberUpdateData): Promise<Member | null>;
  delete(guildId: string, id: string): Promise<boolean>;
}
```

### IActivityRepository

```typescript
interface IActivityRepository {
  append(event: ActivityEvent): Promise<"recorded" | "duplicate">;
  query(filters: ActivityEventFilters): Promise<ActivityEvent[]>;
  hasProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string): Promise<void>;
}
```

## Configuration

### Environment Variables

```bash
# Storage mode: 'mock' (default, in-memory) or 'durable' (backend)
DASHBOARD_STORAGE_MODE=mock

# Required when DASHBOARD_STORAGE_MODE=durable
# Format depends on your backend:
DATABASE_URL=postgresql://user:pass@localhost/guildpass
# or
DATABASE_URL=mongodb://localhost:27017/guildpass
```

### Checking Current Mode

```typescript
import { getStorageMode, getStorageConfig } from "@/lib/env";

const mode = getStorageMode(); // "mock" | "durable"
const config = getStorageConfig(); // { mode, connectionString }
```

## Mock Mode (Development)

### How It Works

- Repositories use in-memory `Map<string, Entity>` storage
- Data is seeded from [lib/mock-data.ts](lib/mock-data.ts) on first access
- Auto-incrementing IDs: Pass nextId=5, Guild nextId=4, Member nextId=5
- **Data does NOT persist** across server restarts

### Use Cases

✅ Local development and prototyping  
✅ Quick iteration without infrastructure  
✅ Testing without mocking the repository itself  
✅ CI/CD test runs

### Example: MockMemberRepository

```typescript
class MockMemberRepository implements IMemberRepository {
  private members: Map<string, Member> = new Map();
  private walletIndex: Map<string, string> = new Map(); // (guildId, wallet) -> id
  private nextId = 5;

  async create(guildId: string, member: MemberCreateData): Promise<Member> {
    const id = String(this.nextId++);
    // guildId comes from the scope parameter only — payloads cannot set it.
    const newMember: Member = { ...member, id, guildId };
    this.members.set(id, newMember);
    this.walletIndex.set(this.walletKey(guildId, member.wallet), id);
    return newMember;
  }

  async getByWallet(guildId: string, wallet: string): Promise<Member | null> {
    const id = this.walletIndex.get(this.walletKey(guildId, wallet));
    if (!id) return null;
    return this.getScoped(guildId, id);
  }
}
```

**Key Features:**
- Secondary wallet index for O(1) lookups
- Bidirectional consistency on updates/deletes
- Limits in-memory size (keeps only 1000 recent entries for activity)

## Durable Mode (Production)

### How It Works

Durable adapters define a **contract** for persistent storage but are not yet fully implemented.

```typescript
export class DurablePassRepository implements IPassRepository {
  private connectionString: string;

  constructor(connectionString: string) {
    if (!connectionString) {
      throw new Error("Connection string required");
    }
    this.connectionString = connectionString;
  }

  async getAll(guildId: string): Promise<Pass[]> {
    throw new Error(
      "DurablePassRepository.getAll() not yet implemented. " +
      "Implement against your backend (PostgreSQL, MongoDB, etc.)."
    );
  }
}
```

### Implementation Checklist

To implement a durable backend:

1. **Choose a backend** (PostgreSQL, MongoDB, DynamoDB, etc.)
2. **Extend durable adapters** in `lib/repositories/adapters/durable.ts`
3. **Implement each method** using your backend client
4. **Handle transactions** for atomic operations (create, update, delete)
5. **Enforce uniqueness** where needed:
   - Activity event IDs must be unique (idempotency)
   - Wallet addresses should be unique per guild in Member storage
     (composite constraint on `(guild_id, wallet)`)
6. **Add soft deletes** if needed (keep audit trails)
6. **Enforce guild isolation** (see [docs/multi-tenancy.md](../../../../docs/multi-tenancy.md)):
   - `passes`/`members` tables carry a NOT NULL `guild_id` foreign key
   - every statement filters on `guild_id`; `guild_id` never appears in an
     UPDATE SET clause
   - run the isolation contract suites from
     `test/repositories/contracts.ts` against your adapter
7. **Index strategic columns**:
   - `Member.(guild_id, wallet)` (for scoped lookups)
   - `ActivityEvent.id` (for deduplication)
   - `ActivityEvent.type` (for filtering)

### PostgreSQL Example (Pseudocode)

```typescript
export class DurablePassRepository implements IPassRepository {
  async getAll(guildId: string): Promise<Pass[]> {
    const client = new PgClient(this.connectionString);
    const result = await client.query(
      "SELECT * FROM passes WHERE guild_id = $1",
      [guildId]
    );
    return result.rows;
  }

  async create(guildId: string, pass: PassCreateData): Promise<Pass> {
    const client = new PgClient(this.connectionString);
    const result = await client.query(
      "INSERT INTO passes (guild_id, name, price, description) VALUES ($1, $2, $3, $4) RETURNING *",
      [guildId, pass.name, pass.price, pass.description]
    );
    return result.rows[0];
  }
}
```

### MongoDB Example (Pseudocode)

```typescript
export class DurablePassRepository implements IPassRepository {
  async getAll(guildId: string): Promise<Pass[]> {
    const client = new MongoClient(this.connectionString);
    const db = client.db("guildpass");
    const collection = db.collection("passes");
    return await collection.find({ guildId }).toArray();
  }

  async create(guildId: string, pass: PassCreateData): Promise<Pass> {
    const collection = db.collection("passes");
    const result = await collection.insertOne({
      ...pass,
      guildId,
      _id: new ObjectId(),
      createdAt: new Date().toISOString(),
    });
    return { id: result.insertedId.toString(), guildId, ...pass };
  }
}
```

## Activity Repository: Append-Only Pattern

The activity repository implements an **append-only** pattern for strong idempotency:

- Each event has a **unique ID** (generated: `evt_<timestamp>_<randomId>`)
- **Duplicate events** are detected by ID and rejected
- Events are **never updated or deleted** (only appended)
- Useful for audit logs, webhooks, and event sourcing

### Idempotency Example

```typescript
const activityRepo = getActivityRepository();

const event = {
  id: "evt_20240815_abc123",
  type: "members.joined",
  // ...
};

// First call: recorded
const result1 = await activityRepo.append(event);
console.log(result1); // "recorded"

// Same event again: rejected as duplicate
const result2 = await activityRepo.append(event);
console.log(result2); // "duplicate"
```

**Benefits:**
- Webhook retries don't create duplicates
- No race conditions on concurrent appends
- True event log (immutable history)

## Testing Repositories

### Unit Test: Mock Adapter

```typescript
import { MockPassRepository } from "@/lib/repositories/adapters/mock";

test("MockPassRepository should create and retrieve passes", async () => {
  const repo = new MockPassRepository();

  const pass = await repo.create("1", {
    name: "Test",
    price: 1.0,
    description: "Test",
  });

  const retrieved = await repo.getById("1", pass.id);
  expect(retrieved.name).toBe("Test");
});
```

### Integration Test: Factory

```typescript
import { getPassRepository, clearRepositories } from "@/lib/repositories/factory";

test("Factory should provide singleton instances", async () => {
  clearRepositories();
  const repo1 = getPassRepository();
  const repo2 = getPassRepository();
  expect(repo1).toBe(repo2); // Same instance
});
```

### Test with Specific Mode

```typescript
test("Repository in durable mode should error gracefully", async () => {
  process.env.DASHBOARD_STORAGE_MODE = "durable";
  process.env.DATABASE_URL = "postgresql://localhost/test";

  const repo = getRepositoryFactory().passRepository();
  expect(() => repo.getAll("1")).toThrow("not yet implemented");

  // Reset
  process.env.DASHBOARD_STORAGE_MODE = "mock";
  delete process.env.DATABASE_URL;
});
```

## Performance Characteristics

| Operation            | Mock Mode | Durable (Indexed) |
| -------------------- | --------- | ----------------- |
| `getAll()`           | O(n)      | O(n)              |
| `getById(id)`        | O(1)      | O(1)              |
| `getByWallet()`      | O(1)      | O(1)              |
| `create()`           | O(1)      | O(1) + disk I/O   |
| `update()`           | O(1)      | O(1) + disk I/O   |
| `delete()`           | O(1)      | O(1) + disk I/O   |

**Note:** Durable mode adds latency for I/O and network; consider caching for read-heavy workloads.

## File Structure

```
apps/dashboard/lib/repositories/
├── index.ts                    # Main entry point
├── types.ts                    # Repository interfaces
├── factory.ts                  # Factory & singleton management
└── adapters/
    ├── mock.ts                 # In-memory implementations
    └── durable.ts              # Backend contract (stubs)

apps/dashboard/test/
└── repositories.test.js        # Integration tests
```

## Common Patterns

### Conditional Logic Based on Mode

```typescript
import { getStorageMode } from "@/lib/env";

async function savePass(guildId: string, pass: PassCreateData) {
  const mode = getStorageMode();

  if (mode === "mock") {
    console.log("(Mock mode) Pass saved in memory");
  } else {
    console.log("(Durable mode) Pass persisted to database");
  }

  const repo = getPassRepository();
  return await repo.create(guildId, pass);
}
```

### Fallback to Mock on Error

```typescript
async function getSafePasses(guildId: string): Promise<Pass[]> {
  try {
    const repo = getPassRepository();
    return await repo.getAll(guildId);
  } catch (error) {
    console.error("Repository error, falling back to mock:", error);
    return mockPasses; // From lib/mock-data.ts
  }
}
```

### Pre-seeding Data in Tests

```typescript
test("Pass workflow", async () => {
  clearRepositories();

  // First call to any repository loads mock data (guild "1" holds the seeds)
  const repo = getPassRepository();
  const initial = await repo.getAll("1");
  expect(initial.length).toBeGreaterThan(0); // Seeded!

  // Now test custom operations
  const custom = await repo.create("1", { name: "Custom", price: 5.0, description: "" });
  const all = await repo.getAll("1");
  expect(all.some((p) => p.id === custom.id)).toBe(true);
});
```

## Migration: Mock → Durable

When ready to move to production:

1. **Set environment:**
   ```bash
   DASHBOARD_STORAGE_MODE=durable
   DATABASE_URL=postgresql://prod-db/guildpass
   ```

2. **Implement durable adapters** (extend `DurablePassRepository`, etc.)

3. **Run tests** — should pass without code changes:
   ```bash
   npm test  # Uses environment to pick storage mode
   ```

4. **Migrate existing data** (mock → database):
   ```typescript
   const mockRepo = new MockPassRepository();
   const durableRepo = new DurablePassRepository(connectionString);

   for (const guild of await getGuildRepository().getAll()) {
     const passes = await mockRepo.getAll(guild.id);
     for (const pass of passes) {
       await durableRepo.create(guild.id, pass);
     }
   }
   ```

## Troubleshooting

### Q: "DurablePassRepository.getAll() not yet implemented"

**A:** You're in durable mode but haven't implemented the backend yet. Either:

- Switch to mock: `DASHBOARD_STORAGE_MODE=mock`
- Implement the durable adapters (see "Durable Mode" section above)

### Q: Data disappears after server restart

**A:** This is expected in mock mode! Mock repositories use in-memory storage:

```typescript
// Reset cache on every server start
clearRepositories();
```

To persist data, use durable mode with a backend database.

### Q: Wallet lookup returns null for an existing member

**A:** Check the wallet format. The index is case-sensitive:

```typescript
// ❌ Won't find if stored as lowercase
const member = await memberRepo.getByWallet(guildId, "0xABC123");

// ✅ Normalize format consistently
const member = await memberRepo.getByWallet(guildId, "0xabc123".toLowerCase());

// Also check the guild scope: a wallet that belongs to a different guild
// resolves to null by design (see docs/multi-tenancy.md).
```

### Q: Why is `clearRepositories()` needed in tests?

**A:** Repositories are singletons per process. Without clearing between tests, state from one test leaks into the next:

```typescript
test("Test 1", async () => {
  await getPassRepository().create("1", { name: "Pass1" });
  // Pass1 now in global repository instance
});

test("Test 2", async () => {
  const passes = await getPassRepository().getAll("1");
  // ❌ Will see Pass1 from Test 1!
});

// ✅ Fix:
test("Test 2", async () => {
  clearRepositories(); // Resets singleton instances
  const passes = await getPassRepository().getAll("1");
  // Clean slate
});
```

## Further Reading

- [AGENTS.md](../../AGENTS.md) — Engineering guidelines
- [architecture.md](../../docs/docs/architecture.md) — System design overview
- [lib/mock-data.ts](lib/mock-data.ts) — Seed data for development
