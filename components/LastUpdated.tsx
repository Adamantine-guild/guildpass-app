"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/format-relative-time";

interface LastUpdatedProps {
  date: Date | null;
  className?: string;
  /** When true, shows "Auto-refresh on" indicator alongside the timestamp. */
  autoRefresh?: boolean;
}

/** Displays a human-readable "Last updated X s/m/h/d ago" label, refreshing every 10 s. */
export default function LastUpdated({ date, className = "", autoRefresh = false }: LastUpdatedProps) {
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    if (!date) return;

    const update = () => {
      setLabel(formatRelativeTime(date));
    };

    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, [date]);

  if (!date) return null;

  return (
    <span className={`text-xs text-slate-400 flex items-center gap-2 ${className}`}>
      {/* pulsing dot signals live updates */}
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span>Updated {label}</span>
      {autoRefresh && (
        <span className="text-[10px] text-slate-300 border border-slate-200 rounded px-1.5 py-0.5">
          auto
        </span>
      )}
    </span>
  );
}
