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

export async function scanShopifyStore(url: string): Promise<ScanResult> {
  const scannedAt = new Date().toISOString();
  
  try {
    const normalizedUrl = normalizeShopifyUrl(url);
    const storeName = extractStoreName(normalizedUrl);
    const productsUrl = `${normalizedUrl}/products.json`;

    const response = await fetch(productsUrl);
    
    if (!response.ok) {
      return {
        storeUrl: normalizedUrl,
        storeName,
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
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
        if (price === 0 || variant.price === '0.00' || variant.price === '0') {
          zeroPriceProducts.push({
            storeUrl: normalizedUrl,
            storeName,
            productId: product.id,
            productTitle: product.title,
            productHandle: product.handle,
            variantId: variant.id,
            variantTitle: variant.title,
            price: variant.price,
            productUrl: `${normalizedUrl}/products/${product.handle}`,
            available: variant.available,
          });
        }
      }
    }

    return {
      storeUrl: normalizedUrl,
      storeName,
      success: true,
      productsFound: products.length,
      zeroPriceProducts,
      scannedAt,
    };
  } catch (error) {
    const normalizedUrl = normalizeShopifyUrl(url);
    const storeName = extractStoreName(normalizedUrl);
    
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

export async function scanMultipleStores(urls: string[]): Promise<BatchScanResponse> {
  const results = await Promise.all(
    urls.map(url => scanShopifyStore(url))
  );

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
