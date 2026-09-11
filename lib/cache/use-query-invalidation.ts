"use client";

import { useEffect, useMemo, useState } from "react";
import {
  dashboardQueryCache,
  serializeQueryKey,
  type QueryKey,
} from "./query-cache";

export function useQueryInvalidation(key: QueryKey): number {
  const [revision, setRevision] = useState(0);
  const serializedKey = serializeQueryKey(key);
  const stableKey = useMemo(
    () => JSON.parse(serializedKey) as QueryKey,
    [serializedKey]
  );

  useEffect(
    () => dashboardQueryCache.subscribe(stableKey, () => setRevision((value) => value + 1)),
    [stableKey]
  );

  return revision;
}
