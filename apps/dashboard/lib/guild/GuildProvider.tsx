"use client";

/**
 * Client-side guild (tenant) context.
 *
 * Selected guild is resolved from:
 *   1. Explicit `initialGuildId` (route `/guilds/[guildId]/…`)
 *   2. Cookie / localStorage persistence
 *   3. DEFAULT_GUILD_ID
 *
 * Switching guilds updates context + cookie so API calls (`X-Guild-Id`) and
 * subsequent navigations stay in sync. Consumers should key data fetches on
 * `guildId` so content never goes stale after a switch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_GUILD_ID,
  mockGuilds,
  type Guild,
} from "@/lib/mock-data";
import { GUILD_ID_COOKIE, isGuildIdFormat } from "@/lib/guild-context";
import { dashboardQueryCache, queryKeys } from "@/lib/cache/query-cache";
import { useQueryInvalidation } from "@/lib/cache/use-query-invalidation";

const STORAGE_KEY = "guildpass_selected_guild";

type GuildContextValue = {
  /** Currently selected guild id (never empty). */
  guildId: string;
  /** Resolved guild metadata when known; null if catalogue not yet loaded. */
  guild: Guild | null;
  /** Full catalogue for the guild switcher. */
  guilds: Guild[];
  /** True while the catalogue is loading from the API. */
  loading: boolean;
  /** Select a guild and persist the choice. */
  setGuildId: (id: string) => void;
  /** Replace the catalogue (e.g. after /api/guilds fetch). */
  setGuilds: (guilds: Guild[]) => void;
};

const GuildContext = createContext<GuildContextValue | null>(null);

function readStoredGuildId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromStorage = window.localStorage.getItem(STORAGE_KEY);
    if (fromStorage && isGuildIdFormat(fromStorage)) return fromStorage;
  } catch {
    /* private mode / blocked storage */
  }

  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GUILD_ID_COOKIE}=`));
  if (match) {
    const value = decodeURIComponent(match.slice(GUILD_ID_COOKIE.length + 1));
    if (isGuildIdFormat(value)) return value;
  }
  return null;
}

function persistGuildId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  // 1 year; path=/ so API routes receive the cookie on same origin.
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${GUILD_ID_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function GuildProvider({
  children,
  initialGuildId,
  initialGuilds = mockGuilds,
}: {
  children: ReactNode;
  /** When set (route param), takes precedence over stored selection. */
  initialGuildId?: string;
  initialGuilds?: Guild[];
}) {
  const [guilds, setGuilds] = useState<Guild[]>(initialGuilds);
  const [guildId, setGuildIdState] = useState<string>(() => {
    if (initialGuildId && isGuildIdFormat(initialGuildId)) {
      return initialGuildId;
    }
    return DEFAULT_GUILD_ID;
  });
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const guildsRevision = useQueryInvalidation(queryKeys.guilds());

  // Hydrate from storage once on the client when the route did not pin a guild.
  useEffect(() => {
    if (initialGuildId && isGuildIdFormat(initialGuildId)) {
      setGuildIdState(initialGuildId);
      persistGuildId(initialGuildId);
      setHydrated(true);
      return;
    }
    const stored = readStoredGuildId();
    if (stored) {
      setGuildIdState(stored);
    }
    setHydrated(true);
  }, [initialGuildId]);

  // Keep state in sync when navigating between /guilds/[guildId] routes.
  useEffect(() => {
    if (initialGuildId && isGuildIdFormat(initialGuildId) && initialGuildId !== guildId) {
      setGuildIdState(initialGuildId);
      persistGuildId(initialGuildId);
    }
  }, [initialGuildId, guildId]);

  // Load live catalogue so the switcher reflects create/delete.
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const list = await dashboardQueryCache.fetchQuery(queryKeys.guilds(), async () => {
          const res = await fetch("/api/guilds");
          if (!res.ok) throw new Error(`Guild request failed with ${res.status}`);
          const payload = (await res.json()) as { ok?: boolean; data?: Guild[] } | Guild[];
          return Array.isArray(payload)
            ? payload
            : payload && typeof payload === "object" && payload.ok && Array.isArray(payload.data)
              ? payload.data
              : [];
        });
        if (mounted && list && list.length > 0) {
          setGuilds(list);
        }
      } catch {
        /* keep seed catalogue */
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [guildsRevision]);

  const setGuildId = useCallback((id: string) => {
    if (!isGuildIdFormat(id)) return;
    setGuildIdState(id);
    persistGuildId(id);
  }, []);

  const guild = useMemo(
    () => guilds.find((g) => g.id === guildId) ?? null,
    [guilds, guildId]
  );

  const value = useMemo<GuildContextValue>(
    () => ({
      guildId: hydrated ? guildId : initialGuildId && isGuildIdFormat(initialGuildId)
        ? initialGuildId
        : guildId,
      guild,
      guilds,
      loading,
      setGuildId,
      setGuilds,
    }),
    [guild, guildId, guilds, hydrated, initialGuildId, loading, setGuildId]
  );

  return <GuildContext.Provider value={value}>{children}</GuildContext.Provider>;
}

export function useGuild(): GuildContextValue {
  const ctx = useContext(GuildContext);
  if (!ctx) {
    throw new Error("useGuild must be used within a GuildProvider");
  }
  return ctx;
}

/** Safe variant for optional usage outside the provider (returns null). */
export function useOptionalGuild(): GuildContextValue | null {
  return useContext(GuildContext);
}
