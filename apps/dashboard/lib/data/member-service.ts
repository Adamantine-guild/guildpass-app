import { getMemberRepository } from "../repositories/factory";
import { Member } from "../mock-data";

class MemberService {
  async getAllMembers(): Promise<Member[]> {
    const repo = getMemberRepository();
    return repo.getAll();
  }

  async getMemberById(id: string): Promise<Member | null> {
    const repo = getMemberRepository();
    return repo.getById(id);
  }

  async getMemberByWallet(wallet: string): Promise<Member | null> {
    const repo = getMemberRepository();
    return repo.getByWallet(wallet);
  }

  async createMember(member: Omit<Member, "id">): Promise<Member> {
    const repo = getMemberRepository();
    return repo.create(member);
  }

  async updateMember(id: string, member: Partial<Member>): Promise<Member | null> {
    const repo = getMemberRepository();
    return repo.update(id, member);
  }

  async deleteMember(id: string): Promise<boolean> {
    const repo = getMemberRepository();
    return repo.delete(id);
  }
}

export const memberService = new MemberService();
