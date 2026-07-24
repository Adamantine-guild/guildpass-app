import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NextRequest } from "next/server";
import { generateSignature } from "@guildpass/webhook-utils";
import {
  connectActivityStream,
  type ActivityEventSourceLike,
} from "../lib/activity/client-stream";
import {
  getActivitySubscriberCount,
  getEventsAfterCursor,
  publishActivityEvent,
  subscribeToActivityEvents,
} from "../lib/activity/stream";
import { activityStorage } from "../lib/activity/storage";
import { GET as streamActivity } from "../app/api/activity/stream/route";
import { POST as receiveWebhook } from "../app/api/webhooks/route";
import { scheduleActivityReconciliation } from "../lib/hooks/useActivityFeed";
import { makeActivityEvent, makeWebhookPayload } from "./fixtures";

class FakeEventSource implements ActivityEventSourceLike {
  private listeners = new Map<string, Set<EventListener>>();
  closeCount = 0;

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closeCount += 1;
  }

  emit(type: string, data?: string): void {
    const event = { type, data } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("activity SSE delivery", () => {
  test("delivers a published event through a simulated SSE connection in under one second", async () => {
    const initialSubscribers = getActivitySubscriberCount();
    const response = await streamActivity(
      new Request("https://example.test/api/activity/stream")
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(getActivitySubscriberCount(), initialSubscribers + 1);
    assert.ok(response.body);

    const reader = response.body.getReader();
    try {
      const decoder = new TextDecoder();
      const ready = await readWithTimeout(reader, 500);
      assert.equal(ready.done, false);
      assert.match(decoder.decode(ready.value), /event: ready/);

      const event = makeActivityEvent({ id: `evt_stream_${Date.now()}` });
      const startedAt = performance.now();
      publishActivityEvent(event);
      const delivered = await readWithTimeout(reader, 900);
      const elapsedMs = performance.now() - startedAt;

      assert.equal(delivered.done, false);
      assert.ok(elapsedMs < 1_000, `delivery took ${elapsedMs}ms`);
      assert.match(decoder.decode(delivered.value), /event: activity/);
      assert.match(decoder.decode(delivered.value), new RegExp(event.id));
    } finally {
      await reader.cancel();
    }
    assert.equal(getActivitySubscriberCount(), initialSubscribers);
  });

  test("client connector accepts activity and reconnects with backoff on stream error", async () => {
    const sources: FakeEventSource[] = [];
    const received: string[] = [];
    let fallbackCount = 0;
    const event = makeActivityEvent({ id: "evt_client_stream_001" });

    const disconnect = connectActivityStream({
      createEventSource: () => {
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
      onEvent: (activity) => received.push(activity.id),
      onFallback: () => {
        fallbackCount += 1;
      },
      reconnectBaseMs: 40,
    });

    sources[0].emit("ready", "{}");
    sources[0].emit("activity", JSON.stringify(event));
    sources[0].emit("activity", "not-json");
    sources[0].emit("error");
    sources[0].emit("error");

    assert.deepEqual(received, [event.id]);
    assert.equal(fallbackCount, 0);
    assert.equal(sources[0].closeCount, 1);
    assert.equal(sources.length, 1, "reconnect must not happen synchronously");

    await delay(120);
    assert.equal(sources.length, 2, "reconnect should have fired once after backoff");
    assert.equal(fallbackCount, 0);

    disconnect();
    assert.equal(sources[1].closeCount, 1);
  });

  test("reconnect carries the last event id and reports the cursor for backfill", async () => {
    const urls: string[] = [];
    const sources: FakeEventSource[] = [];
    const cursors: Array<{ lastEventId: string | null; lastEventTimestamp: string | null }> = [];
    const first = makeActivityEvent({ id: "evt_cursor_001" });

    const disconnect = connectActivityStream({
      createEventSource: (url) => {
        urls.push(url);
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
      onEvent: () => {},
      onFallback: () => assert.fail("stream should recover before fallback"),
      onReconnect: (cursor) => cursors.push(cursor),
      reconnectBaseMs: 10,
      random: () => 0.5,
    });

    assert.equal(urls[0], "/api/activity/stream");
    sources[0].emit("ready", "{}");
    sources[0].emit("activity", JSON.stringify(first));
    sources[0].emit("error");

    await delay(80);
    assert.equal(sources.length, 2);
    assert.match(urls[1], /lastEventId=evt_cursor_001/);

    sources[1].emit("ready", "{}");
    assert.deepEqual(cursors, [
      { lastEventId: "evt_cursor_001", lastEventTimestamp: first.timestamp },
    ]);
    disconnect();
  });

  test("client falls back to polling after exhausting reconnect attempts", async () => {
    const sources: FakeEventSource[] = [];
    let fallbackCount = 0;

    const disconnect = connectActivityStream({
      createEventSource: () => {
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
      onEvent: () => {},
      onFallback: () => {
        fallbackCount += 1;
      },
      maxReconnectAttempts: 2,
      reconnectBaseMs: 10,
      random: () => 0.5,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      sources[sources.length - 1].emit("error");
      await delay(60);
    }

    assert.equal(sources.length, 3, "initial connect plus two reconnect attempts");
    assert.equal(fallbackCount, 1);
    disconnect();
  });

  test("ready handshake reconciles the REST snapshot after subscription", () => {
    const source = new FakeEventSource();
    const received: string[] = [];
    let reconciliationCount = 0;
    const event = makeActivityEvent({ id: "evt_during_initial_snapshot" });

    const disconnect = connectActivityStream({
      createEventSource: () => source,
      onEvent: (activity) => received.push(activity.id),
      onFallback: () => assert.fail("stream should remain healthy"),
      onReady: () => {
        reconciliationCount += 1;
      },
    });

    source.emit("activity", JSON.stringify(event));
    source.emit("ready", "{}");
    source.emit("ready", "{}");

    assert.deepEqual(received, [event.id]);
    assert.equal(reconciliationCount, 1);
    disconnect();
  });

  test("client falls back when the stream never becomes ready", async () => {
    const sources: FakeEventSource[] = [];
    let fallbackCount = 0;

    connectActivityStream({
      connectionTimeoutMs: 10,
      createEventSource: () => {
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
      heartbeatTimeoutMs: 100,
      onEvent: () => {},
      onFallback: () => {
        fallbackCount += 1;
      },
      maxReconnectAttempts: 1,
      reconnectBaseMs: 10,
      random: () => 0.5,
    });

    await delay(150);
    assert.equal(sources.length, 2, "initial connect plus one reconnect attempt");
    assert.equal(fallbackCount, 1);
    assert.equal(sources[sources.length - 1].closeCount, 1);
  });

  test("client reconnects when a ready stream stops sending heartbeats", async () => {
    const sources: FakeEventSource[] = [];
    let fallbackCount = 0;

    connectActivityStream({
      connectionTimeoutMs: 100,
      createEventSource: () => {
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
      heartbeatTimeoutMs: 20,
      onEvent: () => {},
      onFallback: () => {
        fallbackCount += 1;
      },
      maxReconnectAttempts: 1,
      reconnectBaseMs: 10,
      random: () => 0.5,
    });

    sources[0].emit("ready", "{}");
    await delay(60);
    assert.equal(fallbackCount, 0, "heartbeat loss triggers reconnect, not fallback");
    assert.equal(sources[0].closeCount, 1);

    await delay(150);
    assert.equal(sources.length, 2);
    assert.equal(fallbackCount, 1, "silent reconnect attempt exhausts into fallback");
  });

  test("server frames carry an id line and replay events missed since Last-Event-ID", async () => {
    const anchor = makeActivityEvent({ id: `evt_replay_anchor_${Date.now()}` });
    const missed = makeActivityEvent({ id: `evt_replay_missed_${Date.now()}` });
    await activityStorage.recordActivityEvent(anchor);
    await activityStorage.recordActivityEvent(missed);

    const response = await streamActivity(
      new Request(`https://example.test/api/activity/stream?lastEventId=${anchor.id}`)
    );
    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = response.body.getReader();
    try {
      const decoder = new TextDecoder();
      const ready = await readWithTimeout(reader, 500);
      assert.match(decoder.decode(ready.value), /event: ready/);

      const replay = await readWithTimeout(reader, 500);
      const frame = decoder.decode(replay.value);
      assert.match(frame, new RegExp(`id: ${missed.id}`));
      assert.match(frame, /event: activity/);
      assert.doesNotMatch(frame, new RegExp(anchor.id), "cursor event itself is not replayed");
    } finally {
      await reader.cancel();
    }
  });

  test("getEventsAfterCursor returns newer events oldest-first and [] for unknown cursors", async () => {
    const base = Date.now();
    const oldest = makeActivityEvent({ id: `evt_cursor_a_${base}` });
    const middle = makeActivityEvent({ id: `evt_cursor_b_${base}` });
    const newest = makeActivityEvent({ id: `evt_cursor_c_${base}` });
    const newestFirst = [newest, middle, oldest];

    assert.deepEqual(
      getEventsAfterCursor(newestFirst, oldest.id).map((event) => event.id),
      [middle.id, newest.id]
    );
    assert.deepEqual(getEventsAfterCursor(newestFirst, newest.id), []);
    assert.deepEqual(getEventsAfterCursor(newestFirst, "evt_not_stored"), []);
  });

  test("server disconnects a stream whose bounded output queue fills", async () => {
    const initialSubscribers = getActivitySubscriberCount();
    const response = await streamActivity(
      new Request("https://example.test/api/activity/stream")
    );
    assert.ok(response.body);
    assert.equal(getActivitySubscriberCount(), initialSubscribers + 1);

    for (let index = 0; index < 64; index += 1) {
      publishActivityEvent(makeActivityEvent({ id: `evt_queue_${index}` }));
    }

    assert.equal(getActivitySubscriberCount(), initialSubscribers);
    await assert.rejects(response.body.getReader().read(), /backpressure limit/);
  });

  test("coalesces live events before authoritative REST reconciliation", async () => {
    let reconciliationCount = 0;
    const reconcile = () => {
      reconciliationCount += 1;
    };

    const firstTimer = scheduleActivityReconciliation(null, reconcile, 10);
    scheduleActivityReconciliation(firstTimer, reconcile, 10);

    await delay(30);
    assert.equal(reconciliationCount, 1);
  });

  test("webhook publication happens once after a new event is recorded", async () => {
    const previousSecret = process.env.WEBHOOK_SECRET;
    const secret = "activity-stream-test-secret";
    const payload = makeWebhookPayload({ id: `whk_stream_${Date.now()}` });
    const body = JSON.stringify(payload);
    const { signature } = generateSignature({ secret, payload: body });
    const published: string[] = [];
    const unsubscribe = subscribeToActivityEvents((event) => published.push(event.id));
    process.env.WEBHOOK_SECRET = secret;

    try {
      const first = await receiveWebhook(webhookRequest(body, signature));
      const duplicate = await receiveWebhook(webhookRequest(body, signature));

      assert.equal(first.status, 200);
      assert.equal(duplicate.status, 200);
      assert.deepEqual(published, [payload.id]);
      assert.equal((await duplicate.json()).data.reason, "duplicate");
    } finally {
      unsubscribe();
      if (previousSecret === undefined) delete process.env.WEBHOOK_SECRET;
      else process.env.WEBHOOK_SECRET = previousSecret;
    }
  });
});

function webhookRequest(body: string, signature: string): NextRequest {
  return new NextRequest("https://example.test/api/webhooks", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-guildpass-signature": signature,
    },
  });
}

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`SSE read exceeded ${timeoutMs}ms`)),
      timeoutMs
    );
    reader.read().then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
