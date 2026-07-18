"use client";

import DashboardLayout from "@/components/DashboardLayout";
import LastUpdated from "@/components/LastUpdated";
import { getActivityRefreshConfig } from "@/lib/env";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { useActivityFeed } from "@/lib/hooks/useActivityFeed";
import {
  type ActivityEventSeverity,
  type ActivityEventSource,
  type ActivityEventType,
} from "@guildpass/integration-client";
import type { ActivityChange } from "@guildpass/integration-client";
import { useMemo, useState } from "react";
import VirtualList from "@/components/VirtualList";

const TYPE_ICON: Record<ActivityEventType, string> = {
  "member.joined": "👤",
  "member.left": "🚪",
  "member.roles_changed": "🔄",
  "pass.created": "🎫",
  "pass.updated": "⚙️",
  "pass.purchased": "💳",
  "pass.deleted": "🗑️",
  "guild.created": "🏰",
  "guild.updated": "🏰",
  "guild.deleted": "🏚️",
  "access.granted": "🔓",
  "access.revoked": "🔒",
  "settings.updated": "⚙️",
  "verification.completed": "✅",
  "webhook.received": "📡",
  "activity.permission_denied": "⛔",
};

const TYPE_COLOR: Record<ActivityEventType, string> = {
  "member.joined": "bg-green-100",
  "member.left": "bg-orange-100",
  "member.roles_changed": "bg-yellow-100",
  "pass.created": "bg-blue-100",
  "pass.updated": "bg-blue-100",
  "pass.purchased": "bg-purple-100",
  "pass.deleted": "bg-red-100",
  "guild.created": "bg-pink-100",
  "guild.updated": "bg-pink-100",
  "guild.deleted": "bg-red-100",
  "access.granted": "bg-green-100",
  "access.revoked": "bg-red-100",
  "settings.updated": "bg-slate-100",
  "verification.completed": "bg-emerald-100",
  "webhook.received": "bg-indigo-100",
  "activity.permission_denied": "bg-red-100",
};

const TYPE_FILTERS: { label: string; value: ActivityEventType | "" }[] = [
  { label: "All event types", value: "" },
  { label: "Members joined", value: "member.joined" },
  { label: "Role changes", value: "member.roles_changed" },
  { label: "Pass created", value: "pass.created" },
  { label: "Pass purchased", value: "pass.purchased" },
  { label: "Access granted", value: "access.granted" },
  { label: "Webhook received", value: "webhook.received" },
  { label: "Permission denied", value: "activity.permission_denied" },
];

const SOURCE_FILTERS: { label: string; value: ActivityEventSource | "" }[] = [
  { label: "All sources", value: "" },
  { label: "Dashboard", value: "dashboard" },
  { label: "Webhook", value: "webhook" },
  { label: "Core API", value: "core_api" },
];

const SEVERITY_FILTERS: { label: string; value: ActivityEventSeverity | "" }[] = [
  { label: "All severities", value: "" },
  { label: "Info", value: "info" },
  { label: "Warning", value: "warning" },
  { label: "Error", value: "error" },
  { label: "Critical", value: "critical" },
];

