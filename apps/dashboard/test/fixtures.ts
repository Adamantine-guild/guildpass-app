/**
 * Test fixtures
 *
 * All test data lives here, kept separate from production mock-data.ts.
 * Fixtures are plain objects — no side-effects, no imports from app code.
 */

import type { ActivityEvent } from "../lib/activity/types";
import { CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";
import type { Session } from "../lib/auth/session";
import type { WebhookPayload } from "../lib/activity/types";
import { DEFAULT_GUILD_ID } from "../lib/mock-data";

export const FIXED_TIMESTAMP = "2025-01-15T12:00:00.000Z";
export const FIXED_UNIX = Math.floor(new Date(FIXED_TIMESTAMP).getTime() / 1000);

export function makeActivityEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "evt_fixture_001",
    type: "member.joined",
    source: "dashboard",
    severity: "info",
    actor: { name: "Alice", wallet: "0xabc" },
    timestamp: FIXED_TIMESTAMP,
    description: "Alice joined the guild",
    schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
    ...overrides,
  };
}

export const FIXTURE_PASS_CREATED_EVENT: ActivityEvent = makeActivityEvent({
  id: "evt_fixture_pass_001",
  type: "pass.created",
  description: "Created new pass: Founder Pass",
  entity: { type: "pass", id: "pass_001", name: "Founder Pass" },
});

export const FIXTURE_MEMBER_JOINED_EVENT: ActivityEvent = makeActivityEvent({
  id: "evt_fixture_member_001",
  type: "member.joined",
  description: "Bob joined the guild",
  actor: { name: "Bob", wallet: "0xdef" },
  entity: { type: "member", id: "member_001", name: "Bob" },
});

export const FIXTURE_VERIFICATION_EVENT: ActivityEvent = makeActivityEvent({
  id: "evt_fixture_verify_001",
  type: "verification.completed",
  description: "Verification completed for 0xabc",
  actor: { wallet: "0xabc" },
  entity: { type: "verification", id: "0xabc" },
  metadata: { wallet: "0xabc" },
});

export function makeWebhookPayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    id: "whk_fixture_001",
    type: "membership.created",
    created: FIXED_UNIX,
    data: { id: "member_001", name: "Alice", wallet: "0xabc" },
    ...overrides,
  };
}

export const WEBHOOK_FIXTURES: Record<string, WebhookPayload> = {
  "membership.created": makeWebhookPayload({
    id: "whk_mc_001",
    type: "membership.created",
    data: { id: "member_001", name: "Alice", wallet: "0xabc" },
  }),
  "membership.updated": makeWebhookPayload({
    id: "whk_mu_001",
    type: "membership.updated",
    data: { id: "member_001", name: "Alice", wallet: "0xabc" },
  }),
  "pass.created": makeWebhookPayload({
    id: "whk_pc_001",
    type: "pass.created",
    data: { id: "pass_001", name: "Founder Pass" },
  }),
  "pass.updated": makeWebhookPayload({
    id: "whk_pu_001",
    type: "pass.updated",
    data: { id: "pass_001", name: "Founder Pass" },
  }),
  "guild.updated": makeWebhookPayload({
    id: "whk_gu_001",
    type: "guild.updated",
    data: { id: "guild_001", name: "GuildPass DAO" },
  }),
  "verification.completed": makeWebhookPayload({
    id: "whk_vc_001",
    type: "verification.completed",
    data: { wallet: "0xabc" },
  }),
};

export const SESSION_ADMIN: Session = {
  userId: "test-admin-001",
  name: "Test Admin",
  roles: {
    [DEFAULT_GUILD_ID]: "admin",
  },
};

export const SESSION_MODERATOR: Session = {
  userId: "test-mod-001",
  name: "Test Moderator",
  roles: {
    [DEFAULT_GUILD_ID]: "moderator",
  },
};

export const SESSION_READONLY: Session = {
  userId: "test-readonly-001",
  name: "Test Viewer",
  roles: {
    [DEFAULT_GUILD_ID]: "readonly",
  },
};

export const SESSION_OWNER: Session = {
  userId: "test-owner-001",
  name: "Test Owner",
  roles: {
    [DEFAULT_GUILD_ID]: "owner",
  },
};

export const MOCK_PASSES_METRICS = [
  { id: "1", status: "active", currentSupply: 42, maxSupply: 100, price: 0.1 },
  { id: "2", status: "active", currentSupply: 189, maxSupply: 500, price: 0.05 },
  { id: "3", status: "active", currentSupply: 1203, maxSupply: null, price: 0 },
  { id: "4", status: "draft", currentSupply: 0, maxSupply: 50, price: 1 },
];

export const MOCK_MEMBERS_METRICS = [
  { id: "1", status: "active" },
  { id: "2", status: "active" },
  { id: "3", status: "pending" },
  { id: "4", status: "inactive" },
];
