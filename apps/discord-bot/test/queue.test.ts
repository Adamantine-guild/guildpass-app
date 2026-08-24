/**
 * Tests for the rate-limit-aware RoleReconciliationQueue.
 *
 * Covers:
 * - Basic enqueue / execution
 * - Concurrency cap enforcement
 * - Per-guild serialization
 * - Retry on transient failures
 * - Non-retryable errors propagate immediately
 * - 429 with Retry-After handling
 * - Queue depth and metrics emission
 * - Burst-load scenario
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  RoleReconciliationQueue,
  type QueueMetrics,
  type MetricsHandler,
} from "../src/queue.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a task that resolves after `ms` with the given value. */
function delayedTask<T>(ms: number, value: T): () => Promise<T> {
  return () => new Promise((r) => setTimeout(() => r(value), ms));
}

/** Collect all metrics events into an array. */
function collectMetrics(): { events: QueueMetrics[]; handler: MetricsHandler } {
  const events: QueueMetrics[] = [];
  return {
    events,
    handler: (m: QueueMetrics) => events.push(m),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("RoleReconciliationQueue", () => {
  let queue: RoleReconciliationQueue;

  beforeEach(() => {
    queue = new RoleReconciliationQueue({ maxConcurrency: 3 });
  });

  afterEach(() => {
    queue.removeAllMetricsHandlers();
  });

  // ── Basic execution ──────────────────────────────────────────────────

  it("executes a single task and returns its result", async () => {
    const result = await queue.enqueue("guild-1", () =>
      Promise.resolve("ok"),
    );
    assert.equal(result, "ok");
  });

  it("propagates task rejection", async () => {
    await assert.rejects(
      () =>
        queue.enqueue("guild-1", () =>
          Promise.reject(new Error("boom")),
        ),
      /boom/,
    );
  });

  // ── Concurrency cap ──────────────────────────────────────────────────

  it("respects maxConcurrency", async () => {
    const q = new RoleReconciliationQueue({ maxConcurrency: 2 });
    const startTimes: number[] = [];
    const finishTimes: number[] = [];

    // Launch 4 tasks with DIFFERENT guilds so they can run concurrently.
    // Only 2 should run at once because of the concurrency cap.
    const tasks = [1, 2, 3, 4].map((i) =>
      q.enqueue(`guild-${i}`, async () => {
        startTimes.push(Date.now());
        await sleep(100);
        finishTimes.push(Date.now());
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    assert.deepEqual(results, [1, 2, 3, 4]);

    // The first 2 should start at roughly the same time (within ~50ms),
    // and the remaining 2 should start at least 80ms later.
    assert.equal(startTimes.length, 4);
    // Sort to group the two batches.
    const sorted = [...startTimes].sort((a, b) => a - b);
    assert.ok(
      Math.abs(sorted[0] - sorted[1]) < 50,
      `First batch not concurrent: diff=${Math.abs(sorted[0] - sorted[1])}`,
    );
    assert.ok(
      sorted[2] - sorted[0] >= 80,
      `Second batch started too early: diff=${sorted[2] - sorted[0]}`,
    );
  });

  // ── Per-guild serialization ──────────────────────────────────────────

  it("serializes tasks for the same guild even under concurrency", async () => {
    const q = new RoleReconciliationQueue({ maxConcurrency: 5 });
    const order: string[] = [];

    const p1 = q.enqueue("guild-1", async () => {
      order.push("g1-start");
      await sleep(50);
      order.push("g1-end");
      return 1;
    });

    const p2 = q.enqueue("guild-1", async () => {
      order.push("g1-2-start");
      await sleep(10);
      order.push("g1-2-end");
      return 2;
    });

    // A different guild should run concurrently.
    const p3 = q.enqueue("guild-2", async () => {
      order.push("g2-start");
      await sleep(20);
      order.push("g2-end");
      return 3;
    });

    await Promise.all([p1, p2, p3]);

    // guild-2 should interleave with guild-1's first task, but guild-1's
    // second task must not start until the first finishes.
    const g1FirstEnd = order.indexOf("g1-end");
    const g1SecondStart = order.indexOf("g1-2-start");
    assert.ok(
      g1SecondStart > g1FirstEnd,
      `guild-1 second task started before first ended: ${order.join(" → ")}`,
    );
    // guild-2 should have started before g1 ended (concurrent).
    const g2Start = order.indexOf("g2-start");
    assert.ok(
      g2Start < g1FirstEnd,
      `guild-2 did not run concurrently: ${order.join(" → ")}`,
    );
  });

  // ── Queue state ──────────────────────────────────────────────────────

  it("reports correct queue state", async () => {
    const q = new RoleReconciliationQueue({ maxConcurrency: 1 });
    assert.deepEqual(q.state, { pending: 0, active: 0, activeGuilds: 0 });

    const p = q.enqueue("g", delayedTask(50, "done"));
    // Give the microtask queue a chance to dequeue.
    await sleep(5);
    assert.deepEqual(q.state, { pending: 0, active: 1, activeGuilds: 1 });

    await p;
    assert.deepEqual(q.state, { pending: 0, active: 0, activeGuilds: 0 });
  });

  // ── Retry on transient failure ───────────────────────────────────────

  it("retries on 429 errors and eventually succeeds", async () => {
    let calls = 0;
    const task = async () => {
      calls++;
      if (calls < 3) {
        const err = new Error("rate limited") as Error & {
          status: number;
          httpStatus: number;
        };
        err.status = 429;
        err.httpStatus = 429;
        throw err;
      }
      return "recovered";
    };

    const result = await queue.enqueue("g", task);
    assert.equal(result, "recovered");
    assert.equal(calls, 3);
  });

  it("retries on 5xx errors", async () => {
    let calls = 0;
    const task = async () => {
      calls++;
      if (calls < 2) {
        const err = new Error("server error") as Error & { status: number };
        err.status = 502;
        throw err;
      }
      return "ok";
    };

    const result = await queue.enqueue("g", task);
    assert.equal(result, "ok");
    assert.equal(calls, 2);
  });

  it("retries on network errors (no HTTP status)", async () => {
    let calls = 0;
    const task = async () => {
      calls++;
      if (calls < 2) throw new Error("ECONNRESET");
      return "ok";
    };

    const result = await queue.enqueue("g", task);
    assert.equal(result, "ok");
    assert.equal(calls, 2);
  });

  it("does NOT retry on 4xx (non-429) errors", async () => {
    let calls = 0;
    const task = async () => {
      calls++;
      const err = new Error("forbidden") as Error & { status: number };
      err.status = 403;
      throw err;
    };

    await assert.rejects(() => queue.enqueue("g", task), /forbidden/);
    assert.equal(calls, 1); // no retries
  });

  it("gives up after maxRetries attempts", async () => {
    const q = new RoleReconciliationQueue({ maxRetries: 2 });
    let calls = 0;
    const task = async () => {
      calls++;
      const err = new Error("always down") as Error & { status: number };
      err.status = 500;
      throw err;
    };

    await assert.rejects(() => q.enqueue("g", task), /always down/);
    // 1 initial + 2 retries = 3 total attempts
    assert.equal(calls, 3);
  });

  // ── 429 Retry-After handling ─────────────────────────────────────────

  it("respects retryAfter on 429 errors", async () => {
    const start = Date.now();
    let calls = 0;
    const task = async () => {
      calls++;
      if (calls === 1) {
        const err = new Error("rate limited") as Error & {
          status: number;
          retryAfter: number;
        };
        err.status = 429;
        err.retryAfter = 500; // discord.js gives ms
        throw err;
      }
      return "ok";
    };

    const result = await queue.enqueue("g", task);
    assert.equal(result, "ok");
    assert.equal(calls, 2);
    // Should have waited at least 500ms (the retryAfter value).
    assert.ok(Date.now() - start >= 450);
  });

  // ── Metrics emission ─────────────────────────────────────────────────

  it("emits enqueued → dequeued → completed lifecycle", async () => {
    const { events, handler } = collectMetrics();
    queue.onMetrics(handler);

    await queue.enqueue("g", () => Promise.resolve(42));

    const eventTypes = events.map((e) => e.event);
    assert.deepEqual(eventTypes, ["enqueued", "dequeued", "completed"]);
    assert.equal(events[2].guildId, "g");
    assert.equal(events[2].activeCount, 0);
  });

  it("emits enqueued → dequeued → retry* → failed lifecycle on exhaustion", async () => {
    const { events, handler } = collectMetrics();
    const q = new RoleReconciliationQueue({ maxRetries: 1 });
    q.onMetrics(handler);

    const task = async () => {
      const err = new Error("fail") as Error & { status: number };
      err.status = 500;
      throw err;
    };

    await assert.rejects(() => q.enqueue("g", task));

    const eventTypes = events.map((e) => e.event);
    assert.ok(eventTypes.includes("enqueued"));
    assert.ok(eventTypes.includes("dequeued"));
    assert.ok(eventTypes.includes("retry"));
    assert.ok(eventTypes.includes("failed"));

    const failed = events.find((e) => e.event === "failed")!;
    assert.ok(failed.error!.includes("fail"));
  });

  it("emits ratelimited events for 429s", async () => {
    const { events, handler } = collectMetrics();
    queue.onMetrics(handler);

    let calls = 0;
    const task = async () => {
      calls++;
      if (calls === 1) {
        const err = new Error("rl") as Error & { status: number };
        err.status = 429;
        throw err;
      }
      return "ok";
    };

    await queue.enqueue("g", task);

    const ratelimitedEvents = events.filter((e) => e.event === "ratelimited");
    assert.equal(ratelimitedEvents.length, 1);
    assert.equal(ratelimitedEvents[0].attempt, 1);
  });

  // ── Burst-load scenario ──────────────────────────────────────────────

  it("handles a burst of many concurrent tasks without exceeding cap", async () => {
    const MAX = 3;
    const q = new RoleReconciliationQueue({ maxConcurrency: MAX });
    let maxObserved = 0;
    let current = 0;

    const TASK_COUNT = 20;
    const tasks = Array.from({ length: TASK_COUNT }, (_, i) =>
      q.enqueue(`guild-${i % 5}`, async () => {
        current++;
        maxObserved = Math.max(maxObserved, current);
        await sleep(10 + Math.random() * 20);
        current--;
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    assert.equal(results.length, TASK_COUNT);
    // Concurrency should not have exceeded the cap.
    assert.ok(
      maxObserved <= MAX,
      `maxObserved=${maxObserved} exceeded cap=${MAX}`,
    );
  });

  // ── Per-guild isolation under burst ──────────────────────────────────

  it("serializes same-guild tasks even under burst load", async () => {
    const q = new RoleReconciliationQueue({ maxConcurrency: 5 });
    const executionOrder: { guild: string; seq: number }[] = [];

    const GUILD = "busy-guild";
    const tasks = Array.from({ length: 5 }, (_, i) =>
      q.enqueue(GUILD, async () => {
        executionOrder.push({ guild: GUILD, seq: i });
        await sleep(5);
        return i;
      }),
    );

    await Promise.all(tasks);
    // Same guild must execute in FIFO order.
    const guildExecs = executionOrder.filter((e) => e.guild === GUILD);
    for (let i = 1; i < guildExecs.length; i++) {
      assert.ok(
        guildExecs[i].seq > guildExecs[i - 1].seq,
        `Out-of-order execution for ${GUILD}: seq ${guildExecs[i].seq} after ${guildExecs[i - 1].seq}`,
      );
    }
  });
});

// ── Utility ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
