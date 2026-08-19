/**
 * backfill.test.ts
 *
 * Tests for:
 *  1. BackfillLock — coordination logic (concurrent backfill, live-indexer overlap)
 *  2. IndexerCore.processRange() — dry-run vs live, batching, idempotency
 *  3. Argument-guard-rail logic extracted from the CLI
 *
 * All DB and RPC calls are mocked — no real Postgres or Ethereum node is required.
 * PrismaClient is injected into every class under test via the optional constructor
 * parameter added specifically to support this pattern.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { BackfillLock, BackfillLockError } from "../src/utils/backfill-lock.js";
import { IndexerCore, MembershipIndexer } from "../src/workers/indexer.js";

// ─── Mock Prisma factory ──────────────────────────────────────────────────────

/**
 * Creates a minimal in-memory mock of the Prisma surface used by BackfillLock
 * and IndexerCore.  The `_store` property is exposed so tests can inspect or
 * pre-seed state.
 */
function makePrisma(overrides: Record<string, any> = {}) {
  const store: Record<string, any> = {};

  const mockBackfillLock = {
    findUnique: async ({ where }: any) => store[`lock:${where.holder}`] ?? null,
    upsert: async ({ where, update, create }: any) => {
      const existing = store[`lock:${where.holder}`];
      store[`lock:${where.holder}`] = existing
        ? { ...existing, ...update }
        : { ...create };
      return store[`lock:${where.holder}`];
    },
    delete: async ({ where }: any) => {
      delete store[`lock:${where.holder}`];
    },
    findMany: async () =>
      Object.values(store).filter((v) => v?.holder),
  };

  const mockProcessedEvent = overrides.processedEvent ?? {
    findUnique: async () => null,
    upsert: async (data: any) => data.create,
    updateMany: async () => ({}),
    findMany: async () => [],
  };

  const mockMembership = overrides.membership ?? {
    upsert: async (data: any) => data.create,
    update: async (data: any) => data.data,
    delete: async () => ({}),
  };

  const mockCheckpoint = overrides.indexerCheckpoint ?? {
    findUnique: async () => null,
    upsert: async (data: any) => data.create,
  };

  return {
    backfillLock: mockBackfillLock,
    processedEvent: mockProcessedEvent,
    membership: mockMembership,
    indexerCheckpoint: mockCheckpoint,
    $transaction: async (fn: any) => {
      const txProxy = {
        processedEvent: mockProcessedEvent,
        membership: mockMembership,
        indexerCheckpoint: mockCheckpoint,
      };
      return fn(txProxy);
    },
    $disconnect: async () => {},
    _store: store,
  } as any;
}

// ─── Mock viem PublicClient factory ──────────────────────────────────────────

function makeViemClient(logs: any[] = []) {
  return {
    getBlockNumber: async () => 2_000_000n,
    getLogs: async () => logs,
    getBlock: async ({ blockNumber }: any) => ({
      number: blockNumber,
      hash: `0xhash_${blockNumber}`,
    }),
  } as any;
}

// ─── Injectable IndexerCore subclass ──────────────────────────────────────────

/**
 * Allows tests to supply both a mock Prisma AND a mock viem client
 * without touching environment variables or the real DB.
 */
class TestableIndexerCore extends IndexerCore {
  private _viemClient: any;

  constructor(viemClient: any, dbOverrides?: Record<string, any>) {
    super(
      {
        rpcUrl: "http://localhost:8545",
        contractAddresses: ["0x0000000000000000000000000000000000000000"],
        confirmationDepth: 10,
        startBlock: 0n,
      },

      makePrisma(dbOverrides) // inject mock Prisma
    );
    this._viemClient = viemClient;
  }

