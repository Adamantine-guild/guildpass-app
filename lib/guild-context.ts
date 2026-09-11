/**
 * Guild (tenant) scope resolution for API route handlers and shared constants.
 *
 * The repository layer requires an explicit `guildId` on every pass/member
 * operation (see docs/multi-tenancy.md). Route handlers obtain that scope
 * from here rather than hard-coding IDs, so there is a single place to swap
 * in real per-session guild resolution.
 *
 * Resolution order when a Request is provided:
 *   1. `X-Guild-Id` header (set by the dashboard client for the selected guild)
 *   2. `guildpass_guild_id` cookie (persisted selection across navigations)
 *   3. DEFAULT_GUILD_ID fallback for unscoped callers (tests, scripts)
 *
 * Once per-guild RBAC (issue #67) lands, this should also verify the
 * authenticated session is allowed to act on the resolved guild.
 */

import { DEFAULT_GUILD_ID } from "./mock-data";

/** Request header the dashboard client sends with the selected guild. */
export const GUILD_ID_HEADER = "x-guild-id";

/** Cookie that persists the operator's selected guild across page loads. */
export const GUILD_ID_COOKIE = "guildpass_guild_id";

/**
 * Basic format check: non-empty, no whitespace, reasonable length.
 * Existence of the guild is validated at the UI/route layer (not-found page).
 */
export function isGuildIdFormat(value: string): boolean {
  return value.length > 0 && value.length <= 64 && !/\s/.test(value);
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      const value = rest.join("=").trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

/**
 * Returns the guild scope for the current request.
 *
 * When called without a request (legacy / test helpers), falls back to the
 * default seeded guild so existing unscoped callers keep working.
 */
export function getActiveGuildId(request?: Request): string {
  if (!request) {
    return DEFAULT_GUILD_ID;
  }

  const fromHeader = request.headers.get(GUILD_ID_HEADER)?.trim();
  if (fromHeader && isGuildIdFormat(fromHeader)) {
    return fromHeader;
  }

  const fromCookie = readCookie(request.headers.get("cookie"), GUILD_ID_COOKIE);
  if (fromCookie && isGuildIdFormat(fromCookie)) {
    return fromCookie;
  }

  return DEFAULT_GUILD_ID;
}

/** Build request headers that carry the active guild scope. */
export function guildScopeHeaders(guildId: string, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (guildId && isGuildIdFormat(guildId)) {
    headers.set(GUILD_ID_HEADER, guildId);
  }
  return headers;
}
