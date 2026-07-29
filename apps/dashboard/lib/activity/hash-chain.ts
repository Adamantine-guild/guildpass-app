import { createHash } from "node:crypto";

import type pg from "pg";

import { withTransaction } from "../db";
import type { ActivityEvent } from "./types";

/**
 * The predecessor for the first entry in the durable PostgreSQL chain.
 * It represents an all-zero SHA-256 digest.
 */
export const ACTIVITY_CHAIN_GENESIS_HASH = "0".repeat(64);

export const ACTIVITY_CHAIN_SCOPE = "global";
export const ACTIVITY_CHAIN_FORMAT_VERSION = 1;

const ACTIVITY_CHAIN_DOMAIN = "guildpass.activity-chain";
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_DECIMAL_PATTERN = /^[1-9]\d*$/;
const NON_NEGATIVE_DECIMAL_PATTERN = /^(0|[1-9]\d*)$/;
const VERIFICATION_PAGE_SIZE = 500;

/**
 * PostgreSQL expressions used by both verification and the one-time backfill.
 *
 * JSONB text is PostgreSQL's normalized representation: object-key insertion
 * order and insignificant whitespace are removed while array order is kept.
 * The timestamp expression preserves all six PostgreSQL fractional digits;
 * routing it through JavaScript Date would otherwise discard microseconds.
 */
export const ACTIVITY_CHAIN_CANONICAL_COLUMNS_SQL = `
  id,
  type,
  source,
  severity,
  actor::text AS actor_json,
  to_char("timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS timestamp_utc,
  description,
  entity::text AS entity_json,
  metadata::text AS metadata_json,
  changes::text AS changes_json,
  schema_version::text AS schema_version
`;

export type ActivityChainClient = pg.ClientBase;

export interface CanonicalActivityDatabaseRow extends pg.QueryResultRow {
  id: string;
  type: string;
  source: string;
  severity: string;
  actor_json: string;
  timestamp_utc: string;
  description: string;
  entity_json: string | null;
  metadata_json: string | null;
  changes_json: string | null;
  schema_version: string;
  chain_sequence?: string;
  previous_hash?: string;
  entry_hash?: string;
}

/**
 * Exact, immutable durable content bound into an entry hash.
 *
 * Numeric database values are represented as decimal strings so values beyond
 * JavaScript's safe integer range are not rounded.
 */
export interface CanonicalActivityChainEntry {
  chainSequence: string;
  id: string;
  type: string;
  source: string;
  severity: string;
  actorJson: string;
  timestampUtc: string;
  description: string;
  entityJson: string | null;
  metadataJson: string | null;
  changesJson: string | null;
  schemaVersion: string;
}

export type ActivityChainBreakReason =
  | "invalid_sequence"
  | "sequence_gap"
  | "invalid_content"
  | "invalid_previous_hash"
  | "previous_hash_mismatch"
  | "invalid_entry_hash"
  | "entry_hash_mismatch"
  | "missing_chain_head"
  | "invalid_chain_head"
  | "chain_head_mismatch";

export interface ActivityChainBreakLocation {
  sequence: string | null;
  entryId: string | null;
}

export type ActivityChainVerificationResult =
  | {
      intact: true;
      checkedEntries: number;
      latestSequence: string;
      latestHash: string | null;
    }
  | {
      intact: false;
      checkedEntries: number;
      brokenAt: ActivityChainBreakLocation;
      reason: ActivityChainBreakReason;
      expectedHash?: string;
      actualHash?: string;
      expectedSequence?: string;
      actualSequence?: string;
    };

export type DurableActivityWriteResult = "recorded" | "duplicate";

interface NormalizedActivityContent {
  id: string;
  type: string;
  source: string;
  severity: string;
  actorJson: string;
  timestampUtc: string;
  description: string;
  entityJson: string | null;
  metadataJson: string | null;
  changesJson: string | null;
  schemaVersion: string;
}

