import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  GUILD_ID_COOKIE,
  GUILD_ID_HEADER,
  getActiveGuildId,
  isGuildIdFormat,
} from "../lib/guild-context";
import {
  filterActivityEventsByGuild,
  getActivityForGuild,
  getGuildById,
  getMembersForGuild,
  getPassesForGuild,
  guildExists,
} from "../lib/data/guild-scoped";
import { DEFAULT_GUILD_ID, mockGuilds, mockMembers, mockPasses } from "../lib/mock-data";

describe("guild context resolution", () => {
  test("falls back to DEFAULT_GUILD_ID without a request", () => {
    assert.equal(getActiveGuildId(), DEFAULT_GUILD_ID);
  });

  test("resolves guild id from X-Guild-Id header", () => {
    const request = new Request("http://localhost/api/passes", {
      headers: { [GUILD_ID_HEADER]: "2" },
    });
    assert.equal(getActiveGuildId(request), "2");
  });

  test("resolves guild id from cookie when header is absent", () => {
    const request = new Request("http://localhost/api/passes", {
      headers: { cookie: `${GUILD_ID_COOKIE}=3; other=1` },
    });
    assert.equal(getActiveGuildId(request), "3");
  });

  test("prefers header over cookie", () => {
    const request = new Request("http://localhost/api/passes", {
      headers: {
        [GUILD_ID_HEADER]: "2",
        cookie: `${GUILD_ID_COOKIE}=3`,
      },
    });
    assert.equal(getActiveGuildId(request), "2");
  });

  test("rejects blank or whitespace guild ids", () => {
    assert.equal(isGuildIdFormat(""), false);
    assert.equal(isGuildIdFormat("a b"), false);
    assert.equal(isGuildIdFormat("2"), true);
  });
});

describe("guild-scoped mock data helpers", () => {
  test("mock data includes multiple guild-specific records", () => {
    assert.ok(mockGuilds.length >= 3);
    for (const guild of mockGuilds) {
      assert.ok(getPassesForGuild(guild.id).length > 0, `passes for ${guild.id}`);
      assert.ok(getMembersForGuild(guild.id).length > 0, `members for ${guild.id}`);
      assert.ok(getActivityForGuild(guild.id).length > 0, `activity for ${guild.id}`);
    }
  });

  test("passes and members never cross guild boundaries", () => {
    const g1 = getPassesForGuild("1");
    const g2 = getPassesForGuild("2");
    assert.ok(g1.every((p) => p.guildId === "1"));
    assert.ok(g2.every((p) => p.guildId === "2"));
    assert.equal(
      g1.length + g2.length + getPassesForGuild("3").length,
      mockPasses.length
    );

    const m1 = getMembersForGuild("1");
    const m2 = getMembersForGuild("2");
    assert.ok(m1.every((m) => m.guildId === "1"));
    assert.ok(m2.every((m) => m.guildId === "2"));
    assert.equal(
      m1.length + m2.length + getMembersForGuild("3").length,
      mockMembers.length
    );
  });

  test("unknown guild id is not found", () => {
    assert.equal(getGuildById("does-not-exist"), null);
    assert.equal(guildExists("does-not-exist"), false);
    assert.equal(getPassesForGuild("does-not-exist").length, 0);
  });

  test("activity events filter by metadata.guildId", () => {
    const events = [
      { id: "a", metadata: { guildId: "1" } },
      { id: "b", metadata: { guildId: "2" } },
      { id: "c", entity: { type: "guild", id: "1" } },
      { id: "d", metadata: {} },
    ];
    const scoped = filterActivityEventsByGuild(events, "1");
    assert.deepEqual(
      scoped.map((e) => e.id),
      ["a", "c"]
    );
  });
});
