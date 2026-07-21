import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getPassRepository, getMemberRepository, clearRepositories } from "../lib/repositories/factory";

describe("Optimistic UI Backend Support", () => {
  beforeEach(() => {
    clearRepositories();
  });

  test("PassRepository - update should persist changes", async () => {
    const repo = getPassRepository();
    const passes = await repo.getAll();
    const pass = passes[0];
    assert.ok(pass, "Should have at least one pass");

    const updated = await repo.update(pass.id, { status: "inactive" });
    assert.ok(updated, "Update should return updated pass");
    assert.equal(updated.status, "inactive");

    const fetched = await repo.getById(pass.id);
    assert.equal(fetched?.status, "inactive");
  });

  test("PassRepository - update should return null for non-existent pass", async () => {
    const repo = getPassRepository();
    const updated = await repo.update("999", { status: "inactive" });
    assert.equal(updated, null);
  });

  test("MemberRepository - update should persist changes", async () => {
    const repo = getMemberRepository();
    const members = await repo.getAll();
    const member = members[0];
    assert.ok(member, "Should have at least one member");

    const updated = await repo.update(member.id, { status: "inactive" });
    assert.ok(updated, "Update should return updated member");
    assert.equal(updated.status, "inactive");

    const fetched = await repo.getById(member.id);
    assert.equal(fetched?.status, "inactive");
  });

  test("MemberRepository - delete should remove member", async () => {
    const repo = getMemberRepository();
    const members = await repo.getAll();
    const member = members[0];
    assert.ok(member, "Should have at least one member");

    const success = await repo.delete(member.id);
    assert.equal(success, true);

    const fetched = await repo.getById(member.id);
    assert.equal(fetched, null);
  });
});
