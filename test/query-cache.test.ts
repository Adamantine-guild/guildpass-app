import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dashboardQueryCache,
  DashboardQueryCache,
  invalidateAfterMutation,
  invalidateFromActivityEvent,
  queryKeys,
  serializeQueryKey,
} from "../lib/cache/query-cache";

describe("dashboard query cache", () => {
  test("builds stable, guild-scoped keys", () => {
    const first = queryKeys.passes("guild-a", { page: 2, status: "active" });
    const reordered = queryKeys.passes("guild-a", { status: "active", page: 2 });
    const otherGuild = queryKeys.passes("guild-b", { page: 2, status: "active" });

    assert.equal(serializeQueryKey(first), serializeQueryKey(reordered));
    assert.notEqual(serializeQueryKey(first), serializeQueryKey(otherGuild));
  });

  test("invalidating an entity refreshes every matching filtered query", async () => {
    const cache = new DashboardQueryCache();
    const firstPage = queryKeys.members("guild-a", { page: 1 });
    const secondPage = queryKeys.members("guild-a", { page: 2 });
    let fetches = 0;
    const fetcher = async () => ++fetches;

    await cache.fetchQuery(firstPage, fetcher);
    await cache.fetchQuery(secondPage, fetcher);
    await cache.fetchQuery(firstPage, fetcher);
    assert.equal(fetches, 2);

    cache.invalidateQueries(queryKeys.members("guild-a"));
    await cache.fetchQuery(firstPage, fetcher);
    await cache.fetchQuery(secondPage, fetcher);
    assert.equal(fetches, 4);
  });

  test("a failed refresh preserves the last valid cached value", async () => {
    const cache = new DashboardQueryCache();
    const key = queryKeys.activity("guild-a");
    await cache.fetchQuery(key, async () => ["valid"]);
    cache.invalidateQueries(key);

    await assert.rejects(cache.fetchQuery(key, async () => {
      throw new Error("offline");
    }));
    assert.deepEqual(cache.getQueryData(key), ["valid"]);
  });

  test("invalidating one guild does not notify another guild", () => {
    const cache = new DashboardQueryCache();
    let guildANotifications = 0;
    let guildBNotifications = 0;
    cache.subscribe(queryKeys.passes("guild-a"), () => guildANotifications++);
    cache.subscribe(queryKeys.passes("guild-b"), () => guildBNotifications++);

    cache.invalidateQueries(queryKeys.passes("guild-a"));

    assert.equal(guildANotifications, 1);
    assert.equal(guildBNotifications, 0);
  });

  test("member role mutations refresh member and activity views", () => {
    let memberNotifications = 0;
    let activityNotifications = 0;
    let passNotifications = 0;
    const unsubscribers = [
      dashboardQueryCache.subscribe(queryKeys.members("guild-a"), () => memberNotifications++),
      dashboardQueryCache.subscribe(queryKeys.activity("guild-a"), () => activityNotifications++),
      dashboardQueryCache.subscribe(queryKeys.passes("guild-a"), () => passNotifications++),
    ];

    invalidateAfterMutation("member", "guild-a");

    assert.equal(memberNotifications, 1);
    assert.equal(activityNotifications, 1);
    assert.equal(passNotifications, 0);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  });

  test("webhook pass events invalidate pass and activity views", () => {
    let passNotifications = 0;
    let activityNotifications = 0;
    const unsubscribers = [
      dashboardQueryCache.subscribe(queryKeys.passes("guild-a"), () => passNotifications++),
      dashboardQueryCache.subscribe(queryKeys.activity("guild-a"), () => activityNotifications++),
    ];

    invalidateFromActivityEvent("pass.updated", "guild-a");

    assert.equal(passNotifications, 1);
    assert.equal(activityNotifications, 1);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  });
});
