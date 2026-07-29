import type pg from "pg";

import {
  ACTIVITY_CHAIN_CANONICAL_COLUMNS_SQL,
  ACTIVITY_CHAIN_GENESIS_HASH,
  ACTIVITY_CHAIN_SCOPE,
  canonicalActivityEntryFromDatabaseRow,
  computeActivityEntryHash,
  verifyDurableActivityChainWithClient,
  type CanonicalActivityDatabaseRow,
} from "../../lib/activity/hash-chain.js";

interface BackfillStateRow extends pg.QueryResultRow {
  total_rows: string;
  unchained_rows: string;
  chained_rows: string;
}

interface BackfillHeadRow extends pg.QueryResultRow {
  last_sequence: string;
  last_hash: string;
  last_entry_id: string | null;
}

/**
 * Transaction-bound data migration for 0002_activity_hash_chain.sql.
 *
 * Existing entries are ordered by the feed's historical deterministic order:
 * timestamp ascending, then id under PostgreSQL's bytewise C collation. The
 * table locks ensure an old application instance cannot insert a row between
 * the backfill and the NOT NULL enforcement.
 */
export async function backfillActivityHashChain(
  client: pg.ClientBase,
): Promise<void> {
  await client.query("LOCK TABLE activity_chain_head IN ACCESS EXCLUSIVE MODE");
  await client.query("LOCK TABLE activity_events IN ACCESS EXCLUSIVE MODE");

  const [stateResult, headResult] = await Promise.all([
    client.query<BackfillStateRow>(
      `SELECT
         COUNT(*)::text AS total_rows,
         COUNT(*) FILTER (
           WHERE chain_sequence IS NULL
             AND previous_hash IS NULL
             AND entry_hash IS NULL
         )::text AS unchained_rows,
         COUNT(*) FILTER (
           WHERE chain_sequence IS NOT NULL
             AND previous_hash IS NOT NULL
             AND entry_hash IS NOT NULL
         )::text AS chained_rows
       FROM activity_events`,
    ),
    client.query<BackfillHeadRow>(
      `SELECT last_sequence::text, last_hash, last_entry_id
       FROM activity_chain_head
       WHERE scope = $1`,
      [ACTIVITY_CHAIN_SCOPE],
    ),
  ]);
  const state = stateResult.rows[0];
  const head = headResult.rows[0];
  if (!state || !head) {
    throw new Error("Activity hash-chain backfill state is incomplete.");
  }

  const totalRows = BigInt(state.total_rows);
  const unchainedRows = BigInt(state.unchained_rows);
  const chainedRows = BigInt(state.chained_rows);
  if (totalRows !== unchainedRows + chainedRows) {
    throw new Error(
      "Activity hash-chain backfill refuses a mixed or partially chained log.",
    );
  }

  if (totalRows > BigInt(0) && chainedRows === totalRows) {
    const verification = await verifyDurableActivityChainWithClient(client);
    if (!verification.intact) {
      throw new Error(
        `Activity hash-chain backfill refuses to rewrite a populated corrupt chain (${verification.reason}).`,
      );
    }
    await enforceNotNull(client);
    return;
  }

  if (
    unchainedRows !== totalRows ||
    head.last_sequence !== "0" ||
    head.last_hash !== ACTIVITY_CHAIN_GENESIS_HASH ||
    head.last_entry_id !== null
  ) {
    throw new Error(
      "Activity hash-chain backfill requires an unchained log and the genesis head.",
    );
  }

  const result = await client.query<CanonicalActivityDatabaseRow>(
    `SELECT ${ACTIVITY_CHAIN_CANONICAL_COLUMNS_SQL}
     FROM activity_events
     ORDER BY "timestamp" ASC, id COLLATE "C" ASC`,
  );

  let sequence = BigInt(1);
  let previousHash = ACTIVITY_CHAIN_GENESIS_HASH;
  let latestEntryId: string | null = null;

  for (const row of result.rows) {
    const sequenceText = sequence.toString();
    const canonicalEntry = canonicalActivityEntryFromDatabaseRow(
      row,
      sequenceText,
    );
    const entryHash = computeActivityEntryHash(canonicalEntry, previousHash);

    const updated = await client.query(
      `UPDATE activity_events
       SET chain_sequence = $2::bigint,
           previous_hash = $3,
           entry_hash = $4
       WHERE id = $1`,
      [row.id, sequenceText, previousHash, entryHash],
    );
    if ((updated.rowCount ?? 0) !== 1) {
      throw new Error(
        `Activity hash-chain backfill could not update entry "${row.id}".`,
      );
    }

    latestEntryId = row.id;
    previousHash = entryHash;
    sequence += BigInt(1);
  }

  const lastSequence = (sequence - BigInt(1)).toString();
  const lastHash =
    result.rows.length === 0 ? ACTIVITY_CHAIN_GENESIS_HASH : previousHash;

  const updatedHead = await client.query(
    `UPDATE activity_chain_head
     SET last_sequence = $2::bigint,
         last_hash = $3,
         last_entry_id = $4
     WHERE scope = $1`,
    [ACTIVITY_CHAIN_SCOPE, lastSequence, lastHash, latestEntryId],
  );
  if ((updatedHead.rowCount ?? 0) !== 1) {
    throw new Error("Activity hash-chain backfill could not initialize its head.");
  }

  await enforceNotNull(client);
}

async function enforceNotNull(client: pg.ClientBase): Promise<void> {
  await client.query(`
    ALTER TABLE activity_events
      ALTER COLUMN chain_sequence SET NOT NULL,
      ALTER COLUMN previous_hash SET NOT NULL,
      ALTER COLUMN entry_hash SET NOT NULL
  `);
}
