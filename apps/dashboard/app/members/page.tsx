"use client";

import DashboardLayout from "@/components/DashboardLayout";
import EmptyState from "@/components/EmptyState";
import PaginationControls from "@/components/PaginationControls";
import RoleEditor from "@/components/RoleEditor";
import StatusBadge from "@/components/StatusBadge";
import TruncatedWallet from "@/components/TruncatedWallet";
import UnsupportedBanner from "@/components/UnsupportedBanner";
import { ApiClientError, readApiResult } from "@/lib/api-client";
import { getClientApiMode } from "@/lib/client-env";
import { useSession } from "@/lib/hooks/useSession";
import { useOptimisticMutation } from "@/lib/hooks/useOptimisticMutation";
import { MEMBER_ROLES } from "@/lib/member-roles";
import { toMembersCsv } from "@/lib/members-csv";
import { mockMembers, type Member as MockMember } from "@/lib/mock-data";
import { canManageMembers } from "@/lib/permissions";
import type { PaginatedResult } from "@/lib/repositories/types";
import { useEffect, useMemo, useRef, useState } from "react";


type ListState = "loading" | "loaded" | "unsupported" | "error";
type MemberStatusFilter = MockMember["status"] | "all";
type MemberRoleFilter = (typeof MEMBER_ROLES)[number] | "all";

const PAGE_SIZE = 10;

const emptyPage: PaginatedResult<MockMember> = {
  items: [],
  total: 0,
  limit: PAGE_SIZE,
  page: 1,
  nextCursor: null,
  hasNextPage: false,
  hasPreviousPage: false,
};