interface ChainHeadRow extends pg.QueryResultRow {
  last_sequence: string;
  last_hash: string;
  last_entry_id: string | null;
}

interface InvalidSequenceRow extends pg.QueryResultRow {
  id: string;
  chain_sequence: string | null;
}

interface ChainTailRow extends pg.QueryResultRow {
  chain_sequence: string;
  id: string;
  entry_hash: string;
}

/**
 * Serialize immutable entry content with a fixed field order.
 *
 * Each scalar is UTF-8 byte-length framed. SQL NULL is encoded as `-1:`,
 * which is distinct from an empty string (`0:`) and from JSON null (`4:null`).
 * This avoids ambiguous concatenation without relying on object insertion
 * order or JSON.stringify for the outer structure.
 */
export function serializeCanonicalActivityEntry(
  entry: CanonicalActivityChainEntry,
): string {
  return frameFields([
    ACTIVITY_CHAIN_DOMAIN,
    String(ACTIVITY_CHAIN_FORMAT_VERSION),
    entry.chainSequence,
    entry.id,
    entry.type,
    entry.source,
    entry.severity,
    entry.actorJson,
    entry.timestampUtc,
    entry.description,
    entry.entityJson,
    entry.metadataJson,
    entry.changesJson,
    entry.schemaVersion,
  ]);
}

/**
 * Compute the lowercase SHA-256 digest for an entry and its predecessor.
 */
export function computeActivityEntryHash(
  entry: CanonicalActivityChainEntry,
  previousHash: string,
): string {
  assertSha256Hex(previousHash, "previous hash");
  const canonicalEntry = serializeCanonicalActivityEntry(entry);
  const hashInput = frameFields([
    ACTIVITY_CHAIN_DOMAIN,
    "hash-input",
    String(ACTIVITY_CHAIN_FORMAT_VERSION),
    canonicalEntry,
    previousHash,
  ]);

  return createHash("sha256").update(hashInput, "utf8").digest("hex");
}

/**
 * Convert the exact text values selected from PostgreSQL into canonical input.
 * The migration passes an explicit sequence while verification reads it from
 * the row.
 */
export function canonicalActivityEntryFromDatabaseRow(
  row: CanonicalActivityDatabaseRow,
  chainSequence: string | undefined = row.chain_sequence,
): CanonicalActivityChainEntry {
  if (!chainSequence || !POSITIVE_DECIMAL_PATTERN.test(chainSequence)) {
    throw new Error("Activity chain sequence must be a positive decimal integer.");
  }

  const requiredFields: Array<[string, unknown]> = [
    ["id", row.id],
    ["type", row.type],
    ["source", row.source],
    ["severity", row.severity],
    ["actor", row.actor_json],
    ["timestamp", row.timestamp_utc],
    ["description", row.description],
    ["schema version", row.schema_version],
  ];
  for (const [name, value] of requiredFields) {
    if (typeof value !== "string") {
      throw new Error(`Activity ${name} is not in its canonical database form.`);
    }
  }

  if (!NON_NEGATIVE_DECIMAL_PATTERN.test(row.schema_version)) {
    throw new Error("Activity schema version must be a non-negative decimal integer.");
  }

  return {
    chainSequence,
    id: row.id,
    type: row.type,
    source: row.source,
    severity: row.severity,
    actorJson: row.actor_json,
    timestampUtc: row.timestamp_utc,
    description: row.description,
    entityJson: nullableString(row.entity_json, "entity"),
    metadataJson: nullableString(row.metadata_json, "metadata"),
    changesJson: nullableString(row.changes_json, "changes"),
    schemaVersion: row.schema_version,
  };
}

/**
 * Ask PostgreSQL to normalize a would-be event exactly as its column types
 * will persist it. This is intentionally done before hashing.
 */
