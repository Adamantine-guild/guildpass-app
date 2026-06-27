"use client";

/**
 * app/members/page.tsx
 *
 * Members management page.
 *
 * Visibility rules:
 *  - Table (read) — visible to ALL roles (members:read).
 *  - "Invite Member" button — visible only when canManageMembers() is true (members:write).
 *  - "Remove" / "Change Role" row actions — same guard.
 *
 * Note: Mutation handlers must enforce permissions server-side via
 * assertPermission. UI hiding is convenience only.
 */

import DashboardLayout from "@/components/DashboardLayout";
import StatusBadge from "@/components/StatusBadge";
import { type Member as MockMember } from "@/lib/mock-data";
import { useSession } from "@/lib/hooks/useSession";
import { canManageMembers } from "@/lib/permissions";
import { useEffect, useState } from "react";

export default function MembersPage() {
  const session = useSession();
  const canWrite = canManageMembers(session);
  const [members, setMembers] = useState<MockMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/members");
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (mounted && Array.isArray(data)) setMembers(data);
      } catch (err) {
        console.warn("Error fetching members:", err);
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
    <DashboardLayout title="Members" session={session}>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-500">
          {members.length} member{members.length !== 1 ? "s" : ""} total
        </p>

        {/* Invite button — write roles only */}
        {canWrite && (
          <button
            id="btn-invite-member"
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span>＋</span> Invite Member
          </button>
        )}
      </div>

      {/* ── Members table ───────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="px-6 py-12 text-center text-slate-400 text-sm">Loading members…</div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Wallet</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Status</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Roles</th>
                  <th className="px-6 py-4 text-sm font-semibold text-slate-700">Last Active</th>
                  {/* Actions column only rendered for write-capable roles */}
                  {canWrite && (
                    <th className="px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-800">{member.name}</td>
                    <td className="px-6 py-4 font-mono text-sm text-slate-600">
                      {member.wallet.slice(0, 6)}...{member.wallet.slice(-4)}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={member.status} />
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {member.roles.map((role) => (
                        <span
                          key={role}
                          className="mr-2 px-2 py-1 bg-slate-100 rounded text-xs"
                        >
                          {role}
                        </span>
                      ))}
                      {member.roles.length === 0 && (
                        <span className="text-slate-400 text-xs italic">None</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {new Date(member.lastActive).toLocaleDateString()}
                    </td>
                    {canWrite && (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            id={`btn-change-role-member-${member.id}`}
                            className="text-xs text-slate-600 hover:text-violet-600 font-medium transition-colors"
                            title={`Change role for ${member.name}`}
                          >
                            Change Role
                          </button>
                          <span className="text-slate-300">·</span>
                          <button
                            id={`btn-remove-member-${member.id}`}
                            className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                            title={`Remove ${member.name}`}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={canWrite ? 6 : 5} className="px-6 py-12 text-center text-slate-400 text-sm">
                      No members found.
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
