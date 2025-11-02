import { type ScanResultRecord, type InsertScanResult, scanResults } from "@shared/schema";
import { db } from "./db";
import { desc } from "drizzle-orm";

export interface IStorage {
  saveScanResult(result: InsertScanResult): Promise<ScanResultRecord>;
  getRecentScans(limit?: number): Promise<ScanResultRecord[]>;
}

export class DatabaseStorage implements IStorage {
  async saveScanResult(result: InsertScanResult): Promise<ScanResultRecord> {
    const [saved] = await db.insert(scanResults).values(result).returning();
    return saved;
  }

  async getRecentScans(limit: number = 50): Promise<ScanResultRecord[]> {
    return await db.select()
      .from(scanResults)
      .orderBy(desc(scanResults.scannedAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
