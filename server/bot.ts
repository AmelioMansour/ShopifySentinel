import { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  EmbedBuilder, 
  REST, 
  Routes,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { getUncachableDiscordClient } from './discord-client';
import { scanShopifyStore, scanMultipleStores } from './shopify-scanner';
import type { ScanResult, BatchScanResponse, ZeroPriceProduct } from '@shared/schema';

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
      try {
        if (interaction.isChatInputCommand()) {
          if (interaction.commandName === 'scan') {
            await handleScanCommand(interaction);
          } else if (interaction.commandName === 'scanbatch') {
            await handleScanBatchCommand(interaction);
          }
        } else if (interaction.isButton()) {
          await handleButtonInteraction(interaction);
        }
      } catch (error) {
        console.error('Error handling interaction:', error);
        const errorMessage = error instanceof Error ? error.message : 'An error occurred';
        
        if (interaction.isRepliable()) {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: `❌ Error: ${errorMessage}` });
          } else {
            await interaction.reply({ content: `❌ Error: ${errorMessage}`, ephemeral: true });
          }
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
      .setDescription('Scan multiple Shopify stores for $0.00 products (max 25 URLs)')
      .addAttachmentOption(option =>
        option.setName('file')
          .setDescription('Text file with store URLs (one per line, max 25)')
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

// Store pagination data in memory (simple approach for demo)
const paginationData = new Map<string, { 
  products: ZeroPriceProduct[], 
  storeUrl: string, 
  storeName: string,
  totalProducts: number 
}>();

async function handleScanCommand(interaction: ChatInputCommandInteraction) {
  const url = interaction.options.getString('url', true);
  
  await interaction.deferReply();

  const result = await scanShopifyStore(url);
  
  if (!result.success || result.zeroPriceProducts.length === 0) {
    const embed = createScanResultEmbed(result);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Store pagination data
  const dataId = `${interaction.user.id}_${Date.now()}`;
  paginationData.set(dataId, {
    products: result.zeroPriceProducts,
    storeUrl: result.storeUrl,
    storeName: result.storeName,
    totalProducts: result.productsFound
  });

  const { embed, components } = createPaginatedEmbed(
    result.zeroPriceProducts,
    0,
    result.storeUrl,
    result.storeName,
    result.productsFound,
    dataId
  );
  
  await interaction.editReply({ embeds: [embed], components });
}

async function handleScanBatchCommand(interaction: ChatInputCommandInteraction) {
  const attachment = interaction.options.getAttachment('file', true);

  // Validate file type
  if (!attachment.contentType?.includes('text') && !attachment.name.endsWith('.txt')) {
    await interaction.reply({ 
      content: '❌ Please upload a text file (.txt) with one store URL per line', 
      ephemeral: true 
    });
    return;
  }

  await interaction.deferReply();

  try {
    // Fetch and parse the file
    const response = await fetch(attachment.url);
    const fileContent = await response.text();
    
    // Parse URLs from file (one per line)
    const urls = fileContent
      .split(/\r?\n/)
      .map(url => url.trim())
      .filter(url => url.length > 0);

    if (urls.length === 0) {
      await interaction.editReply({ content: '❌ No URLs found in file. Please provide at least one URL per line.' });
      return;
    }

    if (urls.length > 25) {
      await interaction.editReply({ 
        content: `❌ Too many URLs! Found ${urls.length} URLs but maximum is 25. Please reduce the number of stores in your file.` 
      });
      return;
    }

    // Create progress callback
    const onProgress = async (current: number, total: number, storeName: string) => {
      const progressBar = createProgressBar(current, total);
      const embed = new EmbedBuilder()
        .setTitle('🔄 Batch Scan in Progress')
        .setColor(0x3b82f6)
        .setDescription(`Scanning store **${current}** of **${total}**\n\n${progressBar}\n\nCurrent: \`${storeName}\``)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    };

    const batchResponse = await scanMultipleStores(urls, onProgress);
    
    const embeds = createBatchResultEmbeds(batchResponse);
    await interaction.editReply({ embeds });
  } catch (error) {
    console.error('Error processing file:', error);
    await interaction.editReply({ 
      content: '❌ Failed to read the file. Please make sure it\'s a valid text file with one URL per line.' 
    });
  }
}

function createProgressBar(current: number, total: number): string {
  const percentage = Math.floor((current / total) * 100);
  const filled = Math.floor((current / total) * 20); // 20 character bar
  const empty = 20 - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  return `\`${bar}\` ${percentage}%`;
}

const ITEMS_PER_PAGE = 5;

function createBulkAddToCartUrls(products: ZeroPriceProduct[], storeUrl: string): string[] {
  const MAX_URL_LENGTH = 1900; // Safe limit for Discord and browsers
  const urls: string[] = [];
  let currentVariants: string[] = [];
  
  for (const product of products) {
    const variantParam = `${product.variantId}:1`;
    currentVariants.push(variantParam);
    
    // Build URL to check length
    const testUrl = `${storeUrl}/cart/${currentVariants.join(',')}`;
    
    if (testUrl.length > MAX_URL_LENGTH) {
      // Remove last variant and create URL
      currentVariants.pop();
      if (currentVariants.length > 0) {
        urls.push(`${storeUrl}/cart/${currentVariants.join(',')}`);
      }
      // Start new URL with the current variant
      currentVariants = [variantParam];
    }
  }
  
  // Add remaining variants
  if (currentVariants.length > 0) {
    urls.push(`${storeUrl}/cart/${currentVariants.join(',')}`);
  }
  
  return urls;
}

function createPaginatedEmbed(
  products: ZeroPriceProduct[],
  page: number,
  storeUrl: string,
  storeName: string,
  totalProducts: number,
  dataId: string
): { embed: EmbedBuilder, components: ActionRowBuilder<ButtonBuilder>[] } {
  const totalPages = Math.ceil(products.length / ITEMS_PER_PAGE);
  const start = page * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, products.length);
  const pageProducts = products.slice(start, end);

  const embed = new EmbedBuilder()
    .setTitle(`🔍 Scan Results: ${storeName}`)
    .setColor(0x3b82f6)
    .setDescription(`✅ **Found ${products.length} in-stock zero-price products**`)
    .addFields({
      name: 'Total Products Scanned',
      value: totalProducts.toString(),
      inline: true
    })
    .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
    .setTimestamp();

  pageProducts.forEach((product, index) => {
    const actualIndex = start + index + 1;
    embed.addFields({
      name: `${actualIndex}. ${product.productTitle}`,
      value: `Variant: ${product.variantTitle}\nPrice: $${product.price}\n[🛒 Add to Cart](${product.productUrl})`,
      inline: false
    });
  });

  // Create navigation buttons
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  
  // Navigation row
  const navRow = new ActionRowBuilder<ButtonBuilder>();
  
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`prev|${dataId}|${page}`)
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 0)
  );
  
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`next|${dataId}|${page}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );
  
  components.push(navRow);
  
  // Bulk add-to-cart row
  const bulkRow = new ActionRowBuilder<ButtonBuilder>();
  bulkRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`bulk|${dataId}`)
      .setLabel('🛒 Get Bulk Add-to-Cart Links')
      .setStyle(ButtonStyle.Success)
  );
  
  components.push(bulkRow);

  return { embed, components };
}

async function handleButtonInteraction(interaction: any) {
  if (!interaction.isButton()) return;
  
  const parts = interaction.customId.split('|');
  const action = parts[0];
  const dataId = parts[1];
  
  if (!paginationData.has(dataId)) {
    await interaction.reply({ 
      content: '❌ This interaction has expired. Please run the scan command again.', 
      ephemeral: true 
    });
    return;
  }
  
  const data = paginationData.get(dataId)!;
  
  if (action === 'bulk') {
    await interaction.deferReply({ ephemeral: true });
    
    const urls = createBulkAddToCartUrls(data.products, data.storeUrl);
    
    let response = `🛒 **Bulk Add-to-Cart Links for ${data.storeName}**\n\n`;
    response += `Found ${data.products.length} products. `;
    
    if (urls.length === 1) {
      response += `All products fit in one URL:\n\n${urls[0]}`;
    } else {
      response += `Split into ${urls.length} URLs due to length:\n\n`;
      urls.forEach((url, index) => {
        response += `**Link ${index + 1}:**\n${url}\n\n`;
      });
    }
    
    await interaction.editReply({ content: response });
    return;
  }
  
  // Handle pagination
  const currentPage = parseInt(parts[2]);
  let newPage = currentPage;
  
  if (action === 'prev') {
    newPage = Math.max(0, currentPage - 1);
  } else if (action === 'next') {
    const totalPages = Math.ceil(data.products.length / ITEMS_PER_PAGE);
    newPage = Math.min(totalPages - 1, currentPage + 1);
  }
  
  const { embed, components } = createPaginatedEmbed(
    data.products,
    newPage,
    data.storeUrl,
    data.storeName,
    data.totalProducts,
    dataId
  );
  
  await interaction.update({ embeds: [embed], components });
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

  const failedScans = batchResponse.results.filter(r => !r.success);
  if (failedScans.length > 0) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Failed Scans')
      .setColor(0xef4444);

    failedScans.slice(0, 5).forEach(result => {
      errorEmbed.addFields({
        name: result.storeName,
        value: result.error || 'Unknown error',
        inline: false
      });
    });

    if (failedScans.length > 5) {
      errorEmbed.addFields({
        name: 'Additional Failures',
        value: `... and ${failedScans.length - 5} more failed scans`,
        inline: false
      });
    }

    embeds.push(errorEmbed);
  }

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
