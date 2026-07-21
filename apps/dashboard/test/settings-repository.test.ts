import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { MockSettingsRepository } from "../lib/repositories/adapters/mock";
import { DEFAULT_SETTINGS } from "../lib/settings";
import {
  getSettingsRepository,
  clearRepositories,
} from "../lib/repositories/factory";

describe("MockSettingsRepository", () => {
  test("get() returns the seeded defaults", async () => {
    const repo = new MockSettingsRepository();
    assert.deepEqual(await repo.get(), DEFAULT_SETTINGS);
  });

  test("update() merges a partial patch and persists it", async () => {
    const repo = new MockSettingsRepository();
    const updated = await repo.update({ workspaceName: "Acme DAO" });
    assert.equal(updated.workspaceName, "Acme DAO");
    // untouched fields keep their previous values
    assert.equal(updated.timezone, DEFAULT_SETTINGS.timezone);
    // a subsequent read reflects the saved value (survives "refresh")
    assert.equal((await repo.get()).workspaceName, "Acme DAO");
  });

  test("get() returns a copy, not the internal reference", async () => {
    const repo = new MockSettingsRepository();
    const a = await repo.get();
    a.workspaceName = "mutated";
    assert.notEqual((await repo.get()).workspaceName, "mutated");
  });
});

describe("settings repository factory", () => {
  beforeEach(() => clearRepositories());

  test("returns a stable singleton in mock mode", () => {
    assert.equal(getSettingsRepository(), getSettingsRepository());
  });

  test("an update through the singleton is visible to later reads", async () => {
    await getSettingsRepository().update({ displayName: "Ada" });
    assert.equal((await getSettingsRepository().get()).displayName, "Ada");
  });
});
