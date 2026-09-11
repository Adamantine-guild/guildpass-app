import { test, describe, after } from "node:test";
import assert from "node:assert";
import { DiscordMockAdapter } from "../lib/integrations";

describe("Integration Status Adapters", () => {
  const originalEnv = { ...process.env };

  after(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  test("Mock Adapter - should return disabled when no env vars are set", async () => {
    delete process.env.DISCORD_TOKEN;
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.DISCORD_BOT_MOCK_STATUS;

    const adapter = new DiscordMockAdapter();
    const details = await adapter.getDetails();

    assert.strictEqual(details.status, "disabled");
  });

  test("Mock Adapter - should return configured when mock env vars are set", async () => {
    process.env.DISCORD_TOKEN = "dummy_token";
    process.env.DISCORD_CLIENT_ID = "dummy_client_id";
    process.env.DISCORD_GUILD_ID = "dummy_guild_id";
    delete process.env.DISCORD_BOT_MOCK_STATUS;

    const adapter = new DiscordMockAdapter();
    const details = await adapter.getDetails();

    assert.strictEqual(details.status, "configured");
  });

  test("Mock Adapter - should return unhealthy when partially configured", async () => {
    process.env.DISCORD_TOKEN = "real_token";
    delete process.env.DISCORD_CLIENT_ID;
    process.env.DISCORD_GUILD_ID = "real_guild_id";
    delete process.env.DISCORD_BOT_MOCK_STATUS;

    const adapter = new DiscordMockAdapter();
    const details = await adapter.getDetails();

    assert.strictEqual(details.status, "unhealthy");
    assert.strictEqual(details.details?.missingEnvVars?.includes("DISCORD_CLIENT_ID"), true);
  });

  test("Mock Adapter - should respect explicit constructor override", async () => {
    const adapter = new DiscordMockAdapter("unknown");
    const details = await adapter.getDetails();

    assert.strictEqual(details.status, "unknown");
  });

  test("Mock Adapter - should respect DISCORD_BOT_MOCK_STATUS env override", async () => {
    process.env.DISCORD_BOT_MOCK_STATUS = "healthy";
    const adapter = new DiscordMockAdapter();
    const details = await adapter.getDetails();

    assert.strictEqual(details.status, "healthy");
  });
});
