interface PaginationControlsProps {
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export default function PaginationControls({
  page,
  hasPreviousPage,
  hasNextPage,
  onPrevious,
  onNext,
}: PaginationControlsProps) {
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={!hasPreviousPage}
        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:border-violet-200 hover:text-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:text-slate-700"
      >
        Previous
      </button>
      <span aria-live="polite" className="text-center text-sm text-slate-500">
        Page {page}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNextPage}
        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:border-violet-200 hover:text-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:text-slate-700"
      >
        Next
      </button>
    </nav>
  );
}
