import { getGuildRepository } from "../repositories/factory";
import { Guild } from "../mock-data";

class GuildService {
  async getAllGuilds(): Promise<Guild[]> {
    const repo = getGuildRepository();
    return repo.getAll();
  }

  async getGuildById(id: string): Promise<Guild | null> {
    const repo = getGuildRepository();
    return repo.getById(id);
  }

  async createGuild(guild: Omit<Guild, "id" | "createdAt">): Promise<Guild> {
    const repo = getGuildRepository();
    return repo.create(guild);
  }

  async updateGuild(id: string, guild: Partial<Guild>): Promise<Guild | null> {
    const repo = getGuildRepository();
    return repo.update(id, guild);
  }

  async deleteGuild(id: string): Promise<boolean> {
    const repo = getGuildRepository();
    return repo.delete(id);
  }
}

export const guildService = new GuildService();
