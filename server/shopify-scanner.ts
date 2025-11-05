import type { ScanResult, BatchScanResponse, ShopifyProduct } from '@shared/schema';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

// Proxy configuration and state
let proxyEnabled = false; // Disabled by default - proxies are too slow and unreliable
let proxyList: string[] = [];
let currentProxyIndex = 0;

// Load proxy list from file on startup
function loadProxyList(): void {
  try {
    // Try PyProxy first (faster), then fall back to IPRoyal
    const possiblePaths = [
      { path: path.join(process.cwd(), 'server', 'proxies.txt'), type: 'PyProxy' },
      { path: 'server/proxies.txt', type: 'PyProxy' },
      { path: './server/proxies.txt', type: 'PyProxy' },
      { path: path.join(process.cwd(), 'server', 'proxies-iproyal.txt'), type: 'IPRoyal' },
      { path: 'server/proxies-iproyal.txt', type: 'IPRoyal' },
      { path: './server/proxies-iproyal.txt', type: 'IPRoyal' },
    ];
    
    let proxyFilePath = '';
    let proxyType = '';
    for (const test of possiblePaths) {
      if (fs.existsSync(test.path)) {
        proxyFilePath = test.path;
        proxyType = test.type;
        break;
      }
    }
    
    if (proxyFilePath && fs.existsSync(proxyFilePath)) {
      const fileContent = fs.readFileSync(proxyFilePath, 'utf-8');
      proxyList = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      console.log(`✅ Loaded ${proxyList.length} ${proxyType} proxies from ${proxyFilePath}`);
    } else {
      console.warn('⚠️  No proxy file found. Tried paths:', possiblePaths.map(p => p.path));
      console.warn('⚠️  Bot will work without proxies');
    }
  } catch (error) {
    console.error('❌ Failed to load proxy list:', error);
  }
}

// Initialize proxy list on module load
loadProxyList();

