import type { ScanResult, BatchScanResponse, ShopifyProduct } from '@shared/schema';

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

async function tryHeadlessShopifyUrl(originalUrl: string): Promise<string | null> {
  try {
    const urlObj = new URL(originalUrl);
    const hostname = urlObj.hostname;
    
    // Try adding 'shop.' subdomain for headless Shopify stores
    if (!hostname.startsWith('shop.')) {
      const shopUrl = `${urlObj.protocol}//shop.${hostname}`;
      const response = await fetch(`${shopUrl}/products.json`);
      
      if (response.ok) {
        return shopUrl;
      }
    }
  } catch {
    // Ignore errors
  }
  
  return null;
}

export async function scanShopifyStore(url: string): Promise<ScanResult> {
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
    const productsUrl = `${normalizedUrl}/products.json`;

    let response = await fetch(productsUrl);
    let actualUrl = normalizedUrl;
    
    // If 404, try headless Shopify pattern (shop. subdomain)
    if (!response.ok && response.status === 404) {
      const headlessUrl = await tryHeadlessShopifyUrl(normalizedUrl);
      
      if (headlessUrl) {
        actualUrl = headlessUrl;
        storeName = extractStoreName(headlessUrl);
        response = await fetch(`${headlessUrl}/products.json`);
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
            errorMessage = `This does not appear to be a Shopify store. The /products.json endpoint returned 404. Please make sure you're scanning a valid Shopify store URL (e.g., store-name.myshopify.com).`;
          }
        } catch {
          // Not JSON response, likely not a Shopify store
          errorMessage = `This does not appear to be a Shopify store. The /products.json endpoint returned 404. Please make sure you're scanning a valid Shopify store URL (e.g., store-name.myshopify.com).`;
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

    const data = await response.json();
    const products: ShopifyProduct[] = data.products || [];

    const zeroPriceProducts = [];

    for (const product of products) {
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
      productsFound: products.length,
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

export async function scanMultipleStores(urls: string[]): Promise<BatchScanResponse> {
  const results: ScanResult[] = [];
  
  for (let i = 0; i < urls.length; i++) {
    const result = await scanShopifyStore(urls[i]);
    results.push(result);
    
    if (i < urls.length - 1) {
      await delay(500);
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
