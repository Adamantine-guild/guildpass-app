"use client";

import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import LastUpdated from "@/components/LastUpdated";
import { useActivityFeed } from "@/lib/hooks/useActivityFeed";
import {
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_EVENT_SEVERITIES,
  ACTIVITY_EVENT_SOURCES,
  ACTIVITY_EVENT_TYPES,
} from "@/lib/activity/types";
import {
  type ActivityEventEntity,
  type ActivityEventSeverity,
  type ActivityEventSource,
  type ActivityEventType,
} from "@guildpass/integration-client";

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
  "verification.completed": "✅",
  "webhook.received": "📡",
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
  "verification.completed": "bg-emerald-100",
  "webhook.received": "bg-indigo-100",
};

export default function ActivityPage() {
  const [type, setType] = useState<ActivityEventType | "">("");
  const [source, setSource] = useState<ActivityEventSource | "">("");
  const [severity, setSeverity] = useState<ActivityEventSeverity | "">("");
  const [actor, setActor] = useState("");
  const [entityType, setEntityType] = useState<ActivityEventEntity["type"] | "">("");
  const [from, setFrom] = useState("");
  const { events, lastUpdated, loading, hasMore, loadMore } = useActivityFeed({
    limit: 20,
    type: type || undefined,
    source: source || undefined,
    severity: severity || undefined,
    actor: actor.trim() || undefined,
    entityType: entityType || undefined,
    from: from || undefined,
    paginate: true,
    poll: false,
  });

  return (
    <DashboardLayout title="Activity">
      <div className="flex flex-col gap-4 mb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-medium text-slate-500">
            Type
            <select
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              value={type}
              onChange={(event) => setType(event.target.value as ActivityEventType | "")}
            >
              <option value="">All types</option>
              {ACTIVITY_EVENT_TYPES.map((eventType) => (
                <option key={eventType} value={eventType}>{eventType}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-500">
            Source
            <select
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              value={source}
              onChange={(event) => setSource(event.target.value as ActivityEventSource | "")}
            >
              <option value="">All sources</option>
              {ACTIVITY_EVENT_SOURCES.map((eventSource) => (
                <option key={eventSource} value={eventSource}>{eventSource}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-500">
            Severity
            <select
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as ActivityEventSeverity | "")}
            >
              <option value="">All severities</option>
              {ACTIVITY_EVENT_SEVERITIES.map((eventSeverity) => (
                <option key={eventSeverity} value={eventSeverity}>{eventSeverity}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-500">
            Actor
            <input
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              type="search"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="Name or wallet"
            />
          </label>

          <label className="text-xs font-medium text-slate-500">
            Entity
            <select
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value as ActivityEventEntity["type"] | "")}
            >
              <option value="">All entities</option>
              {ACTIVITY_ENTITY_TYPES.map((eventEntityType) => (
                <option key={eventEntityType} value={eventEntityType}>{eventEntityType}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-500">
            From
            <input
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4 lg:justify-end">
          <p className="text-sm text-slate-500">{events.length} event{events.length !== 1 ? "s" : ""}</p>
          <LastUpdated date={lastUpdated} />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl">
        {loading && events.length === 0 ? (
          <div className="px-6 py-12 text-center text-slate-400 text-sm">Loading activity…</div>
        ) : events.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">No activity found</p>
            <p className="text-sm text-slate-400 mt-1">Try changing the selected filters.</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {events.map((activity) => (
                <li key={activity.id} className="px-6 py-4 flex items-start gap-4 animate-[fadeIn_0.3s_ease-in]">
                  <div className={`w-10 h-10 rounded-full ${TYPE_COLOR[activity.type as ActivityEventType] || "bg-slate-100"} flex items-center justify-center text-lg shrink-0`}>
                    {TYPE_ICON[activity.type as ActivityEventType] ?? "📋"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-medium text-slate-800 truncate">{activity.description}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-slate-400">
                          {new Date(activity.timestamp).toLocaleString()}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full ${activity.source === "webhook" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-700"}`}>
                          {activity.source}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-500 mt-0.5">
                      by {activity.actor.name || activity.actor.wallet || "System"}
                    </p>
                    {activity.entity && (
                      <p className="text-xs text-slate-400 mt-1">
                        {activity.entity.type}: {activity.entity.name || activity.entity.id}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="border-t border-slate-100 px-6 py-4 text-center">
                <button
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  type="button"
                  disabled={loading}
                  onClick={loadMore}
                >
                  {loading ? "Loading..." : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
