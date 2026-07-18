import {
  createPublicClient,
  http,
  decodeEventLog,
  type Address,
  type PublicClient,
  type Log,
} from "viem";
import { mainnet } from "viem/chains";
import { PrismaClient } from "@prisma/client";
import { MEMBERSHIP_ABI, MEMBERSHIP_EVENTS } from "@guildpass/contracts";

export interface IndexerConfig {
  rpcUrl: string;
  contractAddresses?: Address[];
  contractAddress?: Address; // Added to support single-address test configurations
  confirmationDepth: number;
  startBlock: bigint;
}

// ─── Types shared between the live indexer and the backfill CLI ───────────────

/** Lightweight summary of one applied event, used by dry-run mode. */
export interface ProcessedLogSummary {
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  eventType: string;
  args: Record<string, unknown>;
  /** Whether the record already exists (idempotent re-application). */
  alreadyProcessed: boolean;
}

/** Options passed to the shared processRange() method. */
export interface ProcessRangeOptions {
  contractAddress?: Address; // Changed from required to optional
  fromBlock: bigint;
  toBlock: bigint;
  dryRun?: boolean;
}

/** Result returned by processRange(). */
export interface ProcessRangeResult {
  fromBlock: bigint;
  toBlock: bigint;
  logsFound: number;
  logsApplied: number;
  logsSkipped: number;
  dryRun: boolean;
  /** Populated only in dry-run mode – one entry per log that would be applied. */
  preview: ProcessedLogSummary[];
}

// ─── Core: reusable processing engine ─────────────────────────────────────────

/**
 * IndexerCore owns the stateless event-processing logic so it can be called
 * by both the continuous live indexer (poll loop) and the one-shot backfill CLI.
 */
export class IndexerCore {
  private client: PublicClient;
  protected config: IndexerConfig;
  protected db: PrismaClient;

