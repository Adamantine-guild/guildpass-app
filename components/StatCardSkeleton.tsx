import React from 'react'

export const StatCardSkeleton = () => {
  return (
    <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
      <div className="h-32 animate-pulse rounded-xl bg-slate-200"></div>
      <div className="h-32 animate-pulse rounded-xl bg-slate-200"></div>
      <div className="h-32 animate-pulse rounded-xl bg-slate-200"></div>
      <div className="h-32 animate-pulse rounded-xl bg-slate-200"></div>
    </div>
  );
}
