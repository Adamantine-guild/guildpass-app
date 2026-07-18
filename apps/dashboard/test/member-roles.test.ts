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

  test("duplicate-add returns the same array reference unchanged", () => {
    // No-op path must not clone: callers rely on referential equality to skip
    // needless state updates / re-renders.
    const input = ["member"];
    const result = addRole(input, "member");
    assert.equal(result, input);
    assert.deepEqual(result, ["member"]);
  });

  test("adding a supported role does not mutate the input array", () => {
    const input = ["member"];
    const snapshot = [...input];
    const result = addRole(input, "contributor");
    assert.notEqual(result, input);
    assert.deepEqual(input, snapshot);
    assert.deepEqual(result, ["member", "contributor"]);
  });

  test("unsupported-role no-op returns the same reference and does not mutate", () => {
    const input = ["member"];
    const snapshot = [...input];
    const result = addRole(input, "hacker");
    assert.equal(result, input);
    assert.deepEqual(input, snapshot);
  });
});

describe("removeRole", () => {
  test("removes an existing role", () => {
    assert.deepEqual(removeRole(["admin", "member"], "admin"), ["member"]);
  });
  test("is a no-op when the role is absent", () => {
    assert.deepEqual(removeRole(["member"], "admin"), ["member"]);
  });

  test("removing a missing role returns an equivalent list without mutating input", () => {
    const input = ["member"];
    const snapshot = [...input];
    const result = removeRole(input, "admin");
    assert.deepEqual(result, ["member"]);
    assert.deepEqual(input, snapshot);
  });

  test("removing an existing role does not mutate the input array", () => {
    const input = ["admin", "member"];
    const snapshot = [...input];
    const result = removeRole(input, "admin");
    assert.notEqual(result, input);
    assert.deepEqual(input, snapshot);
    assert.deepEqual(result, ["member"]);
  });
});

describe("MEMBER_ROLES", () => {
  test("matches the roles the seed data uses", () => {
    // The role editor must offer exactly the roles the API (mutations.ts) accepts.
    assert.deepEqual([...MEMBER_ROLES], ["admin", "member", "contributor"]);
  });
});