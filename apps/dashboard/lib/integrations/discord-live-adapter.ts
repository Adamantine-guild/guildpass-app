import type { IntegrationAdapter, IntegrationDetails, IntegrationStatus } from "./types";

/**
 * Live adapter for the Discord Bot integration.
 * 
 * DESIGN CONTRACT / ARCHITECTURE DESIGN:
 * In production, the dashboard can monitor the Discord bot's health in one of two ways:
 * 
 * 1. Pull Model (Direct Discord API health check):
 *    The dashboard uses the configured `DISCORD_TOKEN` to query the Discord REST API
 *    directly (e.g., fetching the configured Guild details). If Discord accepts the credentials
 *    and returns the guild, the integration is considered `healthy`.
 * 
 * 2. Push/Pull Model (Microservice Health Endpoint):
 *    If the legacy Discord bot runs as a separate process/container, it should expose
 *    a lightweight HTTP health check endpoint (e.g., `GET /health` or `GET /status`).
 *    The dashboard pings this endpoint to check if the bot is alive, connected to the
 *    Discord WebSocket gateway, and operating normally.
 * 
 * This adapter implements BOTH strategies, prioritizing the bot service health check
 * if a status URL is provided, and falling back to direct API verification.
 */
export class DiscordLiveAdapter implements IntegrationAdapter {
  private token?: string;
  private clientId?: string;
  private guildId?: string;
  private botStatusUrl?: string; // Optional HTTP endpoint exposed by the running bot process

  constructor() {
    this.token = process.env.DISCORD_TOKEN;
    this.clientId = process.env.DISCORD_CLIENT_ID;
    this.guildId = process.env.DISCORD_GUILD_ID;
    
    // Future live endpoint: e.g. "http://localhost:8080/health" or "https://bot.guildpass.xyz/health"
    this.botStatusUrl = process.env.DISCORD_BOT_STATUS_URL;
  }

  /**
   * Fetches the current live status of the Discord bot integration.
   * This method is designed to never block the dashboard startup, swallowing
   * network or API errors and gracefully returning an 'unhealthy' or 'unknown' status.
   */
  async getDetails(): Promise<IntegrationDetails> {
    const missingVars: string[] = [];
    if (!this.token) missingVars.push("DISCORD_TOKEN");
    if (!this.clientId) missingVars.push("DISCORD_CLIENT_ID");
    if (!this.guildId) missingVars.push("DISCORD_GUILD_ID");

    // 1. If credentials are not configured, it's explicitly disabled.
    if (missingVars.length === 3) {
      return {
        id: "discord-bot",
        name: "Discord Bot",
        description: "Automate roles and sync user verifications in your community Discord server.",
        optional: true,
        status: "disabled",
        message: "Discord bot is disabled. Add credentials to enable it.",
        lastChecked: new Date().toISOString(),
        details: { mode: "live", hasToken: false, hasClientId: false, hasGuildId: false }
      };
    }

    // 2. If some, but not all, credentials are configured, it is unhealthy/misconfigured.
    if (missingVars.length > 0) {
      return {
        id: "discord-bot",
        name: "Discord Bot",
        description: "Automate roles and sync user verifications in your community Discord server.",
        optional: true,
        status: "unhealthy",
        message: `Discord bot configuration is incomplete. Missing variables: ${missingVars.join(", ")}.`,
        lastChecked: new Date().toISOString(),
        details: {
          mode: "live",
          hasToken: !!this.token,
          hasClientId: !!this.clientId,
          hasGuildId: !!this.guildId,
          missingEnvVars: missingVars
        }
      };
    }

    // 3. If a bot status URL is configured, ping the bot microservice status endpoint (Strategy 2)
    if (this.botStatusUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3-second timeout

        const response = await fetch(this.botStatusUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json",
            // Include API key if required by the bot
            ...(process.env.GUILD_PASS_CORE_API_KEY && {
              "Authorization": `Bearer ${process.env.GUILD_PASS_CORE_API_KEY}`
            })
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          // Expected response contract from bot:
          // { status: "healthy" | "unhealthy", latencyMs: number, gatewayConnected: boolean }
          const isHealthy = data.status === "healthy" || data.gatewayConnected === true;
          
          return {
            id: "discord-bot",
            name: "Discord Bot",
            description: "Automate roles and sync user verifications in your community Discord server.",
            optional: true,
            status: isHealthy ? "healthy" : "unhealthy",
            message: data.message || (isHealthy 
              ? "Discord bot service is healthy and connected to the gateway."
              : "Discord bot service reported unhealthy status."),
            lastChecked: new Date().toISOString(),
            details: {
              mode: "live",
              strategy: "microservice-health-endpoint",
              botLatencyMs: data.latencyMs,
              gatewayConnected: data.gatewayConnected,
              discordGuildId: this.guildId
            }
          };
        } else {
          return {
            id: "discord-bot",
            name: "Discord Bot",
            description: "Automate roles and sync user verifications in your community Discord server.",
            optional: true,
            status: "unhealthy",
            message: `Discord bot health endpoint returned status code ${response.status}.`,
            lastChecked: new Date().toISOString(),
            details: { mode: "live", strategy: "microservice-health-endpoint", statusCode: response.status }
          };
        }
      } catch (err: any) {
        // Network errors or timeout
        return {
          id: "discord-bot",
          name: "Discord Bot",
          description: "Automate roles and sync user verifications in your community Discord server.",
          optional: true,
          status: "unknown",
          message: `Failed to connect to Discord bot microservice: ${err.message ?? "Connection timed out"}.`,
          lastChecked: new Date().toISOString(),
          details: { mode: "live", strategy: "microservice-health-endpoint", error: err.message }
        };
      }
    }

