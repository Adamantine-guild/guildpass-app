/**
 * lib/auth/csrf-client.ts
 *
 * Client-side utility for attaching the CSRF token to fetch requests.
 *
 * The CSRF token is stored in a non-HttpOnly cookie so JavaScript can read it.
 * This module provides helpers to:
 *   – Read the token from the cookie
 *   – Attach it as an X-CSRF-Token header to fetch requests
 *   – Provide a csrfFetch wrapper that works like the native fetch
 *
 * Usage in dashboard components:
 *
 *   import { csrfFetch, getCsrfToken } from "@/lib/auth/csrf-client";
 *
 *   // Option 1: Use the wrapper
 *   const res = await csrfFetch("/api/guilds", { method: "POST", body: ... });
 *
 *   // Option 2: Build headers manually
 *   const token = getCsrfToken();
 *   fetch("/api/guilds", {
 *     method: "POST",
 *     headers: { "X-CSRF-Token": token, ... },
 *     body: ...,
 *   });
 */

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf";

/**
 * Reads the CSRF token from the browser's cookies.
 *
 * @returns The CSRF token string, or `null` if the cookie is not set.
 */
export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;

  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));

  if (!match) return null;

  const value = match.split("=")[1];
  return decodeURIComponent(value);
}

/**
 * A fetch wrapper that automatically attaches the CSRF token header
 * to every state-changing request (POST, PATCH, PUT, DELETE).
 *
 * Safe (read-only) methods (GET, HEAD, OPTIONS) are passed through unchanged
 * without the CSRF header.
 *
 * @param input  – The URL or Request to fetch.
 * @param init   – Standard fetch options (method, headers, body, etc.).
 * @returns The fetch Response promise.
 *
 * @example
 *   const res = await csrfFetch("/api/guilds", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({ name: "New Guild" }),
 *   });
 */
export async function csrfFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutating = ["POST", "PATCH", "PUT", "DELETE"].includes(method);

  if (!isMutating) {
    return fetch(input, init);
  }

  const token = getCsrfToken();
  if (!token) {
    console.warn(
      "[csrf] No CSRF token found in cookies. Mutating request may be rejected."
    );
  }

  const headers = new Headers(init?.headers);

  // Only add the header if it's not already set (allows callers to override)
  if (!headers.has(CSRF_HEADER_NAME) && token) {
    headers.set(CSRF_HEADER_NAME, token);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
