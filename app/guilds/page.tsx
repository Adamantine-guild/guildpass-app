"use client";

import Link from "next/link";
import { getClientApiMode } from "@/lib/client-env";
import DashboardLayout from "@/components/DashboardLayout";
import GuildsListState, {
  type GuildsListStatus,
} from "@/components/GuildsListState";
import UnsupportedBanner from "@/components/UnsupportedBanner";
import { mockGuilds, type Guild as MockGuild } from "@/lib/mock-data";
import { useEffect, useState, useRef } from "react";
import { useSession } from "@/lib/hooks/useSession";
import { canManageGuilds } from "@/lib/permissions";
import { useOptimisticMutation } from "@/lib/hooks/useOptimisticMutation";
import { ApiClientError, readApiResult } from "@/lib/api-client";
import { useGuild } from "@/lib/guild/GuildProvider";

export default function GuildsPage() {
  const session = useSession();
  const { guildId: activeGuildId, setGuildId, setGuilds: setContextGuilds } = useGuild();
  const canWrite = canManageGuilds(session, activeGuildId);
  const [guilds, setGuilds] = useState<MockGuild[]>(mockGuilds);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [listState, setListState] = useState<GuildsListStatus>("loading");
  const previousGuildsRef = useRef<MockGuild[]>(guilds);
  const apiMode = getClientApiMode();

  useEffect(() => {
    let mounted = true;
    async function load() {
      setListState("loading");

      try {
        const mockState =
          apiMode === "mock"
            ? new URLSearchParams(window.location.search).get("mockState")
            : null;

        if (mockState === "error") {
          throw new Error("Simulated guild fetch error");
        }

        const data =
          mockState === "empty"
            ? []
            : await fetch("/api/guilds").then((res) =>
                readApiResult<MockGuild[]>(res)
              );

        if (mounted) {
          setGuilds(data);
          setContextGuilds(data);
          previousGuildsRef.current = data;
          setListState("loaded");
        }
      } catch (err) {
        if (!mounted) return;

        if (err instanceof ApiClientError && err.code === "UNSUPPORTED") {
          setListState("unsupported");
          return;
        }

        console.warn("Failed to load guilds:", err);
        setListState("error");
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [apiMode]);

  const updateMutation = useOptimisticMutation<MockGuild, { id: string; data: Partial<MockGuild> }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/guilds?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return readApiResult<MockGuild>(res);
    },
    onOptimisticUpdate: ({ id, data }) => {
      previousGuildsRef.current = guilds;
      setGuilds((prev) =>
        prev.map((g) => (g.id === id ? { ...g, ...data } : g))
      );
      setPendingIds((prev) => new Set(prev).add(id));
    },
    onRollback: (_error, { id }) => {
      setGuilds(previousGuildsRef.current);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onSuccess: (updatedGuild, { id }) => {
      setGuilds((prev) =>
        prev.map((g) => (g.id === id ? updatedGuild : g))
      );
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onError: (error) => {
      alert(error.message);
    }
  });

  const deleteMutation = useOptimisticMutation<{ success: boolean }, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/guilds?id=${id}`, {
        method: "DELETE",
      });
      return readApiResult<{ success: boolean }>(res);
    },
    onOptimisticUpdate: (id) => {
      previousGuildsRef.current = guilds;
      setGuilds((prev) => prev.filter((g) => g.id !== id));
      setPendingIds((prev) => new Set(prev).add(id));
    },
    onRollback: () => {
      setGuilds(previousGuildsRef.current);
      setPendingIds(new Set());
    },
    onSuccess: (_data, id) => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onError: (error) => {
      alert(error.message);
    }
  });

  const handleRename = (id: string, currentName: string) => {
    const name = prompt("Enter new name:", currentName);
    if (name && name !== currentName) {
      // Errors are surfaced via onError (alert); avoid unhandled rejection
      updateMutation.mutate({ id, data: { name } }).catch(() => {});
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this guild?")) {
      // Errors are surfaced via onError (alert); avoid unhandled rejection
      deleteMutation.mutate(id).catch(() => {});
    }
  };

  return (
    <DashboardLayout title="Guilds" session={session}>
      {/* â”€â”€ Unsupported banner (live mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {listState === "unsupported" && (
        <UnsupportedBanner resource="guilds" />
      )}

      <GuildsListState
        status={listState}
        isEmpty={guilds.length === 0}
        canWrite={canWrite}
      />

      {listState === "loaded" && guilds.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {guilds.map((guild) => {
            const isPending = pendingIds.has(guild.id);
            return (
              <div key={guild.id} className={`bg-white border rounded-xl p-6 transition-all ${
                guild.id === activeGuildId
                  ? "border-violet-300 ring-2 ring-violet-100"
                  : "border-slate-200"
              } ${isPending ? "opacity-50 scale-[0.98] pointer-events-none" : "hover:shadow-md"}`}>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-semibold text-slate-800">{guild.name}</h3>
                  <div className="flex items-center gap-2">
                    {guild.id === activeGuildId && (
                      <span className="text-xs font-medium text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    )}
                    {isPending && <span className="text-xs text-slate-400 animate-pulse">updating...</span>}
                  </div>
                </div>
                <p className="text-slate-600 mb-4">{guild.description}</p>
                <div className="flex gap-4 text-sm mb-6">
                  <div>
                    <span className="text-slate-500">Members:</span>
                    <span className="font-semibold text-slate-800 ml-2">{guild.memberCount}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Passes:</span>
                    <span className="font-semibold text-slate-800 ml-2">{guild.passCount}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                  <Link
                    href={`/guilds/${guild.id}`}
                    onClick={() => setGuildId(guild.id)}
                    className="text-xs font-medium text-violet-600 hover:text-violet-800 transition-colors"
                  >
                    Open
                  </Link>
                  <span className="text-slate-300">·</span>
                  <button
                    type="button"
                    onClick={() => setGuildId(guild.id)}
                    className="text-xs font-medium text-slate-600 hover:text-violet-600 transition-colors"
                  >
                    {guild.id === activeGuildId ? "Selected" : "Switch to"}
                  </button>
                  {canWrite && (
                    <>
                      <span className="text-slate-300">·</span>
                      <button
                        onClick={() => handleRename(guild.id, guild.name)}
                        className="text-xs font-medium text-slate-600 hover:text-violet-600 transition-colors"
                      >
                        Rename
                      </button>
                      <span className="text-slate-300">·</span>
                      <button
                        onClick={() => handleDelete(guild.id)}
                        className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}

