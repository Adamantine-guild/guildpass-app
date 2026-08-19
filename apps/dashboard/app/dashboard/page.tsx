"use client";

import DashboardLayout from "@/components/DashboardLayout";
import LastUpdated from "@/components/LastUpdated";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import UnsupportedBanner from "@/components/UnsupportedBanner";
import { ApiClientError, readApiResult } from "@/lib/api-client";
import { getClientApiMode } from "@/lib/client-env";
import { getActivityRefreshConfig } from "@/lib/env";
import { useActivityFeed } from "@/lib/hooks/useActivityFeed";
import { mockGuilds, mockMembers, mockPasses, type Member as MockMember } from "@/lib/mock-data";
import type { PaginatedResult } from "@/lib/repositories/types";
import { useEffect, useState } from "react";

type UnsupportedResource = "passes" | "guilds" | "members";

export default function DashboardPage() {
  const { events, lastUpdated, refresh, refreshing } = useActivityFeed({ limit: 5 });
  const { intervalMs } = getActivityRefreshConfig();
  const apiMode = getClientApiMode();

  const [passesCount, setPassesCount] = useState(mockPasses.length);
  const [guildsCount, setGuildsCount] = useState(mockGuilds.length);
  const [activeMembersCount, setActiveMembersCount] = useState(
    mockMembers.filter((m) => m.status === "active").length
  );
  const [unsupportedResources, setUnsupportedResources] = useState<UnsupportedResource[]>([]);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const unsupported: UnsupportedResource[] = [];
      let encounteredError = false;

      try {
        const [passesRes, guildsRes, membersRes] = await Promise.all([
          fetch("/api/passes?limit=1"),
          fetch("/api/guilds"),
          fetch("/api/members?status=active&limit=1"),
        ]);

        const [passes, guilds, members] = await Promise.all([
          readApiResult<PaginatedResult<(typeof mockPasses)[number]>>(passesRes),
          readApiResult<typeof mockGuilds>(guildsRes),
          readApiResult<PaginatedResult<MockMember>>(membersRes),
        ]);

        if (!mounted) return;
        setPassesCount(passes.total);
        setGuildsCount(guilds.length);
        setActiveMembersCount(members.total);
      } catch (err) {
        if (err instanceof ApiClientError && err.code === "UNSUPPORTED") {
          unsupported.push("passes", "guilds", "members");
        } else if (apiMode === "live") {
          encounteredError = true;
        }

        console.warn("Dashboard stats fetch failed, using mock counts", err);
      }

      if (mounted) {
        setUnsupportedResources(unsupported);
        setHasError(encounteredError);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [apiMode]);

  const allUnsupported =
    unsupportedResources.length === 3 ||
    (unsupportedResources.length > 0 &&
      ["passes", "guilds", "members"].every((resource) =>
        unsupportedResources.includes(resource as UnsupportedResource)
      ));

  return (
    <DashboardLayout title="Dashboard">
      {allUnsupported && (
        <UnsupportedBanner
          resource="dashboard"
          message="The live integration does not support full listing of passes, guilds, or members. Dashboard stats cannot be fetched from the live API."
        />
      )}

      {!allUnsupported && unsupportedResources.length > 0 && (
        <UnsupportedBanner
          resource={unsupportedResources.join(", ")}
          message={`The following data sources are unavailable in live mode: ${unsupportedResources.join(", ")}.`}
        />
      )}

      {hasError && (
        <div className="my-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            Some dashboard stats failed to load. Check the API configuration.
          </p>
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Passes" value={passesCount} icon="P" trend="+2 this week" />
        <StatCard title="Active Guilds" value={guildsCount} icon="G" trend="+1 this week" />
        <StatCard title="Active Members" value={activeMembersCount} icon="M" trend="+12 this week" />
        <StatCard title="Total Activity" value={events.length} icon="A" trend="live" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-slate-800">Recent Activity</h2>
              <LastUpdated date={lastUpdated} autoRefresh={intervalMs > 0} />
            </div>
            <button
              onClick={() => void refresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Refresh recent activity"
            >
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
          <ul className="space-y-4">
            {events.slice(0, 5).map((activity) => (
              <li key={activity.id} className="flex items-start gap-4 border-b border-slate-100 pb-3 last:border-0">
                <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-800">{activity.description}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {new Date(activity.timestamp).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold text-slate-800">Recent Passes</h2>
          {unsupportedResources.includes("passes") ? (
            <div className="py-8 text-center text-sm text-amber-600">
              Pass listing is not available in live mode.
            </div>
          ) : (
            <ul className="space-y-3">
              {mockPasses.slice(0, 4).map((pass) => (
                <li key={pass.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <div>
                    <p className="font-medium text-slate-800">{pass.name}</p>
                    <p className="text-sm text-slate-500">
                      {pass.currentSupply} / {pass.maxSupply ?? "unlimited"}
                    </p>
                  </div>
                  <StatusBadge status={pass.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
