import {
  DEFAULT_ACTIVITY_LIMIT,
  MAX_ACTIVITY_LIMIT,
} from "./storage.ts";
import {
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_EVENT_SEVERITIES,
  ACTIVITY_EVENT_SOURCES,
  ACTIVITY_EVENT_TYPES,
  type ActivityQuery,
} from "./types.ts";

type ParseResult =
  | { query: ActivityQuery }
  | { error: string };

function isOneOf<T extends readonly string[]>(
  values: T,
  value: string | null
): value is T[number] {
  return value !== null && values.includes(value);
}

function parseLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_ACTIVITY_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_LIMIT) {
    return null;
  }
  return limit;
}

export function parseActivityQuery(searchParams: URLSearchParams): ParseResult {
  const limit = parseLimit(searchParams.get("limit"));

  if (limit === null) {
    return { error: `limit must be an integer from 1 to ${MAX_ACTIVITY_LIMIT}` };
  }

  const type = searchParams.get("type");
  if (type !== null && !isOneOf(ACTIVITY_EVENT_TYPES, type)) {
    return { error: "Invalid activity type" };
  }

  const source = searchParams.get("source");
  if (source !== null && !isOneOf(ACTIVITY_EVENT_SOURCES, source)) {
    return { error: "Invalid activity source" };
  }

  const severity = searchParams.get("severity");
  if (severity !== null && !isOneOf(ACTIVITY_EVENT_SEVERITIES, severity)) {
    return { error: "Invalid activity severity" };
  }

  const entityType = searchParams.get("entityType");
  if (entityType !== null && !isOneOf(ACTIVITY_ENTITY_TYPES, entityType)) {
    return { error: "Invalid activity entity type" };
  }

  const from = searchParams.get("from");
  if (from !== null && Number.isNaN(Date.parse(from))) {
    return { error: "Invalid from timestamp" };
  }

  const cursor = searchParams.get("cursor") ?? undefined;
  if (cursor !== undefined && cursor.split("|").length !== 2) {
    return { error: "Invalid activity cursor" };
  }

  return {
    query: {
      limit,
      cursor,
      actor: searchParams.get("actor") ?? undefined,
      from: from ?? undefined,
      type: type ?? undefined,
      source: source ?? undefined,
      severity: severity ?? undefined,
      entityType: entityType ?? undefined,
    },
  };
}
