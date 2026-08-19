import { notFound } from "next/navigation";
import { getGuildRepository } from "@/lib/repositories/factory";
import { getGuildById } from "@/lib/data/guild-scoped";

/**
 * Route-level tenant layout for `/guilds/[guildId]/…`.
 * Resolves the guild from the path segment and returns a clear not-found
 * state for unknown or invalid ids before any child page renders.
 */
export default async function GuildScopedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { guildId: string };
}) {
  const guildId = params.guildId?.trim();
  if (!guildId) {
    notFound();
  }

  let guild = getGuildById(guildId);
  try {
    const fromRepo = await getGuildRepository().getById(guildId);
    if (fromRepo) guild = fromRepo;
  } catch {
    /* mock seed is enough for validation */
  }

  if (!guild) {
    notFound();
  }

  return children;
}
