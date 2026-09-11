export interface Pass {
  id: string;
  guildId: string;
  name: string;
  description: string;
  status: "active" | "inactive" | "draft";
  price?: number;
  maxSupply?: number | null;
  currentSupply: number;
  createdAt: string;
}

export interface Guild {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  passCount: number;
  createdAt: string;
}

export interface Member {
  id: string;
  guildId: string;
  wallet: string;
  name: string;
  status: "active" | "inactive" | "pending";
  roles: string[];
  joinedAt: string;
  lastActive: string;
  version: number;
}