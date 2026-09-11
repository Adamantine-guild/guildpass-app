import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MEMBER_ROLES,
  isMemberRole,
  addRole,
  removeRole,
} from "../lib/member-roles";

describe("isMemberRole", () => {
  test("accepts supported roles", () => {
    for (const role of MEMBER_ROLES) assert.equal(isMemberRole(role), true);
  });

  test("rejects unsupported values", () => {
    assert.equal(isMemberRole("superadmin"), false);
    assert.equal(isMemberRole(""), false);
    assert.equal(isMemberRole(42), false);
    assert.equal(isMemberRole(null), false);
  });
});

describe("addRole", () => {
  test("adds a supported role", () => {
    assert.deepEqual(addRole(["member"], "contributor"), ["member", "contributor"]);
  });

  test("does not create a duplicate", () => {
    assert.deepEqual(addRole(["member"], "member"), ["member"]);
  });

  test("ignores an unsupported role", () => {
    assert.deepEqual(addRole(["member"], "hacker"), ["member"]);
  });
});

describe("removeRole", () => {
  test("removes an existing role", () => {
    assert.deepEqual(removeRole(["admin", "member"], "admin"), ["member"]);
  });

  test("is a no-op when the role is absent", () => {
    assert.deepEqual(removeRole(["member"], "admin"), ["member"]);
  });
});

describe("MEMBER_ROLES", () => {
  test("matches the roles the seed data uses", () => {
    // The role editor must offer exactly the roles the API (mutations.ts) accepts.
    assert.deepEqual([...MEMBER_ROLES], ["admin", "member", "contributor"]);
  });
});
