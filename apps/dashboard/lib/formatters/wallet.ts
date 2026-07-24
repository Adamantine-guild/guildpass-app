export function formatWalletAddress(
  address?: string | null,
  prefixLength = 6,
  suffixLength = 4
): string {
  if (!address || typeof address !== "string") {
    return "—";
  }

  const trimmed = address.trim();

  if (trimmed.length <= prefixLength + suffixLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, prefixLength)}…${trimmed.slice(-suffixLength)}`;
}