export async function normalizeActivityEventForChain(
  client: ActivityChainClient,
  event: ActivityEvent,
): Promise<NormalizedActivityContent> {
  const actorJson = requiredJsonParameter(event.actor, "actor");
  const entityJson = optionalJsonParameter(event.entity);
  const metadataJson = optionalJsonParameter(event.metadata);
  const changesJson = optionalJsonParameter(event.changes);

  const result = await client.query<CanonicalActivityDatabaseRow>(
    `SELECT
       $1::text AS id,
       $2::text AS type,
       $3::text AS source,
       $4::text AS severity,
       ($5::jsonb)::text AS actor_json,
       to_char($6::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS timestamp_utc,
       $7::text AS description,
       ($8::jsonb)::text AS entity_json,
       ($9::jsonb)::text AS metadata_json,
       ($10::jsonb)::text AS changes_json,
       ($11::integer)::text AS schema_version`,
    [
      event.id,
      event.type,
      event.source,
      event.severity,
      actorJson,
      event.timestamp,
      event.description,
      entityJson,
      metadataJson,
      changesJson,
      event.schemaVersion,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("PostgreSQL did not return normalized activity content.");
  }

  const canonical = canonicalActivityEntryFromDatabaseRow(row, "1");
  return {
    id: canonical.id,
    type: canonical.type,
    source: canonical.source,
    severity: canonical.severity,
    actorJson: canonical.actorJson,
    timestampUtc: canonical.timestampUtc,
    description: canonical.description,
    entityJson: canonical.entityJson,
    metadataJson: canonical.metadataJson,
    changesJson: canonical.changesJson,
    schemaVersion: canonical.schemaVersion,
  };
}

/**
 * Append a repository-generated activity event and mark its generated ID as
 * processed in the same transaction.
 */
export async function appendDurableActivityEvent(
  event: ActivityEvent,
): Promise<ActivityEvent> {
  return withTransaction(async (client) => {
    const result = await appendWithClient(client, event, false);
    if (result.status !== "recorded") {
      throw new Error(`Generated activity event ID "${event.id}" already exists.`);
    }

    await client.query(
      "INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [event.id],
    );
    return result.event;
  });
}

/**
 * Atomically deduplicate and append an externally identified durable event.
 * A failed normalization/hash/insert rolls the processed marker back too.
 */
export async function recordDurableActivityEvent(
  event: ActivityEvent,
  ttlSeconds: number,
): Promise<DurableActivityWriteResult> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Activity idempotency TTL must be a positive number of seconds.");
  }

  return withTransaction(async (client) => {
    await client.query("DELETE FROM processed_events WHERE expires_at <= NOW()");
    const processed = await client.query(
      `INSERT INTO processed_events (event_id, expires_at)
       VALUES ($1, NOW() + ($2::double precision * INTERVAL '1 second'))
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.id, ttlSeconds],
    );
    if ((processed.rowCount ?? 0) === 0) {
      return "duplicate";
    }

    const result = await appendWithClient(client, event, true);
    return result.status;
  });
}

/**
 * Migration/seed entry point for a caller that already owns a transaction.
 * Existing IDs are skipped without extending the chain.
 */
export async function seedDurableActivityEvent(
  client: ActivityChainClient,
  event: ActivityEvent,
): Promise<DurableActivityWriteResult> {
  const result = await appendWithClient(client, event, true);
  return result.status;
}

/**
 * Verify the durable PostgreSQL chain without rewriting any row.
 */
export async function verifyDurableActivityChain(): Promise<ActivityChainVerificationResult> {
  return withTransaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    return verifyDurableActivityChainWithClient(client);
  });
}

export async function verifyDurableActivityChainWithClient(
  client: ActivityChainClient,
): Promise<ActivityChainVerificationResult> {
  const headResult = await client.query<ChainHeadRow>(
    `SELECT last_sequence::text, last_hash, last_entry_id
     FROM activity_chain_head
     WHERE scope = $1`,
    [ACTIVITY_CHAIN_SCOPE],
  );
  const invalidSequenceResult = await client.query<InvalidSequenceRow>(
    `SELECT id, chain_sequence::text AS chain_sequence
     FROM activity_events
     WHERE chain_sequence IS NULL OR chain_sequence <= 0
     ORDER BY id COLLATE "C"
     LIMIT 1`,
  );
  const invalidSequence = invalidSequenceResult.rows[0];
  if (invalidSequence) {
    return {
      intact: false,
      checkedEntries: 0,
      brokenAt: {
        sequence: invalidSequence.chain_sequence,
        entryId: invalidSequence.id,
      },
      reason: "invalid_sequence",
    };
  }

  let expectedSequence = BigInt(1);
  let expectedPreviousHash = ACTIVITY_CHAIN_GENESIS_HASH;
  let checkedEntries = 0;
  let latestEntryId: string | null = null;
  let scanAfterSequence = "0";

  while (true) {
    const entriesResult = await client.query<CanonicalActivityDatabaseRow>(
      `SELECT
         chain_sequence::text AS chain_sequence,
         ${ACTIVITY_CHAIN_CANONICAL_COLUMNS_SQL},
         previous_hash,
         entry_hash
       FROM activity_events
       WHERE chain_sequence > $1::bigint
       ORDER BY activity_events.chain_sequence ASC
       LIMIT $2`,
      [scanAfterSequence, VERIFICATION_PAGE_SIZE],
    );

    for (const row of entriesResult.rows) {
      const sequence = row.chain_sequence;
      if (!sequence || !POSITIVE_DECIMAL_PATTERN.test(sequence)) {
        return brokenResult(
          checkedEntries,
          row,
          "invalid_sequence",
        );
      }

      const expectedSequenceText = expectedSequence.toString();
      if (sequence !== expectedSequenceText) {
        return {
          ...brokenResult(checkedEntries, row, "sequence_gap"),
          expectedSequence: expectedSequenceText,
          actualSequence: sequence,
        };
      }

      if (!isSha256Hex(row.previous_hash)) {
        return brokenResult(
          checkedEntries,
          row,
          "invalid_previous_hash",
          expectedPreviousHash,
          row.previous_hash,
        );
      }

      if (row.previous_hash !== expectedPreviousHash) {
        return brokenResult(
          checkedEntries,
          row,
          "previous_hash_mismatch",
          expectedPreviousHash,
          row.previous_hash,
        );
      }

      if (!isSha256Hex(row.entry_hash)) {
        return brokenResult(
          checkedEntries,
          row,
          "invalid_entry_hash",
          undefined,
          row.entry_hash,
        );
      }

      let canonicalEntry: CanonicalActivityChainEntry;
      try {
        canonicalEntry = canonicalActivityEntryFromDatabaseRow(row);
      } catch {
        return brokenResult(checkedEntries, row, "invalid_content");
      }

      const expectedEntryHash = computeActivityEntryHash(
        canonicalEntry,
        expectedPreviousHash,
      );
      if (row.entry_hash !== expectedEntryHash) {
        return brokenResult(
          checkedEntries,
          row,
          "entry_hash_mismatch",
          expectedEntryHash,
          row.entry_hash,
        );
      }

      checkedEntries += 1;
      expectedSequence += BigInt(1);
      expectedPreviousHash = row.entry_hash;
      latestEntryId = row.id;
      scanAfterSequence = sequence;
    }

    if (entriesResult.rows.length < VERIFICATION_PAGE_SIZE) break;
  }

  const latestSequence = (expectedSequence - BigInt(1)).toString();
  const head = headResult.rows[0];
  if (!head) {
    return {
      intact: false,
      checkedEntries,
      brokenAt: { sequence: null, entryId: null },
      reason: "missing_chain_head",
    };
  }

  if (
    !NON_NEGATIVE_DECIMAL_PATTERN.test(head.last_sequence) ||
    !isSha256Hex(head.last_hash)
  ) {
    return {
      intact: false,
      checkedEntries,
      brokenAt: {
        sequence: head.last_sequence ?? null,
        entryId: head.last_entry_id,
      },
      reason: "invalid_chain_head",
    };
  }

  const expectedHeadHash =
    checkedEntries === 0 ? ACTIVITY_CHAIN_GENESIS_HASH : expectedPreviousHash;
  if (
    head.last_sequence !== latestSequence ||
    head.last_hash !== expectedHeadHash ||
    head.last_entry_id !== latestEntryId
  ) {
    return {
      intact: false,
      checkedEntries,
      brokenAt: {
        sequence: head.last_sequence,
        entryId: head.last_entry_id,
      },
      reason: "chain_head_mismatch",
      expectedHash: expectedHeadHash,
      actualHash: head.last_hash,
      expectedSequence: latestSequence,
      actualSequence: head.last_sequence,
    };
  }

  return {
    intact: true,
    checkedEntries,
    latestSequence,
    latestHash: checkedEntries === 0 ? null : expectedPreviousHash,
  };
}

function frameFields(fields: ReadonlyArray<string | null>): string {
  return fields.map((field) => {
    if (field === null) return "-1:";
    return `${Buffer.byteLength(field, "utf8")}:${field}`;
  }).join("");
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Activity ${name} is not in its canonical database form.`);
  }
  return value;
}

