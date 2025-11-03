import type { ScanResult, BatchScanResponse, ShopifyProduct } from '@shared/schema';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

// Proxy configuration and state
let proxyEnabled = true; // Always use proxies by default (we have 1000!)
let proxyList: string[] = [];
let currentProxyIndex = 0;

// Load proxy list from file on startup
function loadProxyList(): void {
  try {
    // Try multiple possible paths for the proxy file
    const possiblePaths = [
      path.join(process.cwd(), 'server', 'proxies.txt'),
      'server/proxies.txt',
      './server/proxies.txt',
    ];
    
    let proxyFilePath = '';
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        proxyFilePath = testPath;
        break;
      }
    }
    
    if (proxyFilePath && fs.existsSync(proxyFilePath)) {
      const fileContent = fs.readFileSync(proxyFilePath, 'utf-8');
      proxyList = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      console.log(`✅ Loaded ${proxyList.length} PyProxy proxies from ${proxyFilePath}`);
    } else {
      console.warn('⚠️  No proxy file found. Tried paths:', possiblePaths);
      console.warn('⚠️  Bot will work without proxies until 429 errors occur');
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

// Helper function to make fetch requests with proxy rotation and comprehensive retry logic
async function fetchWithProxy(url: string, options: RequestInit = {}, retryCount = 0, proxyRetryCount = 0): Promise<any> {
  const fetchOptions: any = { ...options };
  const MAX_RETRIES = 3; // Retry with different proxies
  const CONNECTION_TIMEOUT = 10000; // 10 seconds total timeout
  
  // Always use next proxy from rotation (proxies enabled by default)
  const proxyAgent = getNextProxy();
  if (proxyAgent) {
    fetchOptions.agent = proxyAgent;
  }
  
  // Add strict timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT);
  fetchOptions.signal = controller.signal;
  
  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);
    
    // Retry on 429 rate limit errors with exponential backoff
    if (response.status === 429 && retryCount < MAX_RETRIES && proxyList.length > 0) {
      const backoffMs = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s
      console.warn(`⚠️  HTTP 429 detected for ${url} - retrying in ${backoffMs}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await delay(backoffMs);
      return fetchWithProxy(url, options, retryCount + 1, 0);
    }
    
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    // Retry network/timeout errors with a different proxy
    if (proxyRetryCount < MAX_RETRIES && proxyList.length > 0) {
      const errorMsg = error.message || 'Unknown error';
      console.warn(`⚠️  Proxy error for ${url}: ${errorMsg} - trying different proxy (${proxyRetryCount + 1}/${MAX_RETRIES})`);
      await delay(500); // Small delay before trying next proxy
      return fetchWithProxy(url, options, retryCount, proxyRetryCount + 1);
    }
    
    // All retries exhausted, throw error
    throw error;
  }
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
    let errorMessage = 'Unknown error occurred';
    
    if (error instanceof Error) {
      // Categorize errors for better user feedback
      if (error.message.includes('aborted') || error.message.includes('timeout')) {
        errorMessage = 'Connection timeout - proxy may be slow or store is unreachable';
      } else if (error.message.includes('network socket disconnected') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Network connection failed - store may be blocking proxy IPs';
      } else if (error.message.includes('fetch failed')) {
        errorMessage = 'Request failed - proxy connection issue or invalid store URL';
      } else {
        errorMessage = error.message;
      }
    }
    
    return {
      storeUrl: normalizedUrl,
      storeName,
      success: false,
      error: errorMessage,
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
  console.log(`🔄 Starting batch scan of ${urls.length} stores using ${proxyList.length} rotating proxies`);
  
  const BATCH_SIZE = batchSize; // Process batchSize stores in parallel (10 with proxies)
  const BATCH_DELAY_MS = 1000; // 1 second delay between batches (proxies help avoid rate limiting)
  const results: ScanResult[] = [];
  
  // Process stores in batches for maximum throughput
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, Math.min(i + BATCH_SIZE, urls.length));
    
    // Scan all stores in this batch in parallel (skip proxy reset to maintain state across batch)
    const batchResults = await Promise.all(
      batch.map(url => scanShopifyStore(url, true))
    );
    
    results.push(...batchResults);
    
    // Report progress after each batch completes
    if (onProgress && batch.length > 0) {
      const storesProcessed = results.length;
      let storeName = batch[0];
      try {
        const normalized = normalizeShopifyUrl(batch[0]);
        storeName = extractStoreName(normalized);
      } catch {
        storeName = batch[0];
      }
      await onProgress(storesProcessed, urls.length, storeName);
    }
    
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
