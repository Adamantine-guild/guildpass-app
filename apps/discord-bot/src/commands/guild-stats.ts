/**
 * `/guild-stats` slash command — aggregate guild membership statistics.
 *
 * Restricted to users with the **ManageGuild** or **Administrator**
 * permission.  Replies ephemerally with total members, active vs.
 * inactive counts, and role distribution sourced from the integration
 * client.
 */
import type { ChatInputCommandInteraction } from "discord.js";
import { PermissionsBitField } from "discord.js";
import type { BotIntegrationClient } from "../bot.js";

/**
 * Handle the `/guild-stats` slash command.
 *
 * @returns `true` when the interaction was handled (reply sent),
 *          `false` when the user lacked permission (reply sent).
 * @throws On unexpected errors — the caller is expected to catch and
 *         send a generic error reply.
 */
export async function handleGuildStats(
  interaction: ChatInputCommandInteraction,
  integration: BotIntegrationClient,
): Promise<boolean> {
  // ── Permission check ─────────────────────────────────────────────────
  const perms = interaction.memberPermissions;
  if (
    !perms?.has(PermissionsBitField.Flags.ManageGuild) &&
    !perms?.has(PermissionsBitField.Flags.Administrator)
  ) {
    await interaction.reply({
      content:
        "⛔ This command is restricted to server moderators and admins.",
      ephemeral: true,
    });
    return false;
  }

  const stats = await integration.getGuildStats(
    interaction.guildId ?? "unknown",
  );

  const roleLines = Object.entries(stats.roleDistribution)
    .sort(([, a], [, b]) => b - a)
    .map(([role, count]) => `• **${role}**: ${count}`)
    .join("\n");

  await interaction.editReply(
    `**📊 Guild Membership Stats**\n` +
      `Total members: **${stats.totalMembers}**\n` +
      `Active: **${stats.activeCount}**\n` +
      `Inactive: **${stats.inactiveCount}**\n\n` +
      `**Role Distribution**\n` +
      (roleLines || "• No roles assigned"),
  );

  return true;
}
