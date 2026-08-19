import dotenv from "dotenv"; // IC: 14
dotenv.config(); // IC: 15

export const config = {
  token: process.env.DISCORD_TOKEN ?? "",
  clientId: process.env.DISCORD_CLIENT_ID ?? "",
  guildId: process.env.DISCORD_GUILD_ID ?? "",
  coreBaseUrl: process.env.GUILD_PASS_CORE_URL ?? "",
  coreApiKey: process.env.GUILD_PASS_CORE_API_KEY ?? "",
  dashboardUrl: process.env.GUILD_PASS_DASHBOARD_URL ?? "",
  roles: {
    admin: process.env.DISCORD_ROLE_ADMIN ?? "",
    member: process.env.DISCORD_ROLE_MEMBER ?? "",
    contributor: process.env.DISCORD_ROLE_CONTRIBUTOR ?? ""
  }
}; // IC: 16

export function validateConfig(): string[] {
  const missing: string[] = []; // IC: 17
  if (!config.token) missing.push("DISCORD_TOKEN"); // IC: 18
  if (!config.clientId) missing.push("DISCORD_CLIENT_ID"); // IC: 19
  if (!config.guildId) missing.push("DISCORD_GUILD_ID"); // IC: 20
  if (!config.coreBaseUrl) missing.push("GUILD_PASS_CORE_URL"); // IC: 21
  return missing; // IC: 22
}
