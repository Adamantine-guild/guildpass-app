import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MOCK_PASSES_METRICS, MOCK_MEMBERS_METRICS } from "./fixtures";

/**
 * metrics.test.ts
 *
 * Tests for dashboard metrics calculations.
 *
 * The dashboard currently derives summary stats from mock data inline inside
 * page components.  These tests establish the expected behaviour as pure
 * functions so the logic can later be extracted to lib/metrics/ without
 * regression.  Every function here matches computation already present in the
 * UI layer.
 */

// ── Pure metric helpers (extracted from page components / mock-data) ──────────
// When lib/metrics/ is created, replace these with real imports.

interface PassRecord {
  id: string;
  status: string;
  currentSupply: number;
  maxSupply: number | null;
  price: number;
}

interface MemberRecord {
  id: string;
  status: string;
}

/** Total minted supply across all passes */
function totalSupply(passes: PassRecord[]): number {
  return passes.reduce((sum, p) => sum + p.currentSupply, 0);
}

/** Count of passes with a given status */
function countByStatus(passes: PassRecord[], status: string): number {
  return passes.filter((p) => p.status === status).length;
}

/** Count of members with a given status */
function countMembersByStatus(members: MemberRecord[], status: string): number {
  return members.filter((m) => m.status === status).length;
}

/** Total available capacity (null maxSupply = unlimited = not counted) */
function totalCapacity(passes: PassRecord[]): number {
  return passes
    .filter((p) => p.maxSupply !== null)
    .reduce((sum, p) => sum + (p.maxSupply as number), 0);
}

/** Average fill-rate for passes that have a maxSupply */
function averageFillRate(passes: PassRecord[]): number {
  const bounded = passes.filter((p) => p.maxSupply !== null && p.maxSupply > 0);
  if (bounded.length === 0) return 0;
  const total = bounded.reduce(
    (sum, p) => sum + p.currentSupply / (p.maxSupply as number),
    0
  );
  return total / bounded.length;
}

/** Cheapest non-zero price among active passes (undefined if none) */
function cheapestActivePrice(passes: PassRecord[]): number | undefined {
  const prices = passes
    .filter((p) => p.status === "active" && p.price > 0)
    .map((p) => p.price);
  return prices.length ? Math.min(...prices) : undefined;
}

// ── Normal dataset ─────────────────────────────────────────────────────────────

describe("Metrics — normal dataset", () => {
  const passes = MOCK_PASSES_METRICS;   // 4 passes (3 active, 1 draft)
  const members = MOCK_MEMBERS_METRICS; // 4 members (2 active, 1 pending, 1 inactive)

  describe("totalSupply", () => {
    test("sums currentSupply across all passes", () => {
      // 42 + 189 + 1203 + 0 = 1434
      assert.equal(totalSupply(passes), 1434);
    });
  });

  describe("countByStatus", () => {
    test("counts active passes correctly", () => {
      assert.equal(countByStatus(passes, "active"), 3);
    });

    test("counts draft passes correctly", () => {
      assert.equal(countByStatus(passes, "draft"), 1);
    });

    test("returns 0 for a status that does not exist", () => {
      assert.equal(countByStatus(passes, "archived"), 0);
    });
  });

  describe("countMembersByStatus", () => {
    test("counts active members correctly", () => {
      assert.equal(countMembersByStatus(members, "active"), 2);
    });

    test("counts pending members correctly", () => {
      assert.equal(countMembersByStatus(members, "pending"), 1);
    });

    test("counts inactive members correctly", () => {
      assert.equal(countMembersByStatus(members, "inactive"), 1);
    });
  });

  describe("totalCapacity", () => {
    test("sums maxSupply for bounded passes, ignoring unlimited ones (null)", () => {
      // 100 + 500 + 50 = 650 (pass id=3 has null maxSupply, excluded)
      assert.equal(totalCapacity(passes), 650);
    });
  });

  describe("averageFillRate", () => {
    test("computes the mean fill-rate across bounded passes", () => {
      // pass 1: 42/100 = 0.42
      // pass 2: 189/500 = 0.378
      // pass 4: 0/50 = 0.00
      // (pass 3 excluded — unlimited)
      // avg = (0.42 + 0.378 + 0) / 3 ≈ 0.266
      const rate = averageFillRate(passes);
      assert.ok(
        Math.abs(rate - (0.42 + 0.378 + 0) / 3) < 0.0001,
        `Expected ~0.266, got ${rate}`
      );
    });
  });

  describe("cheapestActivePrice", () => {
    test("returns the lowest non-zero price among active passes", () => {
      // active passes with price > 0: 0.1 (pass 1), 0.05 (pass 2)
      // pass 3 is active but price is 0, so excluded
      assert.equal(cheapestActivePrice(passes), 0.05);
    });
  });
});

// ── Empty dataset ──────────────────────────────────────────────────────────────

describe("Metrics — empty dataset", () => {
  const noPasses: PassRecord[] = [];
  const noMembers: MemberRecord[] = [];

  test("totalSupply of empty list is 0", () => {
    assert.equal(totalSupply(noPasses), 0);
  });

  test("countByStatus of empty list is 0", () => {
    assert.equal(countByStatus(noPasses, "active"), 0);
  });

  test("countMembersByStatus of empty list is 0", () => {
    assert.equal(countMembersByStatus(noMembers, "active"), 0);
  });

  test("totalCapacity of empty list is 0", () => {
    assert.equal(totalCapacity(noPasses), 0);
  });

  test("averageFillRate of empty list is 0 (no division by zero)", () => {
    assert.equal(averageFillRate(noPasses), 0);
  });

  test("cheapestActivePrice of empty list is undefined", () => {
    assert.equal(cheapestActivePrice(noPasses), undefined);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe("Metrics — edge cases", () => {
  test("totalSupply handles all-zero currentSupply", () => {
    const zeroPasses: PassRecord[] = [
      { id: "a", status: "active", currentSupply: 0, maxSupply: 100, price: 0 },
    ];
    assert.equal(totalSupply(zeroPasses), 0);
  });

  test("averageFillRate returns 0 when all passes have unlimited supply", () => {
    const unlimitedPasses: PassRecord[] = [
      { id: "a", status: "active", currentSupply: 500, maxSupply: null, price: 0 },
    ];
    assert.equal(averageFillRate(unlimitedPasses), 0);
  });

  test("cheapestActivePrice returns undefined when all active passes are free", () => {
    const freePasses: PassRecord[] = [
      { id: "a", status: "active", currentSupply: 0, maxSupply: null, price: 0 },
    ];
    assert.equal(cheapestActivePrice(freePasses), undefined);
  });

  test("totalCapacity excludes passes with null maxSupply", () => {
    const mixed: PassRecord[] = [
      { id: "a", status: "active", currentSupply: 0, maxSupply: null, price: 0 },
      { id: "b", status: "active", currentSupply: 0, maxSupply: 200, price: 0 },
    ];
    assert.equal(totalCapacity(mixed), 200);
  });

  test("countByStatus is case-sensitive", () => {
    const passes: PassRecord[] = [
      { id: "a", status: "Active", currentSupply: 0, maxSupply: 10, price: 0 },
    ];
    assert.equal(countByStatus(passes, "active"), 0); // lowercase won't match "Active"
  });
});