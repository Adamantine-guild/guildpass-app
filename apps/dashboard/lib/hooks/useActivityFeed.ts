"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ActivityEvent,
  type ActivityEventEntity,
  type ActivityEventSeverity,
  type ActivityEventSource,
  type ActivityEventType,
} from "@guildpass/integration-client";
import { fetchActivity, generateMockActivity } from "@/lib/mock-data";

const REFRESH_MS =
  Number(process.env.NEXT_PUBLIC_ACTIVITY_REFRESH_MS) || 15_000;

interface UseActivityFeedOptions {
  /** Page size for API queries. Also caps non-paginated feeds. */
  limit?: number;
  type?: ActivityEventType;
  source?: ActivityEventSource;
  severity?: ActivityEventSeverity;
  entityType?: ActivityEventEntity["type"];
  actor?: string;
  from?: string;
  paginate?: boolean;
  poll?: boolean;
}

interface UseActivityFeedResult {
  events: ActivityEvent[];
  lastUpdated: Date | null;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

const MOCK_TYPE_MAP: Record<ReturnType<typeof generateMockActivity>["type"], ActivityEventType> = {
  member_joined: "member.joined",
  pass_created: "pass.created",
  pass_purchased: "pass.purchased",
  role_changed: "member.roles_changed",
  access_granted: "access.granted",
};

export function useActivityFeed({
  limit,
  type,
  source,
  severity,
  entityType,
  actor,
  from,
  paginate = false,
  poll = true,
}: UseActivityFeedOptions = {}): UseActivityFeedResult {
  const [events, setEvents]           = useState<ActivityEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading]         = useState(true);
  const [nextCursor, setNextCursor]   = useState<string | null>(null);
  const loadingMore                   = useRef(false);

  const mergeEvents = useCallback((incoming: ActivityEvent[], append: boolean) => {
    setEvents((prev) => {
      const base = append ? prev : [];
      const seen = new Set(base.map((event) => event.id));
      const fresh = incoming.filter((event) => !seen.has(event.id));
      const merged = [...base, ...fresh].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      return !paginate && limit ? merged.slice(0, limit) : merged;
    });
    setLastUpdated(new Date());
  }, [limit, paginate]);

  const fetchPage = useCallback(async (cursor?: string, append = false) => {
    setLoading(true);
    try {
      const data = await fetchActivity({
        limit,
        cursor,
        type,
        source,
        severity,
        entityType,
        actor,
        from,
      });
      mergeEvents(data.events, append);
      setNextCursor(data.nextCursor);
    } catch {
      // Silently swallow fetch errors; the feed keeps its last known state
    } finally {
      setLoading(false);
    }
  }, [actor, entityType, from, limit, mergeEvents, severity, source, type]);

  const pollFeed = useCallback(async () => {
    await fetchPage(undefined, true);
    if (paginate) return;

    const mock = generateMockActivity();
    mergeEvents([{
      id: mock.id,
      type: MOCK_TYPE_MAP[mock.type],
      source: "dashboard",
      severity: "info",
      actor: { name: mock.actor },
      timestamp: mock.timestamp,
      description: mock.description,
    }], true);
  }, [fetchPage, mergeEvents, paginate]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    await fetchPage(nextCursor, true);
    loadingMore.current = false;
  }, [fetchPage, nextCursor]);

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    setLoading(true);
    pollFeed();

    if (!poll) return;
    const tick = () => {
      // Pause polling while the tab is hidden to avoid wasted requests
      if (document.visibilityState === "visible") pollFeed();
    };

    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [pollFeed, poll]);

  return { events, lastUpdated, loading, hasMore: nextCursor !== null, loadMore };
}
