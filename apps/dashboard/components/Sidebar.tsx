"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@/lib/auth/session";
import { useOptionalGuild } from "@/lib/guild/GuildProvider";

const navItems = [
  { name: "Dashboard", href: "/dashboard", icon: "📊" },
  { name: "Passes", href: "/passes", icon: "🎫" },
  { name: "Guilds", href: "/guilds", icon: "🏰" },
  { name: "Members", href: "/members", icon: "👥" },
  { name: "Activity", href: "/activity", icon: "📋" },
  { name: "Integrations", href: "/integrations", icon: "🔌" },
  { name: "Settings", href: "/settings", icon: "⚙️" },
];

/**
 * Human-readable label + colour for each role,
 * shown in the sidebar badge.
 */
const ROLE_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  owner: {
    label: "Owner",
    className: "bg-amber-500 text-white",
  },
  admin: {
    label: "Admin",
    className: "bg-violet-600 text-white",
  },
  moderator: {
    label: "Moderator",
    className: "bg-sky-600 text-white",
  },
  readonly: {
    label: "Read-only",
    className: "bg-slate-500 text-white",
  },
};

export default function Sidebar({
  session,
  isOpen,
  onClose,
}: {
  session?: Session;
  /**
   * Whether the sidebar is visible on mobile.
   * Ignored on desktop (always visible).
   */
  isOpen?: boolean;
  /**
   * Called when the close button is clicked.
   * Only rendered on mobile.
   */
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const guildCtx = useOptionalGuild();

  const badge = session?.role
    ? ROLE_BADGE[session.role]
    : null;

  const handleGuildChange = (nextId: string) => {
    if (!guildCtx || nextId === guildCtx.guildId) {
      return;
    }

    guildCtx.setGuildId(nextId);

    // If we're on a guild-scoped route,
    // keep the same path under the new guild.
    const match = pathname?.match(
      /^\/guilds\/([^/]+)(\/.*)?$/,
    );

    if (match) {
      const rest = match[2] ?? "";
      router.push(`/guilds/${nextId}${rest}`);
      return;
    }

    // Otherwise stay on the current page.
    // Data hooks re-fetch via guildId dependencies.
  };

  return (
    <div
      className={`
        fixed
        left-0
        top-0
        z-50
        flex
        h-screen
        w-64
        flex-col
        bg-slate-900
        text-white
        transition-transform
        duration-300
        ease-in-out
        dark:bg-slate-950
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0
      `}
    >
      {/* Sidebar header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-4 dark:border-slate-700">
        <div className="flex items-center gap-2 text-lg font-bold">
          <span aria-hidden="true">🛡️</span>
          <span>GuildPass</span>
        </div>

        {/* Close button — visible only on mobile */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md p-1 text-slate-400 hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 md:hidden"
            aria-label="Close sidebar"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Guild switcher */}
      {guildCtx && (
        <div className="border-b border-slate-800 px-4 pb-2 pt-4 dark:border-slate-700">
          <label
            htmlFor="guild-switcher"
            className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-slate-500"
          >
            Active guild
          </label>

          <select
            id="guild-switcher"
            value={guildCtx.guildId}
            onChange={(e) =>
              handleGuildChange(e.target.value)
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-slate-900"
            aria-label="Select guild"
          >
            {guildCtx.guilds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <Link
            href={`/guilds/${guildCtx.guildId}`}
            className="mt-2 inline-block text-xs text-slate-400 transition-colors hover:text-primary-300"
          >
            Open guild overview →
          </Link>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-2">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" &&
                pathname?.startsWith(item.href));

            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={`
                    flex
                    items-center
                    gap-3
                    rounded-lg
                    px-4
                    py-3
                    transition-colors
                    ${
                      isActive
                        ? "bg-slate-800 font-medium text-primary-300"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }
                  `}
                >
                  <span
                    className="text-xl"
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>

                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Role badge */}
      {badge && session && (
        <div className="border-t border-slate-700 p-4 dark:border-slate-700">
          <p
            className="mb-2 truncate text-xs text-slate-400"
            title={session.name}
          >
            {session.name}
          </p>

          <span
            className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
      )}
    </div>
  );
}