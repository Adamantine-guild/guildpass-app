import React, { type ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
};

export default function EmptyState({
  title,
  description,
  icon,
}: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center sm:p-12">
      {icon && (
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-xl font-semibold text-violet-600"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <h3 className="mb-2 text-lg font-semibold text-slate-800">{title}</h3>
      {description && (
        <p className="mx-auto max-w-md text-sm text-slate-500 sm:text-base">
          {description}
        </p>
      )}
    </div>
  );
}
