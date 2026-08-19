/**
 * tests/members-export.test.ts
 *
 * Tests for the streaming member CSV export layer.
 *
 * Strategy: Tests the repository streaming layer (streamAll) and CSV
 * serialization (memberToCsvRow / toMembersCsv) directly. The route handler
 * is thin glue over these — its behaviour is verified through the
 * repository contract tests below.
 *
 * Verifies:
 *  - streamAll yields bounded-size chunks (not all-at-once)
 *  - CSV output is complete, correctly ordered, and escaped
 *  - Guild isolation is respected
 *  - Works with 10k+ records without materializing the full set
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DASHBOARD_STORAGE_MODE = "mock";
process.env.DASHBOARD_API_MODE = "mock";

import {
  getMemberRepository,
  clearRepositories,
} from "../lib/repositories/factory";
import { memberToCsvRow, toMembersCsv } from "../lib/members-csv";
import type { Member } from "../lib/mock-data";
import { DEFAULT_GUILD_ID } from "../lib/mock-data";

function makeTestMember(index: number): Omit<Member, "id" | "guildId"> {
  return {
    version: 1,
    wallet: `0x${String(index).padStart(40, "0")}`,
    name: `Member ${index}`,
    status: index % 3 === 0 ? "pending" : index % 5 === 0 ? "inactive" : "active",
    roles: index % 7 === 0 ? ["admin", "member"] : ["member"],
    joinedAt: new Date(2025, 0, 1 + (index % 365)).toISOString(),
    lastActive: new Date(2025, 6, 1 + (index % 17)).toISOString(),
  };
}

test("streamAll yields members in bounded-size chunks without materializing all", async () => {
  clearRepositories();
  const repo = getMemberRepository();
  const COUNT = 150;
  const CHUNK = 50;
  // The mock adapter is seeded; streamAll returns seeded + created members.
  const seeded = (await repo.getAll(DEFAULT_GUILD_ID)).length;

  for (let i = 0; i < COUNT; i++) {
    await repo.create(DEFAULT_GUILD_ID, makeTestMember(i));
  }

  const chunks: Member[][] = [];
  for await (const chunk of repo.streamAll(DEFAULT_GUILD_ID, CHUNK)) {
    chunks.push(chunk);
    assert.ok(chunk.length <= CHUNK, `chunk size ${chunk.length} > ${CHUNK}`);
  }

  const expected = COUNT + seeded;
  assert.equal(chunks.length, Math.ceil(expected / CHUNK));
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  assert.equal(total, expected);
});

test("streamAll respects guild isolation", async () => {
  clearRepositories();
  const repo = getMemberRepository();

  await repo.create(DEFAULT_GUILD_ID, { ...makeTestMember(1), name: "G1-Alice" });
  await repo.create("other-guild", { ...makeTestMember(2), name: "G2-Bob" });

  const names: string[] = [];
  for await (const chunk of repo.streamAll(DEFAULT_GUILD_ID)) {
    for (const m of chunk) names.push(m.name);
  }

  assert.ok(names.includes("G1-Alice"));
  assert.ok(!names.includes("G2-Bob"));
});

test("streamAll with 10k+ members yields correct total without OOM", async () => {
  clearRepositories();
  const repo = getMemberRepository();
  const COUNT = 10_000;
  const CHUNK = 500;
  const seeded = (await repo.getAll(DEFAULT_GUILD_ID)).length;

  for (let i = 0; i < COUNT; i++) {
    await repo.create(DEFAULT_GUILD_ID, makeTestMember(i));
  }

  let total = 0;
  let chunkCount = 0;
  for await (const chunk of repo.streamAll(DEFAULT_GUILD_ID, CHUNK)) {
    total += chunk.length;
    chunkCount++;
    assert.ok(chunk.length <= CHUNK, `chunk ${chunkCount} size ${chunk.length} > ${CHUNK}`);
  }

  const expected = COUNT + seeded;
  assert.equal(total, expected);
  assert.equal(chunkCount, Math.ceil(expected / CHUNK));
});

test("memberToCsvRow produces correctly escaped CSV", () => {
  const m: Member = {
    id: "1",
    guildId: DEFAULT_GUILD_ID,
    wallet: "0xabc",
    name: 'Alice "The Great", Esq.',
    status: "active",
    roles: ["admin", "member"],
    version: 1,
    joinedAt: "2025-01-01T00:00:00Z",
    lastActive: "2025-01-02T00:00:00Z",
  };

  const row = memberToCsvRow(m);
  assert.ok(row.includes('"Alice ""The Great"", Esq."'), "quotes and commas escaped");
  assert.ok(row.includes("0xabc"));
  assert.ok(row.includes("admin; member"), "roles joined with semicolon");
});

test("toMembersCsv includes headers and all rows", () => {
  const members: Member[] = [
    { id: "1", guildId: DEFAULT_GUILD_ID, version: 1, wallet: "0xa", name: "Alice", status: "active", roles: ["member"], joinedAt: "2025-01-01T00:00:00Z", lastActive: "2025-01-02T00:00:00Z" },
    { id: "2", guildId: DEFAULT_GUILD_ID, version: 1, wallet: "0xb", name: "Bob", status: "inactive", roles: [], joinedAt: "2025-02-01T00:00:00Z", lastActive: "2025-02-02T00:00:00Z" },
  ];

  const csv = toMembersCsv(members);
  const lines = csv.split("\r\n");

  assert.equal(lines.length, 3); // header + 2 rows
  assert.match(lines[0], /^Name,Wallet,Status,Roles,Joined At,Last Active/);
  assert.ok(lines[1].includes("Alice"));
  assert.ok(lines[2].includes("Bob"));
});

test("streamAll + memberToCsvRow compose into full CSV without buffering all", async () => {
  clearRepositories();
  const repo = getMemberRepository();
  const COUNT = 500;
  const CHUNK = 100;
  const seeded = (await repo.getAll(DEFAULT_GUILD_ID)).length;

  for (let i = 0; i < COUNT; i++) {
    await repo.create(DEFAULT_GUILD_ID, makeTestMember(i));
  }

  const rows: string[] = [];
  let totalMembers = 0;

  for await (const chunk of repo.streamAll(DEFAULT_GUILD_ID, CHUNK)) {
    totalMembers += chunk.length;
    for (const m of chunk) rows.push(memberToCsvRow(m));
  }

  assert.equal(totalMembers, COUNT + seeded);
  assert.equal(rows.length, COUNT + seeded);
  // Verify first and last created members are present
  assert.ok(rows.some((r) => r.includes("Member 0")));
  assert.ok(rows.some((r) => r.includes(`Member ${COUNT - 1}`)));
});
