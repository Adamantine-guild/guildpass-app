"use client";

import { getClientApiMode } from '@/lib/client-env';
import DashboardLayout from "@/components/DashboardLayout";
import EmptyState from "@/components/EmptyState";
import UnsupportedBanner from "@/components/UnsupportedBanner";
import { mockGuilds, type Guild as MockGuild } from "@/lib/mock-data";
import { useEffect, useState, useRef } from "react";
import { useSession } from "@/lib/hooks/useSession";
import { canManageGuilds } from "@/lib/permissions";
import { useOptimisticMutation } from "@/lib/hooks/useOptimisticMutation";
import { readApiResult } from "@/lib/api-client";

export default function GuildsPage() {
  const session = useSession();
  const canWrite = canManageGuilds(session);
  const [guilds, setGuilds] = useState<MockGuild[]>(mockGuilds);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [listState] = useState<"loading" | "loaded" | "unsupported" | "error">("loading");
  const previousGuildsRef = useRef<MockGuild[]>(guilds);
  const apiMode = getClientApiMode();

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/guilds");
        const data = await readApiResult<MockGuild[]>(res);
        if (mounted) {
          setGuilds(data);
          previousGuildsRef.current = data;
        }
      } catch (err) {
        console.warn("Falling back to mock guilds:", err);
      }
    }
    load();
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
      updateMutation.mutate({ id, data: { name } });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this guild?")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <DashboardLayout title="Guilds" session={session}>
      {listState === "unsupported" && (
        <UnsupportedBanner resource="guilds" />
      )}
      {listState === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 my-4">
          <p className="text-sm text-red-700">
            Failed to load guilds from the server. Check your API configuration and try again.
          </p>
        </div>
      )}

      {listState !== "unsupported" && (
        guilds.length === 0 ? (
          <EmptyState
            title="No guilds yet"
            description={
              canWrite
                ? "Create your first guild to get started."
                : "Guilds will appear here once they're created."
            }
            icon="-"
          />
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {guilds.map((guild) => {
            const isPending = pendingIds.has(guild.id);
            return (
              <div key={guild.id} className={`bg-white border border-slate-200 rounded-xl p-6 transition-all ${isPending ? "opacity-50 scale-[0.98] pointer-events-none" : "hover:shadow-md"}`}>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-semibold text-slate-800">{guild.name}</h3>
                  {isPending && <span className="text-xs text-slate-400 animate-pulse">updating...</span>}
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

                {canWrite && (
                  <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )
      )}
    </DashboardLayout>
  );
}
