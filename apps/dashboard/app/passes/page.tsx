"use client";

/**
 * app/passes/page.tsx
 *
 * Passes management page.
 *
 * Visibility rules:
 *  - Table (read) — visible to ALL roles (passes:read).
 *  - "Create Pass" button — visible only when canManagePasses() is true (passes:write).
 *  - "Edit" / "Deactivate" row actions — same guard.
 *
 * Note: The actual mutation handlers (form submissions, API calls) must also
 * enforce permissions server-side via assertPermission. UI hiding is convenience
 * only and must not be the sole security boundary.
 */

import DashboardLayout from "@/components/DashboardLayout";
import StatusBadge from "@/components/StatusBadge";
import { type Pass as MockPass } from "@/lib/mock-data";
import { useSession } from "@/lib/hooks/useSession";
import { canManagePasses } from "@/lib/permissions";
import { useEffect, useState } from "react";

export default function PassesPage() {
  const session = useSession();
  const canWrite = canManagePasses(session);
  const [passes, setPasses] = useState<MockPass[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/passes");
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (mounted && Array.isArray(data)) setPasses(data);
      } catch (err) {
        console.warn("Error fetching passes:", err);
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
    <DashboardLayout title="Passes" session={session}>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-500">
          {passes.length} pass{passes.length !== 1 ? "es" : ""} total
        </p>

        {/* Create button — write roles only */}
        {canWrite && (
          <button
            id="btn-create-pass"
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span>＋</span> Create Pass
          </button>
        )}
      </div>

      {/* ── Passes table ────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="px-6 py-12 text-center text-slate-400 text-sm">Loading passes…</div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Description</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Status</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Price</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Supply</th>
                  {/* Actions column only rendered for write-capable roles */}
                  {canWrite && (
                    <th className="px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {passes.map((pass) => (
                  <tr key={pass.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-800">{pass.name}</td>
                    <td className="px-6 py-4 text-slate-600">{pass.description}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={pass.status} />
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {pass.price !== undefined ? `${pass.price} ETH` : "Free"}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {pass.currentSupply} / {pass.maxSupply ?? "∞"}
                    </td>
                    {canWrite && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            id={`btn-edit-pass-${pass.id}`}
                            className="text-xs text-slate-600 hover:text-violet-600 font-medium transition-colors"
                            title={`Edit ${pass.name}`}
                          >
                            Edit
                          </button>
                          <span className="text-slate-300">·</span>
                          <button
                            id={`btn-deactivate-pass-${pass.id}`}
                            className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                            title={`Deactivate ${pass.name}`}
                          >
                            Deactivate
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {passes.length === 0 && (
                  <tr>
                    <td colSpan={canWrite ? 6 : 5} className="px-6 py-12 text-center text-slate-400 text-sm">
                      No passes found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
