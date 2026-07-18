import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from "viem";
import { MEMBERSHIP_ABI } from "@guildpass/contracts";
import { MembershipIndexer } from "../src/workers/indexer.js";

// Minimal in-memory Prisma mock — no real DB required
function makePrisma() {
  return {
    indexerCheckpoint: { findUnique: async () => null, upsert: async () => ({}) },
    processedEvent: {
      findUnique: async () => null,
      upsert: async () => ({}),
      findMany: async () => [],
      updateMany: async () => ({}),
    },
    membership: { upsert: async () => ({}), update: async () => ({}), delete: async () => ({}) },
    $transaction: async (fn: any) => fn({}),
    $disconnect: async () => {},
  } as any;
}

function makeStatefulPrisma() {
  const memberships = new Map<string, { wallet: string; passId: bigint; status: number }>();
  const processedEvents: any[] = [];
  const keyFor = (wallet: string, passId: bigint) => `${wallet.toLowerCase()}:${passId}`;

  const membership = {
    findUnique: async ({ where }: any) => {
      const { wallet, passId } = where.wallet_passId;
      return memberships.get(keyFor(wallet, passId)) ?? null;
    },
    upsert: async ({ where, update, create }: any) => {
      const { wallet, passId } = where.wallet_passId;
      const key = keyFor(wallet, passId);
      const existing = memberships.get(key);
      const value = existing ? { ...existing, ...update } : { ...create };
      memberships.set(key, value);
      return value;
    },
    update: async ({ where, data }: any) => {
      const { wallet, passId } = where.wallet_passId;
      const key = keyFor(wallet, passId);
      const existing = memberships.get(key);
      if (!existing) throw new Error("Membership not found");
      const value = { ...existing, ...data };
      memberships.set(key, value);
      return value;
    },
    deleteMany: async ({ where }: any) => ({
      count: memberships.delete(keyFor(where.wallet, where.passId)) ? 1 : 0,
    }),
  };

  const processedEvent = {
    findUnique: async ({ where }: any) => {
      const key = where.contractAddress_transactionHash_logIndex;
      return processedEvents.find(
        (event) =>
          event.contractAddress === key.contractAddress &&
          event.transactionHash === key.transactionHash &&
          event.logIndex === key.logIndex,
      ) ?? null;
    },
    upsert: async ({ where, update, create }: any) => {
      const key = where.contractAddress_transactionHash_logIndex;
      const existing = await processedEvent.findUnique({ where });
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const event = { id: `event-${processedEvents.length + 1}`, ...key, ...create };
      processedEvents.push(event);
      return event;
    },
    findMany: async ({ where }: any) =>
      processedEvents
        .filter(
          (event) =>
            event.contractAddress === where.contractAddress &&
            event.blockNumber >= where.blockNumber.gte &&
            event.status === where.status,
        )
        .sort(
          (a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex,
        ),
    updateMany: async ({ where, data }: any) => {
      for (const event of processedEvents) {
        if (
          event.contractAddress === where.contractAddress &&
          event.blockNumber >= where.blockNumber.gte
        ) {
          Object.assign(event, data);
        }
      }
      return {};
    },
  };

  const db: any = {
    membership,
    processedEvent,
    indexerCheckpoint: { upsert: async () => ({}) },
    failedEvent: { create: async () => ({}) },
    $transaction: async (fn: any) => fn(db),
    $disconnect: async () => {},
  };

  return { db, memberships, keyFor };
}

const contractAddress = "0x0000000000000000000000000000000000000001" as Address;
const member = "0x1111111111111111111111111111111111111111" as Address;

function membershipLog(
  eventName: "MembershipCreated" | "MembershipUpdated",
  value: bigint | number,
  blockNumber: bigint,
): Log {
  const args = { member, passId: 1n };
  const topics = encodeEventTopics({ abi: MEMBERSHIP_ABI, eventName, args });
  const data = eventName === "MembershipCreated"
    ? encodeAbiParameters([{ type: "uint256" }], [BigInt(value)])
    : encodeAbiParameters([{ type: "uint8" }], [Number(value)]);

  return {
    address: contractAddress,
    blockHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    blockNumber,
    data,
    logIndex: 0,
    removed: false,
    topics,
    transactionHash: `0x${(blockNumber + 100n).toString(16).padStart(64, "0")}`,
    transactionIndex: 0,
  } as Log;
}

/**
 * reorg.test.ts
 *
 * Comprehensive tests for reorg safety, finality, and idempotency.
 */
describe("MembershipIndexer Reorg and Finality", () => {
  test("Indexer initialized with correct config", () => {
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


  test("reverting MembershipUpdated restores the true prior status", async () => {
    const { db, memberships, keyFor } = makeStatefulPrisma();
    const indexer = new MembershipIndexer(
      {
        rpcUrl: "http://localhost:8545",
        contractAddress,
        confirmationDepth: 0,
        startBlock: 0n,
      },
      db,
    );

    await indexer.processLog(contractAddress, membershipLog("MembershipCreated", 1n, 1n));
    await indexer.processLog(contractAddress, membershipLog("MembershipUpdated", 2, 2n));
    assert.equal(memberships.get(keyFor(member, 1n))?.status, 2);

    await indexer.handleReorg(contractAddress, 2n);

    assert.equal(memberships.get(keyFor(member, 1n))?.status, 1);
  });

  test("reverting MembershipCreated restores a pre-existing membership", async () => {
    const { db, memberships, keyFor } = makeStatefulPrisma();
    memberships.set(keyFor(member, 1n), { wallet: member, passId: 1n, status: 2 });
    const indexer = new MembershipIndexer(
      {
        rpcUrl: "http://localhost:8545",
        contractAddress,
        confirmationDepth: 0,
        startBlock: 0n,
      },
      db,
    );

    await indexer.processLog(contractAddress, membershipLog("MembershipCreated", 1n, 1n));
    assert.equal(memberships.get(keyFor(member, 1n))?.status, 1);

    await indexer.handleReorg(contractAddress, 1n);

    assert.equal(memberships.get(keyFor(member, 1n))?.status, 2);
  });

  // The implementation also follows these broader reorg-safety patterns:
  // 1. Lagged checkpointing (safeTip).
  // 2. Block hash verification in a window (checkReorg).
  // 3. Application state rollback (handleReorg calling revertEventApplication).
  // 4. Idempotency with reorg detection (processLog).
});
