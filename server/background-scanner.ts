import fs from 'fs/promises';
import path from 'path';
import { storage } from './storage';
import { scanShopifyStore } from './shopify-scanner';
import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

const ADMIN_CHANNEL_ID = '1434557891318124798';
const PUBLIC_RESULTS_CHANNEL_ID = '1436850851103768576'; // Public channel for free product announcements
const PROGRESS_UPDATE_INTERVAL = 1000; // Send update every 1000 stores
const PUBLIC_UPDATE_INTERVAL = 120000; // Send public updates every 2 minutes (in ms)
const STORES_FILE_PATH = path.join(process.cwd(), 'server', 'stores.txt');
const CONCURRENT_WORKERS = 10;

interface BackgroundScanState {
  isRunning: boolean;
  scanId: number | null;
  startTime: number | null;
  totalStores: number;
  scannedStores: number;
  successfulScans: number;
  failedScans: number;
  storesWithFreeProducts: number;
  totalFreeProducts: number;
  stopRequested: boolean;
}

let currentScan: BackgroundScanState = {
  isRunning: false,
  scanId: null,
  startTime: null,
  totalStores: 0,
  scannedStores: 0,
  successfulScans: 0,
  failedScans: 0,
  storesWithFreeProducts: 0,
  totalFreeProducts: 0,
  stopRequested: false,
};

export function getBackgroundScanStatus(): BackgroundScanState {
  return { ...currentScan };
}

export function stopBackgroundScan(): { success: boolean; message: string } {
  if (!currentScan.isRunning) {
    return {
      success: false,
      message: 'No background scan is currently running.',
    };
  }

  currentScan.stopRequested = true;
  
  return {
    success: true,
    message: `Stop requested for background scan. The scan will stop gracefully after completing current stores.\nProgress: ${currentScan.scannedStores}/${currentScan.totalStores} stores scanned so far.`,
  };
}

