/**
 * Pub/Sub abstraction for cross-instance activity event delivery.
 *
 * ── Trade-off decision ───────────────────────────────────────────────────────
 * Postgres LISTEN/NOTIFY was chosen over Redis because:
 *  1. Postgres is already a required dependency for durable storage mode
 *     (DASHBOARD_STORAGE_MODE=durable requires DATABASE_URL).
 *  2. The `pg` package is already a dependency of the dashboard app.
 *  3. Activity event payloads are small (typically < 1 KB), well within
 *     Postgres's 8000-byte NOTIFY payload limit.
 *  4. At-most-once semantics are acceptable because the client-side polling
 *     fallback already handles missed events via the `NEXT_PUBLIC_ACTIVITY_REFRESH_MS`
 *     interval and the ready-handshake REST reconciliation.
 *  5. No new infrastructure dependency (Redis) is required, keeping the
 *     operational burden low for small-to-medium deployments.
 *
 * Redis would offer better throughput at scale, delivery guarantees via
 * dedicated pub/sub channels or streams, and a larger payload limit. Teams
 * that already run Redis may prefer it; this abstraction is designed to make
 * that swap straightforward.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 * - `ILocalPubSub`: Interface for publish/subscribe operations.
 * - `LocalPubSub`: In-process pub/sub used in mock mode (identical to today's
 *   globalThis-based Set behavior). No Postgres connection required.
 * - `PostgresPubSub`: Uses Postgres LISTEN/NOTIFY via the shared pg pool.
 *   Each subscriber issues `LISTEN "activity_channel"` and receives notifications
 *   via a dedicated listening connection from the pool.
 * - The factory `getActivityPubSub()` selects the implementation based on the
 *   current storage mode:
 *     - `mock` → `LocalPubSub` (single-instance, no infra needed)
 *     - `durable` → `PostgresPubSub` (multi-instance, requires Postgres)
 *
 * ── Cleanup ──────────────────────────────────────────────────────────────────
 * When an SSE client disconnects, the stream route calls `unsubscribe()` which
 * removes the listener. In PostgresPubSub, the listening connection is released
 * back to the pool only when the last subscriber disconnects, avoiding
 * connection churn on every SSE connect/disconnect cycle.
 */

import type { ActivityEvent } from "./types";
import { getPool } from "../db";
import { getStorageMode, getStorageConfig } from "../env";

import { PoolClient } from "pg";
// ── Types ────────────────────────────────────────────────────────────────────

export type ActivitySubscriber = (event: ActivityEvent) => void;

export interface ILocalPubSub {
  /** Publish an event to all local subscribers. */
  publish(event: ActivityEvent): void;
  /**
   * Subscribe to events. Returns an unsubscribe function.
   * In PostgresPubSub this also ensures the LISTEN channel is active.
   */
  subscribe(subscriber: ActivitySubscriber): () => void;
  /** Number of currently connected subscribers (for diagnostics). */
  subscriberCount(): number;
}

// ── Local (in-process) implementation — mock mode ────────────────────────────

interface LocalPubSubState {
  subscribers: Set<ActivitySubscriber>;
}

const globalPubSub = globalThis as typeof globalThis & {
  __guildpassPubSub?: LocalPubSubState;
};

function getLocalState(): LocalPubSubState {
  return (
    globalPubSub.__guildpassPubSub ??
    (globalPubSub.__guildpassPubSub = {
      subscribers: new Set<ActivitySubscriber>(),
    })
  );
}

class LocalPubSubImpl implements ILocalPubSub {
  publish(event: ActivityEvent): void {
    const state = getLocalState();
    for (const subscriber of state.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        console.error("Activity pub/sub subscriber failed:", error);
      }
    }
  }

  subscribe(subscriber: ActivitySubscriber): () => void {
    const state = getLocalState();
    state.subscribers.add(subscriber);
    return () => {
      state.subscribers.delete(subscriber);
    };
  }

  subscriberCount(): number {
    return getLocalState().subscribers.size;
  }
}

// ── Postgres LISTEN/NOTIFY implementation — durable mode ─────────────────────

class PostgresPubSubImpl implements ILocalPubSub {
  private listeners = new Map<string, Set<ActivitySubscriber>>();
  private pgListenerClient: PoolClient | null = null;
  private listenerRefCount = 0;
  private connectionError: Error | null = null;

