/**
 * Guild-scoped fetch helpers for dashboard client pages.
 * Attaches the selected guild as `X-Guild-Id` so API routes resolve the
 * same tenant scope as the UI.
 */

import { guildScopeHeaders } from "@/lib/guild-context";

/**
 * `fetch` wrapper that always sends the active guild scope header.
 * Use this for passes, members, activity, settings, and export calls.
 */
export function guildFetch(
  input: RequestInfo | URL,
  guildId: string,
  init?: RequestInit
): Promise<Response> {
  const headers = guildScopeHeaders(guildId, init?.headers);
  return fetch(input, { ...init, headers });
}
