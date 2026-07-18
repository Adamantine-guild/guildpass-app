import { test } from "node:test";
import assert from "node:assert/strict";
import { getRangeForOffset } from "../components/VirtualList";

test("getRangeForOffset computes a small window for large totals", () => {
  const total = 500;
  const viewportHeight = 720; // typical viewport
  const itemHeight = 88;
  const overscan = 3;

  const { start, end, paddingTop, paddingBottom } = getRangeForOffset({
    total,
    viewportHeight,
    itemHeight,
    scrollTop: 0,
    overscan,
  });

  const visibleCount = Math.ceil(viewportHeight / itemHeight);
  const expectedWindow = visibleCount + overscan * 2;

  // Window length should equal end - start
  assert.equal(end - start, expectedWindow);

  // Padding sums should equal total*itemHeight minus rendered window height
  const renderedHeights = (end - start) * itemHeight;
  assert.equal(paddingTop + paddingBottom + renderedHeights, total * itemHeight);
});
