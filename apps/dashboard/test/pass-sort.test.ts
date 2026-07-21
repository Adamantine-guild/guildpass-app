import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Pass } from "../lib/mock-data";
import { sortPasses, type PassSortState } from "../lib/pass-sort";

const passes: Pass[] = [
  {
    id: "free",
    name: "Free",
    description: "No price or supply cap",
    status: "draft",
    currentSupply: 50,
    maxSupply: null,
    createdAt: "2025-03-01T00:00:00Z",
  },
  {
    id: "nearly-full",
    name: "Nearly full",
    description: "Almost sold out",
    status: "active",
    price: 0.5,
    currentSupply: 90,
    maxSupply: 100,
    createdAt: "2025-02-01T00:00:00Z",
  },
  {
    id: "half-full",
    name: "Half full",
    description: "Half sold",
    status: "inactive",
    price: 0.1,
    currentSupply: 5,
    maxSupply: 10,
    createdAt: "2025-01-01T00:00:00Z",
  },
];

function idsFor(sort: PassSortState): string[] {
  return sortPasses(passes, sort).map((pass) => pass.id);
}

describe("sortPasses", () => {
  test("sorts prices in both directions and keeps missing prices last", () => {
    assert.deepEqual(idsFor({ column: "price", direction: "ascending" }), [
      "half-full",
      "nearly-full",
      "free",
    ]);
    assert.deepEqual(idsFor({ column: "price", direction: "descending" }), [
      "nearly-full",
      "half-full",
      "free",
    ]);
  });

  test("sorts supply by utilization and keeps unlimited passes last", () => {
    assert.deepEqual(idsFor({ column: "supply", direction: "ascending" }), [
      "half-full",
      "nearly-full",
      "free",
    ]);
    assert.deepEqual(idsFor({ column: "supply", direction: "descending" }), [
      "nearly-full",
      "half-full",
      "free",
    ]);
  });

  test("sorts status and creation date", () => {
    assert.deepEqual(idsFor({ column: "status", direction: "ascending" }), [
      "nearly-full",
      "free",
      "half-full",
    ]);
    assert.deepEqual(idsFor({ column: "createdAt", direction: "descending" }), [
      "free",
      "nearly-full",
      "half-full",
    ]);
  });

  test("returns a stable copy without mutating the input", () => {
    const samePrice = passes.map((pass) => ({ ...pass, price: 1 }));
    const originalOrder = samePrice.map((pass) => pass.id);

    const result = sortPasses(samePrice, { column: "price", direction: "ascending" });

    assert.notEqual(result, samePrice);
    assert.deepEqual(result.map((pass) => pass.id), originalOrder);
    assert.deepEqual(samePrice.map((pass) => pass.id), originalOrder);
  });
});
