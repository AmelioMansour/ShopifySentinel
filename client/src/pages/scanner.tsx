import { useState } from "react";
import { ScannerInput } from "@/components/scanner-input";
import { ScanResults } from "@/components/scan-results";
import { StatsDashboard } from "@/components/stats-dashboard";
import { ScanProgress } from "@/components/scan-progress";
import { Search } from "lucide-react";
import type { BatchScanResponse } from "@shared/schema";

export default function Scanner() {
  const [scanResponse, setScanResponse] = useState<BatchScanResponse | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const handleScanComplete = (response: BatchScanResponse) => {
    setScanResponse(response);
    setIsScanning(false);
    setProgress({ current: 0, total: 0 });
  };

  const handleScanStart = (totalUrls: number) => {
    setIsScanning(true);
    setProgress({ current: 0, total: totalUrls });
    setScanResponse(null);
  };

  const handleProgressUpdate = (current: number) => {
    setProgress(prev => ({ ...prev, current }));
  };

  const handleClearResults = () => {
    setScanResponse(null);
    setProgress({ current: 0, total: 0 });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary text-primary-foreground">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Shopify Scanner</h1>
                <p className="text-xs text-muted-foreground">Find zero-price products</p>
              </div>
            </div>
            {scanResponse && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{scanResponse.totalZeroPriceProducts}</span>
                <span>items found</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <ScannerInput
          onScanComplete={handleScanComplete}
          onScanStart={handleScanStart}
          onProgressUpdate={handleProgressUpdate}
          disabled={isScanning}
        />

        {isScanning && (
          <ScanProgress current={progress.current} total={progress.total} />
        )}

        {scanResponse && (
          <>
            <StatsDashboard data={scanResponse} />
            <ScanResults
              data={scanResponse}
              onClear={handleClearResults}
            />
          </>
        )}

        {!scanResponse && !isScanning && (
          <div className="text-center py-16 space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted">
              <Search className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">No scans yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Enter a Shopify store URL above to scan for products priced at $0.00.
                You can scan multiple stores at once in batch mode.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
