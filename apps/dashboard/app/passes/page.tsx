"use client";

import DashboardLayout from "@/components/DashboardLayout";
import EmptyState from "@/components/EmptyState";
import PaginationControls from "@/components/PaginationControls";
import StatusBadge from "@/components/StatusBadge";
import UnsupportedBanner from "@/components/UnsupportedBanner";
import { ApiClientError, readApiResult } from "@/lib/api-client";
import { getClientApiMode } from "@/lib/client-env";
import { mockPasses, type Pass as MockPass } from "@/lib/mock-data";
import {
  sortPasses,
  type PassSortColumn,
  type PassSortDirection,
  type PassSortState,
} from "@/lib/pass-sort";
import type { PaginatedResult } from "@/lib/repositories/types";
import { useSession } from "@/lib/hooks/useSession";
import { useOptimisticMutation } from "@/lib/hooks/useOptimisticMutation";
import { canManagePasses } from "@/lib/permissions";
import { useEffect, useMemo, useRef, useState } from "react";

type ListState = "loading" | "loaded" | "unsupported" | "error";
type PassStatusFilter = MockPass["status"] | "all";

const PAGE_SIZE = 10;

const emptyPage: PaginatedResult<MockPass> = {
  items: [],
  total: 0,
  limit: PAGE_SIZE,
  page: 1,
  nextCursor: null,
  hasNextPage: false,
  hasPreviousPage: false,
};

