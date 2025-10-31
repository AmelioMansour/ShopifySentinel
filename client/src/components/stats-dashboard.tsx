import { Card, CardContent } from "@/components/ui/card";
import { Store, CheckCircle2, XCircle, Package } from "lucide-react";
import type { BatchScanResponse } from "@shared/schema";

interface StatsDashboardProps {
  data: BatchScanResponse;
}

export function StatsDashboard({ data }: StatsDashboardProps) {
  const stats = [
    {
      label: "Total Stores",
      value: data.totalStores,
      icon: Store,
      color: "text-foreground",
    },
    {
      label: "Successful Scans",
      value: data.successfulScans,
      icon: CheckCircle2,
      color: "text-chart-2",
    },
    {
      label: "Failed Scans",
      value: data.failedScans,
      icon: XCircle,
      color: "text-destructive",
    },
    {
      label: "$0.00 Products",
      value: data.totalZeroPriceProducts,
      icon: Package,
      color: "text-primary",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-3xl font-bold" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  {stat.value}
                </p>
              </div>
              <stat.icon className={`w-8 h-8 ${stat.color}`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
