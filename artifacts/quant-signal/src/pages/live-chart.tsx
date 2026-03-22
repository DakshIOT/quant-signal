import { useEffect, useRef, useState } from "react";
import {
  createChart, CandlestickSeries,
  type IChartApi, type ISeriesApi, type CandlestickData, type UTCTimestamp, ColorType,
} from "lightweight-charts";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Radio, RefreshCw, TrendingUp, TrendingDown, Minus,
  ShieldCheck, AlertTriangle, ShieldAlert, Clock, Wifi, WifiOff,
  Play, CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { SignalBadge } from "@/components/SignalBadge";
import { format } from "date-fns";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
const TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;
type SymbolType = typeof SYMBOLS[number];
type TimeframeType = typeof TIMEFRAMES[number];

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface LiveSignal {
  signal: string;
  confidenceScore: number;
  riskScore: number;
  marketRegime: string;
  explanation: string;
  invalidationZone: string;
  stopLossSuggestion?: number;
  targetZone?: number;
  finalBanner: string;
  signalId: string;
  computedAt: string;
}

type StreamStatus = "disconnected" | "connecting" | "connected" | "error";
type AnalysisStatus = "idle" | "waiting" | "running" | "done" | "error";

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  return price.toFixed(6);
}

function timeframeLabel(tf: TimeframeType): string {
  const map: Record<TimeframeType, string> = { "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour" };
  return map[tf];
}

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LiveChartPage() {
  const [symbol, setSymbol] = useState<SymbolType>("BTCUSDT");
  const [timeframe, setTimeframe] = useState<TimeframeType>("1m");

  // Chart state
  const [latestCandle, setLatestCandle] = useState<Candle | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isCandleLive, setIsCandleLive] = useState(false);

  // SSE state
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("disconnected");
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null);

  // Analysis state
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [latestSignal, setLatestSignal] = useState<LiveSignal | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<Date | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isManualAnalyzing, setIsManualAnalyzing] = useState(false);

  // Refs — not in state to avoid triggering re-renders
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(timeframe);

  // Keep refs in sync with state
  symbolRef.current = symbol;
  timeframeRef.current = timeframe;

  // ── Chart init (once on mount) ──────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(156, 163, 175, 1)",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: { borderColor: "rgba(255, 255, 255, 0.1)", timeVisible: true, secondsVisible: false },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#22c55e", borderDownColor: "#ef4444",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    });
    ro.observe(chartContainerRef.current);
    resizeObserverRef.current = ro;

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []); // Only run once — chart never remounts

  // ── Load history ────────────────────────────────────────────────────────────
  useEffect(() => {
    setIsLoadingHistory(true);
    setLatestCandle(null);

    console.log(`[LiveChart] Loading history for ${symbol} ${timeframe}`);

    fetch(`${BASE_URL}/api/market/candles?symbol=${symbol}&timeframe=${timeframe}&limit=300`)
      .then((r) => r.json())
      .then((data: { candles: Candle[] }) => {
        if (!seriesRef.current) return;
        const chartData: CandlestickData<UTCTimestamp>[] = data.candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open, high: c.high, low: c.low, close: c.close,
        }));
        seriesRef.current.setData(chartData);
        chartRef.current?.timeScale().scrollToRealTime();
        if (data.candles.length > 0) {
          setLatestCandle(data.candles[data.candles.length - 1]);
        }
        console.log(`[LiveChart] Loaded ${data.candles.length} candles`);
      })
      .catch((err) => {
        console.error("[LiveChart] Failed to load history:", err);
      })
      .finally(() => setIsLoadingHistory(false));
  }, [symbol, timeframe]);

  // ── SSE connection ──────────────────────────────────────────────────────────
  // Stable effect that does NOT depend on callbacks (no re-render triggering).
  // Only reruns when symbol or timeframe changes.
  useEffect(() => {
    // Reset analysis state when switching stream
    setLatestSignal(null);
    setAnalysisStatus("waiting");
    setAnalysisError(null);
    setStreamStatus("connecting");

    console.log(`[LiveChart] Connecting SSE for ${symbol} ${timeframe}`);

    const url = `${BASE_URL}/api/market/stream?symbol=${symbol}&timeframe=${timeframe}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      console.log(`[LiveChart] SSE connected for ${symbol} ${timeframe}`);
      setStreamStatus("connected");
    };

    es.onmessage = (e: MessageEvent<string>) => {
      // Ignore if this es has been superseded
      if (esRef.current !== es) return;

      let payload: {
        type: string;
        candle: Candle;
        isClosed: boolean;
        signal?: LiveSignal;
        ts: number;
        message?: string;
      };

      try {
        payload = JSON.parse(e.data) as typeof payload;
      } catch {
        return;
      }

      if (payload.type === "connected") {
        setStreamStatus("connected");
        return;
      }

      // Update price chart
      const { candle } = payload;
      setLatestCandle(candle);
      setIsCandleLive(!payload.isClosed);
      setLastTickAt(new Date(payload.ts));

      if (seriesRef.current) {
        seriesRef.current.update({
          time: candle.time as UTCTimestamp,
          open: candle.open, high: candle.high, low: candle.low, close: candle.close,
        });
        chartRef.current?.timeScale().scrollToRealTime();
      }

      // Analysis state machine
      if (payload.type === "analysis_start") {
        console.log(`[LiveChart] Analysis started for candle at ${new Date(candle.time * 1000).toISOString()}`);
        setAnalysisStatus("running");
        setAnalysisError(null);
      } else if (payload.type === "candle_closed") {
        if (payload.signal) {
          console.log(`[LiveChart] Signal received: ${payload.signal.signal} (confidence: ${payload.signal.confidenceScore}%)`);
          setLatestSignal(payload.signal);
          setLastAnalyzedAt(new Date(payload.ts));
          setAnalysisStatus("done");
          setAnalysisError(null);
        } else {
          console.log("[LiveChart] Candle closed but no signal (analysis running server-side)");
          setAnalysisStatus("running");
        }
      } else if (payload.type === "error") {
        console.error("[LiveChart] Stream error:", payload.message);
        setAnalysisStatus("error");
        setAnalysisError(payload.message ?? "Analysis failed");
      }
    };

    es.onerror = () => {
      if (esRef.current !== es) return;
      console.warn(`[LiveChart] SSE error/reconnecting for ${symbol} ${timeframe}`);
      // EventSource automatically reconnects — we just update the status
      setStreamStatus("error");
      // Give the browser a moment to reconnect, then update status
      setTimeout(() => {
        if (esRef.current === es && es.readyState !== EventSource.CLOSED) {
          setStreamStatus("connecting");
        }
      }, 2000);
    };

    return () => {
      console.log(`[LiveChart] Closing SSE for ${symbol} ${timeframe}`);
      es.close();
      // Don't clear esRef here — just close, let the next effect set a new one
    };
  }, [symbol, timeframe]); // Stable: only symbol/timeframe as deps

  // ── Manual analyze ──────────────────────────────────────────────────────────
  const handleAnalyzeNow = async () => {
    if (isManualAnalyzing) return;
    setIsManualAnalyzing(true);
    setAnalysisStatus("running");
    setAnalysisError(null);

    console.log(`[LiveChart] Manual analyze triggered for ${symbol} ${timeframe}`);

    try {
      const res = await fetch(`${BASE_URL}/api/market/analyze-candle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { message?: string };
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { ok: boolean; result: LiveSignal };
      console.log(`[LiveChart] Manual analysis result:`, data.result);

      setLatestSignal(data.result);
      setLastAnalyzedAt(new Date());
      setAnalysisStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      console.error("[LiveChart] Manual analysis failed:", msg);
      setAnalysisError(msg);
      setAnalysisStatus("error");
    } finally {
      setIsManualAnalyzing(false);
    }
  };

  // ── Derived UI state ────────────────────────────────────────────────────────
  const priceChange = latestCandle
    ? { delta: latestCandle.close - latestCandle.open, pct: ((latestCandle.close - latestCandle.open) / latestCandle.open) * 100 }
    : null;
  const isUp = priceChange ? priceChange.delta >= 0 : true;

  function getBannerIcon(banner: string) {
    if (banner === "Safe") return <ShieldCheck className="w-4 h-4 text-primary" />;
    if (banner === "Caution") return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    return <ShieldAlert className="w-4 h-4 text-destructive" />;
  }

  function statusPill() {
    switch (streamStatus) {
      case "connected":
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-primary/10 text-primary border border-primary/30">
            <Wifi className="w-3 h-3" />Live data connected
          </div>
        );
      case "connecting":
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-yellow-400/10 text-yellow-400 border border-yellow-400/30">
            <Loader2 className="w-3 h-3 animate-spin" />Connecting...
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/30">
            <WifiOff className="w-3 h-3" />Disconnected
          </div>
        );
    }
  }

  function analysisStatusBadge() {
    switch (analysisStatus) {
      case "running":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-400/10 text-yellow-400">
            <Loader2 className="w-3 h-3 animate-spin" />Running analysis...
          </div>
        );
      case "done":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
            <CheckCircle2 className="w-3 h-3" />
            {lastAnalyzedAt ? `Done at ${format(lastAnalyzedAt, "HH:mm:ss")}` : "Done"}
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-destructive/10 text-destructive">
            <XCircle className="w-3 h-3" />Analysis failed
          </div>
        );
      case "waiting":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted/40 text-muted-foreground">
            <Clock className="w-3 h-3" />Waiting for candle close
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col gap-3" style={{ height: "calc(100vh - 7rem)" }}>
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-primary animate-pulse" />
          <h1 className="text-xl font-bold tracking-tight">Live Analysis</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {/* Symbol selector */}
          <div className="flex gap-1 glass-panel rounded-xl p-1 border border-border/50">
            {SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => setSymbol(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${symbol === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {s.replace("USDT", "")}
              </button>
            ))}
          </div>

          {/* Timeframe selector */}
          <div className="flex gap-1 glass-panel rounded-xl p-1 border border-border/50">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${timeframe === tf ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Connection badge */}
          {statusPill()}

          {/* Analyze Now button */}
          <button
            onClick={handleAnalyzeNow}
            disabled={isManualAnalyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-border/50 glass-panel hover:border-primary/40 hover:text-primary transition-all disabled:opacity-50"
          >
            {isManualAnalyzing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Play className="w-3.5 h-3.5" />
            }
            Analyze Now
          </button>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* ── Chart ── */}
        <div className="flex-1 glass-panel rounded-2xl border border-border/50 overflow-hidden relative min-w-0">
          {isLoadingHistory && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <RefreshCw className="w-7 h-7 text-primary animate-spin" />
            </div>
          )}

          {/* Chart overlay: symbol + price */}
          <div className="absolute top-3 left-4 z-10 flex items-center gap-3 pointer-events-none">
            <span className="text-xs font-bold tracking-wider text-muted-foreground">{symbol} · {timeframe}</span>
            {latestCandle && (
              <span className={`text-base font-mono font-black ${isUp ? "text-green-400" : "text-red-400"}`}>
                {formatPrice(latestCandle.close)}
              </span>
            )}
            {priceChange && (
              <span className={`text-xs font-semibold flex items-center gap-1 ${isUp ? "text-green-400" : "text-red-400"}`}>
                {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {isUp ? "+" : ""}{priceChange.pct.toFixed(2)}%
              </span>
            )}
            {lastTickAt && (
              <span className="text-xs text-muted-foreground/50">
                {format(lastTickAt, "HH:mm:ss")}
              </span>
            )}
          </div>

          <div ref={chartContainerRef} className="w-full h-full" />
        </div>

        {/* ── Analysis panel ── */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">

          {/* Price card */}
          <div className="glass-panel rounded-2xl p-4 border border-border/50">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Current Price</p>
            <div className="flex items-end gap-2">
              <span className={`text-2xl font-black font-mono leading-none ${isUp ? "text-green-400" : "text-red-400"}`}>
                {latestCandle ? formatPrice(latestCandle.close) : "—"}
              </span>
              {priceChange && (
                <span className={`text-xs font-bold pb-0.5 ${isUp ? "text-green-400" : "text-red-400"}`}>
                  {isUp ? "▲" : "▼"} {Math.abs(priceChange.pct).toFixed(2)}%
                </span>
              )}
            </div>
            <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
              <span>H: <span className="text-foreground font-mono">{latestCandle ? formatPrice(latestCandle.high) : "—"}</span></span>
              <span>L: <span className="text-foreground font-mono">{latestCandle ? formatPrice(latestCandle.low) : "—"}</span></span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              <span>Open: <span className="text-foreground font-mono">{latestCandle ? formatPrice(latestCandle.open) : "—"}</span></span>
              <span>Vol: <span className="text-foreground font-mono">{latestCandle ? latestCandle.volume.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "—"}</span></span>
            </div>
          </div>

          {/* Status card */}
          <div className="glass-panel rounded-2xl p-4 border border-border/50 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {isCandleLive
                  ? <span className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
                  : <span className="w-2 h-2 rounded-full bg-muted flex-shrink-0" />
                }
                <span className="text-xs text-foreground">{isCandleLive ? `Candle forming (${timeframe})` : "Candle closed"}</span>
              </div>
              {analysisStatusBadge()}
              {analysisError && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-lg p-2">{analysisError}</p>
              )}
            </div>
            {lastAnalyzedAt && (
              <p className="text-xs text-muted-foreground/60 pt-1">
                Last analysis: {format(lastAnalyzedAt, "HH:mm:ss")} UTC
              </p>
            )}
            <p className="text-xs text-muted-foreground/40">Analysis runs every {timeframeLabel(timeframe)}</p>
          </div>

          {/* Signal panel */}
          <AnimatePresence mode="wait">
            {analysisStatus === "running" && !latestSignal ? (
              <motion.div
                key="analyzing"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="glass-panel rounded-2xl p-5 border border-yellow-400/30 flex flex-col items-center gap-3"
              >
                <Activity className="w-8 h-8 text-yellow-400 animate-pulse" />
                <p className="text-sm font-semibold text-yellow-400">Running Analysis</p>
                <p className="text-xs text-muted-foreground text-center">Processing closed candle through signal engine...</p>
              </motion.div>
            ) : latestSignal ? (
              <motion.div
                key={latestSignal.signalId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="glass-panel rounded-2xl p-4 border border-border/50 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Signal</p>
                  <div className="flex items-center gap-1.5">
                    {getBannerIcon(latestSignal.finalBanner)}
                    <span className="text-xs font-bold text-muted-foreground">{latestSignal.finalBanner}</span>
                  </div>
                </div>

                <SignalBadge signal={latestSignal.signal} size="lg" />

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-muted/30 p-2.5">
                    <p className="text-xs text-muted-foreground">Confidence</p>
                    <p className="text-xl font-black font-mono">{latestSignal.confidenceScore}%</p>
                  </div>
                  <div className="rounded-xl bg-muted/30 p-2.5">
                    <p className="text-xs text-muted-foreground">Risk</p>
                    <p className="text-xl font-black font-mono text-destructive">{latestSignal.riskScore}%</p>
                  </div>
                </div>

                <div className="rounded-xl bg-muted/20 p-2.5">
                  <p className="text-xs text-muted-foreground mb-0.5">Regime</p>
                  <p className="text-sm font-bold capitalize">{latestSignal.marketRegime}</p>
                </div>

                {latestSignal.stopLossSuggestion && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-destructive/10 p-2 border border-destructive/20">
                      <p className="text-xs text-destructive font-semibold mb-0.5">Stop Loss</p>
                      <p className="text-xs font-mono font-bold">{formatPrice(latestSignal.stopLossSuggestion)}</p>
                    </div>
                    {latestSignal.targetZone && (
                      <div className="rounded-lg bg-primary/10 p-2 border border-primary/20">
                        <p className="text-xs text-primary font-semibold mb-0.5">Target</p>
                        <p className="text-xs font-mono font-bold">{formatPrice(latestSignal.targetZone)}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="rounded-xl bg-muted/10 p-2.5 border border-border/30">
                  <p className="text-xs text-muted-foreground mb-1">Invalidation</p>
                  <p className="text-xs text-foreground/80 leading-relaxed">{latestSignal.invalidationZone}</p>
                </div>

                <div className="text-xs leading-relaxed text-muted-foreground border-t border-border/30 pt-2">
                  {latestSignal.explanation.length > 200
                    ? `${latestSignal.explanation.slice(0, 200)}…`
                    : latestSignal.explanation}
                </div>

                {lastAnalyzedAt && (
                  <p className="text-xs text-muted-foreground/50 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Analyzed at {format(lastAnalyzedAt, "HH:mm:ss")}
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="waiting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass-panel rounded-2xl p-5 border border-border/50 flex flex-col items-center gap-3 text-center"
              >
                <Minus className="w-7 h-7 text-muted-foreground/30" />
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">Waiting for candle close</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Analysis runs automatically every {timeframeLabel(timeframe)}
                  </p>
                  <p className="text-xs text-muted-foreground/40 mt-2">
                    Or click "Analyze Now" to run immediately
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="text-xs text-center text-muted-foreground/30 pb-1">
            Data via Kraken · Real-time streaming
          </p>
        </div>
      </div>
    </div>
  );
}
