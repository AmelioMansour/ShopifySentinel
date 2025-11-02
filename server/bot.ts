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
  ComponentType,
  TextChannel
} from 'discord.js';
import { getUncachableDiscordClient } from './discord-client';
import { scanShopifyStore, scanMultipleStores } from './shopify-scanner';
import type { ScanResult, BatchScanResponse, ZeroPriceProduct } from '@shared/schema';
import { storage } from './storage';

let client: Client | null = null;

// Required role ID for bot commands
const REQUIRED_ROLE_ID = '1434562069893746698';
// Admin channel ID for scan results
const ADMIN_CHANNEL_ID = '1434557891318124798';

export async function startBot() {
  try {
    console.log('Starting Discord bot...');
    
    // Check for token first
    if (!process.env.DISCORD_BOT_TOKEN) {
      console.warn('⚠️  DISCORD_BOT_TOKEN not found in environment variables');
      console.warn('⚠️  Discord bot will not start. Server will continue running.');
      console.warn('⚠️  To enable the bot, add DISCORD_BOT_TOKEN to your deployment secrets.');
      return; // Exit gracefully without crashing
    }
    
    client = await getUncachableDiscordClient();

    client.on('ready', async () => {
      console.log(`✅ Bot logged in as ${client?.user?.tag}`);
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

    console.log('✅ Bot is running and listening for commands');
  } catch (error) {
    console.error('❌ Failed to start Discord bot:', error);
    console.error('❌ Server will continue running without bot functionality');
    // Don't throw - let the server continue running
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

// Store batch scan results for navigation
const batchResultsData = new Map<string, {
  results: ScanResult[],
  totalStores: number,
  successfulScans: number,
  failedScans: number,
  totalZeroPriceProducts: number
}>();

// Store batch navigation state (storeIndex and productPage per user)
const batchNavState = new Map<string, {
  storeIndex: number,
  productPage: number
}>();

// Check if user has required role
async function checkUserPermission(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({ 
      content: '❌ This command can only be used in a server.', 
      ephemeral: true 
    });
    return false;
  }

  const member = interaction.member;
  
  // Check if member has the required role
  // Discord.js guild members have a GuildMemberRoleManager with a cache property
  let hasRole = false;
  if ('roles' in member && member.roles && typeof member.roles === 'object') {
    // GuildMember from guild (has cache)
    if ('cache' in member.roles && member.roles.cache) {
      hasRole = member.roles.cache.has(REQUIRED_ROLE_ID);
    }
    // APIInteractionGuildMember (array of role IDs)
    else if (Array.isArray(member.roles)) {
      hasRole = member.roles.includes(REQUIRED_ROLE_ID);
    }
  }

  if (!hasRole) {
    await interaction.reply({ 
      content: '❌ You do not have permission to use this command. Required role is missing.', 
      ephemeral: true 
    });
    return false;
  }

  return true;
}

// Send scan results to admin channel
async function sendToAdminChannel(content: { embeds?: EmbedBuilder[], content?: string, components?: any[] }) {
  if (!client) return;
  
  try {
    const channel = await client.channels.fetch(ADMIN_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      await (channel as TextChannel).send(content);
    }
  } catch (error) {
    console.error('Error sending to admin channel:', error);
  }
}

// Create a summarized table view for admin channel
function createAdminSummaryMessage(
  username: string, 
  results: Array<{ storeUrl: string; storeName: string; freeProductCount: number; totalProducts: number }>
): string {
  // Calculate totals
  const totalFree = results.reduce((sum, r) => sum + r.freeProductCount, 0);
  const totalScanned = results.reduce((sum, r) => sum + r.totalProducts, 0);
  
  // Build table header
  let message = `📊 **Scan Summary** - Initiated by @${username}\n\n`;
  message += '```\n';
  message += 'Store                                      Free  Total\n';
  message += '─'.repeat(60) + '\n';
  
  // Add each store row
  for (const result of results) {
    const storeName = result.storeName.substring(0, 40).padEnd(40);
    const free = result.freeProductCount.toString().padStart(4);
    const total = result.totalProducts.toString().padStart(6);
    message += `${storeName} ${free}  ${total}\n`;
  }
  
  // Add summary footer
  message += '─'.repeat(60) + '\n';
  message += `TOTAL${' '.repeat(35)} ${totalFree.toString().padStart(4)}  ${totalScanned.toString().padStart(6)}\n`;
  message += '```\n';
  
  message += `\n✅ **${results.length}** store(s) scanned | **${totalFree}** free products found`;
  
  return message;
}

async function handleScanCommand(interaction: ChatInputCommandInteraction) {
  // Check permissions first
  if (!await checkUserPermission(interaction)) {
    return;
  }

  const url = interaction.options.getString('url', true);
  
  // Reply in channel that results will be sent via DM
  await interaction.reply({ 
    content: '🔍 Scanning... Results will be sent to your DMs!', 
    ephemeral: true 
  });

  const result = await scanShopifyStore(url);
  
  // Try to send results via DM
  try {
    if (!result.success || result.zeroPriceProducts.length === 0) {
      const embed = createScanResultEmbed(result);
      await interaction.user.send({ embeds: [embed] });
    } else {
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
      
      await interaction.user.send({ embeds: [embed], components });
    }
  } catch (error) {
    console.error('Error sending DM:', error);
    // Follow up if DM fails
    await interaction.followUp({ 
      content: '❌ Could not send you a DM. Please check your privacy settings to allow DMs from server members.', 
      ephemeral: true 
    });
  } finally {
    // Always send summary to admin channel, only save to database if free products found
    if (result.success) {
      try {
        // Save to database only if free products found
        if (result.zeroPriceProducts.length > 0) {
          await storage.saveScanResult({
            storeUrl: result.storeUrl,
            storeName: result.storeName,
            freeProductCount: result.zeroPriceProducts.length,
            totalProductsScanned: result.productsFound,
            discordUsername: interaction.user.username,
          });
        }

        // Send summarized table view to admin channel (always, even for 0 free products)
        const summaryMessage = createAdminSummaryMessage(interaction.user.username, [{
          storeUrl: result.storeUrl,
          storeName: result.storeName,
          freeProductCount: result.zeroPriceProducts.length,
          totalProducts: result.productsFound,
        }]);

        await sendToAdminChannel({ content: summaryMessage });
      } catch (error) {
        console.error('Error saving to database or sending to admin channel:', error);
      }
    }
  }
}

async function handleScanBatchCommand(interaction: ChatInputCommandInteraction) {
  // Check permissions first
  if (!await checkUserPermission(interaction)) {
    return;
  }
  
  await handleBatchScan(interaction, 25, 'Batch', 10); // 10 parallel stores
}

async function handleBatchScan(
  interaction: ChatInputCommandInteraction, 
  maxUrls: number,
  scanType: string,
  batchSize: number = 10
) {
  const attachment = interaction.options.getAttachment('file', true);

  // Reply in channel that scan is starting
  await interaction.reply({ 
    content: '🔍 Starting batch scan... Progress updates and results will be sent to your DMs!', 
    ephemeral: true 
  });

  // Validate file type
  if (!attachment.contentType?.includes('text') && !attachment.name.endsWith('.txt')) {
    await interaction.followUp({ 
      content: '❌ Please upload a text file (.txt) with one store URL per line',
      ephemeral: true
    });
    return;
  }

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
      await interaction.followUp({ 
        content: '❌ No URLs found in file. Please provide at least one URL per line.',
        ephemeral: true
      });
      return;
    }

    if (urls.length > maxUrls) {
      await interaction.followUp({ 
        content: `❌ Too many URLs! Found ${urls.length} URLs but maximum is ${maxUrls}. Please reduce the number of stores in your file.`,
        ephemeral: true
      });
      return;
    }

    // Store the last progress message so we can update it
    let lastProgressMessage: any = null;

    // Create progress callback - send to DM
    const onProgress = async (current: number, total: number, storeName: string) => {
      try {
        const progressBar = createProgressBar(current, total);
        const embed = new EmbedBuilder()
          .setTitle(`🔄 ${scanType} Scan in Progress`)
          .setColor(0x3b82f6)
          .setDescription(`Scanning store **${current}** of **${total}**\n\n${progressBar}\n\nCurrent: \`${storeName}\``)
          .setTimestamp();
        
        // Update or send progress in DM
        if (lastProgressMessage) {
          await lastProgressMessage.edit({ embeds: [embed] });
        } else {
          lastProgressMessage = await interaction.user.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('Error sending progress update to DM:', error);
      }
    };

    const batchResponse = await scanMultipleStores(urls, onProgress, batchSize);
    
    // Store batch results for navigation
    const batchDataId = `batch_${interaction.user.id}_${Date.now()}`;
    batchResultsData.set(batchDataId, batchResponse);
    batchNavState.set(batchDataId, { storeIndex: 0, productPage: 0 });
    
    let embedToLog;
    
    // Try to send results via DM
    try {
      // Delete progress message if it exists
      if (lastProgressMessage) {
        await lastProgressMessage.delete();
      }

      // Show summary and first store with results in DM
      const { embed, components } = createBatchNavigationEmbed(batchResponse, 0, 0, batchDataId);
      embedToLog = embed;
      await interaction.user.send({ embeds: [embed], components });
    } catch (error) {
      console.error('Error sending DM:', error);
      await interaction.followUp({ 
        content: '❌ Could not send you a DM. Please check your privacy settings to allow DMs from server members.', 
        ephemeral: true 
      });
    } finally {
      // Save to database (only stores with free items) and send summary to admin channel (all stores)
      try {
        const summaryData = [];
        
        for (const result of batchResponse.results) {
          if (result.success) {
            // Save to database only if free products found
            if (result.zeroPriceProducts.length > 0) {
              await storage.saveScanResult({
                storeUrl: result.storeUrl,
                storeName: result.storeName,
                freeProductCount: result.zeroPriceProducts.length,
                totalProductsScanned: result.productsFound,
                discordUsername: interaction.user.username,
              });
            }

            // Add all successful scans to summary (including 0 free products)
            summaryData.push({
              storeUrl: result.storeUrl,
              storeName: result.storeName,
              freeProductCount: result.zeroPriceProducts.length,
              totalProducts: result.productsFound,
            });
          }
        }

        // Send summarized table view to admin channel
        if (summaryData.length > 0) {
          const summaryMessage = createAdminSummaryMessage(interaction.user.username, summaryData);
          await sendToAdminChannel({ content: summaryMessage });
        }
      } catch (error) {
        console.error('Error saving to database or sending to admin channel:', error);
      }
    }
  } catch (error) {
    console.error('Error processing file:', error);
    await interaction.followUp({ 
      content: '❌ Failed to read the file. Please make sure it\'s a valid text file with one URL per line.',
      ephemeral: true
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
  
  // Check if we're in a DM (no guild context)
  const isInDM = !interaction.guild;
  
  const parts = interaction.customId.split('|');
  const action = parts[0];
  const dataId = parts[1];
  
  // Handle batch navigation
  if (dataId.startsWith('batch_')) {
    if (!batchResultsData.has(dataId) || !batchNavState.has(dataId)) {
      await interaction.reply({ 
        content: '❌ This interaction has expired. Please run the scan command again.', 
        ephemeral: !isInDM 
      });
      return;
    }
    
    const batchData = batchResultsData.get(dataId)!;
    const navState = batchNavState.get(dataId)!;
    const storesWithProducts = batchData.results.filter(r => r.success && r.zeroPriceProducts.length > 0);
    
    if (action === 'batchstoreprev' || action === 'batchstorenext') {
      let newStoreIndex = navState.storeIndex;
      
      if (action === 'batchstoreprev') {
        newStoreIndex = Math.max(0, navState.storeIndex - 1);
      } else if (action === 'batchstorenext') {
        newStoreIndex = Math.min(storesWithProducts.length - 1, navState.storeIndex + 1);
      }
      
      // Reset to first product page when changing stores
      navState.storeIndex = newStoreIndex;
      navState.productPage = 0;
      
      const { embed, components } = createBatchNavigationEmbed(batchData, newStoreIndex, 0, dataId);
      await interaction.update({ embeds: [embed], components });
      return;
    }
    
    if (action === 'batchprodprev' || action === 'batchprodnext') {
      const currentStore = storesWithProducts[navState.storeIndex];
      const totalProductPages = Math.ceil(currentStore.zeroPriceProducts.length / ITEMS_PER_PAGE);
      let newProductPage = navState.productPage;
      
      if (action === 'batchprodprev') {
        newProductPage = Math.max(0, navState.productPage - 1);
      } else if (action === 'batchprodnext') {
        newProductPage = Math.min(totalProductPages - 1, navState.productPage + 1);
      }
      
      navState.productPage = newProductPage;
      
      const { embed, components } = createBatchNavigationEmbed(batchData, navState.storeIndex, newProductPage, dataId);
      await interaction.update({ embeds: [embed], components });
      return;
    }
    
    if (action === 'batchbulk') {
      await interaction.deferReply({ ephemeral: !isInDM });
      
      const store = storesWithProducts[navState.storeIndex];
      
      const urls = createBulkAddToCartUrls(store.zeroPriceProducts, store.storeUrl);
      
      // Build initial response
      let response = `🛒 **Bulk Add-to-Cart Links for ${store.storeName}**\n\n`;
      response += `Found ${store.zeroPriceProducts.length} products. `;
      
      if (urls.length === 1) {
        response += `All products fit in one URL:\n\n${urls[0]}`;
        await interaction.editReply({ content: response });
      } else {
        response += `Split into ${urls.length} URLs due to length:\n\n`;
        
        // Send links in chunks to avoid Discord's 2000 character limit
        const MAX_MESSAGE_LENGTH = 1900;
        let currentMessage = response;
        let sentFirst = false;
        
        for (let i = 0; i < urls.length; i++) {
          const linkText = `**Link ${i + 1}:**\n${urls[i]}\n\n`;
          
          // Check if adding this link would exceed the limit
          if (currentMessage.length + linkText.length > MAX_MESSAGE_LENGTH) {
            // Send current message
            if (!sentFirst) {
              await interaction.editReply({ content: currentMessage });
              sentFirst = true;
            } else {
              await interaction.followUp({ content: currentMessage, ephemeral: !isInDM });
            }
            // Start new message with just this link
            currentMessage = linkText;
          } else {
            currentMessage += linkText;
          }
        }
        
        // Send remaining message
        if (!sentFirst) {
          await interaction.editReply({ content: currentMessage });
        } else if (currentMessage.trim().length > 0) {
          await interaction.followUp({ content: currentMessage, ephemeral: !isInDM });
        }
      }
      return;
    }
  }
  
  // Handle single scan pagination
  if (!paginationData.has(dataId)) {
    await interaction.reply({ 
      content: '❌ This interaction has expired. Please run the scan command again.', 
      ephemeral: !isInDM 
    });
    return;
  }
  
  const data = paginationData.get(dataId)!;
  
  if (action === 'bulk') {
    await interaction.deferReply({ ephemeral: !isInDM });
    
    const urls = createBulkAddToCartUrls(data.products, data.storeUrl);
    
    // Build initial response
    let response = `🛒 **Bulk Add-to-Cart Links for ${data.storeName}**\n\n`;
    response += `Found ${data.products.length} products. `;
    
    if (urls.length === 1) {
      response += `All products fit in one URL:\n\n${urls[0]}`;
      await interaction.editReply({ content: response });
    } else {
      response += `Split into ${urls.length} URLs due to length:\n\n`;
      
      // Send links in chunks to avoid Discord's 2000 character limit
      const MAX_MESSAGE_LENGTH = 1900;
      let currentMessage = response;
      let sentFirst = false;
      
      for (let i = 0; i < urls.length; i++) {
        const linkText = `**Link ${i + 1}:**\n${urls[i]}\n\n`;
        
        // Check if adding this link would exceed the limit
        if (currentMessage.length + linkText.length > MAX_MESSAGE_LENGTH) {
          // Send current message
          if (!sentFirst) {
            await interaction.editReply({ content: currentMessage });
            sentFirst = true;
          } else {
            await interaction.followUp({ content: currentMessage, ephemeral: !isInDM });
          }
          // Start new message with just this link
          currentMessage = linkText;
        } else {
          currentMessage += linkText;
        }
      }
      
      // Send remaining message
      if (!sentFirst) {
        await interaction.editReply({ content: currentMessage });
      } else if (currentMessage.trim().length > 0) {
        await interaction.followUp({ content: currentMessage, ephemeral: !isInDM });
      }
    }
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

function createBatchNavigationEmbed(
  batchResponse: BatchScanResponse,
  storeIndex: number,
  productPage: number,
  batchDataId: string
): { embed: EmbedBuilder, components: ActionRowBuilder<ButtonBuilder>[] } {
  const storesWithProducts = batchResponse.results.filter(r => r.success && r.zeroPriceProducts.length > 0);
  
  // Build summary embed
  const embed = new EmbedBuilder()
    .setTitle('📊 Batch Scan Results')
    .setColor(0x3b82f6)
    .addFields(
      { name: 'Total Stores Scanned', value: batchResponse.totalStores.toString(), inline: true },
      { name: 'Successful Scans', value: batchResponse.successfulScans.toString(), inline: true },
      { name: 'Failed Scans', value: batchResponse.failedScans.toString(), inline: true },
      { name: 'Total Zero-Price Products', value: batchResponse.totalZeroPriceProducts.toString(), inline: true }
    )
    .setTimestamp();
  
  // If no stores have products, show that message
  if (storesWithProducts.length === 0) {
    embed.setDescription('✅ Scan complete! No zero-price products found in any store.');
    
    const failedScans = batchResponse.results.filter(r => !r.success);
    if (failedScans.length > 0) {
      let errorText = '**Failed Stores:**\n';
      failedScans.slice(0, 5).forEach(result => {
        errorText += `• ${result.storeName}: ${result.error?.substring(0, 100) || 'Unknown error'}\n`;
      });
      if (failedScans.length > 5) {
        errorText += `... and ${failedScans.length - 5} more`;
      }
      embed.addFields({ name: '❌ Errors', value: errorText, inline: false });
    }
    
    return { embed, components: [] };
  }
  
  // Show current store details
  const currentStore = storesWithProducts[storeIndex];
  const totalProductPages = Math.ceil(currentStore.zeroPriceProducts.length / ITEMS_PER_PAGE);
  const start = productPage * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, currentStore.zeroPriceProducts.length);
  const productsToShow = currentStore.zeroPriceProducts.slice(start, end);
  
  // Add store name prominently in description
  embed.setDescription(`## 🏪 ${currentStore.storeName}\n*Store ${storeIndex + 1} of ${storesWithProducts.length}*`);
  
  embed.addFields({
    name: '🛍️ Zero-Price Products',
    value: `Found ${currentStore.zeroPriceProducts.length} in-stock products`,
    inline: true
  });
  
  embed.addFields({
    name: '📦 Total Products',
    value: currentStore.productsFound.toString(),
    inline: true
  });
  
  // Add spacing between store info and products
  embed.addFields({
    name: '\u200B',
    value: '\u200B',
    inline: false
  });
  
  // Show product details with green FREE indicator (without variants)
  productsToShow.forEach((product, index) => {
    const actualIndex = start + index + 1;
    embed.addFields({
      name: `${actualIndex}. ${product.productTitle}`,
      value: `🟢 **FREE**\n[🛒 Add to Cart](${product.productUrl})`,
      inline: false
    });
  });
  
  embed.setFooter({ text: `Store ${storeIndex + 1}/${storesWithProducts.length} • Products ${start + 1}-${end} of ${currentStore.zeroPriceProducts.length}` });
  
  // Create navigation buttons
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  
  // Store navigation row
  const storeNavRow = new ActionRowBuilder<ButtonBuilder>();
  
  storeNavRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`batchstoreprev|${batchDataId}`)
      .setLabel('◀ Previous Store')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(storeIndex === 0)
  );
  
  storeNavRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`batchstorenext|${batchDataId}`)
      .setLabel('Next Store ▶')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(storeIndex >= storesWithProducts.length - 1)
  );
  
  components.push(storeNavRow);
  
  // Product navigation row (only show if more than one page of products)
  if (totalProductPages > 1) {
    const productNavRow = new ActionRowBuilder<ButtonBuilder>();
    
    productNavRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`batchprodprev|${batchDataId}`)
        .setLabel('◀ Previous Products')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(productPage === 0)
    );
    
    productNavRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`batchprodnext|${batchDataId}`)
        .setLabel('Next Products ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(productPage >= totalProductPages - 1)
    );
    
    components.push(productNavRow);
  }
  
  // Bulk add-to-cart button for current store
  const bulkRow = new ActionRowBuilder<ButtonBuilder>();
  bulkRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`batchbulk|${batchDataId}`)
      .setLabel('🛒 Get Bulk Cart Links for This Store')
      .setStyle(ButtonStyle.Success)
  );
  
  components.push(bulkRow);
  
  return { embed, components };
}

export async function stopBot() {
  if (client) {
    client.destroy();
    client = null;
    console.log('Bot stopped');
  }
}
