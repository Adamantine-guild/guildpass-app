import { getGuildRepository } from "../repositories/factory";

class SettingsService {
  async updateSettings(settings: any): Promise<{ message: string }> {
    // In a real implementation, this would update guild settings in the repository
    // For now, we'll use the guild repository as a placeholder or mock the persistence
    const repo = getGuildRepository();

    // Assuming workspace settings map to a primary guild for this demo
    const guilds = await repo.getAll();
    if (guilds.length > 0) {
      await repo.update(guilds[0].id, {
        name: settings.workspaceName,
        // map other settings as needed
      });
    }

    return { message: "Settings updated successfully" };
  }

  async getSettings(): Promise<any> {
    const repo = getGuildRepository();
    const guilds = await repo.getAll();

    if (guilds.length === 0) {
      return {
        workspaceName: "GuildPass DAO",
        timezone: "UTC",
        email: "admin@guildpass.xyz"
      };
    }

    const mainGuild = guilds[0];
    return {
      workspaceName: mainGuild.name,
      timezone: "UTC", // Placeholder
      email: "admin@guildpass.xyz" // Placeholder
    };
  }
}

export const settingsService = new SettingsService();
