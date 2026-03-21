import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { useAnalyzeSetup, type AnalysisRequest } from "@workspace/api-client-react";
import { Activity, ImageIcon, FileSpreadsheet, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  symbol: z.string().min(1, "Symbol is required").toUpperCase(),
  timeframe: z.string().min(1, "Timeframe is required"),
  marketBias: z.enum(["bullish", "bearish", "neutral"]).optional(),
  entryPrice: z.union([z.literal(""), z.coerce.number().positive()]).optional(),
  stopLoss: z.union([z.literal(""), z.coerce.number().positive()]).optional(),
  target: z.union([z.literal(""), z.coerce.number().positive()]).optional(),
  strategyNote: z.string().optional(),
  screenshotFileId: z.string().optional(),
  tradeFileId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function AnalyzeSetup() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      symbol: "",
      timeframe: "1h",
      marketBias: "neutral",
      entryPrice: "",
      stopLoss: "",
      target: "",
      strategyNote: "",
      screenshotFileId: searchParams.get("screenshotFileId") || "",
      tradeFileId: searchParams.get("tradeFileId") || "",
    },
  });

  const { mutate: analyze, isPending, error } = useAnalyzeSetup({
    mutation: {
      onSuccess: (data) => {
        // Encode result as base64 to pass it to the view page without a backend DB fetch requirement
        const dataStr = btoa(encodeURIComponent(JSON.stringify(data)));
        setLocation(`/signals/${data.id}?data=${dataStr}`);
      }
    }
  });

  const onSubmit = (data: FormValues) => {
    const request: AnalysisRequest = {
      symbol: data.symbol,
      timeframe: data.timeframe,
      ...(data.marketBias && { marketBias: data.marketBias }),
      ...(data.entryPrice !== "" && data.entryPrice !== undefined && { entryPrice: data.entryPrice }),
      ...(data.stopLoss !== "" && data.stopLoss !== undefined && { stopLoss: data.stopLoss }),
      ...(data.target !== "" && data.target !== undefined && { target: data.target }),
      ...(data.strategyNote && { strategyNote: data.strategyNote }),
      ...(data.screenshotFileId && { screenshotFileId: data.screenshotFileId }),
      ...(data.tradeFileId && { tradeFileId: data.tradeFileId }),
    };
    analyze({ data: request });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analyze Setup</h1>
        <p className="text-muted-foreground mt-1">Submit your market context for AI signal validation.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <form onSubmit={form.handleSubmit(onSubmit)} className="lg:col-span-2 space-y-8 glass-panel p-6 sm:p-8 rounded-3xl">
          {error && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Analysis Failed</p>
                <p className="text-sm opacity-90">{error.message || "An unexpected error occurred"}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground/80">Symbol <span className="text-primary">*</span></label>
              <input
                {...form.register("symbol")}
                placeholder="BTCUSDT, AAPL..."
                className="w-full bg-input border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all uppercase placeholder:normal-case font-mono"
              />
              {form.formState.errors.symbol && <p className="text-destructive text-sm">{form.formState.errors.symbol.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground/80">Timeframe <span className="text-primary">*</span></label>
              <select
                {...form.register("timeframe")}
                className="w-full bg-input border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-mono appearance-none"
              >
                {["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"].map(tf => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground/80">Entry Price</label>
              <input
                type="number"
                step="any"
                {...form.register("entryPrice")}
                placeholder="0.00"
                className="w-full bg-input border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground/80">Stop Loss</label>
              <input
                type="number"
                step="any"
                {...form.register("stopLoss")}
                placeholder="0.00"
                className="w-full bg-input border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-destructive focus:border-transparent transition-all font-mono"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground/80">Target</label>
              <input
                type="number"
                step="any"
                {...form.register("target")}
                placeholder="0.00"
                className="w-full bg-input border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chart-2 focus:border-transparent transition-all font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground/80">Market Bias</label>
            <div className="grid grid-cols-3 gap-3">
              {["bullish", "neutral", "bearish"].map(bias => (
                <label key={bias} className={cn(
                  "cursor-pointer px-4 py-3 rounded-xl border text-center transition-all capitalize font-medium",
                  form.watch("marketBias") === bias 
                    ? "bg-primary/20 border-primary text-primary" 
                    : "bg-input border-border text-muted-foreground hover:bg-muted"
                )}>
                  <input type="radio" value={bias} {...form.register("marketBias")} className="hidden" />
                  {bias}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground/80">Strategy Notes</label>
            <textarea
              {...form.register("strategyNote")}
              placeholder="Describe your reasoning, specific indicator setups, or fundamental context..."
              rows={4}
              className="w-full bg-input border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all resize-none"
            />
          </div>

          <div className="space-y-4 pt-4 border-t border-border/50">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Context Attachments (Optional)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground/80">Screenshot ID</label>
                <input
                  {...form.register("screenshotFileId")}
                  placeholder="Paste file ID..."
                  className="w-full bg-input border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground/80">Trade CSV ID</label>
                <input
                  {...form.register("tradeFileId")}
                  placeholder="Paste file ID..."
                  className="w-full bg-input border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold text-lg bg-primary text-primary-foreground shadow-lg glow-primary hover:shadow-xl hover:bg-primary/90 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {isPending ? (
              <>
                <Activity className="w-5 h-5 animate-spin" />
                Analyzing Setup...
              </>
            ) : (
              <>
                <Activity className="w-5 h-5" />
                Run AI Validation
              </>
            )}
          </button>
        </form>

        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-3xl space-y-4 border-border/50 bg-accent/10">
            <h3 className="font-bold flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-primary" />
              Better with Visuals
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Upload a chart screenshot to give the AI context about support/resistance zones, trendlines, and candlestick patterns.
            </p>
            <Link href="/upload/screenshot" className="block text-center px-4 py-2 w-full rounded-lg bg-background border border-border hover:border-primary/50 hover:text-primary transition-colors text-sm font-medium">
              Upload Screenshot
            </Link>
          </div>

          <div className="glass-panel p-6 rounded-3xl space-y-4 border-border/50 bg-accent/10">
            <h3 className="font-bold flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-chart-4" />
              Add Trade History
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Link a recent trades CSV. The AI will factor in your current drawdown, win-streak, and historical edge on this asset.
            </p>
            <Link href="/upload/trades" className="block text-center px-4 py-2 w-full rounded-lg bg-background border border-border hover:border-chart-4/50 hover:text-chart-4 transition-colors text-sm font-medium">
              Upload CSV
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
