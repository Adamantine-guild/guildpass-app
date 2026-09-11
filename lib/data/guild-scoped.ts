/**
 * Guild-scoped data access helpers.
 *
 * These pure helpers filter mock / in-memory collections by `guildId` and
 * mirror the interface live API adapters will use once multi-guild endpoints
 * are fully wired. Prefer these over ad-hoc `.filter()` calls in UI/API code.
 */

import {
  mockActivity,
  mockGuilds,
  mockMembers,
  mockPasses,
  type Activity,
  type Guild,
  type Member,
  type Pass,
} from "../mock-data";

/** Look up a guild by id. Returns null when unknown. */
export function getGuildById(guildId: string): Guild | null {
  return mockGuilds.find((guild) => guild.id === guildId) ?? null;
}

/** Whether a guild id exists in the known guild catalogue. */
export function guildExists(guildId: string): boolean {
  return mockGuilds.some((guild) => guild.id === guildId);
}

/** All seeded guilds (workspace catalogue — not further tenant-scoped). */
export function listGuilds(): Guild[] {
  return [...mockGuilds];
}

/** Passes belonging to the given guild. */
export function getPassesForGuild(guildId: string): Pass[] {
  return mockPasses.filter((pass) => pass.guildId === guildId);
}

/** Members belonging to the given guild. */
export function getMembersForGuild(guildId: string): Member[] {
  return mockMembers.filter((member) => member.guildId === guildId);
}

/** Activity events belonging to the given guild. */
export function getActivityForGuild(guildId: string): Activity[] {
  return mockActivity.filter((event) => event.guildId === guildId);
}

/**
 * Extract a guild id from an ActivityEvent-like object.
 * Prefers `metadata.guildId`, then entity.id when entity.type === "guild".
 */
export function activityEventGuildId(event: {
  metadata?: Record<string, unknown> | null;
  entity?: { type?: string; id?: string } | null;
}): string | undefined {
  const fromMeta = event.metadata?.guildId;
  if (typeof fromMeta === "string" && fromMeta.length > 0) {
    return fromMeta;
  }
  if (event.entity?.type === "guild" && typeof event.entity.id === "string") {
    return event.entity.id;
  }
  return undefined;
}

/** Filter ActivityEvent records to a single guild scope. */
export function filterActivityEventsByGuild<
  T extends {
    metadata?: Record<string, unknown> | null;
    entity?: { type?: string; id?: string } | null;
  },
>(events: T[], guildId: string): T[] {
  return events.filter((event) => {
    const eventGuildId = activityEventGuildId(event);
    // Events without a guild tag are treated as unscoped and excluded when
    // a tenant is selected — avoids leaking workspace-wide noise into a
    // community-scoped feed.
    return eventGuildId === guildId;
  });
}
