/**
 * Guild (tenant) scope resolution for API route handlers.
 *
 * The repository layer requires an explicit `guildId` on every pass/member
 * operation (see docs/multi-tenancy.md). Route handlers obtain that scope
 * from here rather than hard-coding IDs, so there is a single place to swap
 * in real per-session guild resolution.
 *
 * Today the dashboard operates on a single workspace guild, so this resolves
 * to DEFAULT_GUILD_ID. Once per-guild RBAC (issue #67) lands, this should
 * derive the guild from the authenticated session instead — never from
 * unauthenticated client input.
 */

import { DEFAULT_GUILD_ID } from "./mock-data";

/** Returns the guild scope for the current request. */
export function getActiveGuildId(): string {
  return DEFAULT_GUILD_ID;
}
