import type { ActivityChange, ActivityEvent } from "@guildpass/integration-client";
import type { ActivityQuery } from "./activity/query";
import { readApiResult } from "./api-client";
import { GUILD_ID_HEADER } from "./guild-context";

export interface Pass {
  id: string;
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
  wallet: string;
  name: string;
  status: "active" | "inactive" | "pending";
  roles: string[];
  joinedAt: string;
  lastActive: string;
  /** Monotonically increasing version number for optimistic concurrency control. */
  version: number;
}

export interface Activity {
  id: string;
  /** Owning guild (tenant). Activity is scoped to a single community. */
  guildId: string;
  type: "pass_created" | "pass_purchased" | "member_joined" | "role_changed" | "access_granted";
  description: string;
  timestamp: string;
  actor: string;
  changes?: ActivityChange[];
}

<<<<<<< HEAD
export const mockPasses: Pass[] = [
  { id: "1", name: "Founder Pass", description: "Exclusive early access pass for founding members", status: "active", price: 0.1, maxSupply: 100, currentSupply: 42, createdAt: "2025-01-15T00:00:00Z" },
  { id: "2", name: "Premium Pass", description: "Full access to all guild features", status: "active", price: 0.05, maxSupply: 500, currentSupply: 189, createdAt: "2025-02-20T00:00:00Z" },
  { id: "3", name: "Community Pass", description: "Basic community access", status: "active", price: 0, maxSupply: null, currentSupply: 1203, createdAt: "2025-01-01T00:00:00Z" },
  { id: "4", name: "VIP Pass", description: "Top-tier VIP membership", status: "draft", price: 1, maxSupply: 50, currentSupply: 0, createdAt: "2025-06-01T00:00:00Z" },
=======
/**
 * Default guild used when no tenant scope is supplied (header / cookie / route).
 * Not a hard-coded product assumption — only a fallback for unscoped requests.
 */
export const DEFAULT_GUILD_ID = "1";

export const mockGuilds: Guild[] = [
  {
    id: "1",
    name: "GuildPass DAO",
    description: "The official GuildPass DAO",
    memberCount: 4,
    passCount: 4,
    createdAt: "2024-12-01T00:00:00Z",
  },
  {
    id: "2",
    name: "Web3 Builders",
    description: "A community for Web3 developers",
    memberCount: 3,
    passCount: 3,
    createdAt: "2025-01-10T00:00:00Z",
  },
  {
    id: "3",
    name: "DeFi Enthusiasts",
    description: "DeFi-focused community",
    memberCount: 3,
    passCount: 3,
    createdAt: "2025-03-05T00:00:00Z",
  },
>>>>>>> main
];

export const mockPasses: Pass[] = [
  // Guild 1 — GuildPass DAO
  {
    id: "1",
    guildId: "1",
    name: "Founder Pass",
    description: "Exclusive early access pass for founding members",
    status: "active",
    price: 0.1,
    maxSupply: 100,
    currentSupply: 42,
    createdAt: "2025-01-15T00:00:00Z",
  },
  {
    id: "2",
    guildId: "1",
    name: "Premium Pass",
    description: "Full access to all guild features",
    status: "active",
    price: 0.05,
    maxSupply: 500,
    currentSupply: 189,
    createdAt: "2025-02-20T00:00:00Z",
  },
  {
    id: "3",
    guildId: "1",
    name: "Community Pass",
    description: "Basic community access",
    status: "active",
    price: 0,
    maxSupply: null,
    currentSupply: 1203,
    createdAt: "2025-01-01T00:00:00Z",
  },
  {
    id: "4",
    guildId: "1",
    name: "VIP Pass",
    description: "Top-tier VIP membership",
    status: "draft",
    price: 1,
    maxSupply: 50,
    currentSupply: 0,
    createdAt: "2025-06-01T00:00:00Z",
  },
  // Guild 2 — Web3 Builders
  {
    id: "5",
    guildId: "2",
    name: "Builder Pass",
    description: "Access for active Web3 builders",
    status: "active",
    price: 0.02,
    maxSupply: 1000,
    currentSupply: 312,
    createdAt: "2025-01-12T00:00:00Z",
  },
  {
    id: "6",
    guildId: "2",
    name: "Mentor Pass",
    description: "Pass for community mentors and reviewers",
    status: "active",
    price: 0,
    maxSupply: 100,
    currentSupply: 28,
    createdAt: "2025-02-01T00:00:00Z",
  },
  {
    id: "7",
    guildId: "2",
    name: "Hackathon Pass",
    description: "Seasonal hackathon entry pass",
    status: "draft",
    price: 0.01,
    maxSupply: 500,
    currentSupply: 0,
    createdAt: "2025-05-20T00:00:00Z",
  },
  // Guild 3 — DeFi Enthusiasts
  {
    id: "8",
    guildId: "3",
    name: "Yield Seeker",
    description: "Access to DeFi research channels",
    status: "active",
    price: 0.03,
    maxSupply: 2000,
    currentSupply: 890,
    createdAt: "2025-03-10T00:00:00Z",
  },
  {
    id: "9",
    guildId: "3",
    name: "Protocol Analyst",
    description: "Advanced analytics and protocol briefings",
    status: "active",
    price: 0.15,
    maxSupply: 200,
    currentSupply: 67,
    createdAt: "2025-04-01T00:00:00Z",
  },
  {
    id: "10",
    guildId: "3",
    name: "Whale Lounge",
    description: "Private lounge for high-volume members",
    status: "inactive",
    price: 0.5,
    maxSupply: 50,
    currentSupply: 12,
    createdAt: "2025-03-15T00:00:00Z",
  },
];

export const mockMembers: Member[] = [
<<<<<<< HEAD
  { id: "1", wallet: "0x742d35Cc6634C0532925a3b8879539d43374e290", name: "Alice", status: "active", roles: ["admin", "member"], joinedAt: "2024-12-01T00:00:00Z", lastActive: "2025-06-10T12:34:56Z" },
  { id: "2", wallet: "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1", name: "Bob", status: "active", roles: ["member", "contributor"], joinedAt: "2025-01-05T00:00:00Z", lastActive: "2025-06-11T08:23:45Z" },
  { id: "3", wallet: "0xFFcf8Ff64036412b493244b40b914f562419246F", name: "Charlie", status: "pending", roles: [], joinedAt: "2025-06-12T00:00:00Z", lastActive: "2025-06-12T09:15:22Z" },
  { id: "4", wallet: "0x1234567890123456789012345678901234567890", name: "Diana", status: "inactive", roles: ["member"], joinedAt: "2025-02-14T00:00:00Z", lastActive: "2025-04-20T14:30:00Z" },
=======
  // Guild 1
  {
    id: "1",
    guildId: "1",
    wallet: "0x742d35Cc6634C0532925a3b8879539d43374e290",
    name: "Alice",
    status: "active",
    roles: ["admin", "member"],
    joinedAt: "2024-12-01T00:00:00Z",
    lastActive: "2025-06-10T12:34:56Z",
  },
  {
    id: "2",
    guildId: "1",
    wallet: "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1",
    name: "Bob",
    status: "active",
    roles: ["member", "contributor"],
    joinedAt: "2025-01-05T00:00:00Z",
    lastActive: "2025-06-11T08:23:45Z",
  },
  {
    id: "3",
    guildId: "1",
    wallet: "0xFFcf8Ff64036412b493244b40b914f562419246F",
    name: "Charlie",
    status: "pending",
    roles: [],
    joinedAt: "2025-06-12T00:00:00Z",
    lastActive: "2025-06-12T09:15:22Z",
  },
  {
    id: "4",
    guildId: "1",
    wallet: "0x1234567890123456789012345678901234567890",
    name: "Diana",
    status: "inactive",
    roles: ["member"],
    joinedAt: "2025-02-14T00:00:00Z",
    lastActive: "2025-04-20T14:30:00Z",
  },
  // Guild 2
  {
    id: "5",
    guildId: "2",
    wallet: "0x1111111111111111111111111111111111111111",
    name: "Eve",
    status: "active",
    roles: ["admin", "member"],
    joinedAt: "2025-01-11T00:00:00Z",
    lastActive: "2025-06-11T16:00:00Z",
  },
  {
    id: "6",
    guildId: "2",
    wallet: "0x2222222222222222222222222222222222222222",
    name: "Frank",
    status: "active",
    roles: ["member", "contributor"],
    joinedAt: "2025-02-03T00:00:00Z",
    lastActive: "2025-06-10T11:22:00Z",
  },
  {
    id: "7",
    guildId: "2",
    wallet: "0x3333333333333333333333333333333333333333",
    name: "Grace",
    status: "pending",
    roles: ["member"],
    joinedAt: "2025-06-01T00:00:00Z",
    lastActive: "2025-06-01T09:00:00Z",
  },
  // Guild 3
  {
    id: "8",
    guildId: "3",
    wallet: "0x4444444444444444444444444444444444444444",
    name: "Hank",
    status: "active",
    roles: ["admin", "member"],
    joinedAt: "2025-03-06T00:00:00Z",
    lastActive: "2025-06-12T10:00:00Z",
  },
  {
    id: "9",
    guildId: "3",
    wallet: "0x5555555555555555555555555555555555555555",
    name: "Ivy",
    status: "active",
    roles: ["member"],
    joinedAt: "2025-03-20T00:00:00Z",
    lastActive: "2025-06-09T14:15:00Z",
  },
  {
    id: "10",
    guildId: "3",
    wallet: "0x6666666666666666666666666666666666666666",
    name: "Jack",
    status: "inactive",
    roles: ["member", "contributor"],
    joinedAt: "2025-04-02T00:00:00Z",
    lastActive: "2025-05-01T08:00:00Z",
  },
>>>>>>> main
];

export const mockActivity: Activity[] = [
  // Guild 1
  {
    id: "1",
    guildId: "1",
    type: "member_joined",
    description: "Alice joined GuildPass DAO",
    timestamp: "2025-06-11T15:30:00Z",
    actor: "Alice",
    changes: [
      { field: "name", before: undefined, after: "Alice" },
      { field: "status", before: undefined, after: "active" },
      { field: "roles", before: undefined, after: ["admin", "member"] },
    ],
  },
  {
    id: "2",
    guildId: "1",
    type: "pass_created",
    description: "Created new VIP Pass (draft)",
    timestamp: "2025-06-10T10:15:00Z",
    actor: "Admin",
    changes: [
      { field: "name", before: undefined, after: "VIP Pass" },
      { field: "status", before: undefined, after: "draft" },
    ],
  },
  {
    id: "3",
    guildId: "1",
    type: "pass_purchased",
    description: "Bob purchased Premium Pass",
    timestamp: "2025-06-09T18:45:00Z",
    actor: "Bob",
  },
  {
    id: "4",
    guildId: "1",
    type: "role_changed",
    description: "Charlie promoted to Contributor",
    timestamp: "2025-06-08T09:20:00Z",
    actor: "Admin",
    changes: [{ field: "roles", before: [], after: ["contributor"] }],
  },
  {
    id: "5",
    guildId: "1",
    type: "access_granted",
    description: "Alice granted Admin access",
    timestamp: "2025-06-07T14:00:00Z",
    actor: "Admin",
    changes: [{ field: "roles", before: ["member"], after: ["admin", "member"] }],
  },
  // Guild 2
  {
    id: "6",
    guildId: "2",
    type: "member_joined",
    description: "Eve joined Web3 Builders",
    timestamp: "2025-06-11T12:00:00Z",
    actor: "Eve",
    changes: [{ field: "status", before: undefined, after: "active" }],
  },
  {
    id: "7",
    guildId: "2",
    type: "pass_created",
    description: "Created Builder Pass",
    timestamp: "2025-06-10T09:00:00Z",
    actor: "Admin",
    changes: [{ field: "name", before: undefined, after: "Builder Pass" }],
  },
  {
    id: "8",
    guildId: "2",
    type: "pass_purchased",
    description: "Frank purchased Mentor Pass",
    timestamp: "2025-06-09T16:30:00Z",
    actor: "Frank",
  },
  // Guild 3
  {
    id: "9",
    guildId: "3",
    type: "member_joined",
    description: "Hank joined DeFi Enthusiasts",
    timestamp: "2025-06-11T11:00:00Z",
    actor: "Hank",
  },
  {
    id: "10",
    guildId: "3",
    type: "pass_purchased",
    description: "Ivy purchased Yield Seeker",
    timestamp: "2025-06-10T13:45:00Z",
    actor: "Ivy",
  },
  {
    id: "11",
    guildId: "3",
    type: "role_changed",
    description: "Jack promoted to Contributor",
    timestamp: "2025-06-08T17:00:00Z",
    actor: "Admin",
    changes: [{ field: "roles", before: ["member"], after: ["member", "contributor"] }],
  },
];

// ── Mock simulator ────────────────────────────────────────────────────────────
// Generates a single random activity event with a unique ID and current timestamp.
// Used by useActivityFeed to simulate newly arriving events in dev/mock mode.

const SIM_ACTORS = ["Alice", "Bob", "Charlie", "Diana", "Admin"];
const SIM_TEMPLATES: {
  type: Activity["type"];
  description: (actor: string) => string;
  changes?: ActivityChange[];
}[] = [
  {
    type: "member_joined",
    description: (a) => `${a} joined the guild`,
    changes: [{ field: "status", before: undefined, after: "active" }],
  },
  { type: "pass_purchased", description: (a) => `${a} purchased a community pass` },
  {
    type: "role_changed",
    description: (a) => `${a} was promoted to Contributor`,
    changes: [{ field: "roles", before: ["member"], after: ["member", "contributor"] }],
  },
  {
    type: "access_granted",
    description: (a) => `${a} granted member access`,
    changes: [{ field: "roles", before: [], after: ["member"] }],
  },
  {
    type: "pass_created",
    description: (a) => `${a} created a new seasonal pass`,
    changes: [{ field: "name", before: undefined, after: "Seasonal Pass" }],
  },
];

let _simCounter = mockActivity.length;

export function generateMockActivity(guildId: string = DEFAULT_GUILD_ID): Activity {
  const actor = SIM_ACTORS[Math.floor(Math.random() * SIM_ACTORS.length)];
  const tpl = SIM_TEMPLATES[Math.floor(Math.random() * SIM_TEMPLATES.length)];
  _simCounter += 1;
  return {
    id: String(Date.now()) + _simCounter,
    guildId,
    type: tpl.type,
    description: tpl.description(actor),
    timestamp: new Date().toISOString(),
    actor,
    changes: tpl.changes,
  };
}

export interface ActivityFetchResult {
  events: (Activity | ActivityEvent)[];
  nextCursor: string | null;
  total: number;
}

export interface ActivityFetchQuery extends ActivityQuery {
  /** Optional tenant scope for client-side mock fallback filtering. */
  guildId?: string;
}

/** Fetches activity from the API and falls back to local mock data in dev/test. */
export async function fetchActivity(query: ActivityFetchQuery = {}): Promise<ActivityFetchResult> {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === "guildId") continue; // sent via header, not query
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        params.set(key, String(value));
      }
    }

    const headers: HeadersInit = {};
    if (query.guildId) {
      headers[GUILD_ID_HEADER] = query.guildId;
    }

    const response = await fetch(`/api/activity${params.size ? `?${params}` : ""}`, {
      headers,
    });
    return await readApiResult<ActivityFetchResult>(response);
  } catch (error) {
    console.warn("Using fallback mock data due to fetch error:", error);
    const scoped = query.guildId
      ? mockActivity.filter((event) => event.guildId === query.guildId)
      : mockActivity;
    return Promise.resolve({
      events: [...scoped],
      nextCursor: null,
      total: scoped.length,
    });
  }
}