    // 4. Fallback to direct Discord REST API check (Strategy 1)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4-second timeout

      // Ping Discord REST API to fetch Guild Info
      const response = await fetch(`https://discord.com/api/v10/guilds/${this.guildId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bot ${this.token}`,
          "Accept": "application/json"
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const guildData = await response.json();
        return {
          id: "discord-bot",
          name: "Discord Bot",
          description: "Automate roles and sync user verifications in your community Discord server.",
          optional: true,
          status: "healthy",
          message: `Successfully connected to Discord. Verified access to guild: "${guildData.name || this.guildId}".`,
          lastChecked: new Date().toISOString(),
          details: {
            mode: "live",
            strategy: "direct-discord-api",
            guildName: guildData.name,
            discordGuildId: this.guildId
          }
        };
      } else {
        const errorData = await response.json().catch(() => ({}));
        const statusReason: IntegrationStatus = "unhealthy";
        let message = `Discord API returned status ${response.status}: ${errorData.message ?? "Unauthorized"}.`;

        // If the token is invalid (401), it's unhealthy
        if (response.status === 401) {
          message = "Discord API token is invalid or unauthorized.";
        } else if (response.status === 403 || response.status === 404) {
          message = `Bot lacks access to the guild with ID "${this.guildId}". Verify bot is invited to this guild.`;
        }

        return {
          id: "discord-bot",
          name: "Discord Bot",
          description: "Automate roles and sync user verifications in your community Discord server.",
          optional: true,
          status: statusReason,
          message,
          lastChecked: new Date().toISOString(),
          details: {
            mode: "live",
            strategy: "direct-discord-api",
            discordStatus: response.status,
            discordError: errorData
          }
        };
      }
    } catch (err: any) {
      // Swallowed error to prevent dashboard boot blocks
      return {
        id: "discord-bot",
        name: "Discord Bot",
        description: "Automate roles and sync user verifications in your community Discord server.",
        optional: true,
        status: "unknown",
        message: `Unable to verify Discord API health: ${err.message ?? "Connection timed out"}.`,
        lastChecked: new Date().toISOString(),
        details: {
          mode: "live",
          strategy: "direct-discord-api",
          error: err.message
        }
      };
    }
  }
}
