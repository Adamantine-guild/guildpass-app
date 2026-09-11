export function formatWalletAddress(
  address?: string | null,
  prefixLength = 6,
  suffixLength = 4
): string {
  if (!address || typeof address !== "string") {
    return "—";
  }

  const trimmed = address.trim();
  const prefixOffset = trimmed.startsWith("0x") ? 2 : 0;

  if (trimmed.length <= prefixLength + suffixLength + prefixOffset) {
    return trimmed;
  }

  return `${trimmed.slice(0, prefixLength)}…${trimmed.slice(-suffixLength)}`;
}
