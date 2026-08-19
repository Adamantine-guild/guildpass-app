/**
 * Unit tests for lib/format-relative-time.ts
 *
 * Covers every threshold boundary to ensure consistent phrasing across
 * all components that consume the shared utility.
 *
 * Thresholds:
 *   0–4 s    → "just now"
 *   5–59 s   → "Xs ago"
 *   60–3599 s (1–59 m) → "Xm ago"
 *   3600–86399 s (1–23 h) → "Xh ago"
 *   ≥ 86400 s (≥ 1 d)    → "Xd ago"
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRelativeTime } from "../lib/format-relative-time.ts";

/** Convenience: build a Date that is `offsetSeconds` in the past relative to `now`. */
function past(offsetSeconds: number, now: Date): Date {
  return new Date(now.getTime() - offsetSeconds * 1_000);
}

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");

  // ── "just now" band (0–4 s) ───────────────────────────────────────────────
  describe("just now band (< 5 s)", () => {
    it("returns 'just now' for 0 s", () => {
      assert.equal(formatRelativeTime(past(0, now), now), "just now");
    });

    it("returns 'just now' for 4 s", () => {
      assert.equal(formatRelativeTime(past(4, now), now), "just now");
    });

    it("returns 'just now' for a future date (clock skew clamp)", () => {
      const future = new Date(now.getTime() + 5_000);
      assert.equal(formatRelativeTime(future, now), "just now");
    });
  });

  // ── seconds band (5–59 s) ─────────────────────────────────────────────────
  describe("seconds band (5–59 s)", () => {
    it("returns '5s ago' at the lower boundary (5 s)", () => {
      assert.equal(formatRelativeTime(past(5, now), now), "5s ago");
    });

    it("returns '30s ago' mid-band", () => {
      assert.equal(formatRelativeTime(past(30, now), now), "30s ago");
    });

    it("returns '59s ago' at the upper boundary (59 s)", () => {
      assert.equal(formatRelativeTime(past(59, now), now), "59s ago");
    });
  });

  // ── minutes band (60 s – 59 m 59 s) ─────────────────────────────────────
  describe("minutes band (1–59 m)", () => {
    it("returns '1m ago' at exactly 60 s", () => {
      assert.equal(formatRelativeTime(past(60, now), now), "1m ago");
    });

    it("returns '1m ago' at 61 s (still 1 full minute)", () => {
      assert.equal(formatRelativeTime(past(61, now), now), "1m ago");
    });

    it("returns '2m ago' at 2 min", () => {
      assert.equal(formatRelativeTime(past(120, now), now), "2m ago");
    });

    it("returns '59m ago' just before the hours boundary (3599 s)", () => {
      assert.equal(formatRelativeTime(past(3599, now), now), "59m ago");
    });
  });

  // ── hours band (1 h – 23 h 59 m) ─────────────────────────────────────────
  describe("hours band (1–23 h)", () => {
    it("returns '1h ago' at exactly 3600 s", () => {
      assert.equal(formatRelativeTime(past(3600, now), now), "1h ago");
    });

    it("returns '1h ago' at 3601 s", () => {
      assert.equal(formatRelativeTime(past(3601, now), now), "1h ago");
    });

    it("returns '23h ago' just before the days boundary (86399 s)", () => {
      assert.equal(formatRelativeTime(past(86399, now), now), "23h ago");
    });
  });

  // ── days band (≥ 24 h) ────────────────────────────────────────────────────
  describe("days band (>= 24 h)", () => {
    it("returns '1d ago' at exactly 86400 s (24 h)", () => {
      assert.equal(formatRelativeTime(past(86400, now), now), "1d ago");
    });

    it("returns '2d ago' at 172800 s (48 h)", () => {
      assert.equal(formatRelativeTime(past(172800, now), now), "2d ago");
    });

    it("returns '7d ago' for 1 week", () => {
      assert.equal(formatRelativeTime(past(7 * 86400, now), now), "7d ago");
    });
  });

  // ── ISO string input ──────────────────────────────────────────────────────
  describe("ISO string input", () => {
    it("accepts an ISO-8601 string and returns the correct relative label", () => {
      const iso = past(90, now).toISOString();
      assert.equal(formatRelativeTime(iso, now), "1m ago");
    });
  });
});
