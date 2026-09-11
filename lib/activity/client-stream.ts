import type { ActivityEvent } from "./types";

export interface ActivityEventSourceLike {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  close(): void;
}

export interface ActivityStreamConnectionOptions {
  connectionTimeoutMs?: number;
  createEventSource?: (url: string) => ActivityEventSourceLike;
  heartbeatTimeoutMs?: number;
  onEvent: (event: ActivityEvent) => void;
  onFallback: () => void;
  onReady?: () => void;
  reconnectBaseDelayMs?: number;
  reconnectJitterRatio?: number;
  reconnectMaxDelayMs?: number;
  url?: string;
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_JITTER_RATIO = 0.25;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;

export function connectActivityStream({
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
  createEventSource = (url) => new EventSource(url),
  heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  onEvent,
  onFallback,
  onReady = () => {},
  reconnectBaseDelayMs = DEFAULT_RECONNECT_BASE_DELAY_MS,
  reconnectJitterRatio = DEFAULT_RECONNECT_JITTER_RATIO,
  reconnectMaxDelayMs = DEFAULT_RECONNECT_MAX_DELAY_MS,
  url = "/api/activity/stream",
}: ActivityStreamConnectionOptions): () => void {
  let source: ActivityEventSourceLike | null = null;
  let stopped = false;
  let fallbackStarted = false;
  let connectionReady = false;
  let lastEventId: string | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

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

  const armWatchdog = (timeoutMs: number, onTimeout: () => void) => {
    clearWatchdog();
    watchdog = setTimeout(onTimeout, timeoutMs);
  };

  const markAlive = () => {
    if (stopped || fallbackStarted) return;
    armWatchdog(heartbeatTimeoutMs, scheduleReconnect);
  };

  const onActivity = ((rawEvent: Event) => {
    markAlive();
    const event = parseActivityEvent(rawEvent);
    if (!event) return;
    lastEventId = event.id;
    onEvent(event);
  }) as EventListener;

  const onHeartbeat = (() => {
    markAlive();
  }) as EventListener;

  const onReadyEvent = (() => {
    const firstReady = !connectionReady;
    connectionReady = true;
    reconnectAttempt = 0;
    markAlive();
    if (firstReady) onReady();
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

  const streamUrl = () => {
    if (!lastEventId) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}lastEventId=${encodeURIComponent(lastEventId)}`;
  };

  const startFallback = () => {
    if (stopped || fallbackStarted) return;
    fallbackStarted = true;
    clearReconnectTimer();
    detach();
    onFallback();
  };

  const reconnectDelay = () => {
    const exponentialDelay = Math.min(
      reconnectMaxDelayMs,
      reconnectBaseDelayMs * 2 ** reconnectAttempt
    );
    const jitter = exponentialDelay * reconnectJitterRatio * Math.random();
    reconnectAttempt += 1;
    return Math.round(exponentialDelay + jitter);
  };

  const scheduleReconnect = () => {
    if (stopped || fallbackStarted) return;
    if (!connectionReady) {
      startFallback();
      return;
    }

    detach();
    clearReconnectTimer();
    reconnectTimer = setTimeout(connect, reconnectDelay());
  };

  const onError = (() => {
    scheduleReconnect();
  }) as EventListener;

  const connect = () => {
    if (stopped || fallbackStarted) return;
    connectionReady = false;

    try {
      source = createEventSource(streamUrl());
    } catch {
      startFallback();
      return;
    }

    source.addEventListener("activity", onActivity);
    source.addEventListener("error", onError);
    source.addEventListener("heartbeat", onHeartbeat);
    source.addEventListener("ready", onReadyEvent);
    armWatchdog(connectionTimeoutMs, startFallback);
  };

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
