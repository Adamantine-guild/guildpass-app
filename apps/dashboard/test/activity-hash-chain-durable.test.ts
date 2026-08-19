import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";

import {
  ACTIVITY_CHAIN_GENESIS_HASH,
  normalizeActivityEventForChain,
  verifyDurableActivityChain,
} from "../lib/activity/hash-chain";
import {
  DurableActivityStorage,
} from "../lib/activity/storage";
import { getPool, query } from "../lib/db";
import { DurableActivityRepository } from "../lib/repositories/adapters/durable";
import { makeActivityEvent } from "./fixtures";
import { acquirePostgresTestLock } from "./postgres-test-lock";

interface StoredChainRow extends pg.QueryResultRow {
  id: string;
  chain_sequence: string;
  previous_hash: string;
  entry_hash: string;
}

const connectionString = process.env.DATABASE_URL;
const releasePostgresTestLock = connectionString
  ? await acquirePostgresTestLock()
  : null;
after(async () => {
  await releasePostgresTestLock?.();
});

async function resetChain(): Promise<void> {
  await query("TRUNCATE TABLE activity_events, processed_events");
  const reset = await query(
    `UPDATE activity_chain_head
     SET last_sequence = 0,
         last_hash = repeat('0', 64),
         last_entry_id = NULL
     WHERE scope = 'global'`,
  );
  assert.equal(reset.rowCount, 1, "the global activity-chain head must exist");
}

async function appendEvents(ids: readonly string[]): Promise<void> {
  const storage = new DurableActivityStorage({ ttlSeconds: 3600 });
  for (const [index, id] of ids.entries()) {
    const result = await storage.recordActivityEvent(
      makeActivityEvent({
        id,
        timestamp: `2025-01-15T12:00:${String(index).padStart(2, "0")}.000Z`,
        description: `Chained event ${id}`,
      }),
    );
    assert.equal(result, "recorded");
  }
}

