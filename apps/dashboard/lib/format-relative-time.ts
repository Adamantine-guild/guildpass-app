/**
 * Shared relative-time formatter for the GuildPass dashboard.
 *
 * Produces consistent "time ago" strings across all components, removing
 * duplicated inline logic and making future localisation straightforward.
 *
 * Threshold table:
 *   < 5 s      → "just now"
 *   5–59 s     → "Xs ago"
 *   60 s–59 m  → "Xm ago"
 *   1 h–23 h   → "Xh ago"
 *   ≥ 24 h     → "Xd ago"
 *
 * @param date - A Date object or an ISO-8601 string.
 * @param now  - Optional override for "current time" (useful in tests).
 * @returns A human-readable relative time string.
 */
export function formatRelativeTime(date: Date | string, now?: Date): string {
  const target = date instanceof Date ? date : new Date(date);
  const reference = now ?? new Date();

  const diffMs = reference.getTime() - target.getTime();
  // Clamp to zero so future dates (clock skew, optimistic UI) show "just now"
  const secs = Math.max(0, Math.floor(diffMs / 1_000));

  if (secs < 5) return "just now";

  if (secs < 60) return `${secs}s ago`;

  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
