/**
 * test/core-reconciliation.test.ts
 *
 * Tests for core-state reconciliation (issue #262): the dashboard diffs its
 * local state against an authoritative snapshot from GuildPass core and
 * optionally applies corrections.
 *
 * Covers the acceptance criteria:
 *  - no-drift runs are pure no-ops (no writes, no activity),
 *  - partial drift is reported by dry-run without side effects and fixed by
 *    apply, with every correction tagged source: "reconciliation",
 *  - full resync rebuilds an empty guild from a snapshot,
 *  - re-running apply after a successful pass produces no further changes
 *    or duplicate activity entries,
 *  - cores without a snapshot endpoint degrade to supported: false.
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { ActivityEvent, GuildSnapshot } from "@guildpass/integration-client";
import { reconcileGuildWithCore } from "../lib/reconciliation/core-sync";
import type { SnapshotClient } from "../lib/reconciliation/core-sync-types";
import { POST as reconcileRoutePOST } from "../app/api/integrations/reconcile/route";
import {
  clearRepositories,
  getGuildRepository,
  getMemberRepository,
  getPassRepository,
} from "../lib/repositories/factory";

process.env.DASHBOARD_STORAGE_MODE = "mock";
process.env.DASHBOARD_API_MODE = "mock";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stubClient(snapshot: GuildSnapshot | null): SnapshotClient {
  return { getGuildSnapshot: async () => snapshot };
}

/** In-memory activity sink with the same id-dedupe contract as the real one. */
function fakeSink() {
  const events: ActivityEvent[] = [];
  const ids = new Set<string>();
  return {
    events,
    sink: {
      recordActivityEvent: async (event: ActivityEvent) => {
        if (ids.has(event.id)) return "duplicate" as const;
        ids.add(event.id);
        events.push(event);
        return "recorded" as const;
      },
    },
  };
}

const noopPublish = () => {};

async function freshGuild(name = "Recon Guild") {
  const guildRepo = getGuildRepository();
  return guildRepo.create({ name, description: "test guild", memberCount: 0, passCount: 0 });
}

function snapshotFor(guildId: string, over: Partial<GuildSnapshot> = {}): GuildSnapshot {
  return {
    guildId,
    generatedAt: "2026-07-24T00:00:00.000Z",
    members: [],
    passes: [],
    ...over,
  };
}

