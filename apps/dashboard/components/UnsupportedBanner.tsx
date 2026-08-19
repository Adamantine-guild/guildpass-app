"use client";

import { useEffect, useState } from "react";

/**
 * UnsupportedBanner
 *
 * Renders a visible banner when the dashboard is running in live mode and
 * a particular list endpoint is not yet implemented. This prevents silent
 * fallback to mock data on live deployments.
 *
 * Dismissal is persisted in sessionStorage so it survives in-page navigation
 * but reappears on a fresh browser session, keeping new operators informed.
 * Dismissal is scoped per-resource so banners don't interfere with each other.
 */

interface UnsupportedBannerProps {
  /** The resource type that is not supported (e.g. "passes", "guilds"). */
  resource: string;
  /** Optional extra message to display. */
  message?: string;
}

export default function UnsupportedBanner({
  resource,
  message,
}: UnsupportedBannerProps) {
  // Unique storage key scoped to this resource so dismissing one banner
  // never hides another resource's warning.
  const storageKey = `guildpass:banner-dismissed:${resource}`;

  // Start as null to avoid a flash of the banner before we read sessionStorage.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  // Initialise dismissed state from sessionStorage on mount (client-only).
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      setDismissed(stored === "true");
    } catch {
      // sessionStorage may be unavailable (e.g. private-browsing restrictions).
      setDismissed(false);
    }
  }, [storageKey]);

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(storageKey, "true");
    } catch {
      // Silently ignore storage errors; the banner will still hide for this render.
    }
    setDismissed(true);
  };

  // Suppress render until we've confirmed the sessionStorage state to avoid
  // a layout shift where the banner briefly appears then disappears.
  if (dismissed === null || dismissed === true) return null;

  const displayResource = resource.charAt(0).toUpperCase() + resource.slice(1);

  return (
    <div
      role="alert"
      className="bg-amber-50 border border-amber-200 rounded-xl p-6 my-4"
    >
      <div className="flex items-start gap-4">
        <div className="text-2xl shrink-0" aria-hidden="true">
          ⚠️
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-amber-800">
            {displayResource} listing not available in live mode
          </h3>
          <p className="mt-1 text-sm text-amber-700">
            {message ||
              `The live integration currently supports only targeted lookups. Full ${resource} listing has not been implemented yet.`}
          </p>
          <p className="mt-2 text-xs text-amber-600">
            Switch to{" "}
            <span className="font-mono bg-amber-100 px-1 rounded">
              DASHBOARD_API_MODE=mock
            </span>{" "}
            or implement the list endpoint to see data here.
          </p>
        </div>

        {/* Dismiss button — hides banner for this session only */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={`Dismiss ${displayResource} unsupported banner`}
          className="shrink-0 text-amber-500 hover:text-amber-700 hover:bg-amber-100 rounded-md p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