function requiredJsonParameter(value: unknown, name: string): string {
  if (value === null || value === undefined) {
    throw new Error(`Activity ${name} is required.`);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error(`Activity ${name} is not JSON serializable.`);
  }
  return serialized;
}

function optionalJsonParameter(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Optional activity JSON content is not serializable.");
  }
  return serialized;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

function assertSha256Hex(value: string, name: string): void {
  if (!isSha256Hex(value)) {
    throw new Error(`${name} must be a lowercase 64-character SHA-256 hex digest.`);
  }
}

function parseNonNegativeSequence(value: string, name: string): bigint {
  if (!NON_NEGATIVE_DECIMAL_PATTERN.test(value)) {
    throw new Error(`${name} must be a non-negative decimal integer.`);
  }
  return BigInt(value);
}

async function appendWithClient(
  client: ActivityChainClient,
  event: ActivityEvent,
  skipExistingId: boolean,
): Promise<
  | { status: "recorded"; event: ActivityEvent }
  | { status: "duplicate" }
> {
  const normalized = await normalizeActivityEventForChain(client, event);

  const headResult = await client.query<ChainHeadRow>(
    `SELECT last_sequence::text, last_hash, last_entry_id
     FROM activity_chain_head
     WHERE scope = $1
     FOR UPDATE`,
    [ACTIVITY_CHAIN_SCOPE],
  );
  const head = headResult.rows[0];
  if (!head) {
    throw new Error(
      "Activity chain head is missing. Run dashboard database migrations before writing activity.",
    );
  }

  if (skipExistingId) {
    const existing = await client.query(
      "SELECT 1 FROM activity_events WHERE id = $1",
      [normalized.id],
    );
    if ((existing.rowCount ?? 0) > 0) {
      return { status: "duplicate" };
    }
  }

  await assertChainHeadMatchesTail(client, head);

  const previousSequence = parseNonNegativeSequence(
    head.last_sequence,
    "Activity chain head sequence",
  );
  assertSha256Hex(head.last_hash, "Activity chain head hash");
  const chainSequence = (previousSequence + BigInt(1)).toString();
  const canonicalEntry: CanonicalActivityChainEntry = {
    chainSequence,
    ...normalized,
  };
  const entryHash = computeActivityEntryHash(canonicalEntry, head.last_hash);

  await client.query(
    `INSERT INTO activity_events (
       id, type, source, severity, actor, "timestamp", description,
       entity, metadata, changes, schema_version,
       chain_sequence, previous_hash, entry_hash
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7,
       $8::jsonb, $9::jsonb, $10::jsonb, $11::integer,
       $12::bigint, $13, $14
     )`,
    [
      normalized.id,
      normalized.type,
      normalized.source,
      normalized.severity,
      normalized.actorJson,
      normalized.timestampUtc,
      normalized.description,
      normalized.entityJson,
      normalized.metadataJson,
      normalized.changesJson,
      normalized.schemaVersion,
      chainSequence,
      head.last_hash,
      entryHash,
    ],
  );

  const updatedHead = await client.query(
    `UPDATE activity_chain_head
     SET last_sequence = $2::bigint,
         last_hash = $3,
         last_entry_id = $4
     WHERE scope = $1
       AND last_sequence = $5::bigint
       AND last_hash = $6`,
    [
      ACTIVITY_CHAIN_SCOPE,
      chainSequence,
      entryHash,
      normalized.id,
      head.last_sequence,
      head.last_hash,
    ],
  );
  if ((updatedHead.rowCount ?? 0) !== 1) {
    throw new Error("Activity chain head changed unexpectedly during append.");
  }

  return {
    status: "recorded",
    event: normalizedContentToActivityEvent(normalized),
  };
}

