import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createNonceStore, NONCE_TTL_MS } from "../lib/auth/nonce-store";

/**
 * Tests for issue #142 (nonce foundation): nonces must be SIWE-compliant,
 * single-use, and expiring, so a captured SIWE signature cannot be replayed.
 */

describe("nonce-store — issuance", () => {
  test("issues a SIWE-compliant nonce (>= 8 alphanumeric chars)", () => {
    const store = createNonceStore();
    const nonce = store.issue();
    assert.ok(nonce.length >= 8, "nonce must be at least 8 chars");
    assert.match(nonce, /^[a-z0-9]+$/, "nonce must be alphanumeric");
  });

  test("issues distinct nonces", () => {
    const store = createNonceStore();
    const a = store.issue();
    const b = store.issue();
    assert.notEqual(a, b);
  });
});

describe("nonce-store — single use", () => {
  test("a freshly issued nonce consumes exactly once", () => {
    const store = createNonceStore();
    const nonce = store.issue();
    assert.equal(store.consume(nonce), true, "first consume succeeds");
    assert.equal(store.consume(nonce), false, "replay is rejected");
  });

  test("an unknown nonce cannot be consumed", () => {
    const store = createNonceStore();
    assert.equal(store.consume("never-issued"), false);
  });
});

describe("nonce-store — expiry", () => {
  test("a nonce past its TTL is rejected", () => {
    const store = createNonceStore();
    const t0 = 1_000_000;
    const nonce = store.issue(t0);
    // One ms past expiry.
    assert.equal(store.consume(nonce, t0 + NONCE_TTL_MS + 1), false);
  });

  test("a nonce within its TTL is accepted", () => {
    const store = createNonceStore();
    const t0 = 1_000_000;
    const nonce = store.issue(t0);
    assert.equal(store.consume(nonce, t0 + NONCE_TTL_MS - 1), true);
  });

  test("expired records are pruned on the next issue", () => {
    const store = createNonceStore();
    const t0 = 1_000_000;
    store.issue(t0);
    assert.equal(store.size(), 1);
    // Issuing well after expiry prunes the stale record.
    store.issue(t0 + NONCE_TTL_MS + 1);
    assert.equal(store.size(), 1, "stale record pruned, only the new one remains");
  });
});