# @guildpass/discord-bot

GuildPass Discord bot — handles wallet verification, membership status checks, and automated role reconciliation.

## Quick start

```sh
# From the repo root:
pnpm install

# Set up environment (copy and fill in values)
cp .env.example .env

# Run in single-process mode (development)
pnpm --filter @guildpass/discord-bot dev

# Run in sharded mode (production / large guild counts)
SHARD_COUNT=auto pnpm --filter @guildpass/discord-bot dev:shard
```

## Entry points

| Script | Entry file | Mode | When to use |
|--------|-----------|------|-------------|
| `dev` / `start` | `src/index.ts` | Single-process | Development, testing, self-hosting with < ~500 guilds |
| `dev:shard` / `start:shard` | `src/shard.ts` | Sharded (ShardingManager) | Production, 1 000+ guilds, or when you need process isolation |

Both entry points share the same bot logic defined in `src/bot.ts`.

## Sharding

### When do I need sharding?

Discord **requires** sharding once your bot reaches **2 500 guilds**. However, we recommend enabling sharding earlier — at around 1 000 guilds — for these reasons:

- **Responsiveness**: Gateway events are distributed across processes, so a burst of activity in one set of guilds doesn't delay event processing for others.
- **Process isolation**: A crash in one shard process doesn't bring down the entire bot.
- **Incremental scaling**: You can add shards or redistribute them across machines without downtime.

### How sharding works

The sharded entry point (`src/shard.ts`) uses discord.js's built-in `ShardingManager`. It spawns one child process per shard, each running `src/bot.ts` independently. Discord automatically distributes guilds across shards using `(guild_id >> 22) % shardCount`.

Key design properties that make this safe:

- **No shared in-process state**: Each shard process is fully isolated. `config.ts` reads from environment variables inherited from the manager. `RoleReconciliationQueue` is per-process with per-guild serialization — since each guild belongs to exactly one shard, there's no cross-shard contention.
- **Commands are registered once**: Slash commands are registered at the application level via `scripts/register-commands.ts`, not per shard. All shards handle the same set of commands.
- **Shard-aware logging**: Every log line includes the shard ID so you can trace issues to a specific shard.

### Configuration

| Env variable | Default | Description |
|-------------|---------|-------------|
| `SHARD_COUNT` | `"auto"` | Number of shards. `"auto"` fetches the recommended count from Discord's `/gateway/bot` endpoint. |
| `SHARDS` | (all) | Comma-separated shard IDs to run, e.g. `0,1,2`. Use this to split shards across multiple machines. |
| `SHARD_MODE` | `"worker"` | `"worker"` spawns child processes (recommended). `"process"` runs shards in the same process (development only). |

### Multi-machine deployment

To split shards across multiple hosts:

```sh
# Machine A (shards 0-3)
SHARD_COUNT=8 SHARDS=0,1,2,3 tsx src/shard.ts

# Machine B (shards 4-7)
SHARD_COUNT=8 SHARDS=4,5,6,7 tsx src/shard.ts
```

Each machine must have the same `SHARD_COUNT` value. The `SHARDS` list must be non-overlapping across machines.

### Single-process fallback

The single-process entry point (`src/index.ts`) creates one `Client` that handles all guilds directly — no `ShardingManager`, no child processes. This is simpler to debug and perfectly fine for small deployments. If the bot grows past ~1 000 guilds, switch to the sharded entry point.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | Discord application client ID |
| `DISCORD_GUILD_ID` | Yes* | Primary guild ID (used for command registration) |
| `GUILD_PASS_CORE_URL` | Yes | GuildPass Core API base URL |
| `GUILD_PASS_CORE_API_KEY` | No | API key for authenticated Core API requests |
| `DISCORD_ROLE_ADMIN` | No | Discord role ID for GuildPass "admin" role |
| `DISCORD_ROLE_MEMBER` | No | Discord role ID for GuildPass "member" role |
| `DISCORD_ROLE_CONTRIBUTOR` | No | Discord role ID for GuildPass "contributor" role |
| `QUEUE_MAX_CONCURRENCY` | No | Max concurrent reconciliations (default: 5) |
| `MOCK_MODE` | No | Set to `"true"` to force mock mode (no Discord connection) |

\* `DISCORD_GUILD_ID` is used for guild-scoped command registration. In sharded mode the bot handles all guilds it's invited to, but commands are still registered to this primary guild for development convenience.

## Architecture

```
src/
├── index.ts      Single-process entry point
├── shard.ts       ShardingManager entry point
├── bot.ts         Shared Client factory (used by both entry points)
├── config.ts      Environment variable configuration
├── roles.ts       Role resolution and reconciliation logic
├── queue.ts       Rate-limit-aware reconciliation queue
scripts/
└── register-commands.ts   Slash command registration
```

### Data flow (role reconciliation)

```
User runs /refresh-roles
  → Interaction handler in bot.ts
    → integration.getMembershipByDiscordUser()
      → resolveDesiredRoles(membership, roleMap)
        → queue.enqueue(guildId, reconcile)
          → reconcileMemberRoles(member, desiredRoles)
            → member.roles.add() / member.roles.remove()
```

The `RoleReconciliationQueue` ensures:
- At most `QUEUE_MAX_CONCURRENCY` reconciliations run concurrently across all guilds.
- Operations for the same guild are always serialized (no racing add/remove cycles).
- Transient failures (HTTP 429, 5xx) are retried with exponential backoff and jitter.
- Discord 429 responses with `Retry-After` are honored automatically.
