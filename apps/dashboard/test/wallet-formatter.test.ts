import { describe, it, expect } from "vitest";
import { formatWalletAddress } from "../lib/formatters/wallet";

describe("formatWalletAddress", () => {
  it("formats a standard long wallet address correctly", () => {
    const wallet = "0x742d35Cc6634C0532925a3b8879539d43374e290";
    expect(formatWalletAddress(wallet)).toBe("0x742d…e290");
  });

  it("handles custom prefix and suffix lengths", () => {
    const wallet = "0x742d35Cc6634C0532925a3b8879539d43374e290";
    expect(formatWalletAddress(wallet, 4, 3)).toBe("0x74…290");
  });

  it("returns the full address if it is shorter than prefix + suffix", () => {
    const shortWallet = "0x123456";
    expect(formatWalletAddress(shortWallet)).toBe("0x123456");
  });

  it("returns the full address if it is exactly prefix + suffix", () => {
    const exactWallet = "0x1234abcd";
    expect(formatWalletAddress(exactWallet, 4, 4)).toBe("0x1234abcd");
  });

  it("handles missing or null wallet values gracefully", () => {
    expect(formatWalletAddress(null)).toBe("—");
    expect(formatWalletAddress(undefined)).toBe("—");
    expect(formatWalletAddress("")).toBe("—");
  });

  it("handles whitespace padding gracefully", () => {
    const wallet = "  0x742d35Cc6634C0532925a3b8879539d43374e290  ";
    expect(formatWalletAddress(wallet)).toBe("0x742d…e290");
  });

  it("handles mixed-case wallet values without altering case", () => {
    const wallet = "0xABCDefghIJKLmnopQRSTuvwxYZ1234567890abcd";
    expect(formatWalletAddress(wallet)).toBe("0xABCD…abcd");
  });
});