export default function MembersPage() {
  const session = useSession();
  const canWrite = canManageMembers(session);
  const apiMode = getClientApiMode();

  const [members, setMembers] = useState<MockMember[]>(mockMembers.slice(0, PAGE_SIZE));
  const [pagination, setPagination] = useState<PaginatedResult<MockMember>>({
    ...emptyPage,
    items: mockMembers.slice(0, PAGE_SIZE),
    total: mockMembers.length,
    hasNextPage: mockMembers.length > PAGE_SIZE,
  });
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [listState, setListState] = useState<ListState>("loading");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MemberStatusFilter>("all");
  const [role, setRole] = useState<MemberRoleFilter>("all");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 250);
  const previousMembersRef = useRef<MockMember[]>(members);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [form, setForm] = useState({ name: "", wallet: "" });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, role, status]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setListState("loading");
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          page: String(page),
        });
        if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
        if (status !== "all") params.set("status", status);
        if (role !== "all") params.set("role", role);

        const res = await fetch(`/api/members?${params.toString()}`);
        const data = await readApiResult<PaginatedResult<MockMember>>(res);
        if (!mounted) return;

        setMembers(data.items);
        setPagination(data);
        previousMembersRef.current = data.items;
        setListState("loaded");
      } catch (err) {
        if (!mounted) return;
        if (err instanceof ApiClientError && err.code === "UNSUPPORTED") {
          setListState("unsupported");
          return;
        }
        console.warn("Falling back to mock members:", err);
        setListState(apiMode === "live" ? "error" : "loaded");
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [apiMode, debouncedSearch, page, role, status]);

  const updateMutation = useOptimisticMutation<MockMember, { id: string; data: Partial<MockMember> }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/members?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return readApiResult<MockMember>(res);
    },
    onOptimisticUpdate: ({ id, data }) => {
      previousMembersRef.current = members;
      setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...data } : m)));
      setPendingIds((prev) => new Set(prev).add(id));
    },
    onRollback: (_error, { id }) => {
      setMembers(previousMembersRef.current);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onSuccess: (updatedMember, { id }) => {
      setMembers((prev) => prev.map((m) => (m.id === id ? updatedMember : m)));
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onError: (error) => {
      alert(error.message);
    },
  });

  const deleteMutation = useOptimisticMutation<{ success: boolean }, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/members?id=${id}`, { method: "DELETE" });
      return readApiResult<{ success: boolean }>(res);
    },
    onOptimisticUpdate: (id) => {
      previousMembersRef.current = members;
      setMembers((prev) => prev.filter((m) => m.id !== id));
      setPendingIds((prev) => new Set(prev).add(id));
    },
    onRollback: () => {
      setMembers(previousMembersRef.current);
      setPendingIds(new Set());
    },
    onSuccess: (_data, id) => {
      setPagination((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onError: (error) => {
      alert(error.message);
    },
  });

  const resultSummary = useMemo(() => {
    if (pagination.total === 0) return "No members found";
    const start = (pagination.page - 1) * pagination.limit + 1;
    const end = start + members.length - 1;
    return `Showing ${start}-${end} of ${pagination.total} members`;
  }, [members.length, pagination]);

  const hasActiveFilters = debouncedSearch.trim() !== "" || status !== "all" || role !== "all";

  const handleRemove = (id: string) => {
    if (confirm("Are you sure you want to remove this member?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleRolesChange = (id: string, roles: string[]) => {
    updateMutation.mutate({ id, data: { roles } });
  };

  const handleExportCsv = () => {
    const csv = toMembersCsv(members);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "guildpass-members.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout title="Members" session={session}>
      {listState === "unsupported" && <UnsupportedBanner resource="members" />}

      {listState === "error" && (
        <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            Failed to load members from the server. Check your API configuration and try again.
          </p>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-slate-500">
          {listState === "unsupported" ? "Member listing unavailable in live mode" : resultSummary}
        </p>

        {listState !== "unsupported" && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="btn-export-members-csv"
              onClick={handleExportCsv}
              disabled={members.length === 0 || listState === "loading"}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export CSV
            </button>

            {canWrite && (
              <button
                id="btn-invite-member"
                onClick={() => setIsInviteOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
              >
                <span>+</span> Invite Member
              </button>
            )}
          </div>
        )}
      </div>

      {listState !== "unsupported" && (
        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <label className="block">
            <span className="sr-only">Search members</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or wallet"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>

          <label className="block">
            <span className="sr-only">Filter by status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as MemberStatusFilter)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="pending">Pending</option>
            </select>
          </label>

          <label className="block">
            <span className="sr-only">Filter by role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRoleFilter)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="all">All roles</option>
              {MEMBER_ROLES.map((memberRole) => (
                <option key={memberRole} value={memberRole}>
                  {memberRole}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Invite Member</h2>
            <div className="space-y-3">
              <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-slate-200 p-2" />
              <input placeholder="Wallet" value={form.wallet} onChange={(e) => setForm({ ...form, wallet: e.target.value })} className="w-full rounded-lg border border-slate-200 p-2" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setIsInviteOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">
                Cancel
              </button>
              <button
                disabled={inviteLoading}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={async () => {
                  if (!form.name.trim()) return alert("Name is required");
                  if (!form.wallet.trim()) return alert("Wallet is required");

                  try {
                    setInviteLoading(true);
                    const res = await fetch("/api/members", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: form.name.trim(), wallet: form.wallet.trim() }),
                    });
                    const newMember = await readApiResult<MockMember>(res);
                    const safeMember = {
                      ...newMember,
                      roles: newMember.roles ?? [],
                      status: newMember.status ?? "pending",
                    };
                    setMembers((prev) => [safeMember, ...prev].slice(0, pagination.limit));
                    setPagination((prev) => ({ ...prev, total: prev.total + 1 }));
                    setIsInviteOpen(false);
                    setForm({ name: "", wallet: "" });
                  } catch (error: any) {
                    alert(error.message);
                  } finally {
                    setInviteLoading(false);
                  }
                }}
              >
                {inviteLoading ? "Inviting..." : "Invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {listState !== "unsupported" && (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                    <th className="px-6 py-4 text-sm font-semibold text-slate-700">Wallet</th>
                    <th className="px-6 py-4 text-sm font-semibold text-slate-700">Status</th>
                    <th className="px-6 py-4 text-sm font-semibold text-slate-700">Roles</th>
                    <th className="px-6 py-4 text-sm font-semibold text-slate-700">Last Active</th>
                    {canWrite && <th className="px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((member) => {
                    const isPending = pendingIds.has(member.id);
                    return (
                      <tr key={member.id} className={`transition-opacity hover:bg-slate-50 ${isPending ? "pointer-events-none opacity-50" : ""}`}>
                        <td className="px-6 py-4 font-medium text-slate-800">
                          {member.name}
                          {isPending && <span className="ml-2 text-xs text-slate-400">(updating...)</span>}
                        </td>
                        <td className="px-6 py-4"><TruncatedWallet address={member.wallet} /></td>
                        <td className="px-6 py-4"><StatusBadge status={member.status} /></td>
                        <td className="px-6 py-4 text-slate-600">
                          <RoleEditor roles={member.roles ?? []} disabled={!canWrite || isPending} onChange={(roles) => handleRolesChange(member.id, roles)} />
                        </td>
                        <td className="px-6 py-4 text-slate-600">{new Date(member.lastActive).toLocaleDateString()}</td>
                        {canWrite && (
                          <td className="px-6 py-4">
                            <button id={`btn-remove-member-${member.id}`} onClick={() => handleRemove(member.id)} disabled={isPending} className="text-xs font-medium text-red-500 transition-colors hover:text-red-700 disabled:opacity-50">
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {members.length === 0 && (
            <div className="mt-4">
              <EmptyState
                title={hasActiveFilters ? "No members match your filters" : "No members yet"}
                description={
                  hasActiveFilters
                    ? "Adjust the search, status, or role filter to see more members."
                    : canWrite
                      ? "Invite your first member to get started."
                      : "Members will appear here once invited."
                }
                icon="-"
              />
            </div>
          )}

          <PaginationControls
            page={pagination.page}
            hasPreviousPage={pagination.hasPreviousPage}
            hasNextPage={pagination.hasNextPage}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
        </>
      )}
    </DashboardLayout>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debounced;
}
