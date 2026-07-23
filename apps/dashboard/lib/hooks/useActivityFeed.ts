"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ActivityEvent, CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";
import { connectActivityStream } from "@/lib/activity/client-stream";
import { filterActivityEvents, type ActivityQuery } from "@/lib/activity/query";
import { getActivityRefreshConfig } from "@/lib/env";
import { type Activity, fetchActivity, generateMockActivity } from "@/lib/mock-data";
import { invalidateFromActivityEvent, queryKeys } from "@/lib/cache/query-cache";
import { useQueryInvalidation } from "@/lib/cache/use-query-invalidation";

interface UseActivityFeedOptions extends Omit<ActivityQuery, "cursor"> {
  /** How many events to request per REST page. */
  limit?: number;
  /** Override the fallback interval. Pass 0 to disable automatic delivery. */
  refreshIntervalMs?: number;
  autoRefresh?: boolean;
  simulate?: boolean;
  /** Tenant scope — when set, activity is filtered to this guild. */
  guildId?: string;
}

interface UseActivityFeedResult {
  events: ActivityEvent[];
  lastUpdated: Date | null;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  hasMore: boolean;
  total: number;
  error: string | null;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

const TYPE_MAP: Record<Activity["type"], ActivityEvent["type"]> = {
  member_joined: "member.joined",
  pass_created: "pass.created",
  pass_purchased: "pass.purchased",
  role_changed: "member.roles_changed",
  access_granted: "access.granted",
};

function isActivityEvent(activity: Activity | ActivityEvent): activity is ActivityEvent {
  return "source" in activity && "severity" in activity;
}

function toActivityEvent(activity: Activity | ActivityEvent): ActivityEvent {
  if (isActivityEvent(activity)) return activity;

  return {
    id: activity.id,
    type: TYPE_MAP[activity.type],
    source: "dashboard",
    severity: "info",
    actor: { name: activity.actor },
    timestamp: activity.timestamp,
    description: activity.description,
    metadata: { guildId: activity.guildId },
    schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
  };
}

export function useActivityFeed({
  limit,
  type,
  source,
  severity,
  entityType,
  actor,
  from,`n  sort,`n  refreshIntervalMs,
  autoRefresh = true,
  simulate = true,
  guildId,
}: UseActivityFeedOptions = {}): UseActivityFeedResult {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seenIds = useRef(new Set<string>());
  const queryVersion = useRef(0);
  const requestVersion = useRef(0);

  const config = getActivityRefreshConfig();
  const fallbackIntervalMs = refreshIntervalMs ?? config.intervalMs;
  const maxEvents = config.maxEvents;

  const query = useMemo<ActivityQuery & { guildId?: string }>(
    () => ({
      limit,
      type,
      source,
      severity,
      entityType,
      actor: actor?.trim() || undefined,
      from,`n      sort,`n      guildId,
    }),
    [limit, type, source, severity, entityType, actor, from, sort, guildId]
  );
  const activityQueryKey = useMemo(
    () => queryKeys.activity(guildId ?? "unscoped", {
      limit,
      type,
      source,
      severity,
      entityType,
      actor: actor?.trim() || undefined,
      from,`n      sort,`n    }),
    [actor, entityType, from, guildId, limit, severity, source, sort, type]
  );
  const cacheRevision = useQueryInvalidation(activityQueryKey);

  const hasFilters = Boolean(type || source || severity || entityType || actor?.trim() || from);

  const replaceEvents = useCallback((incoming: ActivityEvent[]) => {
    setEvents((previous) => {
      const byId = new Map(previous.map((event) => [event.id, event]));
      incoming.forEach((event) => byId.set(event.id, event));
      const bounded = [...byId.values()].sort(compareActivityEvents).slice(0, maxEvents);
      seenIds.current = new Set(bounded.map((event) => event.id));
      return bounded;
    });
    setLastUpdated(new Date());
  }, [maxEvents]);

  const appendEvents = useCallback((incoming: ActivityEvent[]) => {
    const fresh = incoming.filter((event) => !seenIds.current.has(event.id));
    if (fresh.length === 0) return;

    fresh.forEach((event) => seenIds.current.add(event.id));
    setEvents((previous) => {
      const bounded = [...previous, ...fresh]
        .sort(compareActivityEvents)
        .slice(0, maxEvents);
      seenIds.current = new Set(bounded.map((event) => event.id));
      return bounded;
    });
    setLastUpdated(new Date());
  }, [maxEvents]);

  const prependLiveEvent = useCallback((event: ActivityEvent) => {
    if (seenIds.current.has(event.id)) return;
    if (filterActivityEvents([event], query).events.length === 0) return;

    seenIds.current.add(event.id);
    setEvents((previous) => {
      const bounded = [event, ...previous]
        .sort(compareActivityEvents)
        .slice(0, maxEvents);
      seenIds.current = new Set(bounded.map((activity) => activity.id));
      return bounded;
    });
    setTotal((previous) => previous + 1);
    setLastUpdated(new Date());
    setError(null);
  }, [maxEvents, query]);

  const fetchLatest = useCallback(async ({ simulateEvent = true } = {}) => {
    const version = queryVersion.current;
    const currentRequest = requestVersion.current + 1;
    requestVersion.current = currentRequest;
    try {
      const data = await fetchActivity(query);
      if (
        version !== queryVersion.current ||
        currentRequest !== requestVersion.current
      ) return;
      const incoming = data.events.map(toActivityEvent);
      replaceEvents(incoming);
      setNextCursor(data.nextCursor);
      setTotal(data.total);
      setError(null);

      if (simulateEvent && simulate && !hasFilters) {
        prependLiveEvent(toActivityEvent(generateMockActivity(guildId)));
      }
    } catch {
      if (version === queryVersion.current) {
        setError("Activity feed is temporarily unavailable.");
      }
    } finally {
      if (version === queryVersion.current) setLoading(false);
    }
  }, [guildId, hasFilters, prependLiveEvent, query, replaceEvents, simulate]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchLatest();
    } finally {
      setRefreshing(false);
    }
  }, [fetchLatest]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;

