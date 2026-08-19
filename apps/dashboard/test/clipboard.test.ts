import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { copyToClipboard } from "../lib/clipboard";

const WALLET = "0x742d35cC6634c0532925a3B8879539d43374E290";

/**
 * `navigator` is a getter-only global in Node, so it must be overridden via
 * `Object.defineProperty` (a plain assignment throws in strict-mode ESM).
 */
async function withStubbedNavigator<T>(stub: unknown, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  Object.defineProperty(globalThis, "navigator", {
    value: stub,
    configurable: true,
    writable: true,
  });

  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "navigator", original);
    }
  }
}

describe("copyToClipboard", () => {
  test("returns true and writes the given text when the clipboard API succeeds", async () => {
    const written: string[] = [];

    const result = await withStubbedNavigator(
      {
        clipboard: {
          writeText: async (text: string) => {
            written.push(text);
          },
        },
      },
      () => copyToClipboard(WALLET)
    );

    assert.equal(result, true);
    assert.deepEqual(written, [WALLET]);
  });

  test("returns false when the clipboard API rejects", async () => {
    const result = await withStubbedNavigator(
      {
        clipboard: {
          writeText: async () => {
            throw new Error("Clipboard permission denied");
          },
        },
      },
      () => copyToClipboard(WALLET)
    );

    assert.equal(result, false);
  });

  test("returns false when clipboard access is unavailable", async () => {
    const result = await withStubbedNavigator({}, () => copyToClipboard(WALLET));

    assert.equal(result, false);
  });
});
