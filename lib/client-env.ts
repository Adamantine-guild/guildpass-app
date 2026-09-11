/**
 * Client-side API mode detection.
 *
 * On the server, the mode is read from the environment variable directly.
 * On the client, Next.js inlines `NEXT_PUBLIC_*` variables at build time so
 * we expose the same value here. The default is "mock" so local development
 * continues to work out of the box.
 */

export type ClientApiMode = "mock" | "live";

/**
 * Returns the API mode as seen from the client bundle.
 * In live deployments set `NEXT_PUBLIC_DASHBOARD_API_MODE=live`.
 */
export function getClientApiMode(): ClientApiMode {
  const m = (
    process.env.NEXT_PUBLIC_DASHBOARD_API_MODE || "mock"
  )?.toLowerCase();
  return m === "live" ? "live" : "mock";
}
