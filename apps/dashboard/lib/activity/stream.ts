import type { ActivityEvent } from "./types";
import { getActivityPubSub, type ActivitySubscriber } from "./pubsub";

/**
 * Publish an activity event to all connected SSE clients.
 *
 * In mock mode, this dispatches in-process (same behavior as before).
 * In durable mode, this also broadcasts via Postgres LISTEN/NOTIFY so
 * that other dashboard instances receive the event.
 */
export function publishActivityEvent(event: ActivityEvent): void {
  getActivityPubSub().publish(event);
}

/**
 * Subscribe to activity events. Returns an unsubscribe function.
 *
 * In durable mode, this also ensures the Postgres LISTEN channel
 * is active so cross-instance notifications are received.
 */
export function subscribeToActivityEvents(
  subscriber: ActivitySubscriber,
): () => void {
  return getActivityPubSub().subscribe(subscriber);
}

export function encodeActivityEvent(event: ActivityEvent): string {
  return `event: activity\ndata: ${JSON.stringify(event)}\n\n`;
}

export function getActivitySubscriberCount(): number {
  return getActivityPubSub().subscriberCount();
}
