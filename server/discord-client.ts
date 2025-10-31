import { Client, GatewayIntentBits } from 'discord.js';

export async function getUncachableDiscordClient() {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN environment variable not found. Please add your Discord bot token to Replit Secrets.');
  }

  console.log('Discord bot token found, length:', token.length);
  console.log('Token starts with:', token.substring(0, 10) + '...');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  await client.login(token);
  return client;
}
