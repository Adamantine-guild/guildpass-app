import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DurableSettingsRepository,
  SettingsValidationError,
} from "../lib/repositories/adapters/durable";
import { DEFAULT_SETTINGS, MAX_TEXT_LENGTH } from "../lib/settings";

/**
 * Tests for issue #139: DurableSettingsRepository must fully implement
 * ISettingsRepository, enforce server-side validation at the repository
 * boundary (not only in the API route), and persist updates.
 */

function makeRepo() {
  return new DurableSettingsRepository("mock://conn");
}

describe("DurableSettingsRepository — implements ISettingsRepository", () => {
  test("get returns the seeded defaults on a fresh instance", async () => {
    const repo = makeRepo();
    assert.deepEqual(await repo.get(), DEFAULT_SETTINGS);
  });

  test("get returns a copy, not the stored reference", async () => {
    const repo = makeRepo();
    const a = await repo.get();
    a.workspaceName = "mutated";
    const b = await repo.get();
    assert.notEqual(b.workspaceName, "mutated");
  });
});

describe("DurableSettingsRepository — update persists", () => {
  test("a valid patch is merged and survives the next read", async () => {
    const repo = makeRepo();
    const returned = await repo.update({ workspaceName: "New Name" });
    assert.equal(returned.workspaceName, "New Name");
    // Persisted: a fresh read reflects the saved value.
    assert.equal((await repo.get()).workspaceName, "New Name");
    // Untouched fields keep their defaults.
    assert.equal((await repo.get()).email, DEFAULT_SETTINGS.email);
  });

  test("only the validated value is merged; unknown keys are dropped", async () => {
    const repo = makeRepo();
    await repo.update({ workspaceName: "Trimmed", nonsense: "x" } as never);
    const saved = await repo.get();
    assert.equal(saved.workspaceName, "Trimmed");
    assert.equal(Object.prototype.hasOwnProperty.call(saved, "nonsense"), false);
  });
});

describe("DurableSettingsRepository — boundary validation", () => {
  test("rejects an over-length workspace name and leaves the store untouched", async () => {
    const repo = makeRepo();
    const tooLong = "x".repeat(MAX_TEXT_LENGTH + 1);
    await assert.rejects(
      () => repo.update({ workspaceName: tooLong }),
      (err: unknown) => {
        assert.ok(err instanceof SettingsValidationError);
        assert.ok(err.errors.some((e) => e.field === "workspaceName"));
        return true;
      },
    );
    // Store unchanged after a rejected write.
    assert.deepEqual(await repo.get(), DEFAULT_SETTINGS);
  });

  test("rejects an invalid email", async () => {
    const repo = makeRepo();
    await assert.rejects(
      () => repo.update({ email: "not-an-email" }),
      (err: unknown) => err instanceof SettingsValidationError,
    );
  });

  test("rejects an unsupported timezone", async () => {
    const repo = makeRepo();
    await assert.rejects(
      () => repo.update({ timezone: "Mars/Olympus_Mons" }),
      (err: unknown) => err instanceof SettingsValidationError,
    );
  });

  test("rejects an empty patch with no supported fields", async () => {
    const repo = makeRepo();
    await assert.rejects(
      () => repo.update({}),
      (err: unknown) => err instanceof SettingsValidationError,
    );
  });
});