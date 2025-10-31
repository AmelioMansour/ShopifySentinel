import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Search, Loader2, List } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BatchScanResponse } from "@shared/schema";

const singleUrlSchema = z.object({
  url: z.string().url("Please enter a valid URL").refine(
    (url) => url.includes("myshopify.com") || url.includes(".com"),
    "Please enter a Shopify store URL"
  ),
});

const batchUrlSchema = z.object({
  urls: z.string().min(1, "Please enter at least one URL").transform((val) => {
    const lines = val.split("\n").map(line => line.trim()).filter(line => line.length > 0);
    return lines;
  }).refine((urls) => urls.length > 0, "Please enter at least one URL"),
});

interface ScannerInputProps {
  onScanComplete: (response: BatchScanResponse) => void;
  onScanStart: (totalUrls: number) => void;
  onProgressUpdate: (current: number) => void;
  disabled?: boolean;
}

export function ScannerInput({ onScanComplete, onScanStart, onProgressUpdate, disabled }: ScannerInputProps) {
  const [batchMode, setBatchMode] = useState(false);
  const { toast } = useToast();

  const singleForm = useForm({
    resolver: zodResolver(singleUrlSchema),
    defaultValues: { url: "" },
  });

  const batchForm = useForm({
    resolver: zodResolver(batchUrlSchema),
    defaultValues: { urls: "" },
  });

  const scanMutation = useMutation({
    mutationFn: async (urls: string[]) => {
      onScanStart(urls.length);
      const response = await apiRequest<BatchScanResponse>("POST", "/api/scan", { urls });
      return response;
    },
    onSuccess: (data) => {
      onScanComplete(data);
      toast({
        title: "Scan complete",
        description: `Found ${data.totalZeroPriceProducts} zero-price products across ${data.successfulScans} stores.`,
      });
      singleForm.reset();
      batchForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Scan failed",
        description: error.message || "An error occurred while scanning",
        variant: "destructive",
      });
    },
  });

  const onSingleSubmit = (data: z.infer<typeof singleUrlSchema>) => {
    scanMutation.mutate([data.url]);
  };

  const onBatchSubmit = (data: z.infer<typeof batchUrlSchema>) => {
    const urls = typeof data.urls === 'string' 
      ? data.urls.split("\n").map(line => line.trim()).filter(line => line.length > 0)
      : data.urls;
    
    if (urls.length === 0) {
      toast({
        title: "No URLs provided",
        description: "Please enter at least one URL",
        variant: "destructive",
      });
      return;
    }
    
    scanMutation.mutate(urls);
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Scan Shopify Stores</h2>
            <p className="text-sm text-muted-foreground">
              {batchMode ? "Enter multiple store URLs (one per line)" : "Enter a Shopify store URL to scan"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="batch-mode" className="text-sm font-medium cursor-pointer">
              Batch Mode
            </Label>
            <Switch
              id="batch-mode"
              checked={batchMode}
              onCheckedChange={setBatchMode}
              disabled={disabled}
              data-testid="switch-batch-mode"
            />
          </div>
        </div>

        {!batchMode ? (
          <Form {...singleForm}>
            <form onSubmit={singleForm.handleSubmit(onSingleSubmit)} className="space-y-4">
              <FormField
                control={singleForm.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Store URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://store-name.myshopify.com"
                        {...field}
                        disabled={disabled}
                        data-testid="input-store-url"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={disabled || scanMutation.isPending}
                className="w-full sm:w-auto"
                data-testid="button-scan-store"
              >
                {scanMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Scan Store
                  </>
                )}
              </Button>
            </form>
          </Form>
        ) : (
          <Form {...batchForm}>
            <form onSubmit={batchForm.handleSubmit(onBatchSubmit)} className="space-y-4">
              <FormField
                control={batchForm.control}
                name="urls"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Store URLs</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="https://store-1.myshopify.com&#10;https://store-2.myshopify.com&#10;https://store-3.myshopify.com"
                        className="min-h-32 resize-none"
                        {...field}
                        disabled={disabled}
                        data-testid="input-batch-urls"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {field.value ? field.value.split("\n").filter(line => line.trim()).length : 0} URLs entered
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={disabled || scanMutation.isPending}
                className="w-full sm:w-auto"
                data-testid="button-scan-batch"
              >
                {scanMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <List className="w-4 h-4 mr-2" />
                    Scan All Stores
                  </>
                )}
              </Button>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