  constructor(config: IndexerConfig, db?: PrismaClient) {
    this.config = config;
    this.db = db ?? new PrismaClient();
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(config.rpcUrl),
    });
  }

  getClient(): PublicClient {
    return this.client;
  }

  /**
   * Fetch and process (or preview) all logs for one contract in [fromBlock, toBlock].
   */
  async processRange(opts: ProcessRangeOptions): Promise<ProcessRangeResult> {
    const { 
      contractAddress = this.config.contractAddress || this.config.contractAddresses?.[0], 
      fromBlock, 
      toBlock, 
      dryRun = false 
    } = opts;

    if (!contractAddress) {
      throw new Error("No contract address provided for processRange");
    }

    const logs = await this.getClient().getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
    });

    const result: ProcessRangeResult = {
      fromBlock,
      toBlock,
      logsFound: logs.length,
      logsApplied: 0,
      logsSkipped: 0,
      dryRun,
      preview: [],
    };

    for (const log of logs) {
      if (dryRun) {
        const summary = await this.previewLog(contractAddress, log);
        if (summary) {
          result.preview.push(summary);
          if (!summary.alreadyProcessed) result.logsApplied++;
          else result.logsSkipped++;
        }
      } else {
        const applied = await this.processLog(contractAddress, log);
        if (applied) result.logsApplied++;
        else result.logsSkipped++;
      }
    }

    return result;
  }

  private async previewLog(
    contractAddress: Address,
    log: Log,
  ): Promise<ProcessedLogSummary | null> {
    const { transactionHash, logIndex, blockHash, blockNumber } = log;
    if (!transactionHash || logIndex === null || !blockHash || blockNumber === null) return null;

    try {
      const decoded = decodeEventLog({
        abi: MEMBERSHIP_ABI,
        data: log.data,
        topics: log.topics,
      });

      const existing = await this.db.processedEvent.findUnique({
        where: {
          contractAddress_transactionHash_logIndex: {
            contractAddress,
            transactionHash,
            logIndex,
          },
        },
      });
      const alreadyProcessed =
        existing?.status === "processed" && existing.blockHash === blockHash;

      return {
        transactionHash,
        logIndex,
        blockNumber,
        blockHash,
        eventType: decoded.eventName,
        args: decoded.args as Record<string, unknown>,
        alreadyProcessed,
      };
    } catch {
      return null;
    }
  }

  public async processLog(contractAddress: Address, log: Log): Promise<boolean> {
    const { transactionHash, logIndex, blockHash, blockNumber } = log;
    if (!transactionHash || logIndex === null || !blockHash || blockNumber === null) return false;

    const existing = await this.db.processedEvent.findUnique({
      where: {
        contractAddress_transactionHash_logIndex: {
          contractAddress,
          transactionHash,
          logIndex,
        },
      },
    });

    if (existing) {
      if (existing.status === "processed" && existing.blockHash === blockHash) {
        console.log(`Skipping duplicate log: ${transactionHash}-${logIndex}`);
        return false;
      }

      if (existing.blockHash !== blockHash) {
        console.warn(`Reorg detected via log mismatch at ${transactionHash}`);
        await this.handleReorg(contractAddress, blockNumber);
        throw new Error("REORG_DETECTED");
      }
    }

    let decoded: any = null;

    try {
      decoded = decodeEventLog({
        abi: MEMBERSHIP_ABI,
        data: log.data,
        topics: log.topics,
      });

      await this.db.$transaction(async (tx) => {
        const previousState = await this.applyEventApplication(decoded, tx);

        await tx.processedEvent.upsert({
          where: {
            contractAddress_transactionHash_logIndex: {
              contractAddress,
              transactionHash,
              logIndex,
            },
          },
          update: {
            contractAddress,
            blockHash,
            blockNumber,
            status: "processed",
            eventType: decoded.eventName,
            data: decoded.args as any,
            previousState,
          },
          create: {
            contractAddress,
            blockHash,
            blockNumber,
            transactionHash,
            logIndex,
            status: "processed",
            eventType: decoded.eventName,
            data: decoded.args as any,
            previousState,
          },
        });
      });

      return true;
    } catch (err) {
      if ((err as Error).message === "REORG_DETECTED") throw err;
      
      console.error(`Failed to process log ${transactionHash}-${logIndex}:`, err);

      const errorMessage = (err as Error).message || String(err);

      // Persist durable dead-letter status in the FailedEvent queue table
      try {
        await this.db.failedEvent.create({
          data: {
            contractAddress,
            blockHash,
            blockNumber,
            transactionHash,
            logIndex,
            eventType: decoded?.eventName || "Unknown",
            error: errorMessage,
            data: {
              ...(decoded ? decoded.args : { rawData: log.data, rawTopics: log.topics }),
            } as any,
          },
        });
      } catch (dbWriteErr) {
        console.error("Critical: Failed to save the dead letter log to the database:", dbWriteErr);
      }

      // CHECKPOINT ADVANCEMENT APPROACH (Option A):
      // Stalling advancement avoids moving checkpoints past blocks containing failed logs. 
      // Throwing immediately aborts processRange and poll(), preventing checkpoint updates.
      throw new Error(`INDEXER_STALL: Failing block ${blockNumber} due to log processing error: ${errorMessage}`);
    }
  }

  private async applyEventApplication(decoded: any, tx: any) {
    const { eventName, args } = decoded;

    const membership = await tx.membership.findUnique({
      where: { wallet_passId: { wallet: args.member, passId: args.passId } },
      select: { status: true },
    });
    const previousState = {
      membership: membership ? { status: membership.status } : null,
    };

    if (eventName === MEMBERSHIP_EVENTS.MembershipCreated) {
      await tx.membership.upsert({
        where: { wallet_passId: { wallet: args.member, passId: args.passId } },
        update: { status: 1 },
        create: { wallet: args.member, passId: args.passId, status: 1 },
      });
    } else if (eventName === MEMBERSHIP_EVENTS.MembershipUpdated) {
      await tx.membership.update({
        where: { wallet_passId: { wallet: args.member, passId: args.passId } },
        data: { status: args.newStatus },
      });
    }

    return previousState;
  }

  private async revertEventApplication(event: any, tx: any) {
    const data = event.data as any;
    const previousState = event.previousState as {
      membership: { status: number } | null;
    } | null;

    if (!previousState || !("membership" in previousState)) {
      throw new Error(`Processed event ${event.id} is missing rollback state`);
    }

    const membershipKey = {
      wallet_passId: { wallet: data.member, passId: BigInt(data.passId) },
    };

    if (previousState.membership === null) {
      // The applied event created this row, so rollback removes it.
      await tx.membership.deleteMany({
        where: membershipKey.wallet_passId,
      });
    } else {
      // Restore the exact status captured immediately before the event was applied.
      await tx.membership.update({
        where: membershipKey,
        data: { status: previousState.membership.status },
      });
    }
  }

  /** Revert all processed logs for one contract at/after reorgBlockNumber. */
  async handleReorg(contractAddress: Address, reorgBlockNumber: bigint) {
    const safeBlock = reorgBlockNumber - 1n;
    console.log(`[${contractAddress}] Rolling back to safe block ${safeBlock}`);

    const eventsToRevert = await this.db.processedEvent.findMany({
      where: {
        contractAddress,
        blockNumber: { gte: reorgBlockNumber },
        status: "processed",
      },
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
    });

    await this.db.$transaction(async (tx: any) => {
      for (const event of eventsToRevert) {
        await this.revertEventApplication(event, tx);
      }

      await tx.processedEvent.updateMany({
        where: {
          contractAddress,
          blockNumber: { gte: reorgBlockNumber },
        },
        data: { status: "reverted" },
      });

      await tx.indexerCheckpoint.upsert({
        where: { contractAddress },
        update: { lastBlock: safeBlock },
        create: { contractAddress, lastBlock: safeBlock },
      });
    });
  }

  /**
   * Actionable retry mechanism invocation manually triggered via a CLI worker context.
   * Reprocesses a specific event record from the dead letter table.
   */
  async retryFailedEvent(failedEventId: string): Promise<boolean> {
    const failed = await this.db.failedEvent.findUnique({
      where: { id: failedEventId },
    });

    if (!failed) throw new Error("Failed event record not found");

    const rawLog = {
      address: failed.contractAddress as Address,
      blockHash: failed.blockHash as `0x${string}`,
      blockNumber: failed.blockNumber,
      transactionHash: failed.transactionHash as `0x${string}`,
      logIndex: failed.logIndex,
      data: (failed.data as any).rawData || "0x",
      topics: (failed.data as any).rawTopics || [],
      removed: false,
      transactionIndex: 0,
    } as unknown as Log;

    try {
      const successful = await this.processLog(failed.contractAddress as Address, rawLog);
      if (successful) {
        await this.db.failedEvent.delete({ where: { id: failedEventId } });
        return true;
      }
      return false;
    } catch (err) {
      await this.db.failedEvent.update({
        where: { id: failedEventId },
        data: {
          retryCount: { increment: 1 },
          error: (err as Error).message || String(err),
        },
      });
      return false;
    }
  }

  /** Expose accumulation data metrics for the health/status verification endpoint. */
  async getDeadLetterMetrics() {
    const count = await this.db.failedEvent.count();
    const oldest = await this.db.failedEvent.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    return {
      deadLetterCount: count,
      oldestUnresolvedAgeMs: oldest ? Date.now() - oldest.createdAt.getTime() : 0,
    };
  }
}

