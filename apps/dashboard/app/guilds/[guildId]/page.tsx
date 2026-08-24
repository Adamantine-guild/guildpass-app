"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import StatCard from "@/components/StatCard";
import { ApiClientError, readApiResult } from "@/lib/api-client";
import { guildFetch } from "@/lib/guild/api";
import { useGuild } from "@/lib/guild/GuildProvider";
import type { Guild, Member, Pass } from "@/lib/mock-data";
import type { PaginatedResult } from "@/lib/repositories/types";

/**
 * Guild overview for the selected tenant. Selecting this route pins the
 * active guild from the path so dashboard views stay scoped.
 */
export default function GuildOverviewPage() {
  const params = useParams();
  const routeGuildId = String(params?.guildId ?? "");
  const { guildId, guild, setGuildId, guilds } = useGuild();

  const [passTotal, setPassTotal] = useState<number | null>(null);
  const [memberTotal, setMemberTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pin context from the route whenever the path guild changes.
  useEffect(() => {
    if (routeGuildId && routeGuildId !== guildId) {
      setGuildId(routeGuildId);
    }
  }, [routeGuildId, guildId, setGuildId]);

  const activeId = routeGuildId || guildId;
  const activeGuild =
    guilds.find((g) => g.id === activeId) ?? guild ?? ({ id: activeId } as Guild);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [passesRes, membersRes] = await Promise.all([
          guildFetch("/api/passes?limit=1", activeId),
          guildFetch("/api/members?limit=1", activeId),
        ]);
        const [passes, members] = await Promise.all([
          readApiResult<PaginatedResult<Pass>>(passesRes),
          readApiResult<PaginatedResult<Member>>(membersRes),
        ]);
        if (!mounted) return;
        setPassTotal(passes.total);
        setMemberTotal(members.total);
      } catch (err) {
        if (!mounted) return;
        if (err instanceof ApiClientError) {
          setError(err.message);
        } else {
          setError("Failed to load guild overview.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    if (activeId) void load();
    return () => {
      mounted = false;
    };
  }, [activeId]);

  return (
    <DashboardLayout
      title={activeGuild.name ?? "Guild"}
      initialGuildId={activeId}
      subtitle="Guild overview — data below is scoped to this community"
    >
      <p className="text-slate-600 mb-8 max-w-2xl">
        {activeGuild.description ??
          "Manage passes, members, and activity for this guild."}
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <StatCard
          title="Passes"
          value={loading ? "…" : String(passTotal ?? activeGuild.passCount ?? 0)}
          icon="🎫"
        />
        <StatCard
          title="Members"
          value={loading ? "…" : String(memberTotal ?? activeGuild.memberCount ?? 0)}
          icon="👥"
        />
        <StatCard title="Guild ID" value={activeId} icon="🏷️" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { href: "/passes", label: "Manage passes", icon: "🎫" },
          { href: "/members", label: "Manage members", icon: "👥" },
          { href: "/activity", label: "View activity", icon: "📋" },
          { href: "/settings", label: "Settings", icon: "⚙️" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 hover:shadow-md hover:border-primary-200 transition-all"
          >
            <span className="text-2xl">{item.icon}</span>
            <span className="font-medium text-slate-800">{item.label}</span>
          </Link>
        ))}
      </div>
    </DashboardLayout>
  );
}
