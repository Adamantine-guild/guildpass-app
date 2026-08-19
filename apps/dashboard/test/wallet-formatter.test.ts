import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatWalletAddress } from "../lib/formatters/wallet";

describe("formatWalletAddress", () => {
  test("formats a standard long wallet address correctly", () => {
    const wallet = "0x742d35Cc6634C0532925a3b8879539d43374e290";
    assert.equal(formatWalletAddress(wallet), "0x742d…e290");
  });

  test("handles custom prefix and suffix lengths", () => {
    const wallet = "0x742d35Cc6634C0532925a3b8879539d43374e290";
    assert.equal(formatWalletAddress(wallet, 4, 3), "0x74…290");
  });

  test("returns the full address if it is shorter than prefix + suffix", () => {
    const shortWallet = "0x123456";
    assert.equal(formatWalletAddress(shortWallet), "0x123456");
  });

  test("returns the full address if it is exactly prefix + suffix", () => {
    const exactWallet = "0x1234abcd";
    assert.equal(formatWalletAddress(exactWallet, 4, 4), "0x1234abcd");
  });

  test("handles missing or null wallet values gracefully", () => {
    assert.equal(formatWalletAddress(null), "—");
    assert.equal(formatWalletAddress(undefined), "—");
    assert.equal(formatWalletAddress(""), "—");
  });

  test("handles whitespace padding gracefully", () => {
    const wallet = "  0x742d35Cc6634C0532925a3b8879539d43374e290  ";
    assert.equal(formatWalletAddress(wallet), "0x742d…e290");
  });

  test("handles mixed-case wallet values without altering case", () => {
    const wallet = "0xABCDefghIJKLmnopQRSTuvwxYZ1234567890abcd";
    assert.equal(formatWalletAddress(wallet), "0xABCD…abcd");
  });
});
