import type { ActivityEvent } from "./types";

type ActivitySubscriber = (event: ActivityEvent) => void;

interface ActivityStreamState {
  subscribers: Set<ActivitySubscriber>;
}

const globalActivityStream = globalThis as typeof globalThis & {
  __guildpassActivityStream?: ActivityStreamState;
};

const streamState =
  globalActivityStream.__guildpassActivityStream ??
  (globalActivityStream.__guildpassActivityStream = {
    subscribers: new Set<ActivitySubscriber>(),
  });

export function publishActivityEvent(event: ActivityEvent): void {
  for (const subscriber of streamState.subscribers) {
    try {
      subscriber(event);
    } catch (error) {
      console.error("Activity stream subscriber failed:", error);
    }
  }
}

export function subscribeToActivityEvents(
  subscriber: ActivitySubscriber
): () => void {
  streamState.subscribers.add(subscriber);
  return () => {
    streamState.subscribers.delete(subscriber);
  };
}

export function encodeActivityEvent(event: ActivityEvent): string {
  // The id line lets native EventSource clients track lastEventId and send
  // Last-Event-ID on reconnect, which the stream route replays from.
  return `id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Returns the events newer than `cursor` (an event id), oldest first, ready
 * to replay to a reconnecting client. Events are expected newest-first.
 * Returns [] when the cursor is unknown (e.g. evicted from storage) — the
 * client's REST backfill covers that case.
 */
export function getEventsAfterCursor(
  events: ActivityEvent[],
  cursor: string
): ActivityEvent[] {
  const cursorIndex = events.findIndex((event) => event.id === cursor);
  if (cursorIndex <= 0) return [];
  return events.slice(0, cursorIndex).reverse();
}

export function getActivitySubscriberCount(): number {
  return streamState.subscribers.size;
}