beforeEach(() => {
  clearRepositories();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("reconcileGuildWithCore", () => {
  test("reports supported: false when core has no snapshot endpoint", async () => {
    const guild = await freshGuild();
    const { sink, events } = fakeSink();

    const report = await reconcileGuildWithCore({
      guildId: guild.id,
      mode: "apply",
      client: stubClient(null),
      deps: { activitySink: sink, publish: noopPublish },
    });

    assert.equal(report.supported, false);
    assert.match(report.reason ?? "", /snapshot/);
    assert.equal(report.changes.length, 0);
    assert.equal(events.length, 0);
  });

  test("no-drift run is a pure no-op, even in apply mode", async () => {
    const guild = await freshGuild();
    const memberRepo = getMemberRepository();
    const passRepo = getPassRepository();

    await memberRepo.create(guild.id, {
      wallet: "0xAAA",
      name: "alice",
      status: "active",
      roles: ["admin"],
    });
    await passRepo.create(guild.id, {
      name: "Gold",
      description: "gold pass",
      status: "active",
      price: 10,
      maxSupply: 100,
      currentSupply: 3,
    });

    const snapshot = snapshotFor(guild.id, {
      members: [
        { userId: "alice", wallet: "0xaaa", status: "active", roles: ["admin"], updatedAt: "2026-07-24T00:00:00.000Z" },
      ],
      // Local pass ids are repo-generated, so core matches by name.
      passes: [{ id: "core-pass-1", name: "Gold", status: "active", price: 10, maxSupply: 100, currentSupply: 3 }],
    });

    const { sink, events } = fakeSink();
    const report = await reconcileGuildWithCore({
      guildId: guild.id,
      mode: "apply",
      client: stubClient(snapshot),
      deps: { activitySink: sink, publish: noopPublish },
    });

    assert.equal(report.supported, true);
    assert.equal(report.changes.length, 0);
    assert.equal(report.applied, 0);
    assert.equal(events.length, 0);
    assert.match(report.summary, /no drift/);
  });

  test("dry-run reports partial drift without writing anything", async () => {
    const guild = await freshGuild();
    const memberRepo = getMemberRepository();

    await memberRepo.create(guild.id, {
      wallet: "0xbbb",
      name: "bob",
      status: "active",
      roles: [],
    });

    const snapshot = snapshotFor(guild.id, {
      members: [
        // Bob's status drifted in core.
        { userId: "bob", wallet: "0xBBB", status: "inactive", roles: [], updatedAt: "2026-07-24T00:00:00.000Z" },
        // Carol exists in core but not locally.
        { userId: "carol", wallet: "0xccc", status: "active", roles: ["contributor"], updatedAt: "2026-07-24T00:00:00.000Z" },
      ],
      passes: [{ id: "core-pass-9", name: "Silver", status: "active", currentSupply: 1 }],
    });

    const { sink, events } = fakeSink();
    const report = await reconcileGuildWithCore({
      guildId: guild.id,
      mode: "dry-run",
      client: stubClient(snapshot),
      deps: { activitySink: sink, publish: noopPublish },
    });

    assert.equal(report.changes.length, 3);
    assert.equal(report.totals.added, 2); // carol + Silver pass
    assert.equal(report.totals.updated, 1); // bob's status
    assert.equal(report.applied, 0);
    assert.equal(events.length, 0);

    // Nothing was written.
    const bob = await memberRepo.getByWallet(guild.id, "0xbbb");
    assert.equal(bob?.status, "active");
    assert.equal(await memberRepo.getByWallet(guild.id, "0xccc"), null);
  });

  test("apply corrects drift, tags activity as reconciliation, and is idempotent", async () => {
    const guild = await freshGuild();
    const memberRepo = getMemberRepository();
    const passRepo = getPassRepository();

    await memberRepo.create(guild.id, { wallet: "0xbbb", name: "bob", status: "active", roles: [] });
    // Dan left while the dashboard was down: absent from the snapshot.
    await memberRepo.create(guild.id, { wallet: "0xddd", name: "dan", status: "active", roles: [] });

    const snapshot = snapshotFor(guild.id, {
      members: [
        { userId: "bob", wallet: "0xbbb", status: "active", roles: ["contributor"], updatedAt: "2026-07-24T00:00:00.000Z" },
        { userId: "carol", wallet: "0xccc", status: "active", roles: [], updatedAt: "2026-07-24T00:00:00.000Z" },
      ],
      passes: [{ id: "core-pass-9", name: "Silver", status: "active", currentSupply: 1 }],
    });

    const { sink, events } = fakeSink();
    const deps = { activitySink: sink, publish: noopPublish, now: () => "2026-07-24T01:00:00.000Z" };

    const report = await reconcileGuildWithCore({
      guildId: guild.id,
      mode: "apply",
      client: stubClient(snapshot),
      deps,
    });

    // bob roles update + dan deactivate + carol add + pass add
    assert.equal(report.changes.length, 4);
    assert.equal(report.applied, 4);
    assert.equal(events.length, 4);

    for (const event of events) {
      assert.equal(event.source, "reconciliation");
      assert.equal(event.actor.name, "Reconciliation Job");
      assert.equal(event.metadata?.reconciliation, true);
      assert.match(event.id, /^reconcile:/);
    }

    // State actually changed.
    assert.deepEqual((await memberRepo.getByWallet(guild.id, "0xbbb"))?.roles, ["contributor"]);
    assert.equal((await memberRepo.getByWallet(guild.id, "0xddd"))?.status, "inactive");
    assert.notEqual(await memberRepo.getByWallet(guild.id, "0xccc"), null);
    const passes = await passRepo.getAll(guild.id);
    assert.equal(passes.length, 1);
    assert.equal(passes[0].name, "Silver");

    // Second run: no drift, no writes, no duplicate activity.
    const second = await reconcileGuildWithCore({
      guildId: guild.id,
      mode: "apply",
      client: stubClient(snapshot),
      deps,
    });
    assert.equal(second.changes.length, 0);
    assert.equal(second.applied, 0);
    assert.equal(events.length, 4);
  });

  test("full resync rebuilds an empty guild from a snapshot", async () => {
    const guild = await freshGuild();
    const memberRepo = getMemberRepository();

    const snapshot = snapshotFor(guild.id, {
      guild: { name: "Renamed Guild", description: "from core" },
      members: [
        { userId: "u1", wallet: "0x1", status: "active", roles: ["admin"], updatedAt: "2026-07-24T00:00:00.000Z" },
        { userId: "u2", wallet: "0x2", status: "unknown", roles: [], updatedAt: "2026-07-24T00:00:00.000Z" },
      ],
      passes: [
        { id: "p1", name: "Founder", status: "active", price: 100, maxSupply: null, currentSupply: 12 },
        { id: "p2", name: "Retired", status: "inactive" },
      ],
    });

    const { sink, events } = fakeSink();
    const report = await reconcileGuildWithCore({
      guildId: guild.id,
      mode: "apply",
      client: stubClient(snapshot),
      deps: { activitySink: sink, publish: noopPublish },
    });

    assert.equal(report.totals.added, 4);
    assert.equal(report.totals.updated, 1); // guild metadata
    assert.equal(events.length, 5);

    const members = await memberRepo.getAll(guild.id);
    assert.equal(members.length, 2);
    // core "unknown" maps to dashboard "pending" (same mapping as live lookups).
    assert.equal(members.find((m) => m.wallet === "0x2")?.status, "pending");

    const guildRepo = getGuildRepository();
    assert.equal((await guildRepo.getById(guild.id))?.name, "Renamed Guild");
  });

  test("snapshot members without a wallet are skipped, not deleted locally", async () => {
    const guild = await freshGuild();
    const memberRepo = getMemberRepository();
    await memberRepo.create(guild.id, { wallet: "0xeee", name: "erin", status: "active", roles: [] });

    const snapshot = snapshotFor(guild.id, {
      members: [
        { userId: "walletless", status: "active", roles: [], updatedAt: "2026-07-24T00:00:00.000Z" },
        { userId: "erin", wallet: "0xeee", status: "active", roles: [], updatedAt: "2026-07-24T00:00:00.000Z" },
      ],
    });

    const { sink } = fakeSink();
    const report = await reconcileGuildWithCore({
      guildId: guild.id,
      mode: "apply",
      client: stubClient(snapshot),
      deps: { activitySink: sink, publish: noopPublish },
    });

    assert.equal(report.changes.length, 0);
    assert.equal((await memberRepo.getByWallet(guild.id, "0xeee"))?.status, "active");
  });
});

describe("POST /api/integrations/reconcile", () => {
  test("rejects callers without settings:write (default API session is readonly)", async () => {
    const res = await reconcileRoutePOST(
      new Request("http://localhost/api/integrations/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "dry-run" }),
      }),
    );
    assert.equal(res.status, 403);
  });
});
