"use client";

import { useState } from "react";
import { readApiResult } from "@/lib/api-client";
import type { CoreSyncReport } from "@/lib/reconciliation/core-sync-types";

type RunState =
  | { status: "idle" }
  | { status: "running"; mode: "dry-run" | "apply" }
  | { status: "done"; report: CoreSyncReport }
  | { status: "error"; message: string };

/**
 * Manual trigger for core-state reconciliation (issue #262). Dry-run first
 * shows what would change; apply writes corrections and tags them as
 * `source: "reconciliation"` in the activity feed.
 */
export default function ReconcilePanel() {
  const [state, setState] = useState<RunState>({ status: "idle" });

  async function run(mode: "dry-run" | "apply") {
    setState({ status: "running", mode });
    try {
      const response = await fetch("/api/integrations/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const report = await readApiResult<CoreSyncReport>(response);
      setState({ status: "done", report });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Reconciliation failed" });
    }
  }

  const running = state.status === "running";

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-lg font-semibold text-slate-900">Core reconciliation</h3>
        </div>
        <p className="text-slate-600 text-sm mb-4">
          Recover from webhook delivery gaps by diffing local state against GuildPass core&apos;s
          authoritative snapshot. Corrections appear in the activity feed tagged as
          &quot;reconciliation&quot;.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => run("dry-run")}
            disabled={running}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {running && state.mode === "dry-run" ? "Running…" : "Preview changes (dry-run)"}
          </button>
          <button
            type="button"
            onClick={() => run("apply")}
            disabled={running}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {running && state.mode === "apply" ? "Applying…" : "Apply corrections"}
          </button>
        </div>

        {state.status === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {state.message}
          </div>
        )}

        {state.status === "done" && (
          <div className="bg-slate-50 rounded-lg p-4 text-sm border border-slate-100">
            <p className="font-medium text-slate-800 mb-1">{state.report.summary}</p>
            {!state.report.supported && state.report.reason && (
              <p className="text-slate-600">{state.report.reason}</p>
            )}
            {state.report.changes.length > 0 && (
              <ul className="mt-2 space-y-1 text-slate-600 list-disc list-inside">
                {state.report.changes.map((change, i) => (
                  <li key={`${change.entity}-${change.id}-${i}`}>{change.summary}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
