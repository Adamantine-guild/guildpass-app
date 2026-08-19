import { getAddress } from "viem";

export function isValidChecksumAddress(addr: string): boolean {
  try {
    const checksummed = getAddress(addr);
    return checksummed === addr;
  } catch {
    return false;
  }
}

export function normaliseAddress(addr: string): string {
  // getAddress will throw for invalid addresses and returns the checksummed address
  return getAddress(addr);
}

/**
 * Best-effort version of `normaliseAddress` for form inputs: trims whitespace
 * and returns the checksummed address, or `null` if the value isn't a valid
 * Ethereum address (never throws).
 */
export function tryNormaliseAddress(addr: string | null | undefined): string | null {
  if (!addr || typeof addr !== "string") return null;

  const trimmed = addr.trim();
  if (!trimmed) return null;

  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}

export default {
  isValidChecksumAddress,
  normaliseAddress,
  tryNormaliseAddress,
};
