import type { IntegrationAdapter, IntegrationDetails, IntegrationStatus } from "./types";

/**
 * Mock adapter for the Discord Bot integration.
 * Used for local development and testing to simulate different statuses
 * without requiring live Discord API connections.
 */
export class DiscordMockAdapter implements IntegrationAdapter {
  private mockStatus?: IntegrationStatus;

  constructor(mockStatus?: IntegrationStatus) {
    this.mockStatus = mockStatus;
  }

  async getDetails(): Promise<IntegrationDetails> {
    // 1. Determine status based on explicit constructor override, env override, or default detection
    let status: IntegrationStatus;
    
    const envOverride = process.env.DISCORD_BOT_MOCK_STATUS as IntegrationStatus | undefined;
    
    if (this.mockStatus) {
      status = this.mockStatus;
    } else if (envOverride && ["disabled", "configured", "healthy", "unhealthy", "unknown"].includes(envOverride)) {
      status = envOverride;
    } else {
      // Automatic detection based on env vars
      const token = process.env.DISCORD_TOKEN;
      const clientId = process.env.DISCORD_CLIENT_ID;
      const guildId = process.env.DISCORD_GUILD_ID;

      const hasAllKeys = !!(token && clientId && guildId);
      const isDummy = !!(
        token?.includes("dummy") || 
        clientId?.includes("dummy") || 
        guildId?.includes("dummy") ||
        token?.includes("placeholder")
      );

      if (!token && !clientId && !guildId) {
        status = "disabled";
      } else if (hasAllKeys && !isDummy) {
        status = "healthy";
      } else if (hasAllKeys && isDummy) {
        status = "configured";
      } else {
        status = "unhealthy";
      }
    }

    // 2. Build descriptive message and details
    let message = "Discord bot integration is disabled.";
    const missingVars: string[] = [];
    if (!process.env.DISCORD_TOKEN) missingVars.push("DISCORD_TOKEN");
    if (!process.env.DISCORD_CLIENT_ID) missingVars.push("DISCORD_CLIENT_ID");
    if (!process.env.DISCORD_GUILD_ID) missingVars.push("DISCORD_GUILD_ID");

    switch (status) {
      case "disabled":
        message = "Discord bot is disabled. Add credentials to enable it.";
        break;
      case "configured":
        message = "Discord bot configured successfully in development/mock mode.";
        break;
      case "healthy":
        message = "Discord bot is healthy, connected to the guild, and listening for commands.";
        break;
      case "unhealthy":
        message = `Discord bot configuration is incomplete. Missing variables: ${missingVars.join(", ")}.`;
        break;
      case "unknown":
        message = "Unable to determine Discord bot health. Health-check request timed out.";
        break;
    }

    return {
      id: "discord-bot",
      name: "Discord Bot",
      description: "Automate roles and sync user verifications in your community Discord server.",
      optional: true,
      status,
      message,
      lastChecked: new Date().toISOString(),
      details: {
        hasToken: !!process.env.DISCORD_TOKEN,
        hasClientId: !!process.env.DISCORD_CLIENT_ID,
        hasGuildId: !!process.env.DISCORD_GUILD_ID,
        missingEnvVars: missingVars,
        mode: "mock",
        discordGuildId: process.env.DISCORD_GUILD_ID || undefined
      }
    };
  }
}
