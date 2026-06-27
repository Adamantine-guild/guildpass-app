"use client";

import DashboardLayout from "@/components/DashboardLayout";
import { type Guild as MockGuild } from "@/lib/mock-data";
import { useEffect, useState } from "react";


export default function GuildsPage() {
  const [guilds, setGuilds] = useState<MockGuild[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/guilds");
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (mounted && Array.isArray(data)) setGuilds(data);
      } catch (err) {
        console.warn("Error fetching guilds:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <DashboardLayout title="Guilds">
      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading guilds...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {guilds.map((guild) => (
            <div key={guild.id} className="bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-shadow">
              <h3 className="text-lg font-semibold text-slate-800 mb-2">{guild.name}</h3>
              <p className="text-slate-600 mb-4">{guild.description}</p>
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-slate-500">Members:</span>
                  <span className="font-semibold text-slate-800 ml-2">{guild.memberCount}</span>
                </div>
                <div>
                  <span className="text-slate-500">Passes:</span>
                  <span className="font-semibold text-slate-800 ml-2">{guild.passCount}</span>
                </div>
              </div>
            </div>
          ))}
          {guilds.length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-500 bg-white border border-slate-200 rounded-xl">
              No guilds found.
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
