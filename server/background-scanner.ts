import fs from 'fs/promises';
import path from 'path';
import { storage } from './storage';
import { scanMultipleStores } from './shopify-scanner';
import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

const ADMIN_CHANNEL_ID = '1434557891318124798';
const PROGRESS_UPDATE_INTERVAL = 1000; // Send update every 1000 stores
const STORES_FILE_PATH = path.join(process.cwd(), 'server', 'stores.txt');

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
};

export function getBackgroundScanStatus(): BackgroundScanState {
  return { ...currentScan };
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
  };

  console.log(`🚀 Background scan started: ${storeUrls.length} stores to scan`);

  // Send initial notification to admin channel
  const adminChannel = await discordClient.channels.fetch(ADMIN_CHANNEL_ID) as TextChannel;
  if (adminChannel) {
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('🚀 Background Scan Started')
      .setDescription(`Scanning ${storeUrls.length.toLocaleString()} stores from stores.txt`)
      .addFields(
        { name: 'Started By', value: startedBy, inline: true },
        { name: 'Total Stores', value: storeUrls.length.toLocaleString(), inline: true },
        { name: 'Status', value: 'Running...', inline: true }
      )
      .setTimestamp();

    await adminChannel.send({ embeds: [embed] });
  }

  // Start the scan asynchronously (don't await)
  runBackgroundScan(storeUrls, discordClient, backgroundScan.id).catch(error => {
    console.error('Background scan error:', error);
  });

  return {
    success: true,
    message: `Background scan started! Scanning ${storeUrls.length.toLocaleString()} stores.\nProgress updates will be sent every ${PROGRESS_UPDATE_INTERVAL} stores.`,
    scanId: backgroundScan.id,
  };
}

async function runBackgroundScan(storeUrls: string[], discordClient: Client, scanId: number) {
  const adminChannel = await discordClient.channels.fetch(ADMIN_CHANNEL_ID) as TextChannel;
  let lastProgressUpdate = 0;

  try {
    // Define progress callback
    const onProgress = async (current: number, total: number, storeName: string) => {
      currentScan.scannedStores = current;

      // Send progress update every PROGRESS_UPDATE_INTERVAL stores
      if (current - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL || current === total) {
        lastProgressUpdate = current;

        const elapsed = Date.now() - (currentScan.startTime || Date.now());
        const storesPerSecond = current / (elapsed / 1000);
        const remainingStores = total - current;
        const estimatedTimeRemaining = remainingStores / storesPerSecond;

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('📊 Background Scan Progress')
          .setDescription(`Currently scanning: ${storeName}`)
          .addFields(
            { name: 'Progress', value: `${current.toLocaleString()}/${total.toLocaleString()} (${((current/total)*100).toFixed(1)}%)`, inline: true },
            { name: 'Speed', value: `${storesPerSecond.toFixed(1)} stores/sec`, inline: true },
            { name: 'ETA', value: formatTime(estimatedTimeRemaining), inline: true },
            { name: 'Successful', value: currentScan.successfulScans.toLocaleString(), inline: true },
            { name: 'Failed', value: currentScan.failedScans.toLocaleString(), inline: true },
            { name: 'Free Products Found', value: currentScan.totalFreeProducts.toLocaleString(), inline: true }
          )
          .setTimestamp();

        if (adminChannel) {
          await adminChannel.send({ embeds: [embed] });
        }

        // Update database
        await storage.updateBackgroundScan(scanId, {
          scannedStores: current,
          successfulScans: currentScan.successfulScans,
          failedScans: currentScan.failedScans,
          storesWithFreeProducts: currentScan.storesWithFreeProducts,
          totalFreeProducts: currentScan.totalFreeProducts,
        });
      }
    };

    // Run the scan with rolling concurrent queue
    const batchResult = await scanMultipleStores(storeUrls, onProgress, 10);

    // Update final statistics
    currentScan.successfulScans = batchResult.successfulScans;
    currentScan.failedScans = batchResult.failedScans;
    currentScan.storesWithFreeProducts = batchResult.results.filter(r => r.zeroPriceProducts.length > 0).length;
    currentScan.totalFreeProducts = batchResult.totalZeroPriceProducts;

    // Save results to database
    for (const result of batchResult.results) {
      if (result.success && result.zeroPriceProducts.length > 0) {
        await storage.saveScanResult({
          storeUrl: result.storeUrl,
          storeName: result.storeName,
          freeProductCount: result.zeroPriceProducts.length,
          totalProductsScanned: result.productsFound,
          discordUsername: 'Background Scan',
        });
      }
    }

    // Mark as completed
    const elapsed = Date.now() - (currentScan.startTime || Date.now());
    await storage.updateBackgroundScan(scanId, {
      isRunning: false,
      completedAt: new Date(),
      scannedStores: batchResult.totalStores,
      successfulScans: batchResult.successfulScans,
      failedScans: batchResult.failedScans,
      storesWithFreeProducts: currentScan.storesWithFreeProducts,
      totalFreeProducts: batchResult.totalZeroPriceProducts,
    });

    // Send completion notification
    if (adminChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Background Scan Completed')
        .setDescription('All stores have been scanned!')
        .addFields(
          { name: 'Total Stores', value: batchResult.totalStores.toLocaleString(), inline: true },
          { name: 'Successful', value: batchResult.successfulScans.toLocaleString(), inline: true },
          { name: 'Failed', value: batchResult.failedScans.toLocaleString(), inline: true },
          { name: 'Stores with Free Products', value: currentScan.storesWithFreeProducts.toLocaleString(), inline: true },
          { name: 'Total Free Products', value: batchResult.totalZeroPriceProducts.toLocaleString(), inline: true },
          { name: 'Time Elapsed', value: formatTime(elapsed / 1000), inline: true }
        )
        .setTimestamp();

      await adminChannel.send({ embeds: [embed] });
    }

    console.log(`✅ Background scan completed: ${batchResult.totalStores} stores in ${formatTime(elapsed / 1000)}`);

  } catch (error) {
    console.error('Background scan failed:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update database with error
    await storage.updateBackgroundScan(scanId, {
      isRunning: false,
      completedAt: new Date(),
      errorMessage,
    });

    // Send error notification
    if (adminChannel) {
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
    }
  } finally {
    // Reset state
    currentScan.isRunning = false;
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
