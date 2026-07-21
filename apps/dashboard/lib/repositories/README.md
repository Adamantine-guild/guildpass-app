# Repository Pattern & Persistence Layer

This document explains the persistence layer architecture for the GuildPass dashboard.

## Overview

The dashboard uses a **repository pattern** to abstract data storage, enabling seamless switching between:

- **Mock mode** (in-memory, local development): Fast iteration without external dependencies
- **Durable mode** (production backends): PostgreSQL, MongoDB, etc.

All storage access is **server-side only** — repositories are never exposed to client-side JavaScript.

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
import { getPassRepository } from "@/lib/repositories";

// In an API route or server component:
export async function GET() {
  const passRepository = getPassRepository();
  const passes = await passRepository.getAll();
  return apiResponse(passes);
}
```

### Creating a Pass

```typescript
const repo = getPassRepository();
const newPass = await repo.create({
  name: "VIP Pass",
  price: 10.0,
  description: "Exclusive access",
});
```

### Looking Up a Member by Wallet

```typescript
const memberRepo = getMemberRepository();
const member = await memberRepo.getByWallet("0x123abc...");
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

```typescript
interface IPassRepository {
  getAll(): Promise<Pass[]>;
  getById(id: string): Promise<Pass | null>;
  create(pass: Omit<Pass, "id" | "createdAt">): Promise<Pass>;
  update(id: string, pass: Partial<Pass>): Promise<Pass | null>;
  delete(id: string): Promise<boolean>;
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

```typescript
interface IMemberRepository {
  getAll(): Promise<Member[]>;
  getById(id: string): Promise<Member | null>;
  getByWallet(wallet: string): Promise<Member | null>;
  create(member: Omit<Member, "id">): Promise<Member>;
  update(id: string, member: Partial<Member>): Promise<Member | null>;
  delete(id: string): Promise<boolean>;
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
  private walletIndex: Map<string, string> = new Map(); // wallet -> id
  private nextId = 5;

  async create(member: Omit<Member, "id">): Promise<Member> {
    const id = String(this.nextId++);
    const newMember: Member = { ...member, id };
    this.members.set(id, newMember);
    this.walletIndex.set(member.wallet, id); // Index for O(1) lookup
    return newMember;
  }

  async getByWallet(wallet: string): Promise<Member | null> {
    const id = this.walletIndex.get(wallet);
    if (!id) return null;
    return this.members.get(id) || null;
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

  async getAll(): Promise<Pass[]> {
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
   - Wallet addresses should be unique in Member storage
6. **Add soft deletes** if needed (keep audit trails)
7. **Index strategic columns**:
   - `Member.wallet` (for lookups)
   - `ActivityEvent.id` (for deduplication)
   - `ActivityEvent.type` (for filtering)

### PostgreSQL Example (Pseudocode)

```typescript
export class DurablePassRepository implements IPassRepository {
  async getAll(): Promise<Pass[]> {
    const client = new PgClient(this.connectionString);
    const result = await client.query("SELECT * FROM passes");
    return result.rows;
  }

  async create(pass: Omit<Pass, "id" | "createdAt">): Promise<Pass> {
    const client = new PgClient(this.connectionString);
    const result = await client.query(
      "INSERT INTO passes (name, price, description) VALUES ($1, $2, $3) RETURNING *",
      [pass.name, pass.price, pass.description]
    );
    return result.rows[0];
  }
}
```

### MongoDB Example (Pseudocode)

```typescript
export class DurablePassRepository implements IPassRepository {
  async getAll(): Promise<Pass[]> {
    const client = new MongoClient(this.connectionString);
    const db = client.db("guildpass");
    const collection = db.collection("passes");
    return await collection.find({}).toArray();
  }

  async create(pass: Omit<Pass, "id" | "createdAt">): Promise<Pass> {
    const collection = db.collection("passes");
    const result = await collection.insertOne({
      ...pass,
      _id: new ObjectId(),
      createdAt: new Date().toISOString(),
    });
    return { id: result.insertedId.toString(), ...pass };
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

  const pass = await repo.create({
    name: "Test",
    price: 1.0,
    description: "Test",
  });

  const retrieved = await repo.getById(pass.id);
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
  expect(() => repo.getAll()).toThrow("not yet implemented");

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

async function savePass(pass: Pass) {
  const mode = getStorageMode();

  if (mode === "mock") {
    console.log("(Mock mode) Pass saved in memory");
  } else {
    console.log("(Durable mode) Pass persisted to database");
  }

  const repo = getPassRepository();
  return await repo.create(pass);
}
```

### Fallback to Mock on Error

```typescript
async function getSafePasses(): Promise<Pass[]> {
  try {
    const repo = getPassRepository();
    return await repo.getAll();
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

  // First call to any repository loads mock data
  const repo = getPassRepository();
  const initial = await repo.getAll();
  expect(initial.length).toBeGreaterThan(0); // Seeded!

  // Now test custom operations
  const custom = await repo.create({ name: "Custom", price: 5.0, description: "" });
  const all = await repo.getAll();
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

   const passes = await mockRepo.getAll();
   for (const pass of passes) {
     await durableRepo.create(pass);
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
const member = await memberRepo.getByWallet("0xABC123");

// ✅ Normalize format consistently
const member = await memberRepo.getByWallet("0xabc123".toLowerCase());
```

### Q: Why is `clearRepositories()` needed in tests?

**A:** Repositories are singletons per process. Without clearing between tests, state from one test leaks into the next:

```typescript
test("Test 1", async () => {
  await getPassRepository().create({ name: "Pass1" });
  // Pass1 now in global repository instance
});

test("Test 2", async () => {
  const passes = await getPassRepository().getAll();
  // ❌ Will see Pass1 from Test 1!
});

// ✅ Fix:
test("Test 2", async () => {
  clearRepositories(); // Resets singleton instances
  const passes = await getPassRepository().getAll();
  // Clean slate
});
```

## Further Reading

- [AGENTS.md](../../AGENTS.md) — Engineering guidelines
- [architecture.md](../../docs/docs/architecture.md) — System design overview
- [lib/mock-data.ts](lib/mock-data.ts) — Seed data for development
