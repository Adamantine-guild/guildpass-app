import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { GET, PATCH } from "../app/api/settings/route";
import {
  getSettingsRepository,
  clearRepositories,
} from "../lib/repositories/factory";
import { MOCK_API_ROLE } from "../lib/auth/session";

// The API-layer mock session defaults to the "readonly" role, which holds
// settings:read but NOT settings:write. These tests assert that contract.
describe("GET /api/settings", () => {
  beforeEach(() => clearRepositories());

  test("returns typed dashboard settings (settings:read is held by readonly)", async () => {
    const res = await GET(new Request("http://localhost/api/settings"));
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.data.workspaceName, "string");
    assert.equal(typeof body.data.timezone, "string");
    assert.equal(typeof body.data.displayName, "string");
    assert.equal(typeof body.data.email, "string");
  });

  test("reflects a persisted update from the mock repository", async () => {
    await getSettingsRepository().update({ workspaceName: "Persisted DAO" });
    const res = await GET(new Request("http://localhost/api/settings"));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.workspaceName, "Persisted DAO");
  });
});

describe("PATCH /api/settings", () => {
  beforeEach(() => clearRepositories());

  test("a read-only API session cannot update settings (403)", async () => {
    // Guard the precondition so this stays meaningful if the mock role changes.
    assert.equal(MOCK_API_ROLE, "readonly");

    const res = await PATCH(
      new Request("https://example.test/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: "Hacked DAO" }),
      })
    );
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.ok, false);
    assert.equal(body.code, "FORBIDDEN");
    assert.ok(typeof body.error === "string" && body.error.length > 0);

    // The rejected write must not have mutated the stored settings.
    const after = await getSettingsRepository().get();
    assert.notEqual(after.workspaceName, "Hacked DAO");
  });
});
