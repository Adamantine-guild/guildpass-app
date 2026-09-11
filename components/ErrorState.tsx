import React, { type ReactNode } from "react";

type ErrorStateProps = {
  message: string;
  title?: string;
  icon?: ReactNode;
};

export default function ErrorState({
  message,
  title = "Unable to load data",
  icon = "!",
}: ErrorStateProps) {
  return (
    <div
      className="my-4 rounded-xl border border-red-200 bg-red-50 p-4 sm:p-5"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700"
          aria-hidden="true"
        >
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-red-800">{title}</h3>
          <p className="mt-1 text-sm text-red-700">{message}</p>
        </div>
      </div>
    </div>
  );
}
