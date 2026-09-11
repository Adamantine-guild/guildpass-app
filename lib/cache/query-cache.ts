export type QueryKey = readonly string[];

type CacheEntry = {
  key: QueryKey;
  data: unknown;
  stale: boolean;
};

type CacheListener = () => void;

function stableParams(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export const queryKeys = {
  guilds: (): QueryKey => ["guilds"],
  passes: (
    guildId: string,
    filters: Record<string, string | number | undefined> = {}
  ): QueryKey => {
    const filterKey = stableParams(filters);
    return filterKey
      ? ["guild", guildId, "passes", filterKey]
      : ["guild", guildId, "passes"];
  },
  members: (
    guildId: string,
    filters: Record<string, string | number | undefined> = {}
  ): QueryKey => {
    const filterKey = stableParams(filters);
    return filterKey
      ? ["guild", guildId, "members", filterKey]
      : ["guild", guildId, "members"];
  },
  activity: (
    guildId: string,
    filters: Record<string, string | number | undefined> = {}
  ): QueryKey => {
    const filterKey = stableParams(filters);
    return filterKey
      ? ["guild", guildId, "activity", filterKey]
      : ["guild", guildId, "activity"];
  },
  settings: (guildId: string): QueryKey => ["guild", guildId, "settings"],
};

export function serializeQueryKey(key: QueryKey): string {
  return JSON.stringify(key);
}

function startsWith(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((part, index) => key[index] === part);
}

export class DashboardQueryCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, { key: QueryKey; listeners: Set<CacheListener> }>();

  getQueryData<T>(key: QueryKey): T | undefined {
    return this.entries.get(serializeQueryKey(key))?.data as T | undefined;
  }

  setQueryData<T>(key: QueryKey, data: T): void {
    this.entries.set(serializeQueryKey(key), { key: [...key], data, stale: false });
  }

  async fetchQuery<T>(key: QueryKey, fetcher: () => Promise<T>): Promise<T> {
    const serialized = serializeQueryKey(key);
    const cached = this.entries.get(serialized);
    if (cached && !cached.stale) return cached.data as T;

    const pending = this.inFlight.get(serialized);
    if (pending) return pending as Promise<T>;

    const request = fetcher()
      .then((data) => {
        this.setQueryData(key, data);
        return data;
      })
      .finally(() => {
        this.inFlight.delete(serialized);
      });

    this.inFlight.set(serialized, request);
    return request;
  }

  invalidateQueries(prefix: QueryKey): void {
    for (const entry of this.entries.values()) {
      if (startsWith(entry.key, prefix)) entry.stale = true;
    }

    for (const subscription of this.listeners.values()) {
      if (startsWith(subscription.key, prefix)) {
        subscription.listeners.forEach((listener) => listener());
      }
    }
  }

  subscribe(key: QueryKey, listener: CacheListener): () => void {
    const serialized = serializeQueryKey(key);
    const subscription = this.listeners.get(serialized) ?? {
      key: [...key],
      listeners: new Set<CacheListener>(),
    };
    subscription.listeners.add(listener);
    this.listeners.set(serialized, subscription);

    return () => {
      subscription.listeners.delete(listener);
      if (subscription.listeners.size === 0) this.listeners.delete(serialized);
    };
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}

export const dashboardQueryCache = new DashboardQueryCache();

export type DashboardMutation = "pass" | "member" | "guild" | "settings" | "verification";

export function invalidateAfterMutation(mutation: DashboardMutation, guildId: string): void {
  if (mutation === "pass") {
    dashboardQueryCache.invalidateQueries(queryKeys.passes(guildId));
  }
  if (mutation === "member" || mutation === "verification") {
    dashboardQueryCache.invalidateQueries(queryKeys.members(guildId));
  }
  if (mutation === "settings") {
    dashboardQueryCache.invalidateQueries(queryKeys.settings(guildId));
  }
  if (mutation === "guild" || mutation === "pass" || mutation === "member") {
    dashboardQueryCache.invalidateQueries(queryKeys.guilds());
  }
  dashboardQueryCache.invalidateQueries(queryKeys.activity(guildId));
}

export function invalidateFromActivityEvent(eventType: string, guildId: string): void {
  if (eventType.startsWith("pass.")) invalidateAfterMutation("pass", guildId);
  else if (eventType.startsWith("member.")) invalidateAfterMutation("member", guildId);
  else if (eventType.startsWith("guild.")) invalidateAfterMutation("guild", guildId);
  else if (eventType === "verification.completed") invalidateAfterMutation("verification", guildId);
  else if (eventType === "settings.updated") invalidateAfterMutation("settings", guildId);
  else dashboardQueryCache.invalidateQueries(queryKeys.activity(guildId));
}
