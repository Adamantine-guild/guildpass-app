export default function Header({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-8 py-6 sticky top-0 z-10">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
        {title}
      </h1>

      {subtitle ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}