import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isValidChecksumAddress, normaliseAddress, tryNormaliseAddress } from "../lib/address";

const CHECKSUMMED = "0x742d35cC6634c0532925a3B8879539d43374E290";
const LOWERCASE = CHECKSUMMED.toLowerCase();
const UPPERCASE = "0x" + CHECKSUMMED.slice(2).toUpperCase();
const BAD_CHECKSUM = "0x742d35cc6634C0532925a3B8879539d43374E290"; // mixed case, wrong checksum
const MALFORMED = "0x123456"; // too short
const EMPTY = "";
const WHITESPACE = "   ";

describe("isValidChecksumAddress", () => {
  test("accepts an already-checksummed address", () => {
    assert.equal(isValidChecksumAddress(CHECKSUMMED), true);
  });

  test("rejects an all-lowercase address (not checksummed)", () => {
    assert.equal(isValidChecksumAddress(LOWERCASE), false);
  });

  test("rejects an all-uppercase address (not checksummed)", () => {
    assert.equal(isValidChecksumAddress(UPPERCASE), false);
  });

  test("rejects a mixed-case address with an incorrect checksum", () => {
    assert.equal(isValidChecksumAddress(BAD_CHECKSUM), false);
  });

  test("rejects a malformed address", () => {
    assert.equal(isValidChecksumAddress(MALFORMED), false);
  });

  test("rejects an empty string", () => {
    assert.equal(isValidChecksumAddress(EMPTY), false);
  });
});

describe("normaliseAddress", () => {
  test("returns the checksummed form of a lowercase address", () => {
    assert.equal(normaliseAddress(LOWERCASE), CHECKSUMMED);
  });

  test("returns the checksummed form of an uppercase address", () => {
    assert.equal(normaliseAddress(UPPERCASE), CHECKSUMMED);
  });

  test("returns an already-checksummed address unchanged", () => {
    assert.equal(normaliseAddress(CHECKSUMMED), CHECKSUMMED);
  });

  test("normalises a mixed-case address with an incorrect checksum to the canonical form", () => {
    // getAddress recomputes the checksum from the underlying hex digits — it
    // corrects bad casing rather than treating it as invalid. Only
    // `isValidChecksumAddress` rejects non-canonical casing.
    assert.equal(normaliseAddress(BAD_CHECKSUM), CHECKSUMMED);
  });

  test("throws for a malformed address", () => {
    assert.throws(() => normaliseAddress(MALFORMED));
  });
});

describe("tryNormaliseAddress", () => {
  test("normalises a valid lowercase address", () => {
    assert.equal(tryNormaliseAddress(LOWERCASE), CHECKSUMMED);
  });

  test("normalises a valid uppercase address", () => {
    assert.equal(tryNormaliseAddress(UPPERCASE), CHECKSUMMED);
  });

  test("normalises an already-checksummed address", () => {
    assert.equal(tryNormaliseAddress(CHECKSUMMED), CHECKSUMMED);
  });

  test("normalises a mixed-case address with an incorrect checksum to the canonical form", () => {
    assert.equal(tryNormaliseAddress(BAD_CHECKSUM), CHECKSUMMED);
  });

  test("returns null for a malformed address", () => {
    assert.equal(tryNormaliseAddress(MALFORMED), null);
  });

  test("returns null for an empty string", () => {
    assert.equal(tryNormaliseAddress(EMPTY), null);
  });

  test("returns null for whitespace-only input", () => {
    assert.equal(tryNormaliseAddress(WHITESPACE), null);
  });

  test("trims surrounding whitespace before normalising", () => {
    assert.equal(tryNormaliseAddress(`  ${LOWERCASE}  `), CHECKSUMMED);
  });

  test("returns null for null or undefined input", () => {
    assert.equal(tryNormaliseAddress(null), null);
    assert.equal(tryNormaliseAddress(undefined), null);
  });
});
