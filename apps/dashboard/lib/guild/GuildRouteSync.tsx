"use client";

import { useEffect } from "react";
import { useGuild } from "./GuildProvider";

/**
 * Pins the active guild from a route param (`/guilds/[guildId]/…`) into shared
 * context without nesting another GuildProvider.
 */
export function GuildRouteSync({ guildId }: { guildId: string }) {
  const { guildId: activeId, setGuildId } = useGuild();

  useEffect(() => {
    if (guildId && guildId !== activeId) {
      setGuildId(guildId);
    }
  }, [guildId, activeId, setGuildId]);

  return null;
}