    const version = queryVersion.current;
    setLoadingMore(true);
    try {
      const data = await fetchActivity({ ...query, cursor: nextCursor });
      if (version !== queryVersion.current) return;
      appendEvents(data.events.map(toActivityEvent));
      setNextCursor(data.nextCursor);
      setTotal((previous) => Math.max(previous, data.total));
      setError(null);
    } catch {
      if (version === queryVersion.current) {
        setError("More activity could not be loaded.");
      }
    } finally {
      if (version === queryVersion.current) setLoadingMore(false);
    }
  }, [appendEvents, loadingMore, nextCursor, query]);

  useEffect(() => {
    let disposed = false;
    let pollingId: ReturnType<typeof setInterval> | null = null;
    let reconciliationId: ReturnType<typeof setTimeout> | null = null;
    let stopStream = () => {};

    const pollWhenVisible = () => {
      if (document.visibilityState === "visible") void fetchLatest();
    };

    const stopPolling = () => {
      if (pollingId === null) return;
      clearInterval(pollingId);
      pollingId = null;
      document.removeEventListener("visibilitychange", pollWhenVisible);
    };

    const startPolling = () => {
      if (disposed || pollingId !== null || fallbackIntervalMs <= 0) return;
      pollingId = setInterval(pollWhenVisible, fallbackIntervalMs);
      document.addEventListener("visibilitychange", pollWhenVisible);
    };

    const scheduleReconciliation = () => {
      reconciliationId = scheduleActivityReconciliation(
        reconciliationId,
        () => {
          reconciliationId = null;
          if (!disposed) void fetchLatest({ simulateEvent: false });
        }
      );
    };

    queryVersion.current += 1;
    seenIds.current.clear();
    setEvents([]);
    setNextCursor(null);
    setTotal(0);
    setLoading(true);
    setLoadingMore(false);
    void fetchLatest();

    if (autoRefresh && fallbackIntervalMs > 0) {
      if (typeof EventSource === "undefined") {
        startPolling();
      } else {
        stopStream = connectActivityStream({
          onEvent: (event) => {
            prependLiveEvent(event);
            invalidateFromActivityEvent(event.type, guildId ?? "unscoped");
            scheduleReconciliation();
          },
          onFallback: startPolling,
          onReady: () => {
            void fetchLatest({ simulateEvent: false });
          },
        });
      }
    }

    return () => {
      disposed = true;
      if (reconciliationId !== null) clearTimeout(reconciliationId);
      stopStream();
      stopPolling();
    };
  }, [autoRefresh, cacheRevision, fallbackIntervalMs, fetchLatest, guildId, prependLiveEvent]);

  return {
    events,
    lastUpdated,
    loading,
    loadingMore,
    refreshing,
    hasMore: Boolean(nextCursor),
    total,
    error,
    loadMore,
    refresh,
  };
}

export function scheduleActivityReconciliation(
  existingTimer: ReturnType<typeof setTimeout> | null,
  reconcile: () => void,
  delayMs = 50
): ReturnType<typeof setTimeout> {
  if (existingTimer !== null) clearTimeout(existingTimer);
  return setTimeout(reconcile, delayMs);
}

function compareActivityEvents(a: ActivityEvent, b: ActivityEvent): number {
  const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  if (timeDiff !== 0) return timeDiff;
  return b.id.localeCompare(a.id);
}
