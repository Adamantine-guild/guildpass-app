export default function Header({
  title,
  subtitle,
  onMenuClick,
  menuOpen,
}: {
  title: string;
  subtitle?: string;
  /** Opens the mobile sidebar drawer. Omit to hide the toggle button. */
  onMenuClick?: () => void;
  /** Whether the mobile sidebar drawer is currently open. */
  menuOpen?: boolean;
}) {
  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 md:px-8 py-6 sticky top-0 z-10 flex items-center gap-4">
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          aria-controls="dashboard-sidebar"
          aria-expanded={menuOpen ?? false}
          className="inline-flex items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white md:hidden"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      )}

      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
          {title}
        </h1>

        {subtitle ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {subtitle}
          </p>
        ) : null}
      </div>
    </header>
  );
}