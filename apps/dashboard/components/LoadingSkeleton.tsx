import React from "react";

type LoadingSkeletonProps = {
  count?: number;
  label?: string;
};

export default function LoadingSkeleton({
  count = 3,
  label = "Loading data",
}: LoadingSkeletonProps) {
  return (
    <div
      className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
      role="status"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-xl border border-slate-200 bg-white p-6"
          aria-hidden="true"
        >
          <div className="h-5 w-2/3 rounded bg-slate-200" />
          <div className="mt-4 h-4 w-full rounded bg-slate-100" />
          <div className="mt-2 h-4 w-4/5 rounded bg-slate-100" />
          <div className="mt-6 h-10 rounded-lg bg-slate-100" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
