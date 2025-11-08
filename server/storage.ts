import { type ScanResultRecord, type InsertScanResult, scanResults, type BackgroundScan, type InsertBackgroundScan, backgroundScans } from "@shared/schema";
import { db } from "./db";
import { desc, sql, eq } from "drizzle-orm";

export interface IStorage {
  saveScanResult(result: InsertScanResult): Promise<ScanResultRecord>;
  getRecentScans(limit?: number): Promise<ScanResultRecord[]>;
  createBackgroundScan(scan: InsertBackgroundScan): Promise<BackgroundScan>;
  updateBackgroundScan(id: number, updates: Partial<BackgroundScan>): Promise<BackgroundScan>;
  getBackgroundScan(id: number): Promise<BackgroundScan | undefined>;
  getRunningBackgroundScan(): Promise<BackgroundScan | undefined>;
}

export class DatabaseStorage implements IStorage {
  async saveScanResult(result: InsertScanResult): Promise<ScanResultRecord> {
    // Upsert: Insert new record or update existing one if storeUrl already exists
    const [saved] = await db.insert(scanResults)
      .values(result)
      .onConflictDoUpdate({
        target: scanResults.storeUrl,
        set: {
          storeName: result.storeName,
          freeProductCount: result.freeProductCount,
          totalProductsScanned: result.totalProductsScanned,
          discordUsername: result.discordUsername,
          scannedAt: sql`NOW()`,
        },
      })
      .returning();
    return saved;
  }

  async getRecentScans(limit: number = 50): Promise<ScanResultRecord[]> {
    return await db.select()
      .from(scanResults)
      .orderBy(desc(scanResults.scannedAt))
      .limit(limit);
  }

  async createBackgroundScan(scan: InsertBackgroundScan): Promise<BackgroundScan> {
    const [created] = await db.insert(backgroundScans)
      .values(scan)
      .returning();
    return created;
  }

  async updateBackgroundScan(id: number, updates: Partial<BackgroundScan>): Promise<BackgroundScan> {
    const [updated] = await db.update(backgroundScans)
      .set(updates)
      .where(eq(backgroundScans.id, id))
      .returning();
    return updated;
  }

  async getBackgroundScan(id: number): Promise<BackgroundScan | undefined> {
    const [scan] = await db.select()
      .from(backgroundScans)
      .where(eq(backgroundScans.id, id))
      .limit(1);
    return scan;
  }

  async getRunningBackgroundScan(): Promise<BackgroundScan | undefined> {
    const [scan] = await db.select()
      .from(backgroundScans)
      .where(eq(backgroundScans.isRunning, true))
      .orderBy(desc(backgroundScans.startedAt))
      .limit(1);
    return scan;
  }
}

export const storage = new DatabaseStorage();
