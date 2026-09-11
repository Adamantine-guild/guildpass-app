import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { validateSettingsPatch } from "../lib/validation/settings";

describe("validateSettingsPatch", () => {
  test("accepts a valid partial patch and trims text", () => {
    const result = validateSettingsPatch({
      workspaceName: "  Acme DAO  ",
      timezone: "Europe/London",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, {
        workspaceName: "Acme DAO",
        timezone: "Europe/London",
      });
    }
  });

  test("accepts a valid email and display name", () => {
    const result = validateSettingsPatch({
      displayName: "Ada",
      email: "ada@guildpass.xyz",
    });
    assert.equal(result.ok, true);
  });

  test("rejects an unsupported timezone with a field error", () => {
    const result = validateSettingsPatch({ timezone: "Mars/Olympus" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(
        result.errors.map((e) => e.field),
        ["timezone"]
      );
    }
  });

  test("rejects a malformed email", () => {
    const result = validateSettingsPatch({ email: "not-an-email" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors[0].field, "email");
  });

  test("rejects an empty workspace name", () => {
    const result = validateSettingsPatch({ workspaceName: "   " });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors[0].field, "workspaceName");
  });

  test("rejects an over-long field", () => {
    const result = validateSettingsPatch({ displayName: "x".repeat(51) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors[0].field, "displayName");
  });

  test("collects multiple field errors at once", () => {
    const result = validateSettingsPatch({
      timezone: "nope",
      email: "bad",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(
        result.errors.map((e) => e.field).sort(),
        ["email", "timezone"]
      );
    }
  });

  test("rejects a body with no supported fields", () => {
    const result = validateSettingsPatch({ unrelated: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errors[0].field, "_root");
  });

  test("rejects a non-object body", () => {
    assert.equal(validateSettingsPatch(null).ok, false);
    assert.equal(validateSettingsPatch("string").ok, false);
    assert.equal(validateSettingsPatch([]).ok, false);
  });
});
