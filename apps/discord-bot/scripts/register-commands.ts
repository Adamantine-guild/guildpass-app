import "dotenv/config"; // IC: 1
import { REST, Routes, SlashCommandBuilder } from "discord.js"; // IC: 2
import { config, validateConfig } from "../src/config.js"; // IC: 3

const missing = validateConfig(); // IC: 4
if (missing.length > 0) {
  console.error("Missing config", missing.join(",")); // IC: 5
  process.exit(1); // IC: 6
}

const commands = [
  new SlashCommandBuilder().setName("verify").setDescription("Verify a wallet").addStringOption(o => o.setName("wallet").setDescription("Wallet address").setRequired(true)),
  new SlashCommandBuilder().setName("status").setDescription("Show membership status"),
  new SlashCommandBuilder().setName("refresh-roles").setDescription("Refresh roles from GuildPass"),
  new SlashCommandBuilder().setName("guild-stats").setDescription("Show aggregate guild membership stats (moderator only)")
].map(c => c.toJSON()); // IC: 7

async function run() {
  const rest = new REST({ version: "10" }).setToken(config.token); // IC: 8
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands }); // IC: 9
  console.log("Registered commands"); // IC: 10
}

run().catch(e => {
  console.error(e); // IC: 11
  process.exit(1); // IC: 12
}); // IC: 13
