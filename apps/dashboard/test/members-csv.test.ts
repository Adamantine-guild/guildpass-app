import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toMembersCsv } from "../lib/members-csv";
import type { Member } from "../lib/mock-data";

const baseMember: Member = {
  id: "member-1",
  name: "Alice",
  wallet: "0xabc",
  status: "active",
  roles: ["admin", "member"],
  joinedAt: "2025-01-01T00:00:00Z",
  lastActive: "2025-01-02T00:00:00Z",
};

describe("toMembersCsv", () => {
  it("serializes members with a header row", () => {
    assert.equal(
      toMembersCsv([baseMember]),
      [
        "Name,Wallet,Status,Roles,Joined At,Last Active",
        "Alice,0xabc,active,admin; member,2025-01-01T00:00:00Z,2025-01-02T00:00:00Z",
      ].join("\r\n")
    );
  });

  it("escapes commas, quotes, and line breaks", () => {
    const csv = toMembersCsv([
      {
        ...baseMember,
        name: 'Alice "DAO", Core',
        wallet: "0xabc\n0xdef",
      },
    ]);

    assert.equal(
      csv,
      [
        "Name,Wallet,Status,Roles,Joined At,Last Active",
        '"Alice ""DAO"", Core","0xabc\n0xdef",active,admin; member,2025-01-01T00:00:00Z,2025-01-02T00:00:00Z',
      ].join("\r\n")
    );
  });

  it("uses the provided member list without broadening filters", () => {
    const inactiveMember: Member = {
      ...baseMember,
      id: "member-2",
      name: "Bob",
      status: "inactive",
    };

    const csv = toMembersCsv([inactiveMember]);

    assert.match(csv, /Bob/);
    assert.doesNotMatch(csv, /Alice/);
  });
});
