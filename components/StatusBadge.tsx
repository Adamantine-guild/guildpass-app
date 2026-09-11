export default function StatusBadge({ status }: { status?: string }) {
  const safeStatus = status ?? "inactive";

  const statusStyles: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    inactive: "bg-gray-100 text-gray-800",
    pending: "bg-yellow-100 text-yellow-800",
    draft: "bg-slate-100 text-slate-800",
  };

  const label =
    safeStatus.charAt(0).toUpperCase() + safeStatus.slice(1);

  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-medium ${
        statusStyles[safeStatus] || statusStyles.inactive
      }`}
    >
      {label}
    </span>
  );
}