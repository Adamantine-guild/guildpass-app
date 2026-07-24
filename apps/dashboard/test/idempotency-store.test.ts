import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DurableActivityStorage,
  FileActivityStorage,
  InMemoryActivityStorage,
} from "../lib/activity/storage.js";
import { makeActivityEvent } from "./fixtures.js";

function makeEvent(id: string) {
  return makeActivityEvent({ id });
}

describe("idempotency store backends", () => {
  test("memory backend accepts the first webhook and rejects the duplicate", async () => {
    const store = new InMemoryActivityStorage({ maxEvents: 50 });
    const event = makeEvent("mem_first_seen");

    assert.equal(await store.recordActivityEvent(event), "recorded");
    assert.equal(await store.recordActivityEvent(event), "duplicate");
    assert.equal(await store.hasProcessedEvent(event.id), true);
  });

  test("file backend keeps processed webhook IDs across a fresh store instance", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "guildpass-idem-file-"));

    try {
      const first = new FileActivityStorage(rootDir, { maxEvents: 10 });
      const event = makeEvent("file_first_seen");

      assert.equal(await first.recordActivityEvent(event), "recorded");

      const restarted = new FileActivityStorage(rootDir, { maxEvents: 10 });
      assert.equal(await restarted.hasProcessedEvent(event.id), true);
      assert.equal(await restarted.recordActivityEvent(event), "duplicate");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test("durable backend rejects a duplicate webhook ID observed from a second store instance", async () => {
    if (!process.env.DATABASE_URL) {
      test.skip("DATABASE_URL is not configured for durable idempotency integration tests");
      return;
    }

    const event = makeEvent("durable_second_instance_001");
    const first = new DurableActivityStorage({ maxEvents: 20, ttlSeconds: 3600 });
    const second = new DurableActivityStorage({ maxEvents: 20, ttlSeconds: 3600 });

    assert.equal(await first.recordActivityEvent(event), "recorded");
    assert.equal(await second.hasProcessedEvent(event.id), true);
    assert.equal(await second.recordActivityEvent(event), "duplicate");
  });

  test("stores expire lazily after the configured retention window", async () => {
    const store = new InMemoryActivityStorage({ maxEvents: 50, ttlSeconds: 1 });
    const event = makeEvent("mem_expiry_001");

    assert.equal(await store.recordActivityEvent(event), "recorded");
    await new Promise((resolve) => setTimeout(resolve, 1100));

    assert.equal(await store.hasProcessedEvent(event.id), false);
    assert.equal(await store.recordActivityEvent(event), "recorded");
  });
});
