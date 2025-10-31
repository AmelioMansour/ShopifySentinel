import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

interface ScanProgressProps {
  current: number;
  total: number;
}

export function ScanProgress({ current, total }: ScanProgressProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold">Scanning in progress...</h3>
              <p className="text-xs text-muted-foreground">
                {current} of {total} stores scanned
              </p>
            </div>
            <span className="text-sm font-medium">{percentage}%</span>
          </div>
          <Progress value={percentage} className="h-2" data-testid="progress-scan" />
        </div>
      </CardContent>
    </Card>
  );
}
