"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getClientApiMode, type ClientApiMode } from "@/lib/client-env";
import type { UnsupportedResponse } from "@/lib/api-helpers";

/**
 * Possible states for a list fetch operation.
 * - "loading": initial fetch in progress
 * - "loaded": data successfully fetched (or mock fallback used in mock mode)
 * - "unsupported": live mode, endpoint returned 501 with UNSUPPORTED_IN_LIVE_MODE
 * - "error": fetch failed (network or server error)
 */
export type ListState = "loading" | "loaded" | "unsupported" | "error";

interface UseApiListOptions<T> {
  /** API endpoint URL (e.g. "/api/passes"). */
  url: string;
  /** Fallback mock data used only in mock mode when the fetch fails. */
  fallbackData: T[];
  /** Called when data is available (from API or mock fallback). */
  onData: (data: T[]) => void;
}

interface UseApiListResult {
  /** Current state of the fetch operation. */
  state: ListState;
  /** Error message, if state is "error". */
  errorMessage: string | null;
  /** Retry the fetch. */
  retry: () => void;
}

/**
 * Fetches a list from the given API endpoint and distinguishes between:
 *  - Successful responses → "loaded"
 *  - 501 UNSUPPORTED_IN_LIVE_MODE → "unsupported"
 *  - Network/server errors in live mode → "error"
 *  - Network/server errors in mock mode → falls back to `fallbackData` → "loaded"
 */
export function useApiList<T>({
  url,
  fallbackData,
  onData,
}: UseApiListOptions<T>): UseApiListResult {
  const [state, setState] = useState<ListState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const apiModeRef = useRef<ClientApiMode>(getClientApiMode());
  const [retryCounter, setRetryCounter] = useState(0);

  const fetchData = useCallback(async () => {
    setState("loading");
    setErrorMessage(null);

    try {
      const res = await fetch(url);

      if (!res.ok) {
        // Check if this is a live-mode unsupported response
        if (res.status === 501) {
          const body = await res.json().catch(() => ({}));
          if ((body as UnsupportedResponse).code === "UNSUPPORTED_IN_LIVE_MODE") {
            if (mountedRef.current) {
              setState("unsupported");
              setErrorMessage(null);
            }
            return;
          }
        }

        // Other server errors
        if (apiModeRef.current === "live") {
          if (mountedRef.current) {
            setState("error");
            setErrorMessage(
              `Server returned ${res.status}: ${res.statusText}`
            );
          }
          return;
        }

        // Mock mode: fall back to mock data
        console.warn(
          `[useApiList] ${url} returned ${res.status}, falling back to mock data`
        );
        if (mountedRef.current) {
          onData(fallbackData);
          setState("loaded");
        }
        return;
      }

      const data = await res.json();
      if (mountedRef.current) {
        if (Array.isArray(data)) {
          onData(data);
        } else {
          console.warn(
            `[useApiList] ${url} returned non-array payload, falling back to mock`
          );
          onData(fallbackData);
        }
        setState("loaded");
      }
    } catch (err) {
      // Network / fetch error
      const message =
        err instanceof Error ? err.message : "Unknown fetch error";

      if (apiModeRef.current === "live") {
        if (mountedRef.current) {
          setState("error");
          setErrorMessage(`Network error: ${message}`);
        }
      } else {
        // Mock mode: fall back to mock data
        console.warn(
          `[useApiList] ${url} fetch failed in mock mode, falling back to mock data:`,
          message
        );
        if (mountedRef.current) {
          onData(fallbackData);
          setState("loaded");
        }
      }
    }
  }, [url, fallbackData, onData]);

  useEffect(() => {
    mountedRef.current = true;
    // fetchData handles its own errors (state fallback), so no await needed
    void fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData, retryCounter]);

  const retry = useCallback(() => {
    setRetryCounter((c) => c + 1);
  }, []);

  return { state, errorMessage, retry };
}
