/**
 * lib/settings.ts
 *
 * Typed model for workspace dashboard settings. These are *public* settings —
 * safe to read by any authenticated role (settings:read) and to update with
 * settings:write. Secret values must NOT live here; they stay write-only and
 * server-side if added later (see issue #80 notes).
 */

import { SUPPORTED_TIMEZONES } from "@/lib/timezones";

export interface DashboardSettings {
  /** Display name of the workspace. */
  workspaceName: string;
  /** IANA timezone identifier (constrained to the supported set below). */
  timezone: string;
  /** Display name shown for the current operator profile. */
  displayName: string;
  /** Contact email for the workspace profile. */
  email: string;
}

/**
 * Timezones the UI offers and the API accepts. Kept in lockstep with the
 * <select> options on the settings page so the two cannot drift.
 */
export const ALLOWED_TIMEZONES = SUPPORTED_TIMEZONES;

export type AllowedTimezone = (typeof ALLOWED_TIMEZONES)[number];

/** Max length for free-text settings fields. */
export const MAX_TEXT_LENGTH = 50;

/**
 * Seed values used by the mock repository. Mirror the defaults the settings
 * page previously hard-coded so behaviour is unchanged on a fresh process.
 */
export const DEFAULT_SETTINGS: DashboardSettings = {
  workspaceName: "GuildPass DAO",
  timezone: "UTC",
  displayName: "Admin",
  email: "admin@guildpass.xyz",
};
