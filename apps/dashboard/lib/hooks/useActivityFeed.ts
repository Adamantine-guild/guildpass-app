"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ActivityEvent } from "@guildpass/integration-client";

const REFRESH_MS =
  Number(process.env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS) || 15_000;

interface UseActivityFeedOptions {
  /** How many events to surface at most (default: unlimited). */
  limit?: number;
}

interface UseActivityFeedResult {
  events: ActivityEvent[];
  lastUpdated: Date | null;
  loading: boolean;
}

export function useActivityFeed({ limit }: UseActivityFeedOptions = {}): UseActivityFeedResult {
  const [events, setEvents]           = useState<ActivityEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading]         = useState(true);
  const seenIds                       = useRef(new Set<string>());

  const mergeEvents = useCallback((incoming: ActivityEvent[]) => {
    const fresh = incoming.filter((e) => !seenIds.current.has(e.id));
    if (fresh.length === 0 && events.length > 0) return;

    fresh.forEach((e) => seenIds.current.add(e.id));
    setEvents((prev) => {
      const merged = [...fresh, ...prev].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const unique = Array.from(new Map(merged.map(item => [item.id, item])).values());
      return limit ? unique.slice(0, limit) : unique;
    });
    setLastUpdated(new Date());
  }, [limit, events.length]);

  /** Single poll tick: fetch real data. */
  const poll = useCallback(async () => {
    try {
      const url = new URL("/api/activity", window.location.origin);
      if (limit) url.searchParams.set("limit", limit.toString());

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error("Failed to fetch activity");
      const data = await response.json();
      mergeEvents(data);
    } catch (error) {
      console.warn("Error polling activity:", error);
    } finally {
      setLoading(false);
    }
  }, [mergeEvents, limit]);

  useEffect(() => {
    // Initial load
    poll();

    const tick = () => {
      // Pause polling while the tab is hidden to avoid wasted requests
      if (document.visibilityState === "visible") poll();
    };

    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [poll]);

  return { events, lastUpdated, loading };
}
