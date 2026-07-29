/**
 * An internal GuildPass event to be delivered to an external subscriber as a
 * signed outbound webhook (e.g. member joined, pass issued, guild updated).
 */
export type WebhookEvent = {
  /** Dot-namespaced event name, e.g. "member.joined", "pass.issued". */
  event: string;
  /** Event-specific data. Must not contain secrets (see SECURITY.md). */
  payload: Record<string, unknown>;
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string;
  /** The guild the event belongs to. Used to resolve subscriber URL(s). */
  guildId: string;
};

/** One subscriber delivery attempt, kept for observability/debugging. */
export type DeliveryAttempt = {
  attempt: number;
  startedAt: string;
  /** HTTP status code, if a response was received. */
  status?: number;
  /** Error message, if the attempt failed before or without a response. */
  error?: string;
};

/** Outcome of a `dispatchWebhook` call. */
export type DispatchResult = {
  delivered: boolean;
  subscriberUrl: string;
  event: WebhookEvent;
  attempts: DeliveryAttempt[];
  /** Present only when `delivered` is false and attempts were exhausted. */
  deadLettered?: boolean;
};

/** A delivery that exhausted all retry attempts without success. */
export type DeadLetterEntry = {
  id: string;
  subscriberUrl: string;
  event: WebhookEvent;
  attempts: DeliveryAttempt[];
  failedAt: string;
};

/** Persistence boundary for exhausted deliveries — swappable for durable storage later. */
export interface DeadLetterStore {
  record(entry: DeadLetterEntry): Promise<void> | void;
  list(): Promise<DeadLetterEntry[]> | DeadLetterEntry[];
}

/** Maps a guildId to the subscriber URL(s) that should receive its webhooks. */
export interface SubscriberRegistry {
  getSubscriberUrls(guildId: string): string[];
}

export type RetryConfig = {
  /** Maximum delivery attempts before giving up. Default: 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 200. */
  baseDelayMs?: number;
  /** Maximum backoff delay in milliseconds, before jitter. Default: 10000. */
  maxDelayMs?: number;
};

export type DispatchOptions = {
  /** Secret used to sign the outbound payload. Required. */
  secret: string;
  retry?: RetryConfig;
  deadLetterStore?: DeadLetterStore;
  /** Injectable fetch implementation, primarily for testing. Default: global fetch. */
  fetch?: typeof fetch;
  /** Injectable sleep implementation, primarily for testing. Default: setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0, 1), primarily for deterministic testing. Default: Math.random. */
  random?: () => number;
};
