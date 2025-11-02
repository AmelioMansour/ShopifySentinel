import type { ScanResult, BatchScanResponse, ShopifyProduct } from '@shared/schema';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Proxy configuration and state
let proxyEnabled = false;
let proxyList: string[] = [];
let currentProxyIndex = 0;

// Load proxy list from file on startup
function loadProxyList(): void {
  try {
    const proxyFilePath = path.join(__dirname, 'proxies.txt');
    if (fs.existsSync(proxyFilePath)) {
      const fileContent = fs.readFileSync(proxyFilePath, 'utf-8');
      proxyList = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      console.log(`✅ Loaded ${proxyList.length} PyProxy proxies from file`);
    } else {
      console.warn('⚠️  No proxy file found at server/proxies.txt');
    }
  } catch (error) {
    console.error('❌ Failed to load proxy list:', error);
  }
}

// Initialize proxy list on module load
loadProxyList();

// Get next proxy from rotation
function getNextProxy(): HttpsProxyAgent<string> | null {
  if (proxyList.length === 0) {
    return null;
  }

  const proxyString = proxyList[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;

  try {
    // Parse proxy format: host:port:username:password
    const parts = proxyString.split(':');
    if (parts.length >= 4) {
      const host = parts[0];
      const port = parts[1];
      const username = parts.slice(2, -1).join(':'); // Handle username with colons
      const password = parts[parts.length - 1];
      
      const proxyUrl = `http://${username}:${password}@${host}:${port}`;
      return new HttpsProxyAgent(proxyUrl);
    }
  } catch (error) {
    console.error('❌ Failed to parse proxy:', error);
  }

  return null;
}

// Enable proxy mode globally
function enableProxyMode(): void {
  if (!proxyEnabled) {
    proxyEnabled = true;
    console.log(`🔒 Proxy mode ENABLED - Rotating through ${proxyList.length} PyProxy proxies`);
  }
}

// Reset proxy mode (called at start of each batch scan)
function resetProxyMode(): void {
  proxyEnabled = false;
  currentProxyIndex = 0;
}

function normalizeShopifyUrl(url: string): string {
  let normalized = url.trim();
  
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  
  try {
    const urlObj = new URL(normalized);
    return `${urlObj.protocol}//${urlObj.hostname}`;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

function extractStoreName(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    return hostname.replace('.myshopify.com', '').replace(/\./g, '-');
  } catch {
    return 'Unknown Store';
  }
}

// Helper function to make fetch requests with optional proxy support
async function fetchWithProxy(url: string, options: RequestInit = {}): Promise<any> {
  const fetchOptions: any = { ...options };
  
  // Add proxy agent if proxy mode is enabled (use next proxy from rotation)
  if (proxyEnabled) {
    const proxyAgent = getNextProxy();
    if (proxyAgent) {
      fetchOptions.agent = proxyAgent;
    }
  }
  
  const response = await fetch(url, fetchOptions);
  
  // Detect 429 rate limit errors and enable proxy mode
  if (response.status === 429) {
    console.warn(`⚠️  HTTP 429 detected for ${url} - Shopify rate limit reached`);
    
    // Enable proxy mode if not already enabled
    if (!proxyEnabled) {
      enableProxyMode();
      
      // Retry the request with proxy
      if (proxyList.length > 0) {
        console.log(`🔄 Retrying request with PyProxy...`);
        await delay(2000); // Wait 2 seconds before retry
        const proxyAgent = getNextProxy();
        if (proxyAgent) {
          fetchOptions.agent = proxyAgent;
        }
        return fetch(url, fetchOptions);
      } else {
        console.warn('⚠️  No proxies available - continuing with direct connection');
      }
    }
  }
  
  return response;
}

async function tryHeadlessShopifyUrl(originalUrl: string): Promise<string | null> {
  try {
    const urlObj = new URL(originalUrl);
    const hostname = urlObj.hostname;
    
    // Try adding 'shop.' subdomain for headless Shopify stores
    if (!hostname.startsWith('shop.')) {
      const shopUrl = `${urlObj.protocol}//shop.${hostname}`;
      
      try {
        const response = await fetchWithProxy(`${shopUrl}/products.json`, { 
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
        
        if (response.ok) {
          return shopUrl;
        }
      } catch (error) {
        // Connection error or timeout - skip this subdomain
        console.log(`Failed to check shop.${hostname}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
  } catch {
    // Ignore errors
  }
  
  return null;
}

export async function scanShopifyStore(url: string, skipProxyReset = false): Promise<ScanResult> {
  // Reset proxy mode for standalone scans (not batch scans)
  if (!skipProxyReset) {
    resetProxyMode();
    console.log('🔄 Starting single store scan - proxy mode reset (direct connection)');
  }
  
  const scannedAt = new Date().toISOString();
  let normalizedUrl: string;
  let storeName: string;
  
  try {
    normalizedUrl = normalizeShopifyUrl(url);
    storeName = extractStoreName(normalizedUrl);
  } catch (error) {
    return {
      storeUrl: url,
      storeName: 'Invalid Store',
      success: false,
      error: error instanceof Error ? error.message : 'Invalid URL format',
      productsFound: 0,
      zeroPriceProducts: [],
      scannedAt,
    };
  }
  
  try {
    // Start with a test request to check if the store exists
    const testUrl = `${normalizedUrl}/products.json?limit=1`;
    let response = await fetchWithProxy(testUrl);
    let actualUrl = normalizedUrl;
    
    // If 404, try headless Shopify pattern (shop. subdomain)
    if (!response.ok && response.status === 404) {
      const headlessUrl = await tryHeadlessShopifyUrl(normalizedUrl);
      
      if (headlessUrl) {
        actualUrl = headlessUrl;
        storeName = extractStoreName(headlessUrl);
        response = await fetchWithProxy(`${headlessUrl}/products.json?limit=1`);
      }
    }
    
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      
      if (response.status === 404) {
        // Check if it's a deactivated Shopify store
        try {
          const errorData = await response.json();
          if (errorData.errors && errorData.errors === "Not Found") {
            errorMessage = `This Shopify store appears to be deactivated or temporarily unavailable. The store exists but is not currently accessible.`;
          } else {
            errorMessage = `This does not appear to be a Shopify store. The /products.json endpoint returned 404.\n\nTry scanning:\n• The .myshopify.com URL (e.g., storename.myshopify.com)\n• A subdomain like shop.domain.com or store.domain.com`;
          }
        } catch {
          // Not JSON response, likely not a Shopify store
          const hostname = new URL(actualUrl).hostname;
          const baseDomain = hostname.replace(/^(www\.|shop\.|store\.)/, '');
          errorMessage = `This does not appear to be a Shopify store. The /products.json endpoint returned 404.\n\nTry scanning:\n• ${baseDomain.split('.')[0]}.myshopify.com\n• shop.${baseDomain} or store.${baseDomain}`;
        }
      }
      
      return {
        storeUrl: actualUrl,
        storeName,
        success: false,
        error: errorMessage,
        productsFound: 0,
        zeroPriceProducts: [],
        scannedAt,
      };
    }

    // Fetch all products using pagination (Shopify limits to 250 per page)
    let allProducts: ShopifyProduct[] = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const paginatedUrl = `${actualUrl}/products.json?limit=250&page=${page}`;
      const pageResponse = await fetchWithProxy(paginatedUrl);
      
      if (!pageResponse.ok) {
        break;
      }
      
      const data = await pageResponse.json();
      const products: ShopifyProduct[] = data.products || [];
      
      if (products.length === 0) {
        hasMore = false;
      } else {
        allProducts = allProducts.concat(products);
        page++;
        
        // If we got less than 250 products, this is the last page
        if (products.length < 250) {
          hasMore = false;
        } else {
          // Add delay between pagination requests to avoid rate limiting
          await delay(500);
        }
      }
    }

    const zeroPriceProducts = [];

    for (const product of allProducts) {
      for (const variant of product.variants) {
        const price = parseFloat(variant.price);
        // Filter: only include zero-price products that are in stock
        if ((price === 0 || variant.price === '0.00' || variant.price === '0') && variant.available) {
          // Create add-to-cart URL instead of product page URL
          const addToCartUrl = `${actualUrl}/cart/${variant.id}:1`;
          
          zeroPriceProducts.push({
            storeUrl: actualUrl,
            storeName,
            productId: product.id,
            productTitle: product.title,
            productHandle: product.handle,
            variantId: variant.id,
            variantTitle: variant.title,
            price: variant.price,
            productUrl: addToCartUrl,
            available: variant.available,
          });
        }
      }
    }

    return {
      storeUrl: actualUrl,
      storeName,
      success: true,
      productsFound: allProducts.length,
      zeroPriceProducts,
      scannedAt,
    };
  } catch (error) {
    return {
      storeUrl: normalizedUrl,
      storeName,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      productsFound: 0,
      zeroPriceProducts: [],
      scannedAt,
    };
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function scanMultipleStores(
  urls: string[], 
  onProgress?: (current: number, total: number, storeName: string) => Promise<void>,
  batchSize: number = 3
): Promise<BatchScanResponse> {
  // Reset proxy mode at start of each batch scan
  resetProxyMode();
  console.log('🔄 Starting new batch scan - proxy mode reset (direct connection)');
  
  const BATCH_SIZE = batchSize; // Configurable batch size (default 3 to avoid rate limiting)
  const PROGRESS_UPDATE_INTERVAL = 10; // Update progress every 10 stores
  const BATCH_DELAY_MS = 2000; // 2 second delay between batches to avoid rate limiting
  const results: ScanResult[] = [];
  
  // Process stores in batches
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, Math.min(i + BATCH_SIZE, urls.length));
    
    // Report progress every PROGRESS_UPDATE_INTERVAL stores or on first/last batch
    const shouldUpdateProgress = i === 0 || 
                                 i % PROGRESS_UPDATE_INTERVAL === 0 || 
                                 i + BATCH_SIZE >= urls.length;
    
    if (onProgress && shouldUpdateProgress && batch.length > 0) {
      let storeName = batch[0];
      try {
        const normalized = normalizeShopifyUrl(batch[0]);
        storeName = extractStoreName(normalized);
      } catch {
        storeName = batch[0];
      }
      await onProgress(i + 1, urls.length, storeName);
    }
    
    // Scan all stores in this batch in parallel (skip proxy reset to maintain state across batch)
    const batchResults = await Promise.all(
      batch.map(url => scanShopifyStore(url, true))
    );
    
    results.push(...batchResults);
    
    // Add delay between batches (except after the last batch) to avoid rate limiting
    if (i + BATCH_SIZE < urls.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  const successfulScans = results.filter(r => r.success).length;
  const failedScans = results.filter(r => !r.success).length;
  const totalZeroPriceProducts = results.reduce(
    (sum, r) => sum + r.zeroPriceProducts.length,
    0
  );

  return {
    results,
    totalStores: urls.length,
    successfulScans,
    failedScans,
    totalZeroPriceProducts,
  };
}