export default function ActivityPage() {
  const [type, setType] = useState<ActivityEventType | "">("");
  const [source, setSource] = useState<ActivityEventSource | "">("");
  const [severity, setSeverity] = useState<ActivityEventSeverity | "">("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const { intervalMs } = getActivityRefreshConfig();

  const fromIso = useMemo(() => {
    if (!from) return undefined;
    const parsed = new Date(from);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }, [from]);

  const {
    events,
    lastUpdated,
    loading,
    loadingMore,
    refreshing,
    hasMore,
    total,
    error,
    loadMore,
    refresh,
  } = useActivityFeed({
    limit: 10,
    type: type || undefined,
    source: source || undefined,
    severity: severity || undefined,
    actor: actor.trim() || undefined,
    from: fromIso,
    autoRefresh: true,
    simulate: false,
  });

  const hasActiveFilters = Boolean(type || source || severity || actor.trim() || from);

  const clearFilters = () => {
    setType("");
    setSource("");
    setSeverity("");
    setActor("");
    setFrom("");
  };

  return (
    <DashboardLayout title="Activity">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-500">
            Showing {events.length} of {total} event{total !== 1 ? "s" : ""}
          </p>
          <LastUpdated date={lastUpdated} autoRefresh={intervalMs > 0} />
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          title="Fetch the latest activity events"
        >
          <svg
            className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
            />
          </svg>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-medium text-slate-600">
            Event type
            <select
              value={type}
              onChange={(event) => setType(event.target.value as ActivityEventType | "")}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              {TYPE_FILTERS.map((option) => (
                <option key={option.value || "all-types"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-600">
            Source
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as ActivityEventSource | "")}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              {SOURCE_FILTERS.map((option) => (
                <option key={option.value || "all-sources"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-600">
            Severity
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value as ActivityEventSeverity | "")}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            >
              {SEVERITY_FILTERS.map((option) => (
                <option key={option.value || "all-severities"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-600">
            Actor
            <input
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="Name or wallet"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </label>

          <label className="text-xs font-medium text-slate-600">
            From
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </label>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        {error ? (
          <div className="px-6 py-12 text-center text-sm text-red-500">{error}</div>
        ) : loading && events.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-400">Loading activity...</div>
        ) : events.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-400">
            {hasActiveFilters ? "No activity matches the selected filters." : "No activity yet."}
          </div>
        ) : (
          <>
            <VirtualList
              items={events}
              className="divide-y divide-slate-100"
              estimatedItemHeight={88}
              overscan={3}
              renderItem={(activity) => (
                <li className="flex items-start gap-4 px-6 py-4 animate-[fadeIn_0.3s_ease-in]">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${TYPE_COLOR[activity.type]}`}>
                    {TYPE_ICON[activity.type]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium text-slate-800">{activity.description}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className="text-xs text-slate-400"
                          title={new Date(activity.timestamp).toLocaleString()}
                        >
                          {formatRelativeTime(activity.timestamp)}
                        </span>
                        <span className={`rounded-full px-2 py-1 text-xs ${activity.source === "webhook" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-700"}`}>
                          {activity.source}
                        </span>
                        <span className={`rounded-full px-2 py-1 text-xs ${activity.severity === "error" || activity.severity === "critical" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                          {activity.severity}
                        </span>
                      </div>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">
                      by {activity.actor.name || activity.actor.wallet || "System"}
                    </p>
                    {activity.entity && (
                      <p className="mt-1 text-xs text-slate-400">
                        {activity.entity.type}: {activity.entity.name || activity.entity.id}
                      </p>
                    )}
                    {activity.changes && activity.changes.length > 0 && (
                      <details className="mt-2 group">
                        <summary className="text-xs font-medium text-primary-600 cursor-pointer hover:text-primary-700 select-none">
                          {activity.changes.length} field{activity.changes.length !== 1 ? "s" : ""} changed
                        </summary>
                        <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-primary-100">
                          {activity.changes.map((change) => (
                            <DiffRow key={change.field} change={change} />
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              )}
            />

            {hasMore && (
              <div className="border-t border-slate-100 px-6 py-4 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

/** Formats a diff value for display. Arrays are comma-joined; objects are JSON-summarized. */
function formatDiffValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "(empty)";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DiffRow({ change }: { change: ActivityChange }) {
  return (
    <div className="text-xs">
      <span className="font-semibold text-slate-700">{change.field}</span>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="inline-block px-1.5 py-0.5 rounded bg-red-50 text-red-700 font-mono text-[11px] line-through">
          {formatDiffValue(change.before)}
        </span>
        <span className="text-slate-300">→</span>
        <span className="inline-block px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-mono text-[11px]">
          {formatDiffValue(change.after)}
        </span>
      </div>
    </div>
  );
}
