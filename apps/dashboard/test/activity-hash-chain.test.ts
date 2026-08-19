import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVITY_CHAIN_GENESIS_HASH,
  computeActivityEntryHash,
  serializeCanonicalActivityEntry,
  type CanonicalActivityChainEntry,
} from "../lib/activity/hash-chain";
import { DurableActivityRepository } from "../lib/repositories/adapters/durable";

const ENTRY: CanonicalActivityChainEntry = {
  chainSequence: "1",
  id: "evt:α",
  type: "member.joined",
  source: "dashboard",
  severity: "info",
  actorJson: '{"name": "Alice"}',
  timestampUtc: "2025-01-15T12:00:00.000000Z",
  description: "Alice: joined | safely",
  entityJson: null,
  metadataJson: '{"a": 1, "b": 2}',
  changesJson: null,
  schemaVersion: "2",
};

describe("activity hash-chain canonical format", () => {
  test("serialization is deterministic and length-frames UTF-8 content", () => {
    const first = serializeCanonicalActivityEntry(ENTRY);
    const second = serializeCanonicalActivityEntry({ ...ENTRY });

    assert.equal(first, second);
    assert.match(first, /evt:α/);
    assert.notEqual(
      first,
      serializeCanonicalActivityEntry({
        ...ENTRY,
        description: `${ENTRY.description}!`,
      }),
    );
  });

  test("hash binds both canonical content and the predecessor", () => {
    const baseHash = computeActivityEntryHash(
      ENTRY,
      ACTIVITY_CHAIN_GENESIS_HASH,
    );
    const contentChanged = computeActivityEntryHash(
      { ...ENTRY, severity: "warning" },
      ACTIVITY_CHAIN_GENESIS_HASH,
    );
    const predecessorChanged = computeActivityEntryHash(
      ENTRY,
      "f".repeat(64),
    );

    assert.match(baseHash, /^[0-9a-f]{64}$/);
    assert.equal(
      baseHash,
      "6d03294552fbf45633d7b2b324f47a42155389f177fda7b4ef2ff0232b01759c",
      "format-v1 known vector must remain stable for historical migrations",
    );
    assert.notEqual(contentChanged, baseHash);
    assert.notEqual(predecessorChanged, baseHash);
    assert.equal(
      computeActivityEntryHash(ENTRY, ACTIVITY_CHAIN_GENESIS_HASH),
      baseHash,
    );
  });

  test("genesis predecessor is the documented all-zero SHA-256 value", () => {
    assert.equal(ACTIVITY_CHAIN_GENESIS_HASH, "0".repeat(64));
  });

  test("mock repository events remain unhashed application events", async () => {
    const repository = new DurableActivityRepository("mock://activity-chain");
    const event = await repository.append("guild-1", {
      type: "member.joined",
      source: "dashboard",
      severity: "info",
      actor: { name: "Alice" },
      description: "Alice joined",
    });

    assert.equal(event.description, "Alice joined");
    assert.equal("chainSequence" in event, false);
    assert.equal("previousHash" in event, false);
    assert.equal("entryHash" in event, false);
  });
});
