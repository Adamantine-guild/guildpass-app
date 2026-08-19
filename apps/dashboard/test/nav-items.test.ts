import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isNavItemActive, navItems } from "../lib/nav-items";

/**
 * nav-items.test.ts
 *
 * Tests for the pure active-route matching logic used by the dashboard
 * sidebar to set aria-current="page" on the current nav link.
 */

describe("isNavItemActive", () => {
  test("matches an exact route", () => {
    assert.equal(isNavItemActive("/dashboard", "/dashboard"), true);
  });

  test("matches a nested route under the item", () => {
    assert.equal(isNavItemActive("/guilds/abc123", "/guilds"), true);
  });

  test("does not match a sibling route sharing a prefix", () => {
    assert.equal(isNavItemActive("/passes-archive", "/passes"), false);
  });

  test("does not match an unrelated route", () => {
    assert.equal(isNavItemActive("/settings", "/passes"), false);
  });

  test("returns false for a null pathname", () => {
    assert.equal(isNavItemActive(null, "/dashboard"), false);
  });

  test("returns false for an undefined pathname", () => {
    assert.equal(isNavItemActive(undefined, "/dashboard"), false);
  });

  test("does not match the empty string pathname against a real route", () => {
    assert.equal(isNavItemActive("", "/dashboard"), false);
  });
});

describe("navItems", () => {
  test("every primary dashboard route from issue #294 is present", () => {
    const hrefs = navItems.map((item) => item.href);
    for (const expected of [
      "/dashboard",
      "/passes",
      "/guilds",
      "/members",
      "/activity",
      "/settings",
    ]) {
      assert.ok(hrefs.includes(expected), `missing nav item for ${expected}`);
    }
  });

  test("every item has a non-empty name, href, and icon", () => {
    for (const item of navItems) {
      assert.ok(item.name.length > 0);
      assert.ok(item.href.startsWith("/"));
      assert.ok(item.icon.length > 0);
    }
  });
});
