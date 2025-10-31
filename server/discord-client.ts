import { Client, GatewayIntentBits } from 'discord.js';

let connectionSettings: any;

async function getBotToken() {
  if (connectionSettings && connectionSettings.settings?.bot_token) {
    return connectionSettings.settings.bot_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  if (!hostname) {
    throw new Error('REPLIT_CONNECTORS_HOSTNAME not found');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=discord',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );

  const data = await response.json();
  connectionSettings = data.items?.[0];

  console.log('Connection settings:', JSON.stringify(connectionSettings, null, 2));

  const botToken = connectionSettings?.settings?.bot_token 
    || connectionSettings?.settings?.access_token
    || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !botToken) {
    throw new Error('Discord not connected or bot token not found');
  }
  
  return botToken;
}

export async function getUncachableDiscordClient() {
  const token = await getBotToken();

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
