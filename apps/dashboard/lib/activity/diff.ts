/**
 * Field-level diffing for audit trail activity events.
 *
 * Computes which top-level fields changed between two plain-object states,
 * respecting the SENSITIVE_AUDIT_FIELDS blocklist so write-only secrets
 * are never captured in any diff.
 */

import { type ActivityChange, SENSITIVE_AUDIT_FIELDS } from "@guildpass/integration-client";

/**
 * Produce a structured before/after diff between `previous` and `next`.
 *
 * Rules:
 * - Only top-level own properties are compared (no deep traversal).
 * - Fields listed in SENSITIVE_AUDIT_FIELDS are unconditionally excluded.
 * - Fields unchanged between `previous` and `next` are omitted.
 * - `undefined` is treated as "absent" — adding or removing a field is recorded.
 */
export function computeDiff<T extends Record<string, unknown>>(
  previous: T,
  next: T,
): ActivityChange[] {
  const changes: ActivityChange[] = [];
  const allFields = new Set([...Object.keys(previous), ...Object.keys(next)]);

  for (const field of allFields) {
    // Hard block: never diff a sensitive field
    if (SENSITIVE_AUDIT_FIELDS.has(field)) {
      continue;
    }

    const before = previous[field];
    const after = next[field];

    if (isEqual(before, after)) {
      continue;
    }

    changes.push({ field, before, after });
  }

  return changes;
}

/**
 * Shallow equality check that treats undefined and missing as equivalent.
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  // Treat `undefined` and missing keys the same
  if (a === undefined && b === undefined) return true;

  // Compare arrays element-wise
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isEqual(item, b[index]));
  }

  return false;
}
