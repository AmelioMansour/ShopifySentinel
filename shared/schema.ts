import { z } from "zod";
import { pgTable, serial, varchar, integer, timestamp, boolean, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Database Tables
export const scanResults = pgTable("scan_results", {
  id: serial("id").primaryKey(),
  storeUrl: varchar("store_url", { length: 500 }).notNull().unique(),
  storeName: varchar("store_name", { length: 255 }).notNull(),
  freeProductCount: integer("free_product_count").notNull().default(0),
  totalProductsScanned: integer("total_products_scanned").notNull().default(0),
  discordUsername: varchar("discord_username", { length: 100 }).notNull(),
  scannedAt: timestamp("scanned_at").notNull().defaultNow(),
});

export const backgroundScans = pgTable("background_scans", {
  id: serial("id").primaryKey(),
  filename: varchar("filename", { length: 255 }).notNull(),
  totalStores: integer("total_stores").notNull(),
  scannedStores: integer("scanned_stores").notNull().default(0),
  successfulScans: integer("successful_scans").notNull().default(0),
  failedScans: integer("failed_scans").notNull().default(0),
  storesWithFreeProducts: integer("stores_with_free_products").notNull().default(0),
  totalFreeProducts: integer("total_free_products").notNull().default(0),
  isRunning: boolean("is_running").notNull().default(true),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  startedBy: varchar("started_by", { length: 100 }).notNull(),
  errorMessage: text("error_message"),
});

// Insert schemas
export const insertScanResultSchema = createInsertSchema(scanResults).omit({
  id: true,
  scannedAt: true,
});

export const insertBackgroundScanSchema = createInsertSchema(backgroundScans).omit({
  id: true,
  scannedStores: true,
  successfulScans: true,
  failedScans: true,
  storesWithFreeProducts: true,
  totalFreeProducts: true,
  isRunning: true,
  startedAt: true,
  completedAt: true,
  errorMessage: true,
});

// Types
export type ScanResultRecord = typeof scanResults.$inferSelect;
export type InsertScanResult = z.infer<typeof insertScanResultSchema>;
export type BackgroundScan = typeof backgroundScans.$inferSelect;
export type InsertBackgroundScan = z.infer<typeof insertBackgroundScanSchema>;

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
