import { z } from "zod";

// Shopify Product Variant Schema
export const shopifyVariantSchema = z.object({
  id: z.number(),
  title: z.string(),
  price: z.string(),
  available: z.boolean().optional(),
  inventory_quantity: z.number().optional(),
});

// Shopify Product Schema
export const shopifyProductSchema = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
  vendor: z.string().optional(),
  product_type: z.string().optional(),
  variants: z.array(shopifyVariantSchema),
});

// Zero Price Product Result
export const zeroPriceProductSchema = z.object({
  storeUrl: z.string(),
  storeName: z.string(),
  productId: z.number(),
  productTitle: z.string(),
  productHandle: z.string(),
  variantId: z.number(),
  variantTitle: z.string(),
  price: z.string(),
  productUrl: z.string(),
  available: z.boolean().optional(),
});

// Scan Result Schema
export const scanResultSchema = z.object({
  storeUrl: z.string(),
  storeName: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  productsFound: z.number(),
  zeroPriceProducts: z.array(zeroPriceProductSchema),
  scannedAt: z.string(),
});

// Batch Scan Response
export const batchScanResponseSchema = z.object({
  results: z.array(scanResultSchema),
  totalStores: z.number(),
  successfulScans: z.number(),
  failedScans: z.number(),
  totalZeroPriceProducts: z.number(),
});

export type ShopifyVariant = z.infer<typeof shopifyVariantSchema>;
export type ShopifyProduct = z.infer<typeof shopifyProductSchema>;
export type ZeroPriceProduct = z.infer<typeof zeroPriceProductSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
export type BatchScanResponse = z.infer<typeof batchScanResponseSchema>;