if (!connectionString) {
  test(
    "durable activity hash-chain security tests",
    { skip: "DATABASE_URL is not configured" },
    () => {},
  );
} else {
  describe("durable PostgreSQL activity hash chain", () => {
    beforeEach(resetChain);

    test("normal repository and storage writes form one valid chain from genesis", async () => {
      const repository = new DurableActivityRepository(connectionString);
      const storage = new DurableActivityStorage({ ttlSeconds: 3600 });

      await repository.append("guild-1", {
        type: "member.joined",
        source: "dashboard",
        severity: "info",
        actor: { name: "Repository writer" },
        description: "First event",
      });
      assert.equal(
        await storage.recordActivityEvent(
          makeActivityEvent({
            id: "chain_valid_storage",
            description: "Second event",
          }),
        ),
        "recorded",
      );
      await repository.append("guild-1", {
        type: "pass.created",
        source: "dashboard",
        severity: "info",
        actor: { name: "Repository writer" },
        description: "Third event",
      });

      const verification = await verifyDurableActivityChain();
      if (!verification.intact) assert.fail(verification.reason);
      assert.equal(verification.intact, true);
      assert.equal(verification.checkedEntries, 3);
      assert.equal(verification.latestSequence, "3");
      assert.match(verification.latestHash ?? "", /^[0-9a-f]{64}$/);

      const stored = await query<StoredChainRow>(
        `SELECT id,
                chain_sequence::text,
                previous_hash,
                entry_hash
         FROM activity_events
         ORDER BY activity_events.chain_sequence`,
      );
      assert.equal(stored.rows[0]?.previous_hash, ACTIVITY_CHAIN_GENESIS_HASH);
      assert.deepEqual(
        stored.rows.map((row) => row.chain_sequence),
        ["1", "2", "3"],
      );
      assert.equal(stored.rows[1]?.previous_hash, stored.rows[0]?.entry_hash);
      assert.equal(stored.rows[2]?.previous_hash, stored.rows[1]?.entry_hash);
    });

    test("raw historical content mutation is detected and localized at that row", async () => {
      const ids = ["tamper_a", "tamper_b", "tamper_c", "tamper_d"];
      await appendEvents(ids);

      const mutation = await query(
        "UPDATE activity_events SET description = $2 WHERE id = $1",
        [ids[1], "Changed directly in PostgreSQL"],
      );
      assert.equal(mutation.rowCount, 1);

      const verification = await verifyDurableActivityChain();
      if (verification.intact) assert.fail("tampered chain was reported intact");
      assert.equal(verification.reason, "entry_hash_mismatch");
      assert.equal(verification.brokenAt.entryId, ids[1]);
      assert.equal(verification.brokenAt.sequence, "2");
      assert.equal(verification.checkedEntries, 1);
    });

    test("deleting a historical middle row localizes the break at its successor", async () => {
      const ids = ["delete_a", "delete_b", "delete_c"];
      await appendEvents(ids);
      await query("DELETE FROM activity_events WHERE id = $1", [ids[1]]);

      const verification = await verifyDurableActivityChain();
      if (verification.intact) assert.fail("chain with a deleted row was intact");
      assert.equal(verification.reason, "sequence_gap");
      assert.equal(verification.brokenAt.entryId, ids[2]);
      assert.equal(verification.brokenAt.sequence, "3");
      assert.equal(verification.checkedEntries, 1);
    });

    test("changing only a stored hash is detected at the changed entry", async () => {
      const ids = ["hash_a", "hash_b", "hash_c"];
      await appendEvents(ids);
      await query(
        "UPDATE activity_events SET entry_hash = $2 WHERE id = $1",
        [ids[1], "f".repeat(64)],
      );

      const verification = await verifyDurableActivityChain();
      if (verification.intact) assert.fail("hash-tampered chain was intact");
      assert.equal(verification.reason, "entry_hash_mismatch");
      assert.equal(verification.brokenAt.entryId, ids[1]);
      assert.equal(verification.checkedEntries, 1);
    });

    test("database-local head detects an isolated latest-row deletion", async () => {
      const ids = ["tail_a", "tail_b"];
      await appendEvents(ids);
      await query("DELETE FROM activity_events WHERE id = $1", [ids[1]]);

      const verification = await verifyDurableActivityChain();
      if (verification.intact) assert.fail("deleted tail was reported intact");
      assert.equal(verification.reason, "chain_head_mismatch");
      assert.equal(verification.checkedEntries, 1);
      assert.equal(verification.brokenAt.entryId, ids[1]);
    });

    test("concurrent durable writers produce a single linear chain without forks", async () => {
      const eventCount = 16;
      const writes = Array.from({ length: eventCount }, (_, index) => {
        const storage = new DurableActivityStorage({ ttlSeconds: 3600 });
        return storage.recordActivityEvent(
          makeActivityEvent({
            id: `concurrent_${index}`,
            timestamp: "2025-01-15T12:00:00.000Z",
            description: `Concurrent event ${index}`,
          }),
        );
      });

      const results = await Promise.all(writes);
      assert.ok(results.every((result) => result === "recorded"));

      const stored = await query<StoredChainRow>(
        `SELECT id,
                chain_sequence::text,
                previous_hash,
                entry_hash
         FROM activity_events
         ORDER BY activity_events.chain_sequence`,
      );
      const verification = await verifyDurableActivityChain();
      if (!verification.intact) {
        assert.fail(
          `${verification.reason}; expected=${verification.expectedSequence ?? "n/a"}; ` +
            `actual=${verification.actualSequence ?? "n/a"}; ` +
            `stored=${stored.rows.map((row) => row.chain_sequence).join(",")}`,
        );
      }
      assert.equal(verification.checkedEntries, eventCount);

      assert.equal(stored.rows.length, eventCount);
      for (const [index, row] of stored.rows.entries()) {
        assert.equal(row.chain_sequence, String(index + 1));
        assert.equal(
          row.previous_hash,
          index === 0
            ? ACTIVITY_CHAIN_GENESIS_HASH
            : stored.rows[index - 1]?.entry_hash,
        );
      }
      assert.equal(
        new Set(stored.rows.map((row) => row.previous_hash)).size,
        eventCount,
      );
    });

    test("PostgreSQL JSONB normalization removes object insertion-order differences", async () => {
      const client = await getPool().connect();
      try {
        const first = await normalizeActivityEventForChain(
          client,
          makeActivityEvent({
            id: "json_order",
            metadata: { beta: 2, alpha: 1 },
          }),
        );
        const second = await normalizeActivityEventForChain(
          client,
          makeActivityEvent({
            id: "json_order",
            metadata: { alpha: 1, beta: 2 },
          }),
        );
        assert.equal(first.metadataJson, second.metadataJson);
      } finally {
        client.release();
      }
    });

    test("normalization failure rolls back both the event and processed marker", async () => {
      const storage = new DurableActivityStorage({ ttlSeconds: 3600 });
      const event = makeActivityEvent({
        id: "invalid_timestamp_atomicity",
        timestamp: "not-a-postgresql-timestamp",
      });

      await assert.rejects(() => storage.recordActivityEvent(event));

      const persisted = await query<{ activity_count: string; marker_count: string }>(
        `SELECT
           (SELECT COUNT(*) FROM activity_events WHERE id = $1)::text
             AS activity_count,
           (SELECT COUNT(*) FROM processed_events WHERE event_id = $1)::text
             AS marker_count`,
        [event.id],
      );
      assert.deepEqual(persisted.rows[0], {
        activity_count: "0",
        marker_count: "0",
      });
    });
  });
}
