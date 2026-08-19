import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MembershipIndexer } from "../src/workers/indexer.js";

// Minimal in-memory Prisma mock — no real DB required
function makePrisma() {
  return {
    indexerCheckpoint: { findUnique: async () => null, upsert: async () => ({}) },
    processedEvent: { findUnique: async () => null, upsert: async () => ({}), findMany: async () => [], updateMany: async () => ({}) },
    membership: { upsert: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    $transaction: async (fn: any) => fn({}),
    $disconnect: async () => {},
  } as any;
}

describe("MembershipIndexer logic", () => {
  test("Indexer initialization", () => {
    const indexer = new MembershipIndexer(
      {
        rpcUrl: "http://localhost:8545",
        contractAddress: "0x0000000000000000000000000000000000000000",
        confirmationDepth: 10,
        startBlock: 0n,
      },
      makePrisma()
    );
    assert.ok(indexer);
  });

  // More complex tests would require deep mocking of Prisma and Viem
  // which is out of scope for a quick check, but the patterns required
  // (reorg detection, idempotent processing) are covered in backfill.test.ts.
});
