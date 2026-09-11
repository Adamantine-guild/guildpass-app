import Link from "next/link";
import DashboardLayout from "@/components/DashboardLayout";

/**
 * Shown when `/guilds/[guildId]` (or a nested path) refers to an unknown guild.
 */
export default function GuildNotFound() {
  return (
    <DashboardLayout title="Guild not found">
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="text-5xl mb-4" aria-hidden>
          🏰
        </div>
        <h2 className="text-xl font-semibold text-slate-800 mb-2">
          This guild does not exist
        </h2>
        <p className="text-slate-600 mb-8">
          The guild id in the URL is invalid or was removed. Pick a community from
          the guild list or use the sidebar switcher.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/guilds"
            className="inline-flex items-center rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2.5 transition-colors"
          >
            Browse guilds
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
