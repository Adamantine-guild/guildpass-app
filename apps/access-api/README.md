# GuildPass Access API

The Access API contains the on-chain event indexer for GuildPass membership state.  It listens to `MembershipCreated` and `MembershipUpdated` events emitted by the membership smart contract and persists them to PostgreSQL.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Environment Setup](#environment-setup)
3. [Running the Indexer](#running-the-indexer)
4. [Database Schema](#database-schema)
5. [Backfill / Replay Runbook](#backfill--replay-runbook)
6. [Development & Testing](#development--testing)

---

## Architecture Overview

```
MembershipIndexer (live, continuous)
  └─ IndexerCore
       ├─ processRange(fromBlock, toBlock, dryRun?)
       ├─ processLog(log)          — idempotent upsert
       ├─ applyEventApplication()  — writes Membership rows
       └─ handleReorg()            — rolls back past a detected reorg

BackfillLock (shared DB table)
  ├─ holder = "live-indexer"  — refreshed every 20s by the poll loop
  └─ holder = "backfill"      — acquired by the CLI before any writes
```

The **live indexer** runs as a continuous process managed via `src/index.ts`.  It advances `IndexerCheckpoint` and refreshes its `BackfillLock` row so the backfill CLI can detect it is running.

The **backfill CLI** (`scripts/backfill.ts`) is a one-shot command that replays a historical block range through the same event pipeline, then exits.  It never touches `IndexerCheckpoint`.

---

## Environment Setup

Copy `.env.example` from the repo root and populate the following variables for the Access API:

```env
# PostgreSQL connection string
DATABASE_URL=postgresql://user:password@localhost:5432/guildpass

# EVM RPC endpoint (Ethereum mainnet)
RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY

# Address of the GuildPass membership contract
MEMBERSHIP_CONTRACT_ADDRESS=0xYourContractAddress

# Number of blocks to wait before treating a block as final (default: 10)
INDEXER_CONFIRMATION_DEPTH=10

# Block to start indexing from on a fresh database (default: 0)
INDEXER_START_BLOCK=18000000
```

Run the database migration and generate the Prisma client:

```bash
pnpm prisma:migrate    # creates / migrates tables
pnpm prisma:generate   # re-generates the typed client
```

---

## Running the Indexer

```bash
# Development (hot-reload)
pnpm dev

# Production
pnpm build && pnpm start
```

The indexer polls every 10 seconds.  Logs are written to stdout.

---

## Database Schema

| Table              | Purpose                                                    |
|--------------------|------------------------------------------------------------|
| `ProcessedEvent`   | Canonical record of every indexed log (idempotency guard). |
| `Membership`       | Current membership status per `(wallet, passId)`.         |
| `IndexerCheckpoint`| Single-row cursor: the last block fully processed.         |
| `BackfillLock`     | Advisory lock coordinating the live indexer and backfill.  |

---

## Backfill / Replay Runbook

Use the backfill CLI whenever you need to **replay a specific historical block range** — for example after fixing a bug that caused incorrect membership state for a past period.

### When to use it

- You deployed a bug fix and need to re-apply events for blocks `A–B`.
- You discovered a data-loss window (e.g. the indexer was down) and want to fill the gap.
- You want to verify a proposed logic change against a historical range before deploying (`--dry-run`).

### When **not** to use it

- To re-index everything from scratch — just wipe `IndexerCheckpoint` and restart the live indexer.
- In place of the live indexer — the backfill CLI is one-shot and does not advance the checkpoint.

---

### Quick reference

```bash
# Dry-run: see what would change without writing
pnpm backfill --from-block 1000000 --to-block 1050000 --dry-run

# Live backfill (prompts for confirmation)
pnpm backfill --from-block 1000000 --to-block 1050000

# Live backfill, skip confirmation (CI / scripts)
pnpm backfill --from-block 1000000 --to-block 1050000 --yes

# Custom batch size (default 1000 blocks per RPC call)
pnpm backfill --from-block 1000000 --to-block 1050000 --batch-size 500

# Show help
pnpm backfill --help
```

---

### Step-by-step safe-backfill procedure

#### Step 1 — Identify the block range

Determine the exact block range affected by the bug.  Use a block explorer or your RPC provider to find the block numbers corresponding to the relevant timestamps.

```bash
# Example: find the block for a given timestamp via cast (foundry)
cast block-number --rpc-url $RPC_URL   # current head
```

#### Step 2 — Run a dry-run first (always)

```bash
pnpm backfill \
  --from-block <FIRST_AFFECTED_BLOCK> \
  --to-block   <LAST_AFFECTED_BLOCK> \
  --dry-run
```

Review the preview output.  Each line is tagged `[APPLY]` (would be written) or `[SKIP]` (already up-to-date).  Verify the event types and member addresses look correct before proceeding.

#### Step 3 — Coordinate with the live indexer

The backfill CLI enforces the following safety rules automatically:

| Scenario | Result |
|---|---|
| Another backfill is already running | **Error** — exit code 2 |
| Live indexer running, range overlaps its current head | **Error** — exit code 2 |
| Live indexer running, range safely behind its head (> 64 blocks) | **Allowed** |
| Live indexer lock is stale (heartbeat > 60 s old) | **Allowed** with a warning |

If the CLI blocks because the range is too close to the live head, you have two options:

**Option A — Wait.**  The live indexer will advance its head automatically.  Retry after it has processed past `toBlock + 64`.

**Option B — Stop the live indexer first.**  This is the safest approach for large backfills.

```bash
# Stop the live indexer (adjust for your process manager)
systemctl stop guildpass-indexer    # systemd
# or
pm2 stop guildpass-indexer          # pm2
# or simply Ctrl-C the dev process
```

The live indexer lock expires after **60 seconds** of inactivity.  Once it expires the backfill CLI will proceed automatically.

#### Step 4 — Run the backfill

```bash
pnpm backfill \
  --from-block <FIRST_AFFECTED_BLOCK> \
  --to-block   <LAST_AFFECTED_BLOCK>
```

The CLI will:
1. Acquire the `BackfillLock`.
2. Process the range in batches (default: 1000 blocks per batch).
3. Print a per-batch progress line and a final summary.
4. Release the lock on exit (including on Ctrl-C or error).

Example output:
```
╔══════════════════════════════════════════════════════════╗
║          GuildPass  Backfill / Replay CLI                ║
╚══════════════════════════════════════════════════════════╝
  Mode        : LIVE (writes to DB)
  Range       : blocks 1,000,000 → 1,050,000
  Total blocks: 50,001
  Batch size  : 1,000 blocks/call
  Contract    : 0xYour…
  RPC         : https://mainnet.infura.io/…

⚠  This will write membership state to the database for 50,001 blocks.
  Proceed? [y/N] y

Acquiring backfill lock…
  ✓ Lock acquired.

Processing range 1,000,000 → 1,050,000 …

  [ 1/51] blocks 1,000,000-1,000,999 | found=0 applied=0 skipped=0 | 2%
  [ 2/51] blocks 1,001,000-1,001,999 | found=3 applied=3 skipped=0 | 4%
  …
  [51/51] blocks 1,050,000-1,050,000 | found=0 applied=0 skipped=0 | 100%

── Summary ──────────────────────────────────────────────────
  Logs found  : 47
  Logs applied: 45
  Logs skipped: 2 (already up-to-date)
  Elapsed     : 43.2s

  ✓ Backfill complete.
```

#### Step 5 — Verify results

After the backfill completes, cross-check a sample of membership records:

```bash
# Via psql (adjust connection details)
psql $DATABASE_URL -c \
  "SELECT wallet, \"passId\", status, \"updatedAt\"
   FROM \"Membership\"
   WHERE \"updatedAt\" > now() - interval '1 hour'
   ORDER BY \"updatedAt\" DESC
   LIMIT 20;"
```

Compare against on-chain state using your RPC or a block explorer.

#### Step 6 — Restart the live indexer

```bash
systemctl start guildpass-indexer
# or
pm2 start guildpass-indexer
```

The live indexer picks up from `IndexerCheckpoint.lastBlock + 1` and continues normally.  It does **not** re-process the blocks that were backfilled, because each log is deduplicated via the `ProcessedEvent` table.

---

### Locking internals

The `BackfillLock` table contains at most two rows:

| `holder`        | Purpose                                              |
|-----------------|------------------------------------------------------|
| `live-indexer`  | Set by the live indexer on start; refreshed every 20 s |
| `backfill`      | Set by the backfill CLI; released on exit             |

A lock is considered **stale** if its `acquiredAt` timestamp is older than **60 seconds**.

The backfill CLI uses a conservative **64-block buffer** when checking live-indexer overlap to avoid races near the current chain head.

---

### Error codes

| Exit code | Meaning                                                  |
|-----------|----------------------------------------------------------|
| `0`       | Success (or dry-run complete)                            |
| `1`       | Unexpected error (see stderr for details)                |
| `2`       | Lock acquisition failure — another process is running    |

---

### Frequently asked questions

**Q: Can I run the backfill while the live indexer is running?**

Yes, if your `toBlock` is at least 64 blocks behind the live indexer's current head.  The CLI enforces this automatically.  For ranges close to the live head, stop the indexer first.

**Q: What if the backfill crashes halfway?**

The `BackfillLock` has a 60-second TTL.  After it expires you can safely re-run the CLI.  Because `ProcessedEvent` upserts are idempotent, already-processed logs are skipped automatically — no double-counting.

**Q: Will the backfill overwrite membership state that the live indexer has since updated?**

Only if an event in the backfill range has a newer counterpart.  Events are applied in chronological order; a `MembershipUpdated` event from block 1,000,100 will overwrite the state set by a `MembershipCreated` from block 1,000,050, regardless of which run wrote it first — matching the behaviour of the live indexer.

**Q: How do I backfill a very large range (millions of blocks)?**

Use `--batch-size` to tune the batch size for your RPC provider's `getLogs` limits.  Most providers cap at 2000 blocks or 10,000 results per call; the default of 1000 is conservative and safe.

```bash
pnpm backfill --from-block 0 --to-block 18000000 --batch-size 2000 --yes
```

---

## Development & Testing

```bash
# Run all tests (no DB or RPC required — fully mocked)
pnpm test

# Type-check without emitting
pnpm typecheck

# Generate Prisma client after schema changes
pnpm prisma:generate
```

Tests are in `test/` and use Node's built-in test runner (`node:test`) with a mock Prisma client injected via the optional second constructor parameter on `IndexerCore` and `MembershipIndexer`.