async function assertChainHeadMatchesTail(
  client: ActivityChainClient,
  head: ChainHeadRow,
): Promise<void> {
  const tailResult = await client.query<ChainTailRow>(
    `SELECT chain_sequence::text, id, entry_hash
     FROM activity_events
     ORDER BY activity_events.chain_sequence DESC
     LIMIT 1`,
  );
  const tail = tailResult.rows[0];

  if (head.last_sequence === "0") {
    if (
      tail ||
      head.last_hash !== ACTIVITY_CHAIN_GENESIS_HASH ||
      head.last_entry_id !== null
    ) {
      throw chainHeadTailMismatchError(head, tail);
    }
    return;
  }

  if (
    !tail ||
    tail.chain_sequence !== head.last_sequence ||
    tail.entry_hash !== head.last_hash ||
    tail.id !== head.last_entry_id
  ) {
    throw chainHeadTailMismatchError(head, tail);
  }
}

function chainHeadTailMismatchError(
  head: ChainHeadRow,
  tail: ChainTailRow | undefined,
): Error {
  return new Error(
    "Activity chain head does not match the persisted chain tail " +
      `(head sequence=${head.last_sequence}, entry=${head.last_entry_id ?? "null"}; ` +
      `tail sequence=${tail?.chain_sequence ?? "none"}, entry=${tail?.id ?? "none"}).`,
  );
}

