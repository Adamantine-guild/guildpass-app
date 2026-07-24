import type {
  ActivityEvent,
  ActivityEventEntity,
  ActivityEventSeverity,
  ActivityEventSource,
  ActivityEventType,
} from "./types";

export const DEFAULT_ACTIVITY_LIMIT = 20;
export const MAX_ACTIVITY_LIMIT = 100;

const EVENT_TYPES = new Set<ActivityEventType>([
  "pass.created",
  "pass.updated",
  "pass.purchased",
  "pass.deleted",
  "guild.created",
  "guild.updated",
  "guild.deleted",
  "member.joined",
  "member.left",
  "member.roles_changed",
  "access.granted",
  "access.revoked",
  "verification.completed",
  "webhook.received",
  "activity.permission_denied",
]);

const EVENT_SOURCES = new Set<ActivityEventSource>([
  "dashboard",
  "webhook",
  "core_api",
]);

const EVENT_SEVERITIES = new Set<ActivityEventSeverity>([
  "info",
  "warning",
  "error",
  "critical",
]);

const ENTITY_TYPES = new Set<ActivityEventEntity["type"]>([
  "pass",
  "guild",
  "member",
  "verification",
  "webhook",
]);

const SORT_ORDERS = new Set<ActivitySortOrder>(["newest", "oldest"]);

export type ActivitySortOrder = "newest" | "oldest";

export interface ActivityQuery {
  limit?: number;
  cursor?: string;
  type?: ActivityEventType;
  source?: ActivityEventSource;
  severity?: ActivityEventSeverity;
  entityType?: ActivityEventEntity["type"];
  actor?: string;
  from?: string;
  sort?: ActivitySortOrder;
}

export interface ActivityQueryResult {
  events: ActivityEvent[];
  nextCursor: string | null;
  total: number;
}

export interface ActivityQueryError {
  field: string;
  message: string;
}

export type ActivityQueryParseResult =
  | { ok: true; value: ActivityQuery }
  | { ok: false; errors: ActivityQueryError[] };

export function filterActivityEvents(
  events: ActivityEvent[],
  query: ActivityQuery = {}
): ActivityQueryResult {
  const limit = clampLimit(query.limit ?? DEFAULT_ACTIVITY_LIMIT);
  const actorFilter = query.actor?.trim().toLowerCase();
  const fromTime = query.from ? new Date(query.from).getTime() : null;

  const filtered = events
    .filter((event) => {
      if (query.type && event.type !== query.type) return false;
      if (query.source && event.source !== query.source) return false;
      if (query.severity && event.severity !== query.severity) return false;
      if (query.entityType && event.entity?.type !== query.entityType) return false;
      if (fromTime !== null && new Date(event.timestamp).getTime() < fromTime) return false;
      if (actorFilter && !matchesActor(event, actorFilter)) return false;
      return true;
    })
    .sort((a, b) => compareActivityEvents(a, b, query.sort ?? "newest"));

  const cursorIndex = query.cursor
    ? filtered.findIndex((event) => event.id === query.cursor)
    : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = filtered.slice(start, start + limit);
  const hasMore = start + page.length < filtered.length;

  return {
    events: page,
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
    total: filtered.length,
  };
}

export function parseActivityQuery(
  searchParams: URLSearchParams
): ActivityQueryParseResult {
  const errors: ActivityQueryError[] = [];
  const query: ActivityQuery = {};

  const limit = searchParams.get("limit");
  if (limit) {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      errors.push({ field: "limit", message: "limit must be a positive integer" });
    } else {
      query.limit = clampLimit(parsedLimit);
    }
  } else {
    query.limit = DEFAULT_ACTIVITY_LIMIT;
  }

  const cursor = searchParams.get("cursor")?.trim();
  if (cursor) {
    query.cursor = cursor;
  }

  readEnum(searchParams, "type", EVENT_TYPES, errors, (value) => {
    query.type = value;
  });
  readEnum(searchParams, "source", EVENT_SOURCES, errors, (value) => {
    query.source = value;
  });
  readEnum(searchParams, "severity", EVENT_SEVERITIES, errors, (value) => {
    query.severity = value;
  });
  readEnum(searchParams, "entityType", ENTITY_TYPES, errors, (value) => {
    query.entityType = value;
  });

  const actor = searchParams.get("actor")?.trim();
  if (actor) {
    query.actor = actor.toLowerCase();
  }

  readEnum(searchParams, "sort", SORT_ORDERS, errors, (value) => {
    query.sort = value;
  });

  const from = searchParams.get("from");
  if (from) {
    const timestamp = new Date(from).getTime();
    if (Number.isNaN(timestamp)) {
      errors.push({ field: "from", message: "from must be a valid ISO timestamp" });
    } else {
      query.from = new Date(timestamp).toISOString();
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: query };
}

function readEnum<T extends string>(
  searchParams: URLSearchParams,
  field: string,
  allowed: Set<T>,
  errors: ActivityQueryError[],
  assign: (value: T) => void
) {
  const value = searchParams.get(field);
  if (!value) return;

  if (!allowed.has(value as T)) {
    errors.push({ field, message: `${field} is not supported` });
    return;
  }

  assign(value as T);
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), MAX_ACTIVITY_LIMIT);
}

function compareActivityEvents(a: ActivityEvent, b: ActivityEvent, sort: ActivitySortOrder = "newest"): number {
  const newestFirst = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  const timeDiff = sort === "oldest" ? -newestFirst : newestFirst;
  if (timeDiff !== 0) return timeDiff;
  return sort === "oldest" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
}

function matchesActor(event: ActivityEvent, actorFilter: string): boolean {
  return [event.actor.id, event.actor.name, event.actor.wallet]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(actorFilter));
}
