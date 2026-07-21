# Repository Pattern - Quick Reference

## Using Repositories in API Routes

```typescript
// Import
import { apiResponse } from "@/lib/api-helpers";
import { getPassRepository } from "@/lib/repositories/factory";

// Fetch all
export async function GET() {
  const repo = getPassRepository();
  const passes = await repo.getAll();
  return apiResponse(passes);
}

// Fetch by ID
const pass = await repo.getById("1");

// Create
const newPass = await repo.create({
  name: "VIP Pass",
  price: 10.0,
  description: "Exclusive"
});

// Update
const updated = await repo.update("1", { price: 12.0 });

// Delete
await repo.delete("1");
```

## Using Member Repository with Wallet Lookup

```typescript
import { getMemberRepository } from "@/lib/repositories/factory";

const repo = getMemberRepository();

// Find by wallet (O(1))
const member = await repo.getByWallet("0x123abc");
```

## Using Activity Repository (Append-Only)

```typescript
import { getActivityRepository } from "@/lib/repositories/factory";

const repo = getActivityRepository();

// Append (idempotent - same event won't duplicate)
const result = await repo.append({
  id: "evt_unique_123",
  type: "member.joined",
  source: "webhook",
  severity: "info",
  actor: { name: "system" },
  timestamp: new Date().toISOString(),
  description: "Member joined guild"
});

console.log(result); // "recorded" or "duplicate"

// Query all events
const events = await repo.query({});

// Check if event was processed
const wasProcessed = await repo.hasProcessed("evt_unique_123");
```

## Configuration

```bash
# Default (mock, in-memory)
DASHBOARD_STORAGE_MODE=mock

# Production (with backend)
DASHBOARD_STORAGE_MODE=durable
DATABASE_URL=postgresql://...
```

## Checking Current Mode

```typescript
import { getStorageMode, getStorageConfig } from "@/lib/env";

const mode = getStorageMode(); // "mock" | "durable"
const config = getStorageConfig(); // { mode, connectionString }
```

## In Tests

```typescript
import { getPassRepository, clearRepositories } from "@/lib/repositories";

test("my test", async () => {
  clearRepositories(); // Fresh state
  
  const repo = getPassRepository();
  const pass = await repo.create({ name: "Test" });
  
  // Assertions...
});
```

## Singleton Pattern

Repositories are singletons per process:

```typescript
const repo1 = getPassRepository();
const repo2 = getPassRepository();
console.log(repo1 === repo2); // true - same instance
```

## Error Handling

```typescript
try {
  const passes = await getPassRepository().getAll();
} catch (error) {
  console.error("Repository error:", error);
  // Fallback to mock data as needed
}
```

## Common Patterns

### Fetch With Fallback

```typescript
try {
  const repo = getPassRepository();
  return await repo.getAll();
} catch (error) {
  console.error("Repo error, using fallback:", error);
  return mockPasses; // From lib/mock-data.ts
}
```

### Conditional by Mode

```typescript
import { getStorageMode } from "@/lib/env";

if (getStorageMode() === "mock") {
  console.log("Running in development mode");
}
```

### Per-Entity Operations

```typescript
// Passes
import { getPassRepository } from "@/lib/repositories";
const pass = await getPassRepository().getById("1");

// Guilds
import { getGuildRepository } from "@/lib/repositories";
const guild = await getGuildRepository().getAll();

// Members
import { getMemberRepository } from "@/lib/repositories";
const member = await getMemberRepository().getByWallet("0x...");

// Activity
import { getActivityRepository } from "@/lib/repositories";
const events = await getActivityRepository().query({});
```

## File Locations

- **Entry Point**: `lib/repositories/index.ts`
- **Types**: `lib/repositories/types.ts`
- **Factory**: `lib/repositories/factory.ts`
- **Mock Adapters**: `lib/repositories/adapters/mock.ts`
- **Durable Stubs**: `lib/repositories/adapters/durable.ts`
- **Full Docs**: `lib/repositories/README.md`

## For Implementers

To add a new entity (e.g., `Settings`) to the persistence layer:

1. Add interface to `types.ts`
   ```typescript
   export interface ISettingsRepository {
     get(guildId: string): Promise<Settings | null>;
     update(guildId: string, settings: Partial<Settings>): Promise<Settings>;
   }
   ```

2. Implement mock adapter in `adapters/mock.ts`
   ```typescript
   export class MockSettingsRepository implements ISettingsRepository { ... }
   ```

3. Add durable stub in `adapters/durable.ts`
   ```typescript
   export class DurableSettingsRepository implements ISettingsRepository { ... }
   ```

4. Add to factory in `factory.ts`
   ```typescript
   export function getSettingsRepository(): ISettingsRepository {
     return getRepositoryFactory().settingsRepository();
   }
   ```

5. Update `IRepositoryFactory` in `types.ts`

6. Add to index.ts exports

7. Use in API routes

---

**Next**: Implement backend adapters in `durable.ts` to persist data to your chosen database.
