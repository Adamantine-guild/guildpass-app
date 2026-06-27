import { getPassRepository } from "../repositories/factory";
import { Pass } from "../mock-data";

class PassService {
  async getAllPasses(): Promise<Pass[]> {
    const repo = getPassRepository();
    return repo.getAll();
  }

  async getPassById(id: string): Promise<Pass | null> {
    const repo = getPassRepository();
    return repo.getById(id);
  }

  async createPass(pass: Omit<Pass, "id" | "createdAt">): Promise<Pass> {
    const repo = getPassRepository();
    return repo.create(pass);
  }

  async updatePass(id: string, pass: Partial<Pass>): Promise<Pass | null> {
    const repo = getPassRepository();
    return repo.update(id, pass);
  }

  async deletePass(id: string): Promise<boolean> {
    const repo = getPassRepository();
    return repo.delete(id);
  }
}

export const passService = new PassService();