// ─── Live indexer: owns the poll loop and checkpoint ──────────────────────────

export class MembershipIndexer extends IndexerCore {
  async start() {
    console.log("Starting indexer...");
    while (true) {
      try {
        await this.poll();
      } catch (error) {
        console.error("Indexer processing cycle suspended:", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }

  async poll() {
    const currentBlock = await this.getClient().getBlockNumber();
    const safeTip = currentBlock - BigInt(this.config.confirmationDepth);

    for (const contractAddress of this.config.contractAddresses || []) {
      const lastCheckpoint = await this.db.indexerCheckpoint.findUnique({
        where: { contractAddress },
      });

      let fromBlock = lastCheckpoint ? lastCheckpoint.lastBlock + 1n : this.config.startBlock;

      await this.checkReorg(contractAddress, fromBlock);

      const updatedCheckpoint = await this.db.indexerCheckpoint.findUnique({
        where: { contractAddress },
      });
      fromBlock = updatedCheckpoint ? updatedCheckpoint.lastBlock + 1n : this.config.startBlock;

      if (fromBlock > safeTip) continue;

      const toBlock = safeTip;
      console.log(
        `[${contractAddress}] Indexing from ${fromBlock} to ${toBlock}`,
      );
      
      // If processRange hits a failed event block, it throws immediately, blocking this upsert.
      await this.processRange({ contractAddress, fromBlock, toBlock, dryRun: false });

      await this.db.indexerCheckpoint.upsert({
        where: { contractAddress },
        update: { lastBlock: toBlock },
        create: { contractAddress, lastBlock: toBlock },
      });
    }
  }

  private async checkReorg(contractAddress: Address, fromBlock: bigint) {
    const depth = BigInt(this.config.confirmationDepth);
    const checkFrom = fromBlock > depth ? fromBlock - depth : 0n;

    const processedBlocks = await this.db.processedEvent.findMany({
      where: {
        contractAddress,
        blockNumber: { gte: checkFrom },
        status: "processed",
      },
      select: { blockNumber: true, blockHash: true },
      distinct: ["blockNumber"],
      orderBy: { blockNumber: "desc" },
    });

    for (const pb of processedBlocks) {
      const actualBlock = await this.getClient().getBlock({ blockNumber: pb.blockNumber });
      if (actualBlock.hash !== pb.blockHash) {
        console.warn(
          `[${contractAddress}] Reorg detected at block ${pb.blockNumber}! Expected ${pb.blockHash}, got ${actualBlock.hash}`,
        );
        await this.handleReorg(contractAddress, pb.blockNumber);
        return;
      }
    }
  }
}