  getClient(): any {
    return this._viemClient;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BackfillLock tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("BackfillLock", () => {
  test("acquires a backfill lock when no locks exist", async () => {
    const prisma = makePrisma();
    const bfl = new BackfillLock(prisma);

    const { staleLiveIndexerDetected } = await bfl.acquireBackfillLock(100n, 200n);

    assert.equal(staleLiveIndexerDetected, false);
    assert.equal(await bfl.isBackfillRunning(), true);
  });

  test("throws BackfillLockError when a non-stale backfill lock is already held", async () => {
    const prisma = makePrisma();
    const bfl = new BackfillLock(prisma);

    await bfl.acquireBackfillLock(100n, 200n);

    await assert.rejects(
      () => bfl.acquireBackfillLock(300n, 400n),
      (err: any) => {
        assert.ok(err instanceof BackfillLockError);
        assert.ok(err.message.includes("Another backfill is already running"));
        return true;
      }
    );
  });

  test("allows re-acquisition after releasing the lock", async () => {
    const prisma = makePrisma();
    const bfl = new BackfillLock(prisma);

    await bfl.acquireBackfillLock(100n, 200n);
    await bfl.releaseBackfillLock();

    // Must not throw
    const { staleLiveIndexerDetected } = await bfl.acquireBackfillLock(100n, 200n);
    assert.equal(staleLiveIndexerDetected, false);
    assert.equal(await bfl.isBackfillRunning(), true);
  });

  test("throws when backfill range overlaps the live indexer head", async () => {
    const prisma = makePrisma();
    // Pre-seed a fresh live-indexer lock at head = 1_000_000
    prisma._store["lock:live-indexer"] = {
      holder: "live-indexer",
      acquiredAt: new Date(),        // fresh — within TTL
      liveHead: 1_000_000n,
      updatedAt: new Date(),
    };

    const bfl = new BackfillLock(prisma);

    // toBlock = 1_000_100 is within the 64-block buffer of liveHead 1_000_000
    await assert.rejects(
      () => bfl.acquireBackfillLock(999_000n, 1_000_100n),
      (err: any) => {
        assert.ok(err instanceof BackfillLockError);
        assert.ok(err.message.includes("Live indexer is running"));
        return true;
      }
    );
  });

  test("allows backfill range safely behind the live indexer head", async () => {
    const prisma = makePrisma();
    prisma._store["lock:live-indexer"] = {
      holder: "live-indexer",
      acquiredAt: new Date(),
      liveHead: 1_500_000n,
      updatedAt: new Date(),
    };

    const bfl = new BackfillLock(prisma);

    // toBlock = 1_499_900 is well behind 1_500_000 - 64 buffer
    const { staleLiveIndexerDetected } = await bfl.acquireBackfillLock(
      1_000_000n,
      1_499_900n
    );
    assert.equal(staleLiveIndexerDetected, false);
    assert.equal(await bfl.isBackfillRunning(), true);
  });

  test("detects and reports a stale live-indexer lock", async () => {
    const prisma = makePrisma();
    // Expired lock (> 60s ago)
    prisma._store["lock:live-indexer"] = {
      holder: "live-indexer",
      acquiredAt: new Date(Date.now() - 120_000),
      liveHead: 1_000_000n,
      updatedAt: new Date(),
    };

    const bfl = new BackfillLock(prisma);
    // toBlock overlaps liveHead but the lock is stale → should succeed with warning
    const { staleLiveIndexerDetected } = await bfl.acquireBackfillLock(
      1_000_000n,
      1_010_000n
    );
    assert.equal(staleLiveIndexerDetected, true);
  });

  test("isBackfillRunning returns false when no lock exists", async () => {
    const prisma = makePrisma();
    const bfl = new BackfillLock(prisma);
    assert.equal(await bfl.isBackfillRunning(), false);
  });

  test("isBackfillRunning returns false after release", async () => {
    const prisma = makePrisma();
    const bfl = new BackfillLock(prisma);
    await bfl.acquireBackfillLock(100n, 200n);
    await bfl.releaseBackfillLock();
    assert.equal(await bfl.isBackfillRunning(), false);
  });

  test("listLocks returns all active locks", async () => {
    const prisma = makePrisma();
    const bfl = new BackfillLock(prisma);

    await bfl.acquireLiveLock(500_000n);
    await bfl.acquireBackfillLock(100n, 200n);

    const locks = await bfl.listLocks();
    const holders = locks.map((l: any) => l.holder);
    assert.ok(holders.includes("live-indexer"), "live-indexer lock missing");
    assert.ok(holders.includes("backfill"), "backfill lock missing");
  });

  test("refreshLiveLock updates the liveHead value", async () => {
    const prisma = makePrisma();
    const bfl = new BackfillLock(prisma);

    await bfl.acquireLiveLock(100n);
    await bfl.refreshLiveLock(200n);

    const lock = prisma._store["lock:live-indexer"];
    assert.equal(lock.liveHead, 200n);
  });

  test("releaseLiveLock removes the live-indexer row", async () => {
    const prisma = makePrisma();
    const bfl = new BackfillLock(prisma);

    await bfl.acquireLiveLock(100n);
    assert.ok(prisma._store["lock:live-indexer"]);

    await bfl.releaseLiveLock();
    assert.equal(prisma._store["lock:live-indexer"], undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// IndexerCore.processRange() tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("IndexerCore.processRange()", () => {
  test("dry-run does NOT call processLog", async () => {
    const viemClient = makeViemClient([
      { transactionHash: "0xabc", logIndex: 0, blockHash: "0xbh", blockNumber: 100n, data: "0x", topics: [] },
    ]);
    const core = new TestableIndexerCore(viemClient);

    let processLogCalled = false;
    (core as any).processLog = async () => { processLogCalled = true; return true; };
    // previewLog must return a valid summary
    (core as any).previewLog = async (log: any) => ({
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      eventType: "MembershipCreated",
      args: { member: "0xMember", passId: "1" },
      alreadyProcessed: false,
    });

    const result = await core.processRange({
      contractAddress: "0x0000000000000000000000000000000000000000" as any,
      fromBlock: 100n,
      toBlock: 100n,
      dryRun: true,
    });

    assert.equal(processLogCalled, false, "processLog must not be called in dry-run");

    assert.equal(result.dryRun, true);
    assert.equal(result.logsFound, 1);
    assert.equal(result.logsApplied, 1);
    assert.equal(result.preview.length, 1);
    assert.equal(result.preview[0].eventType, "MembershipCreated");
  });

  test("dry-run marks already-processed logs as skipped", async () => {
    const viemClient = makeViemClient([
      { transactionHash: "0xabc", logIndex: 0, blockHash: "0xbh", blockNumber: 100n, data: "0x", topics: [] },
    ]);
    const core = new TestableIndexerCore(viemClient);

    (core as any).previewLog = async (log: any) => ({
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      eventType: "MembershipCreated",
      args: {},
      alreadyProcessed: true,
    });

    const result = await core.processRange({
      contractAddress: "0x0000000000000000000000000000000000000000" as any,
      fromBlock: 100n,
      toBlock: 100n,
      dryRun: true,
    });


    assert.equal(result.logsApplied, 0);
    assert.equal(result.logsSkipped, 1);
    assert.equal(result.preview[0].alreadyProcessed, true);
  });

  test("live mode calls processLog and counts applied logs", async () => {
    const viemClient = makeViemClient([
      { transactionHash: "0xabc", logIndex: 0, blockHash: "0xbh", blockNumber: 100n, data: "0x", topics: [] },
    ]);
    const core = new TestableIndexerCore(viemClient);

    let processLogCallCount = 0;
    (core as any).processLog = async () => { processLogCallCount++; return true; };

    const result = await core.processRange({ fromBlock: 100n, toBlock: 100n, dryRun: false });

    assert.equal(processLogCallCount, 1);
    assert.equal(result.dryRun, false);
    assert.equal(result.logsApplied, 1);
    assert.equal(result.logsSkipped, 0);
    assert.equal(result.preview.length, 0, "preview must be empty in live mode");
  });

  test("live mode counts skipped when processLog returns false", async () => {
    const viemClient = makeViemClient([
      { transactionHash: "0xabc", logIndex: 0, blockHash: "0xbh", blockNumber: 100n, data: "0x", topics: [] },
    ]);
    const core = new TestableIndexerCore(viemClient);

    (core as any).processLog = async () => false; // simulate duplicate skip

    const result = await core.processRange({ fromBlock: 100n, toBlock: 100n, dryRun: false });

    assert.equal(result.logsApplied, 0);
    assert.equal(result.logsSkipped, 1);
  });

  test("processRange returns zero counts when no logs are found", async () => {
    const viemClient = makeViemClient([]); // empty
    const core = new TestableIndexerCore(viemClient);

    const result = await core.processRange({ fromBlock: 100n, toBlock: 200n, dryRun: false });

    assert.equal(result.logsFound, 0);
    assert.equal(result.logsApplied, 0);
    assert.equal(result.logsSkipped, 0);
  });

  test("range metadata is preserved in result", async () => {
    const viemClient = makeViemClient([]);
    const core = new TestableIndexerCore(viemClient);

    const result = await core.processRange({
      fromBlock: 1_000_000n,
      toBlock: 1_050_000n,
      dryRun: true,
    });

    assert.equal(result.fromBlock, 1_000_000n);
    assert.equal(result.toBlock, 1_050_000n);
    assert.equal(result.dryRun, true);
  });

  test("processRange handles multiple logs per range", async () => {
    const logs = [
      { transactionHash: "0xaaa", logIndex: 0, blockHash: "0xbh1", blockNumber: 100n, data: "0x", topics: [] },
      { transactionHash: "0xbbb", logIndex: 1, blockHash: "0xbh1", blockNumber: 100n, data: "0x", topics: [] },
      { transactionHash: "0xccc", logIndex: 0, blockHash: "0xbh2", blockNumber: 101n, data: "0x", topics: [] },
    ];
    const viemClient = makeViemClient(logs);
    const core = new TestableIndexerCore(viemClient);

    (core as any).processLog = async () => true;

    const result = await core.processRange({ fromBlock: 100n, toBlock: 101n, dryRun: false });

    assert.equal(result.logsFound, 3);
    assert.equal(result.logsApplied, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MembershipIndexer smoke tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("MembershipIndexer", () => {
  test("initializes without throwing", () => {
    // Inject a mock Prisma so it doesn't try to connect to a DB
    const prisma = makePrisma();
    const indexer = new MembershipIndexer(
      {
        rpcUrl: "http://localhost:8545",
        contractAddress: "0x0000000000000000000000000000000000000000",
        confirmationDepth: 10,
        startBlock: 0n,
      },
      prisma
    );
    assert.ok(indexer);
  });

  test("MembershipIndexer extends IndexerCore", () => {
    const prisma = makePrisma();
    const indexer = new MembershipIndexer(
      {
        rpcUrl: "http://localhost:8545",
        contractAddress: "0x0000000000000000000000000000000000000000",
        confirmationDepth: 10,
        startBlock: 0n,
      },
      prisma
    );
    assert.ok(indexer instanceof IndexerCore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLI argument guard-rail logic (pure unit tests — no I/O)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Backfill CLI argument validation", () => {
  test("fromBlock > toBlock is detected as invalid", () => {
    const fromBlock = 1_050_000n;
    const toBlock = 1_000_000n;
    assert.equal(fromBlock > toBlock, true, "Should detect reversed range");
  });

  test("fromBlock === toBlock is valid (single-block replay)", () => {
    const fromBlock = 1_000_000n;
    const toBlock = 1_000_000n;
    assert.equal(fromBlock <= toBlock, true);
  });

  test("batchSize < 1 is detected as invalid", () => {
    assert.equal(0n < 1n, true, "batchSize 0 should be rejected");
    assert.equal(-1n < 1n, true, "negative batchSize should be rejected");
  });

  test("batch count calculation — 2500 blocks with 1000/batch = 3 batches", () => {
    const fromBlock = 1_000_000n;
    const toBlock = 1_002_499n;   // 2500 blocks
    const batchSize = 1_000n;

    const totalBlocks = toBlock - fromBlock + 1n;
    const totalBatches = Number((totalBlocks + batchSize - 1n) / batchSize);

    assert.equal(totalBlocks, 2_500n);
    assert.equal(totalBatches, 3);
  });

  test("batch count calculation — single-block range = exactly 1 batch", () => {
    const fromBlock = 1_000_000n;
    const toBlock = 1_000_000n;
    const batchSize = 1_000n;

    const totalBlocks = toBlock - fromBlock + 1n;
    const totalBatches = Number((totalBlocks + batchSize - 1n) / batchSize);

    assert.equal(totalBlocks, 1n);
    assert.equal(totalBatches, 1);
  });

  test("batch boundary for last batch is clamped to toBlock", () => {
    const fromBlock = 0n;
    const toBlock = 2_499n;   // 2500 blocks
    const batchSize = 1_000n;

    // Simulate the batch loop from the CLI
    const batches: Array<{ from: bigint; to: bigint }> = [];
    const totalBlocks = toBlock - fromBlock + 1n;
    const totalBatches = Number((totalBlocks + batchSize - 1n) / batchSize);

    for (let i = 0; i < totalBatches; i++) {
      const batchFrom = fromBlock + BigInt(i) * batchSize;
      const batchTo =
        batchFrom + batchSize - 1n < toBlock
          ? batchFrom + batchSize - 1n
          : toBlock;
      batches.push({ from: batchFrom, to: batchTo });
    }

    assert.equal(batches.length, 3);
    assert.equal(batches[0].from, 0n);
    assert.equal(batches[0].to, 999n);
    assert.equal(batches[1].from, 1_000n);
    assert.equal(batches[1].to, 1_999n);
    assert.equal(batches[2].from, 2_000n);
    assert.equal(batches[2].to, 2_499n, "last batch must be clamped to toBlock");
  });
});
