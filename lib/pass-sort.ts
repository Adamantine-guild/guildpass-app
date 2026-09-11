import type { Pass } from "./mock-data";

export type PassSortColumn = "price" | "supply" | "status" | "createdAt";
export type PassSortDirection = "ascending" | "descending";

export interface PassSortState {
  column: PassSortColumn;
  direction: PassSortDirection;
}

type Comparable = number | string;

function compareValues(
  left: Comparable | null | undefined,
  right: Comparable | null | undefined,
  direction: PassSortDirection
): number {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;

  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }

  const comparison =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));

  return direction === "ascending" ? comparison : -comparison;
}

function supplyUtilization(pass: Pass): number | null {
  if (pass.maxSupply === null || pass.maxSupply === undefined || pass.maxSupply <= 0) {
    return null;
  }

  return pass.currentSupply / pass.maxSupply;
}

function valueForColumn(pass: Pass, column: PassSortColumn): Comparable | null | undefined {
  switch (column) {
    case "price":
      return pass.price;
    case "supply":
      return supplyUtilization(pass);
    case "status":
      return pass.status;
    case "createdAt": {
      const timestamp = Date.parse(pass.createdAt);
      return Number.isNaN(timestamp) ? null : timestamp;
    }
  }
}

/** Returns a stable sorted copy without changing the input array. */
export function sortPasses(passes: readonly Pass[], sort: PassSortState): Pass[] {
  return passes
    .map((pass, index) => ({ pass, index }))
    .sort((left, right) => {
      const comparison = compareValues(
        valueForColumn(left.pass, sort.column),
        valueForColumn(right.pass, sort.column),
        sort.direction
      );

      if (comparison !== 0) return comparison;

      if (sort.column === "supply") {
        const supplyComparison = compareValues(
          left.pass.currentSupply,
          right.pass.currentSupply,
          sort.direction
        );
        if (supplyComparison !== 0) return supplyComparison;
      }

      return left.index - right.index;
    })
    .map(({ pass }) => pass);
}
