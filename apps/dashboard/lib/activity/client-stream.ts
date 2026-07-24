import type { ActivityEvent } from "./types";

export interface ActivityEventSourceLike {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  close(): void;
}

export interface ActivityStreamCursor {
  lastEventId: string | null;
  lastEventTimestamp: string | null;
}

export interface ActivityStreamConnectionOptions {
  connectionTimeoutMs?: number;
  createEventSource?: (url: string) => ActivityEventSourceLike;
  heartbeatTimeoutMs?: number;
  onEvent: (event: ActivityEvent) => void;
  onFallback: () => void;
  onReady?: () => void;
  /** Called after a dropped stream reconnects, with the cursor to backfill from. */
  onReconnect?: (cursor: ActivityStreamCursor) => void;
  /** Consecutive failed attempts before giving up to the polling fallback. */
  maxReconnectAttempts?: number;
  reconnectBaseMs?: number;
  reconnectCapMs?: number;
  /** Injected for tests; defaults to Math.random. */
  random?: () => number;
  url?: string;
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_CAP_MS = 30_000;

export function reconnectDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number = Math.random
): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exponential * (0.75 + random() * 0.5));
}

export function connectActivityStream({
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
  createEventSource = (url) => new EventSource(url),
  heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  onEvent,
  onFallback,
  onReady = () => {},
  onReconnect = () => {},
  maxReconnectAttempts = DEFAULT_MAX_RECONNECT_ATTEMPTS,
  reconnectBaseMs = DEFAULT_RECONNECT_BASE_MS,
  reconnectCapMs = DEFAULT_RECONNECT_CAP_MS,
  random = Math.random,
  url = "/api/activity/stream",
}: ActivityStreamConnectionOptions): () => void {
  let source: ActivityEventSourceLike | null = null;
  let stopped = false;
  let fallbackStarted = false;
  let ready = false;
  let everConnected = false;
  let failedAttempts = 0;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const cursor: ActivityStreamCursor = {
    lastEventId: null,
    lastEventTimestamp: null,
  };

  const clearWatchdog = () => {
    if (watchdog === null) return;
    clearTimeout(watchdog);
    watchdog = null;
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const armWatchdog = (timeoutMs: number) => {
    clearWatchdog();
    watchdog = setTimeout(handleDrop, timeoutMs);
  };

  const markAlive = () => {
    if (stopped || fallbackStarted) return;
    armWatchdog(heartbeatTimeoutMs);
  };

  const onActivity = ((rawEvent: Event) => {
    markAlive();
    const event = parseActivityEvent(rawEvent);
    if (!event) return;
    const messageId = (rawEvent as { lastEventId?: unknown }).lastEventId;
    cursor.lastEventId = typeof messageId === "string" && messageId ? messageId : event.id;
    cursor.lastEventTimestamp = event.timestamp;
    onEvent(event);
  }) as EventListener;

  const onHeartbeat = (() => {
    markAlive();
  }) as EventListener;

  const onReadyEvent = (() => {
    const firstReady = !ready;
    const resumed = everConnected && failedAttempts > 0;
    ready = true;
    everConnected = true;
    failedAttempts = 0;
    markAlive();
    if (resumed) {
      onReconnect({ ...cursor });
    } else if (firstReady) {
      onReady();
    }
  }) as EventListener;

  const detach = () => {
    clearWatchdog();
    if (!source) return;
    source.removeEventListener("activity", onActivity);
    source.removeEventListener("error", onError);
    source.removeEventListener("heartbeat", onHeartbeat);
    source.removeEventListener("ready", onReadyEvent);
    source.close();
    source = null;
  };

  const startFallback = () => {
    if (stopped || fallbackStarted) return;
    fallbackStarted = true;
    clearReconnectTimer();
    detach();
    onFallback();
  };

  const connect = () => {
    if (stopped || fallbackStarted) return;
    const attemptUrl = cursor.lastEventId
      ? `${url}${url.includes("?") ? "&" : "?"}lastEventId=${encodeURIComponent(cursor.lastEventId)}`
      : url;
    try {
      source = createEventSource(attemptUrl);
      source.addEventListener("activity", onActivity);
      source.addEventListener("error", onError);
      source.addEventListener("heartbeat", onHeartbeat);
      source.addEventListener("ready", onReadyEvent);
      armWatchdog(connectionTimeoutMs);
    } catch {
      handleDrop();
    }
  };

  function handleDrop() {
    if (stopped || fallbackStarted) return;
    detach();
    ready = false;
    if (failedAttempts >= maxReconnectAttempts) {
      startFallback();
      return;
    }
    const delay = reconnectDelayMs(failedAttempts, reconnectBaseMs, reconnectCapMs, random);
    failedAttempts += 1;
    clearReconnectTimer();
    reconnectTimer = setTimeout(connect, delay);
  }

  function onError() {
    handleDrop();
  }

  connect();

  return () => {
    stopped = true;
    clearReconnectTimer();
    detach();
  };
}

function parseActivityEvent(rawEvent: Event): ActivityEvent | null {
  if (!("data" in rawEvent) || typeof rawEvent.data !== "string") return null;

  try {
    const value: unknown = JSON.parse(rawEvent.data);
    if (!isActivityEvent(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function isActivityEvent(value: unknown): value is ActivityEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ActivityEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.type === "string" &&
    typeof event.source === "string" &&
    typeof event.severity === "string" &&
    typeof event.timestamp === "string" &&
    typeof event.description === "string" &&
    typeof event.actor === "object" &&
    event.actor !== null
  );
}
