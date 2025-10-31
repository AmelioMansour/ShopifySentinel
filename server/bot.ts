import { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  EmbedBuilder, 
  REST, 
  Routes,
  ChatInputCommandInteraction
} from 'discord.js';
import { getUncachableDiscordClient } from './discord-client';
import { scanShopifyStore, scanMultipleStores } from './shopify-scanner';
import type { ScanResult, BatchScanResponse } from '@shared/schema';

let client: Client | null = null;

export async function startBot() {
  try {
    console.log('Starting Discord bot...');
    client = await getUncachableDiscordClient();

    client.on('ready', async () => {
      console.log(`Bot logged in as ${client?.user?.tag}`);
      await registerCommands();
    });

    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      try {
        if (interaction.commandName === 'scan') {
          await handleScanCommand(interaction);
        } else if (interaction.commandName === 'scanbatch') {
          await handleScanBatchCommand(interaction);
        }
      } catch (error) {
        console.error('Error handling command:', error);
        const errorMessage = error instanceof Error ? error.message : 'An error occurred';
        
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: `❌ Error: ${errorMessage}` });
        } else {
          await interaction.reply({ content: `❌ Error: ${errorMessage}`, ephemeral: true });
        }
      }
    });

    console.log('Bot is running and listening for commands');
  } catch (error) {
    console.error('Failed to start bot:', error);
    throw error;
  }
}

async function registerCommands() {
  if (!client?.user?.id) return;

  const commands = [
    new SlashCommandBuilder()
      .setName('scan')
      .setDescription('Scan a Shopify store for products priced at $0.00')
      .addStringOption(option =>
        option.setName('url')
          .setDescription('The Shopify store URL (e.g., store-name.myshopify.com)')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('scanbatch')
      .setDescription('Scan multiple Shopify stores for $0.00 products')
      .addStringOption(option =>
        option.setName('urls')
          .setDescription('Comma-separated store URLs')
          .setRequired(true)
      ),
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(client.token!);

  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Successfully registered slash commands');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

async function handleScanCommand(interaction: ChatInputCommandInteraction) {
  const url = interaction.options.getString('url', true);
  
  await interaction.deferReply();

  const result = await scanShopifyStore(url);
  
  const embed = createScanResultEmbed(result);
  await interaction.editReply({ embeds: [embed] });
}

async function handleScanBatchCommand(interaction: ChatInputCommandInteraction) {
  const urlsInput = interaction.options.getString('urls', true);
  const urls = urlsInput.split(',').map(url => url.trim()).filter(url => url.length > 0);

  if (urls.length === 0) {
    await interaction.reply({ content: '❌ Please provide at least one URL', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const batchResponse = await scanMultipleStores(urls);
  
  const embeds = createBatchResultEmbeds(batchResponse);
  await interaction.editReply({ embeds });
}

function createScanResultEmbed(result: ScanResult): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🔍 Scan Results: ${result.storeName}`)
    .setColor(result.success ? 0x3b82f6 : 0xef4444)
    .setTimestamp(new Date(result.scannedAt));

  if (!result.success) {
    embed.setDescription(`❌ **Scan Failed**\n${result.error || 'Unknown error'}`);
    return embed;
  }

  if (result.zeroPriceProducts.length === 0) {
    embed.setDescription('✅ **No zero-price products found**')
      .addFields({
        name: 'Total Products Scanned',
        value: result.productsFound.toString(),
        inline: true
      });
    return embed;
  }

  embed.setDescription(`✅ **Found ${result.zeroPriceProducts.length} zero-price products**`)
    .addFields({
      name: 'Total Products Scanned',
      value: result.productsFound.toString(),
      inline: true
    });

  const products = result.zeroPriceProducts.slice(0, 5);
  products.forEach((product, index) => {
    embed.addFields({
      name: `${index + 1}. ${product.productTitle}`,
      value: `Variant: ${product.variantTitle}\nPrice: $${product.price}\n[View Product](${product.productUrl})`,
      inline: false
    });
  });

  if (result.zeroPriceProducts.length > 5) {
    embed.addFields({
      name: 'Additional Products',
      value: `... and ${result.zeroPriceProducts.length - 5} more`,
      inline: false
    });
  }

  return embed;
}

function createBatchResultEmbeds(batchResponse: BatchScanResponse): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];

  const summaryEmbed = new EmbedBuilder()
    .setTitle('📊 Batch Scan Summary')
    .setColor(0x3b82f6)
    .addFields(
      { name: 'Total Stores', value: batchResponse.totalStores.toString(), inline: true },
      { name: 'Successful Scans', value: batchResponse.successfulScans.toString(), inline: true },
      { name: 'Failed Scans', value: batchResponse.failedScans.toString(), inline: true },
      { name: 'Zero-Price Products Found', value: batchResponse.totalZeroPriceProducts.toString(), inline: true }
    )
    .setTimestamp();

  embeds.push(summaryEmbed);

  const resultsWithProducts = batchResponse.results.filter(r => r.success && r.zeroPriceProducts.length > 0);
  
  resultsWithProducts.slice(0, 3).forEach(result => {
    const resultEmbed = new EmbedBuilder()
      .setTitle(`🛍️ ${result.storeName}`)
      .setColor(0x10b981)
      .setDescription(`Found ${result.zeroPriceProducts.length} zero-price products`);

    const products = result.zeroPriceProducts.slice(0, 3);
    products.forEach((product, index) => {
      resultEmbed.addFields({
        name: `${index + 1}. ${product.productTitle}`,
        value: `${product.variantTitle} - $${product.price}\n[View](${product.productUrl})`,
        inline: false
      });
    });

    if (result.zeroPriceProducts.length > 3) {
      resultEmbed.addFields({
        name: 'More',
        value: `... and ${result.zeroPriceProducts.length - 3} more products`,
        inline: false
      });
    }

    embeds.push(resultEmbed);
  });

  if (resultsWithProducts.length > 3) {
    const moreEmbed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setDescription(`📦 ${resultsWithProducts.length - 3} more stores have zero-price products`);
    embeds.push(moreEmbed);
  }

  return embeds;
}

export async function stopBot() {
  if (client) {
    client.destroy();
    client = null;
    console.log('Bot stopped');
  }
}