export default function PassesPage() {
  const session = useSession();
  const canWrite = canManagePasses(session);
  const apiMode = getClientApiMode();

  const [passes, setPasses] = useState<MockPass[]>(mockPasses.slice(0, PAGE_SIZE));
  const [pagination, setPagination] = useState<PaginatedResult<MockPass>>({
    ...emptyPage,
    items: mockPasses.slice(0, PAGE_SIZE),
    total: mockPasses.length,
    hasNextPage: mockPasses.length > PAGE_SIZE,
  });
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [listState, setListState] = useState<ListState>("loading");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PassStatusFilter>("all");
  const [sort, setSort] = useState<PassSortState | null>(null);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 250);
  const previousPassesRef = useRef<MockPass[]>(passes);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    maxSupply: "",
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

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

        const res = await fetch(`/api/passes?${params.toString()}`);
        const data = await readApiResult<PaginatedResult<MockPass>>(res);
        if (!mounted) return;

        setPasses(data.items);
        setPagination(data);
        previousPassesRef.current = data.items;
        setListState("loaded");
      } catch (err) {
        if (!mounted) return;
        if (err instanceof ApiClientError && err.code === "UNSUPPORTED") {
          setListState("unsupported");
          return;
        }
        console.warn("Falling back to mock passes:", err);
        setListState(apiMode === "live" ? "error" : "loaded");
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [apiMode, debouncedSearch, page, status]);

  const updateMutation = useOptimisticMutation<MockPass, { id: string; data: Partial<MockPass> }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetch(`/api/passes?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return readApiResult<MockPass>(res);
    },
    onOptimisticUpdate: ({ id, data }) => {
      previousPassesRef.current = passes;
      setPasses((prev) => prev.map((p) => (p.id === id ? { ...p, ...data } : p)));
      setPendingIds((prev) => new Set(prev).add(id));
    },
    onRollback: (_error, { id }) => {
      setPasses(previousPassesRef.current);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onSuccess: (updatedPass, { id }) => {
      setPasses((prev) => prev.map((p) => (p.id === id ? updatedPass : p)));
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
    if (pagination.total === 0) return "No passes found";
    const start = (pagination.page - 1) * pagination.limit + 1;
    const end = start + passes.length - 1;
    return `Showing ${start}-${end} of ${pagination.total} passes`;
  }, [pagination, passes.length]);

  const sortedPasses = useMemo(
    () => (sort ? sortPasses(passes, sort) : passes),
    [passes, sort]
  );

  const hasActiveFilters = debouncedSearch.trim() !== "" || status !== "all";

  const handleSort = (column: PassSortColumn) => {
    setSort((current) => ({
      column,
      direction:
        current?.column === column && current.direction === "ascending"
          ? "descending"
          : "ascending",
    }));
  };

  const handleDeactivate = (id: string) => {
    updateMutation.mutate({ id, data: { status: "inactive" } });
  };

  const handleEdit = (id: string) => {
    const name = prompt("Enter new name:");
    if (name?.trim()) {
      updateMutation.mutate({ id, data: { name: name.trim() } });
    }
  };

  return (
    <DashboardLayout title="Passes" session={session}>
      {listState === "unsupported" && <UnsupportedBanner resource="passes" />}

      {listState === "error" && (
        <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            Failed to load passes from the server. Check your API configuration and try again.
          </p>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-slate-500">
          {listState === "unsupported" ? "Pass listing unavailable in live mode" : resultSummary}
        </p>

        {canWrite && (
          <button
            id="btn-create-pass"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            <span>+</span> Create Pass
          </button>
        )}
      </div>

      {listState !== "unsupported" && (
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px]">
          <label className="block">
            <span className="sr-only">Search passes</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or description"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>

          <label className="block">
            <span className="sr-only">Filter by status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as PassStatusFilter)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="draft">Draft</option>
            </select>
          </label>
        </div>
      )}

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Create Pass</h2>
            <div className="space-y-3">
              <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-slate-200 p-2" />
              <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-slate-200 p-2" />
              <input placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full rounded-lg border border-slate-200 p-2" />
              <input placeholder="Max Supply" value={form.maxSupply} onChange={(e) => setForm({ ...form, maxSupply: e.target.value })} className="w-full rounded-lg border border-slate-200 p-2" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setIsCreateOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">
                Cancel
              </button>
              <button
                disabled={createLoading}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={async () => {
                  if (!form.name.trim()) return alert("Pass name is required.");
                  if (!form.description.trim()) return alert("Description is required.");

                  try {
                    setCreateLoading(true);
                    const res = await fetch("/api/passes", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: form.name.trim(),
                        description: form.description.trim(),
                        price: form.price ? Number(form.price) : undefined,
                        maxSupply: form.maxSupply ? Number(form.maxSupply) : null,
                        status: "draft",
                        currentSupply: 0,
                      }),
                    });
                    const newPass = await readApiResult<MockPass>(res);
                    setPasses((prev) => [newPass, ...prev].slice(0, pagination.limit));
                    setPagination((prev) => ({ ...prev, total: prev.total + 1 }));
                    setIsCreateOpen(false);
                    setForm({ name: "", description: "", price: "", maxSupply: "" });
                  } catch (error: unknown) {
                    alert(error instanceof Error ? error.message : "Failed to create pass.");
                  } finally {
                    setCreateLoading(false);
                  }
                }}
              >
                {createLoading ? "Creating..." : "Create"}
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
                    <th className="px-6 py-4 text-sm font-semibold text-slate-700">Description</th>
                    <SortableHeader label="Status" column="status" sort={sort} onSort={handleSort} />
                    <SortableHeader label="Price" column="price" sort={sort} onSort={handleSort} />
                    <SortableHeader label="Supply" column="supply" sort={sort} onSort={handleSort} />
                    <SortableHeader label="Created" column="createdAt" sort={sort} onSort={handleSort} />
                    {canWrite && <th className="px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedPasses.map((pass) => {
                    const isPending = pendingIds.has(pass.id);
                    return (
                      <tr key={pass.id} className={`transition-opacity hover:bg-slate-50 ${isPending ? "pointer-events-none opacity-50" : ""}`}>
                        <td className="px-6 py-4 font-medium text-slate-800">
                          {pass.name}
                          {isPending && <span className="ml-2 text-xs text-slate-400">(updating...)</span>}
                        </td>
                        <td className="max-w-md px-6 py-4 text-slate-600">{pass.description}</td>
                        <td className="px-6 py-4"><StatusBadge status={pass.status} /></td>
                        <td className="px-6 py-4 text-slate-600">{pass.price !== undefined ? `${pass.price} ETH` : "Free"}</td>
                        <td className="px-6 py-4 text-slate-600">{pass.currentSupply} / {pass.maxSupply ?? "unlimited"}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                          {new Date(pass.createdAt).toLocaleDateString()}
                        </td>
                        {canWrite && (
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <button id={`btn-edit-pass-${pass.id}`} onClick={() => handleEdit(pass.id)} disabled={isPending} className="text-xs font-medium text-slate-600 transition-colors hover:text-violet-600 disabled:opacity-50">
                                Edit
                              </button>
                              <span className="text-slate-300">|</span>
                              <button id={`btn-deactivate-pass-${pass.id}`} onClick={() => handleDeactivate(pass.id)} disabled={isPending || pass.status === "inactive"} className="text-xs font-medium text-red-500 transition-colors hover:text-red-700 disabled:opacity-50">
                                Deactivate
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {passes.length === 0 && (
            <div className="mt-4">
              <EmptyState
                title={hasActiveFilters ? "No passes match your filters" : "No passes yet"}
                description={
                  hasActiveFilters
                    ? "Adjust the search or status filter to see more passes."
                    : canWrite
                      ? "Create your first pass to get started."
                      : "Passes will appear here once created."
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

function SortableHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: PassSortColumn;
  sort: PassSortState | null;
  onSort: (column: PassSortColumn) => void;
}) {
  const direction: PassSortDirection | "none" =
    sort?.column === column ? sort.direction : "none";

  return (
    <th
      aria-sort={direction}
      className="px-6 py-4 text-sm font-semibold text-slate-700"
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1 py-0.5 transition-colors hover:text-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        {label}
        {direction !== "none" && (
          <span aria-hidden="true" className="text-violet-600">
            {direction === "ascending" ? <>&uarr;</> : <>&darr;</>}
          </span>
        )}
      </button>
    </th>
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
