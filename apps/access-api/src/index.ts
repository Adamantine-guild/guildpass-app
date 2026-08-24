import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PrismaClient } from "@prisma/client";
import { MembershipIndexer } from "./workers/indexer.js";
import { LeaderElectionService } from "./utils/leader-election.js";
import { type Address } from "viem";

// ─── Health endpoint ─────────────────────────────────────────────────────────

const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "3000", 10);

// ─── Configuration ───────────────────────────────────────────────────────────

function parseContractAddresses(): Address[] {
  const rawMulti = process.env.MEMBERSHIP_CONTRACT_ADDRESSES;
  if (rawMulti && rawMulti.trim().length > 0) {
    return rawMulti
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s as Address);
  }

  const legacy = process.env.MEMBERSHIP_CONTRACT_ADDRESS;
  if (legacy && legacy.trim().length > 0) return [legacy.trim() as Address];

  return [];
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const contractAddresses = parseContractAddresses();
  const confirmationDepth = parseInt(process.env.INDEXER_CONFIRMATION_DEPTH || "10", 10);
  const startBlock = BigInt(process.env.INDEXER_START_BLOCK || "0");

  if (!rpcUrl || contractAddresses.length === 0) {
    console.error(
      "Missing RPC_URL or membership contract address. Provide either MEMBERSHIP_CONTRACT_ADDRESSES (comma-separated) or MEMBERSHIP_CONTRACT_ADDRESS."
    );
    process.exit(1);
  }

  // Enable leader election unless explicitly disabled
  const leaderElectionEnabled = process.env.LEADER_ELECTION_ENABLED !== "false";

  const prisma = new PrismaClient();
  const indexer = new MembershipIndexer({
    rpcUrl,
    contractAddresses,
    confirmationDepth,
    startBlock,
  }, prisma);

  // ── Leader election setup ──────────────────────────────────────────────
  let leaderElection: LeaderElectionService | null = null;

  if (leaderElectionEnabled) {
    const instanceId = process.env.INSTANCE_ID || undefined;

    leaderElection = new LeaderElectionService(prisma, {
      instanceId,
      leaseTtlMs: parseInt(process.env.LEASE_TTL_MS || "30000", 10),
      renewIntervalMs: parseInt(process.env.LEASE_RENEW_INTERVAL_MS || "10000", 10),
      standbyPollIntervalMs: parseInt(process.env.STANDBY_POLL_INTERVAL_MS || "5000", 10),
    });

    indexer.attachLeaderElection(leaderElection);
    await leaderElection.start();

    console.log(
      `[LeaderElection] Started. Instance: ${leaderElection.getInstanceId()}, ` +
        `Role: ${leaderElection.getStatus().role}.`,
    );
  }

  // ── Health HTTP server ─────────────────────────────────────────────────
  // Build a lightweight status snapshot function for the health endpoint.
  // When leader election is enabled, reads from the live service;
  // otherwise returns a static standalone response.
  const getHealthStatus = leaderElection
    ? () => leaderElection.getStatus()
    : () => ({ role: "standby" as const, instanceId: "standalone", generation: 0, isLeader: true });

  const healthServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    const status = getHealthStatus();
    const body = JSON.stringify({
      status: "ok",
      role: status.role,
      instanceId: status.instanceId,
      generation: status.generation,
      timestamp: new Date().toISOString(),
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  });

  healthServer.listen(HEALTH_PORT, () => {
    console.log(`[Health] Listening on port ${HEALTH_PORT}`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);
    indexer.stop();

    if (leaderElection) {
      await leaderElection.stop();
    }

    healthServer.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // ── Start indexing ─────────────────────────────────────────────────────
  await indexer.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

