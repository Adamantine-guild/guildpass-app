import type { IntegrationAdapter, IntegrationDetails } from "./types";
import { DiscordMockAdapter } from "./discord-mock-adapter";
import { DiscordLiveAdapter } from "./discord-live-adapter";

export * from "./types";
export * from "./discord-mock-adapter";
export * from "./discord-live-adapter";

/**
 * Resolves the appropriate adapter for checking integration status.
 * Uses the Mock adapter when in development, test mode, or if DISCORD_BOT_MOCK_STATUS
 * is explicitly specified. Otherwise, falls back to the Live adapter.
 */
export function getDiscordAdapter(): IntegrationAdapter {
  const hasLiveConfig = 
    process.env.DISCORD_TOKEN &&
    !process.env.DISCORD_TOKEN.includes("dummy") &&
    !process.env.DISCORD_TOKEN.includes("placeholder");

  // Force mock mode if mock status is set or if we're in a dev/test environment without credentials
  const forceMock = 
    !!process.env.DISCORD_BOT_MOCK_STATUS || 
    process.env.NODE_ENV === "test" ||
    !hasLiveConfig;

  if (forceMock) {
    return new DiscordMockAdapter();
  }
  
  return new DiscordLiveAdapter();
}

/**
 * Helper to fetch all integration details.
 * Currently, only the Discord Bot integration is supported, but others can be added.
 * Guaranteed to never throw, ensuring it does not block dashboard loading.
 */
export async function getIntegrationsList(): Promise<IntegrationDetails[]> {
  const discordAdapter = getDiscordAdapter();
  try {
    const discordDetails = await discordAdapter.getDetails();
    return [discordDetails];
  } catch (err: any) {
    return [
      {
        id: "discord-bot",
        name: "Discord Bot",
        description: "Automate roles and sync user verifications in your community Discord server.",
        optional: true,
        status: "unknown",
        message: `Failed to fetch integration details: ${err.message ?? "Unknown error"}.`,
        lastChecked: new Date().toISOString(),
        details: {}
      }
    ];
  }
}