export async function startBackgroundScan(discordClient: Client, startedBy: string): Promise<{ success: boolean; message: string; scanId?: number }> {
  // Check if a scan is already running
  if (currentScan.isRunning) {
    return {
      success: false,
      message: `A background scan is already running (${currentScan.scannedStores}/${currentScan.totalStores} stores scanned)`,
    };
  }

  // Check if file exists
  try {
    await fs.access(STORES_FILE_PATH);
  } catch (error) {
    return {
      success: false,
      message: `Store list file not found at: ${STORES_FILE_PATH}\nPlease create a file at server/stores.txt with one store URL per line.`,
    };
  }

  // Read and parse the file
  let storeUrls: string[];
  try {
    const fileContent = await fs.readFile(STORES_FILE_PATH, 'utf-8');
    storeUrls = fileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Filter out empty lines and comments

    if (storeUrls.length === 0) {
      return {
        success: false,
        message: 'The stores.txt file is empty. Please add store URLs (one per line).',
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to read stores.txt: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  // Create database record for this scan
  const backgroundScan = await storage.createBackgroundScan({
    filename: 'stores.txt',
    totalStores: storeUrls.length,
    startedBy,
  });

  // Initialize scan state
  currentScan = {
    isRunning: true,
    scanId: backgroundScan.id,
    startTime: Date.now(),
    totalStores: storeUrls.length,
    scannedStores: 0,
    successfulScans: 0,
    failedScans: 0,
    storesWithFreeProducts: 0,
    totalFreeProducts: 0,
    stopRequested: false,
  };

  console.log(`🚀 Background scan started: ${storeUrls.length} stores to scan`);

  // Start the scan asynchronously (don't await) - this will handle its own cleanup
  runBackgroundScan(storeUrls, discordClient, backgroundScan.id).catch(error => {
    console.error('Background scan fatal error:', error);
  });

  return {
    success: true,
    message: `Background scan started! Scanning ${storeUrls.length.toLocaleString()} stores.\nProgress updates will be sent every ${PROGRESS_UPDATE_INTERVAL} stores.`,
    scanId: backgroundScan.id,
  };
}

async function runBackgroundScan(storeUrls: string[], discordClient: Client, scanId: number) {
  let adminChannel: TextChannel | null = null;
  let publicChannel: TextChannel | null = null;
  let lastProgressUpdate = 0;
  let lastPublicUpdate = Date.now();
  
  // Buffer for stores with free products found since last public update
  let publicUpdateBuffer: Array<{ storeName: string; freeProductCount: number }> = [];

  try {
    // Fetch admin channel inside try block
    try {
      adminChannel = await discordClient.channels.fetch(ADMIN_CHANNEL_ID) as TextChannel;
      
      // Send initial notification
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🚀 Background Scan Started')
        .setDescription(`Scanning ${storeUrls.length.toLocaleString()} stores from stores.txt`)
        .addFields(
          { name: 'Total Stores', value: storeUrls.length.toLocaleString(), inline: true },
          { name: 'Workers', value: CONCURRENT_WORKERS.toString(), inline: true },
          { name: 'Status', value: 'Running...', inline: true }
        )
        .setTimestamp();

      await adminChannel.send({ embeds: [embed] });
    } catch (channelError) {
      console.warn('⚠️  Could not fetch admin channel, progress updates will be logged only:', channelError);
      adminChannel = null; // Continue without channel updates
    }

    // Fetch public results channel
    try {
      publicChannel = await discordClient.channels.fetch(PUBLIC_RESULTS_CHANNEL_ID) as TextChannel;
      console.log('✅ Connected to public results channel');
    } catch (channelError) {
      console.warn('⚠️  Could not fetch public results channel:', channelError);
      publicChannel = null; // Continue without public updates
    }

    // Memory-efficient scanning: process stores in streaming fashion
    // Use a rolling queue but DON'T accumulate all results
    const queue = [...storeUrls];
    let completed = 0;

    const worker = async (workerId: number): Promise<void> => {
      while (queue.length > 0 && !currentScan.stopRequested) {
        const url = queue.shift();
        if (!url) break;

        const originalIndex = storeUrls.indexOf(url);

        try {
          // Scan single store
          const result = await scanShopifyStore(url);
          
          completed++;
          currentScan.scannedStores = completed;

          if (result.success) {
            currentScan.successfulScans++;
            
            // Only save stores with free products (memory efficient)
            if (result.zeroPriceProducts.length > 0) {
              currentScan.storesWithFreeProducts++;
              currentScan.totalFreeProducts += result.zeroPriceProducts.length;

              // Save to database immediately (streaming approach)
              await storage.saveScanResult({
                storeUrl: result.storeUrl,
                storeName: result.storeName,
                freeProductCount: result.zeroPriceProducts.length,
                totalProductsScanned: result.productsFound,
                discordUsername: 'Background Scan',
              });

              // Add to public update buffer
              publicUpdateBuffer.push({
                storeName: result.storeName,
                freeProductCount: result.zeroPriceProducts.length,
              });

              // Check if it's time to send public update
              const timeSinceLastPublicUpdate = Date.now() - lastPublicUpdate;
              if (publicChannel && publicUpdateBuffer.length > 0 && timeSinceLastPublicUpdate >= PUBLIC_UPDATE_INTERVAL) {
                await sendPublicUpdate(publicChannel, publicUpdateBuffer);
                publicUpdateBuffer = []; // Clear buffer
                lastPublicUpdate = Date.now();
              }
            }
          } else {
            currentScan.failedScans++;
          }

          // Send progress update every PROGRESS_UPDATE_INTERVAL stores
          if (completed - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL || completed === storeUrls.length) {
            lastProgressUpdate = completed;

            const elapsed = Date.now() - (currentScan.startTime || Date.now());
            const storesPerSecond = completed / (elapsed / 1000);
            const remainingStores = storeUrls.length - completed;
            const estimatedTimeRemaining = storesPerSecond > 0 ? remainingStores / storesPerSecond : 0;

            console.log(`📊 Progress: ${completed}/${storeUrls.length} (${((completed/storeUrls.length)*100).toFixed(1)}%) - ${storesPerSecond.toFixed(1)} stores/sec`);

            // Update database
            await storage.updateBackgroundScan(scanId, {
              scannedStores: completed,
              successfulScans: currentScan.successfulScans,
              failedScans: currentScan.failedScans,
              storesWithFreeProducts: currentScan.storesWithFreeProducts,
              totalFreeProducts: currentScan.totalFreeProducts,
            });

            // Send Discord update if channel available
            if (adminChannel) {
              try {
                const embed = new EmbedBuilder()
                  .setColor(0x0099FF)
                  .setTitle('📊 Background Scan Progress')
                  .setDescription(`Currently processing stores...`)
                  .addFields(
                    { name: 'Progress', value: `${completed.toLocaleString()}/${storeUrls.length.toLocaleString()} (${((completed/storeUrls.length)*100).toFixed(1)}%)`, inline: true },
                    { name: 'Speed', value: `${storesPerSecond.toFixed(1)} stores/sec`, inline: true },
                    { name: 'ETA', value: formatTime(estimatedTimeRemaining), inline: true },
                    { name: 'Successful', value: currentScan.successfulScans.toLocaleString(), inline: true },
                    { name: 'Failed', value: currentScan.failedScans.toLocaleString(), inline: true },
                    { name: 'Free Products Found', value: currentScan.totalFreeProducts.toLocaleString(), inline: true }
                  )
                  .setTimestamp();

                await adminChannel.send({ embeds: [embed] });
              } catch (discordError) {
                console.warn('⚠️  Could not send progress update to Discord:', discordError);
                // Don't fail the scan if Discord update fails
              }
            }
          }

        } catch (storeError) {
          // Handle per-store errors gracefully - don't let one store kill the whole scan
          console.error(`❌ Error scanning store ${url}:`, storeError);
          completed++;
          currentScan.scannedStores = completed;
          currentScan.failedScans++;
          // Continue with next store
        }
      }
    };

    // Start concurrent workers
    const workers = Array(CONCURRENT_WORKERS).fill(null).map((_, i) => worker(i));
    await Promise.all(workers);

    // Send any remaining public updates before completing
    if (publicChannel && publicUpdateBuffer.length > 0) {
      await sendPublicUpdate(publicChannel, publicUpdateBuffer);
      publicUpdateBuffer = [];
    }

    // Scan completed (either finished or stopped early)
    const elapsed = Date.now() - (currentScan.startTime || Date.now());
    const wasStopped = currentScan.stopRequested;
    
    await storage.updateBackgroundScan(scanId, {
      isRunning: false,
      completedAt: new Date(),
      scannedStores: completed,
      successfulScans: currentScan.successfulScans,
      failedScans: currentScan.failedScans,
      storesWithFreeProducts: currentScan.storesWithFreeProducts,
      totalFreeProducts: currentScan.totalFreeProducts,
      errorMessage: wasStopped ? 'Stopped by user request' : undefined,
    });

    if (wasStopped) {
      console.log(`⏹️  Background scan stopped: ${completed} stores scanned in ${formatTime(elapsed / 1000)}`);
    } else {
      console.log(`✅ Background scan completed: ${completed} stores in ${formatTime(elapsed / 1000)}`);
    }

    // Send completion notification
    if (adminChannel) {
      try {
        const embed = new EmbedBuilder()
          .setColor(wasStopped ? 0xFFA500 : 0x00FF00)
          .setTitle(wasStopped ? '⏹️ Background Scan Stopped' : '✅ Background Scan Completed')
          .setDescription(wasStopped ? 'Scan was stopped by user request.' : 'All stores have been scanned!')
          .addFields(
            { name: 'Stores Scanned', value: `${completed.toLocaleString()}/${storeUrls.length.toLocaleString()}`, inline: true },
            { name: 'Successful', value: currentScan.successfulScans.toLocaleString(), inline: true },
            { name: 'Failed', value: currentScan.failedScans.toLocaleString(), inline: true },
            { name: 'Stores with Free Products', value: currentScan.storesWithFreeProducts.toLocaleString(), inline: true },
            { name: 'Total Free Products', value: currentScan.totalFreeProducts.toLocaleString(), inline: true },
            { name: 'Time Elapsed', value: formatTime(elapsed / 1000), inline: true }
          )
          .setTimestamp();

        await adminChannel.send({ embeds: [embed] });
      } catch (discordError) {
        console.warn('⚠️  Could not send completion notification to Discord:', discordError);
      }
    }

  } catch (error) {
    // Fatal error in scan
    console.error('Background scan failed:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Try to update database with error
    try {
      await storage.updateBackgroundScan(scanId, {
        isRunning: false,
        completedAt: new Date(),
        errorMessage,
      });
    } catch (dbError) {
      console.error('Failed to update database after error:', dbError);
    }

    // Try to send error notification
    if (adminChannel) {
      try {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Background Scan Failed')
          .setDescription(`Error: ${errorMessage}`)
          .addFields(
            { name: 'Scanned Before Error', value: currentScan.scannedStores.toLocaleString(), inline: true },
            { name: 'Total Stores', value: currentScan.totalStores.toLocaleString(), inline: true }
          )
          .setTimestamp();

        await adminChannel.send({ embeds: [embed] });
      } catch (discordError) {
        console.warn('⚠️  Could not send error notification to Discord:', discordError);
      }
    }
  } finally {
    // ALWAYS reset state, even on error - prevents stuck "isRunning" status
    currentScan.isRunning = false;
  }
}

async function sendPublicUpdate(
  publicChannel: TextChannel,
  stores: Array<{ storeName: string; freeProductCount: number }>
): Promise<void> {
  if (stores.length === 0) return;

  try {
    // Sort by number of free products (highest first)
    const sortedStores = [...stores].sort((a, b) => b.freeProductCount - a.freeProductCount);

    // Create a formatted table
    const maxStores = Math.min(sortedStores.length, 20); // Limit to top 20 stores
    const tableRows = sortedStores.slice(0, maxStores).map((store, index) => {
      // Truncate store name if too long
      const storeName = store.storeName.length > 30 
        ? store.storeName.substring(0, 27) + '...' 
        : store.storeName;
      return `${index + 1}. **${storeName}** - ${store.freeProductCount} free items`;
    });

    const totalFreeItems = sortedStores.reduce((sum, s) => sum + s.freeProductCount, 0);

    const embed = new EmbedBuilder()
      .setColor(0x00D9FF) // Bright cyan
      .setTitle('🎁 Free Products Found!')
      .setDescription(
        `Found **${totalFreeItems} free products** across **${stores.length} stores** in the last ${PUBLIC_UPDATE_INTERVAL / 1000 / 60} minutes!\n\n` +
        '🔒 *Want full access to all products and stores? Subscribe for instant notifications and direct links!*'
      )
      .addFields({
        name: '📊 Top Stores with Free Items',
        value: tableRows.join('\n') || 'No stores found',
      })
      .setFooter({ 
        text: stores.length > maxStores 
          ? `Showing top ${maxStores} of ${stores.length} stores • Subscribe for full access!` 
          : 'Subscribe for instant access to all free products!'
      })
      .setTimestamp();

    await publicChannel.send({ embeds: [embed] });
    console.log(`📢 Sent public update: ${stores.length} stores with ${totalFreeItems} free products`);
  } catch (error) {
    console.error('❌ Failed to send public update:', error);
  }
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}