// Get next proxy from rotation
function getNextProxy(): HttpsProxyAgent<string> | null {
  // If proxies are disabled, return null immediately
  if (!proxyEnabled) {
    return null;
  }
  
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
  const MAX_RETRIES = 1; // Only retry once (failing fast)
  const CONNECTION_TIMEOUT = 8000; // 8 seconds timeout
  
  const requestStart = Date.now();
  
  // Use proxy if enabled
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
    
    const requestTime = Date.now() - requestStart;
    console.log(`⏱️  Request completed in ${requestTime}ms: ${url.substring(0, 60)}...`);
    
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
    
    const requestTime = Date.now() - requestStart;
    
    // Retry network/timeout errors (with different proxy if enabled)
    if (proxyRetryCount < MAX_RETRIES) {
      const errorMsg = error.message || 'Unknown error';
      if (proxyEnabled && proxyList.length > 0) {
        console.warn(`⚠️  Request failed after ${requestTime}ms for ${url}: ${errorMsg} - trying different proxy (${proxyRetryCount + 1}/${MAX_RETRIES})`);
      } else {
        console.warn(`⚠️  Request failed after ${requestTime}ms for ${url}: ${errorMsg} - retrying (${proxyRetryCount + 1}/${MAX_RETRIES})`);
      }
      await delay(500); // Small delay before retry
      return fetchWithProxy(url, options, retryCount, proxyRetryCount + 1);
    }
    
    // All retries exhausted, throw error
    console.error(`❌ Request failed after ${requestTime}ms and ${proxyRetryCount + 1} retries: ${url}`);
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
  const scanStart = Date.now();
  const scannedAt = new Date().toISOString();
  let normalizedUrl: string;
  let storeName: string;
  
  console.log(`🔍 Starting scan for: ${url}`);
  
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

    // Fetch all products using PARALLEL pagination for maximum speed
    const MAX_PAGES = 20; // Limit to 5000 products max (20 pages × 250)
    
    // Step 1: Fetch page 1 to see if there are more pages
    const firstPageUrl = `${actualUrl}/products.json?limit=250&page=1`;
    const firstPageResponse = await fetchWithProxy(firstPageUrl);
    
    if (!firstPageResponse.ok) {
      throw new Error(`Failed to fetch products: ${firstPageResponse.statusText}`);
    }
    
    const firstPageData = await firstPageResponse.json();
    let allProducts: ShopifyProduct[] = firstPageData.products || [];
    
    // Step 2: If page 1 has 250 products, fetch remaining pages in PARALLEL
    if (allProducts.length === 250) {
      console.log(`📄 Page 1 has 250 products - fetching pages 2-${MAX_PAGES} in parallel for ${storeName}`);
      const parallelStart = Date.now();
      
      // Create array of page numbers [2, 3, 4, ..., MAX_PAGES]
      const remainingPages = Array.from({ length: MAX_PAGES - 1 }, (_, i) => i + 2);
      
      // Fetch all remaining pages in parallel
      const pagePromises = remainingPages.map(async (pageNum) => {
        try {
          const pageUrl = `${actualUrl}/products.json?limit=250&page=${pageNum}`;
          const pageResponse = await fetchWithProxy(pageUrl);
          
          if (!pageResponse.ok) {
            return [];
          }
          
          const data = await pageResponse.json();
          return data.products || [];
        } catch (error: any) {
          console.log(`⚠️  Failed to fetch page ${pageNum} for ${storeName}: ${error?.message || error}`);
          return [];
        }
      });
      
      // Wait for ALL pages to complete
      const pageResults = await Promise.all(pagePromises);
      
      // Combine all products, stopping when we hit an empty page
      for (const products of pageResults) {
        if (products.length === 0) {
          break; // Stop at first empty page
        }
        allProducts = allProducts.concat(products);
        
        // If we got less than 250, this was the last page
        if (products.length < 250) {
          break;
        }
      }
      
      const parallelTime = Date.now() - parallelStart;
      console.log(`⚡ Parallel pagination completed in ${parallelTime}ms for ${storeName} - fetched ${allProducts.length} products`);
    } else {
      console.log(`📄 Page 1 has ${allProducts.length} products - no additional pages needed for ${storeName}`);
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

    const scanTime = Date.now() - scanStart;
    console.log(`✅ Scan completed in ${scanTime}ms for ${storeName}: ${allProducts.length} products, ${zeroPriceProducts.length} free`);
    
    return {
      storeUrl: actualUrl,
      storeName,
      success: true,
      productsFound: allProducts.length,
      zeroPriceProducts,
      scannedAt,
    };
  } catch (error) {
    const scanTime = Date.now() - scanStart;
    let errorMessage = 'Unknown error occurred';
    
    if (error instanceof Error) {
      // Categorize errors for better user feedback
      if (error.message.includes('aborted') || error.message.includes('timeout')) {
        errorMessage = proxyEnabled 
          ? 'Connection timeout - proxy may be slow or store is unreachable'
          : 'Connection timeout - store may be unreachable or not a Shopify store';
      } else if (error.message.includes('network socket disconnected') || error.message.includes('ECONNREFUSED') || error.message.includes('EPROTO')) {
        errorMessage = proxyEnabled
          ? 'Network connection failed - store may be blocking proxy IPs'
          : 'Network connection failed - store may not be a Shopify store';
      } else if (error.message.includes('fetch failed')) {
        errorMessage = proxyEnabled
          ? 'Request failed - proxy connection issue or invalid store URL'
          : 'Request failed - store may not be a Shopify store or invalid URL';
      } else {
        errorMessage = error.message;
      }
    }
    
    console.log(`❌ Scan failed after ${scanTime}ms for ${storeName}: ${errorMessage}`);
    
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
  concurrentLimit: number = 10
): Promise<BatchScanResponse> {
  const totalStart = Date.now();
  console.log(`🔄 Starting rolling queue scan of ${urls.length} stores with ${concurrentLimit} concurrent workers`);
  
  const results: ScanResult[] = new Array(urls.length); // Pre-allocate array
  const queue = [...urls]; // Copy array to use as queue
  let completed = 0;
  let lastProgressUpdate = 0;
  
  // Worker function - each worker continuously pulls from queue until empty
  const worker = async (workerId: number) => {
    while (queue.length > 0) {
      const url = queue.shift(); // Get next URL from queue
      if (!url) break;
      
      const storeIndex = urls.indexOf(url);
      const storeNum = completed + 1;
      console.log(`🔄 Worker #${workerId} starting store ${storeNum}/${urls.length}: ${url}`);
      
      const storeStart = Date.now();
      const result = await scanShopifyStore(url, true);
      const storeTime = Date.now() - storeStart;
      
      results[storeIndex] = result; // Store in correct position to maintain order
      completed++;
      
      console.log(`✅ Worker #${workerId} completed store ${completed}/${urls.length} in ${storeTime}ms: ${result.storeName} (${result.zeroPriceProducts.length} free products) - ${queue.length} remaining`);
      
      // Report progress after each store completes (throttle to max 1 per second)
      const now = Date.now();
      if (onProgress && (now - lastProgressUpdate >= 1000 || completed === urls.length)) {
        lastProgressUpdate = now;
        let storeName = url;
        try {
          const normalized = normalizeShopifyUrl(url);
          storeName = extractStoreName(normalized);
        } catch {
          storeName = url;
        }
        await onProgress(completed, urls.length, storeName);
      }
    }
    
    console.log(`🏁 Worker #${workerId} finished - no more stores in queue`);
  };
  
  // Start N workers in parallel - they'll race to pull from the queue
  console.log(`🚀 Launching ${concurrentLimit} concurrent workers...`);
  const workers = Array(concurrentLimit).fill(null).map((_, i) => worker(i + 1));
  await Promise.all(workers);
  
  const successfulScans = results.filter(r => r.success).length;
  const failedScans = results.filter(r => !r.success).length;
  const totalZeroPriceProducts = results.reduce(
    (sum, r) => sum + r.zeroPriceProducts.length,
    0
  );

  const totalTime = Date.now() - totalStart;
  const avgTimePerStore = totalTime / urls.length;
  console.log(`🏁 Rolling queue scan complete: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s) | Avg ${avgTimePerStore.toFixed(0)}ms/store | ${successfulScans} success, ${failedScans} failed | ${totalZeroPriceProducts} free products found`);

  return {
    results,
    totalStores: urls.length,
    successfulScans,
    failedScans,
    totalZeroPriceProducts,
  };
}