  private async ensureListener(): Promise<void> {
    if (this.pgListenerClient) return;
    if (this.connectionError) throw this.connectionError;

    try {
      const pool = getPool();
      this.pgListenerClient = await pool.connect();
    } catch (error) {
      this.connectionError =
        error instanceof Error ? error : new Error(String(error));
      console.error(
        "[PostgresPubSub] Failed to acquire listener connection:",
        this.connectionError.message,
      );
      throw this.connectionError;
    }

    try {
      await this.pgListenerClient.query('LISTEN "activity_channel"');
    } catch (error) {
      this.pgListenerClient.release();
      this.pgListenerClient = null;
      this.connectionError =
        error instanceof Error ? error : new Error(String(error));
      console.error(
        "[PostgresPubSub] LISTEN failed:",
        this.connectionError.message,
      );
      throw this.connectionError;
    }

    this.pgListenerClient.on("notification", (msg: unknown) => {
      const notification = msg as { channel?: string; payload?: string };
      if (notification.channel !== "activity_channel" || !notification.payload)
        return;
      try {
        const parsed: unknown = JSON.parse(notification.payload);
        if (!isActivityEventPayload(parsed)) return;
        this.dispatchToLocalListeners(parsed);
      } catch {
        // Ignore malformed payloads — they shouldn't happen in normal operation.
        console.warn(
          "[PostgresPubSub] Ignored unparseable notification payload",
        );
      }
    });

    this.pgListenerClient.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        "[PostgresPubSub] Listener connection error:",
        error.message,
      );
      this.pgListenerClient = null;
      this.connectionError = error;
    });

    this.pgListenerClient.on("end", () => {
      this.pgListenerClient = null;
    });
  }

  private dispatchToLocalListeners(event: ActivityEvent): void {
    for (const subscriber of this.listeners.get("default") ?? []) {
      try {
        subscriber(event);
      } catch (error) {
        console.error("[PostgresPubSub] Local subscriber failed:", error);
      }
    }
  }

  publish(event: ActivityEvent): void {
    // Always dispatch to local subscribers immediately.
    this.dispatchToLocalListeners(event);

    // Notify other instances via Postgres.
    // We fire-and-forget — if the notification fails, the polling fallback
    // on other instances will pick up the event on the next refresh cycle.
    const payload = JSON.stringify(event);
    if (payload.length > 8000) {
      console.warn(
        "[PostgresPubSub] Event payload exceeds Postgres NOTIFY 8000-byte limit; " +
          "event will not be broadcast to other instances. Consider increasing the " +
          "polling fallback interval or switching to Redis.",
      );
      return;
    }

    getPool()
      .query("SELECT pg_notify('activity_channel', $1)", [payload])
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("[PostgresPubSub] pg_notify failed:", error.message);
      });
  }

  subscribe(subscriber: ActivitySubscriber): () => void {
    if (!this.listeners.has("default")) {
      this.listeners.set("default", new Set());
    }

    const subs = this.listeners.get("default")!;
    subs.add(subscriber);
    this.listenerRefCount++;

    // Start the listener lazily on first subscriber.
    this.ensureListener().catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        "[PostgresPubSub] Failed to start listener:",
        error.message,
      );
    });

    return () => {
      subs.delete(subscriber);
      this.listenerRefCount--;
      if (this.listenerRefCount <= 0) {
        this.releaseListener();
      }
    };
  }

  subscriberCount(): number {
    return this.listenerRefCount;
  }

  private releaseListener(): void {
    if (!this.pgListenerClient) return;
    try {
      this.pgListenerClient
        .query('UNLISTEN "activity_channel"')
        .catch(() => {});
    } finally {
      try {
        this.pgListenerClient.release();
      } catch {
        // Connection may already be closed.
      }
      this.pgListenerClient = null;
    }
  }
}

// ── Payload validation ───────────────────────────────────────────────────────

function isActivityEventPayload(value: unknown): value is ActivityEvent {
  if (!value || typeof value !== "object") return false;
  const ev = value as Partial<ActivityEvent>;
  return (
    typeof ev.id === "string" &&
    typeof ev.type === "string" &&
    typeof ev.source === "string" &&
    typeof ev.severity === "string" &&
    typeof ev.timestamp === "string" &&
    typeof ev.description === "string" &&
    ev.actor !== null &&
    typeof ev.actor === "object"
  );
}

// ── Factory ──────────────────────────────────────────────────────────────────

let pubSubInstance: ILocalPubSub | null = null;

/**
 * Returns the appropriate pub/sub implementation for the current storage mode.
 *
 * - `mock` mode:  `LocalPubSubImpl` (in-process, no Postgres required).
 * - `durable` mode: `PostgresPubSubImpl` (Postgres LISTEN/NOTIFY, shared storage).
 *
 * The instance is cached after first creation for the lifetime of the process.
 */
export function getActivityPubSub(): ILocalPubSub {
  if (pubSubInstance) return pubSubInstance;

  const mode = getStorageMode();

  if (mode === "durable") {
    // Validate that DATABASE_URL is configured before creating the Postgres pub/sub.
    getStorageConfig();
    pubSubInstance = new PostgresPubSubImpl();
  } else {
    pubSubInstance = new LocalPubSubImpl();
  }

  return pubSubInstance;
}

/**
 * Reset the cached pub/sub instance (for testing only).
 */
export function resetActivityPubSub(): void {
  pubSubInstance = null;
}

/**
 * Exported for testing: create a fresh local pub/sub without affecting the singleton.
 */
export function createLocalPubSub(): ILocalPubSub {
  return new LocalPubSubImpl();
}

/**
 * Exported for testing: create a fresh Postgres pub/sub without affecting the singleton.
 */
export function createPostgresPubSub(): ILocalPubSub {
  return new PostgresPubSubImpl();
}