function normalizedContentToActivityEvent(
  content: NormalizedActivityContent,
): ActivityEvent {
  const event: ActivityEvent = {
    id: content.id,
    type: content.type as ActivityEvent["type"],
    source: content.source as ActivityEvent["source"],
    severity: content.severity as ActivityEvent["severity"],
    actor: JSON.parse(content.actorJson) as ActivityEvent["actor"],
    timestamp: new Date(content.timestampUtc).toISOString(),
    description: content.description,
    schemaVersion: Number(content.schemaVersion),
  };

  if (content.entityJson !== null) {
    event.entity = JSON.parse(content.entityJson) as ActivityEvent["entity"];
  }
  if (content.metadataJson !== null) {
    event.metadata = JSON.parse(content.metadataJson) as ActivityEvent["metadata"];
  }
  if (content.changesJson !== null) {
    event.changes = JSON.parse(content.changesJson) as ActivityEvent["changes"];
  }

  return event;
}

function brokenResult(
  checkedEntries: number,
  row: CanonicalActivityDatabaseRow,
  reason: ActivityChainBreakReason,
  expectedHash?: string,
  actualHash?: string,
): Extract<ActivityChainVerificationResult, { intact: false }> {
  return {
    intact: false,
    checkedEntries,
    brokenAt: {
      sequence: row.chain_sequence ?? null,
      entryId: typeof row.id === "string" ? row.id : null,
    },
    reason,
    ...(expectedHash !== undefined ? { expectedHash } : {}),
    ...(actualHash !== undefined ? { actualHash } : {}),
  };
}
