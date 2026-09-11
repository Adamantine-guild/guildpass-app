export interface NavItem {
  name: string;
  href: string;
  icon: string;
}

export const navItems: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: "📊" },
  { name: "Passes", href: "/passes", icon: "🎫" },
  { name: "Guilds", href: "/guilds", icon: "🏰" },
  { name: "Members", href: "/members", icon: "👥" },
  { name: "Activity", href: "/activity", icon: "📋" },
  { name: "Integrations", href: "/integrations", icon: "🔌" },
  { name: "Settings", href: "/settings", icon: "⚙️" },
];

/**
 * Whether a nav item should be treated as the active route.
 * Matches the item's own path exactly, or a nested route under it
 * (e.g. "/guilds" is active for "/guilds/abc123") — but not a
 * sibling route that merely shares a prefix (e.g. "/passes" is not
 * active for "/passes-archive").
 */
export function isNavItemActive(
  pathname: string | null | undefined,
  href: string,
): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
