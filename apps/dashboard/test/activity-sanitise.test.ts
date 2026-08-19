import { describe, test } from "node:test";
import assert from "node:assert";
import { sanitiseWebhookData, getSanitisedDescription } from "../lib/activity/sanitise";

// NOTE: `sanitiseWebhookData` is a field-level ALLOWLIST per event type,
// not an HTML content sanitiser. `getSanitisedDescription` builds a string
// from a template and does NOT escape or strip the content of
// `name`/`wallet`. These tests document the actual behaviour, not the one
// originally described in the issue (see comment at the end of this file).

describe("sanitiseWebhookData", () => {
  test("keeps only the allowed fields for membership.created", () => {
    const result = sanitiseWebhookData("membership.created", {
      id: "123",
      name: "Alice",
      wallet: "0xabc",
      email: "alice@example.com", // not allowed, should be dropped
    });

    assert.deepStrictEqual(result, { id: "123", name: "Alice", wallet: "0xabc" });
    assert.strictEqual("email" in result, false);
  });

  test("keeps only the allowed fields for verification.completed", () => {
    const result = sanitiseWebhookData("verification.completed", {
      id: "1",
      wallet: "0xdef",
      name: "should be dropped",
    });

    assert.deepStrictEqual(result, { id: "1", wallet: "0xdef" });
    assert.strictEqual("name" in result, false);
  });

  test("omits allowlisted fields from the result when they are missing from data", () => {
    const result = sanitiseWebhookData("pass.created", { id: "42" });

    assert.deepStrictEqual(result, { id: "42" });
    assert.strictEqual("name" in result, false);
  });

  test("returns an empty object for an unknown event type", () => {
    const result = sanitiseWebhookData("unknown.event", {
      id: "1",
      name: "test",
    });

    assert.deepStrictEqual(result, {});
  });

  test("returns an empty object when data has none of the allowed fields", () => {
    const result = sanitiseWebhookData("guild.updated", {
      foo: "bar",
    });

    assert.deepStrictEqual(result, {});
  });

  test("does not modify the value of allowed fields, even if they contain HTML", () => {
    // Documents that filtering happens by KEY, not by content: if "name"
    // is in the allowlist, its value passes through unchanged.
    const malicious = "<img src=x onerror=alert(1)>";
    const result = sanitiseWebhookData("membership.created", {
      id: "1",
      name: malicious,
    });

    assert.strictEqual(result.name, malicious);
  });
});

describe("getSanitisedDescription", () => {
  test("uses name when present", () => {
    const result = getSanitisedDescription("membership.created", {
      name: "Alice",
      wallet: "0xabc",
    });

    assert.strictEqual(result, "New member joined: Alice");
  });

  test("falls back to wallet when name is not present", () => {
    const result = getSanitisedDescription("verification.completed", {
      wallet: "0xdef",
    });

    assert.strictEqual(result, "Verification completed for 0xdef");
  });

  test('falls back to "Unknown" when neither name nor wallet is present', () => {
    const result = getSanitisedDescription("pass.created", {});

    assert.strictEqual(result, "New pass created: Unknown");
  });

  test('falls back to "Unknown" when name is an empty string', () => {
    const result = getSanitisedDescription("pass.updated", {
      name: "",
      wallet: "",
    });

    assert.strictEqual(result, "Pass updated: Unknown");
  });

  test("ignores name/wallet when they are not strings (null, undefined, number, etc.)", () => {
    const result = getSanitisedDescription("guild.updated", {
      name: null,
      wallet: 12345,
    });

    assert.strictEqual(result, "Guild settings updated: Unknown");
  });

  test("handles undefined/null individual fields without throwing", () => {
    assert.doesNotThrow(() =>
      getSanitisedDescription("membership.updated", { name: undefined, wallet: undefined })
    );
  });

  test("returns the generic message for an unmapped event type", () => {
    const result = getSanitisedDescription("some.unmapped.event", {
      name: "Alice",
    });

    assert.strictEqual(result, "Webhook received: some.unmapped.event");
  });

  test("preserves unicode/emoji text unmodified", () => {
    const result = getSanitisedDescription("membership.created", {
      name: "日本語 café ☕ Zoë",
    });

    assert.strictEqual(result, "New member joined: 日本語 café ☕ Zoë");
  });

  test(
    "SECURITY REGRESSION: does NOT neutralise HTML/script-like content in the label; " +
      "the malicious string passes through unchanged in the generated description",
    () => {
      const malicious = '<img src=x onerror="alert(1)">';
      const result = getSanitisedDescription("membership.created", {
        name: malicious,
      });

      // Current behaviour: no stripping or escaping happens here.
      assert.strictEqual(result, `New member joined: ${malicious}`);

      // This test is intentionally a "snapshot" of current behaviour, not a
      // security guarantee. If the consumer of this string in the UI uses
      // dangerouslySetInnerHTML (or equivalent) instead of rendering it as
      // plain text, this is a real XSS vector. See the note at the end of
      // this file.
    }
  );
});

/**
 * NOTE FOR REVIEWERS / ISSUE AUTHOR:
 *
 * The original issue describes `sanitise.ts` as a module that "strips or
 * escapes untrusted webhook-derived strings" (HTML tags, script-like
 * content, excessive length). The actual code does none of this:
 *
 * - `sanitiseWebhookData` is a field-level ALLOWLIST per event type (it
 *   filters which keys survive), not a sanitiser of those fields' CONTENT.
 * - `getSanitisedDescription` interpolates `name`/`wallet` directly into a
 *   template string without escaping or truncating.
 *
 * There is no HTML stripping, no length truncation, and therefore unicode
 * preservation is trivially true (the string is never touched).
 *
 * If XSS protection is an actual requirement, the responsibility for
 * escaping falls on wherever this string gets rendered in the UI (e.g.
 * relying on React's automatic escaping when rendering as text, and never
 * using dangerouslySetInnerHTML with this value). Worth verifying
 * separately, and if needed, opening a dedicated security issue instead of
 * folding it into this test-coverage ticket.
 */