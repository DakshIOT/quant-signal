import WebSocket from "ws";
import type { Response } from "express";
import { randomUUID } from "crypto";
import { regimeService } from "./regimeService.js";
import { signalService } from "./signalService.js";
import { riskService } from "./riskService.js";
import { judgeService } from "./judgeService.js";
import { geminiService } from "./geminiService.js";
import { logger } from "../lib/logger.js";
import { db } from "@workspace/db";
import { analysisRunsTable, signalsTable } from "@workspace/db/schema";

const KRAKEN_REST_BASE = "https://api.kraken.com";
const KRAKEN_WS_URL = "wss://ws.kraken.com/v2";

const SUPPORTED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
const SUPPORTED_TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;

export type SupportedSymbol = typeof SUPPORTED_SYMBOLS[number];
export type SupportedTimeframe = typeof SUPPORTED_TIMEFRAMES[number];

const SYMBOL_TO_KRAKEN: Record<string, { restPair: string; wsPair: string }> = {
  BTCUSDT: { restPair: "XBTUSD", wsPair: "BTC/USD" },
  ETHUSDT: { restPair: "ETHUSD", wsPair: "ETH/USD" },
  SOLUSDT: { restPair: "SOLUSD", wsPair: "SOL/USD" },
};

const TF_TO_INTERVAL_MIN: Record<string, number> = {
  "1m": 1, "5m": 5, "15m": 15, "1h": 60,
};

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveSignalResult {
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

export type SSEEventType = "tick" | "candle_closed" | "connected" | "error" | "analysis_start";

export interface SSEPayload {
  type: SSEEventType;
  symbol: string;
  timeframe: string;
  candle: Candle;
  isClosed: boolean;
  signal?: LiveSignalResult;
  ts: number;
  message?: string;
}

interface StreamState {
  ws: WebSocket | null;
  clients: Map<string, Response>;
  latestCandle: Candle | null;
  // WS reconnect
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelay: number;
  isClosing: boolean;
  pingTimer: ReturnType<typeof setInterval> | null;
  // Timer-based candle close (primary detection)
  candleCloseTimer: ReturnType<typeof setTimeout> | null;
  lastAnalyzedCandleTime: number; // unix seconds, to avoid double-analysis
}

/** ms until the next candle boundary for a given interval (minutes) */
function msUntilNextClose(intervalMin: number): number {
  const intervalMs = intervalMin * 60 * 1000;
  const now = Date.now();
  const nextClose = Math.ceil((now + 1000) / intervalMs) * intervalMs; // +1s to avoid exact boundary
  return nextClose - now;
}

function streamKey(symbol: string, timeframe: string): string {
  return `${symbol.toUpperCase()}:${timeframe}`;
}

class MarketDataService {
  private streams = new Map<string, StreamState>();

  normalizeSymbol(raw: string): string {
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  normalizeTimeframe(raw: string): string {
    const map: Record<string, string> = {
      "1m": "1m", "1min": "1m",
      "5m": "5m", "5min": "5m",
      "15m": "15m", "15min": "15m",
      "1h": "1h", "60m": "1h",
    };
    return map[raw.toLowerCase()] ?? raw;
  }

  isValidSymbol(sym: string): boolean {
    return SUPPORTED_SYMBOLS.includes(sym.toUpperCase() as SupportedSymbol);
  }

  isValidTimeframe(tf: string): boolean {
    return SUPPORTED_TIMEFRAMES.includes(tf as SupportedTimeframe);
  }

  async fetchCandles(symbol: string, timeframe: string, limit = 300): Promise<Candle[]> {
    const sym = this.normalizeSymbol(symbol);
    const tf = this.normalizeTimeframe(timeframe);

    const krakenInfo = SYMBOL_TO_KRAKEN[sym];
    if (!krakenInfo) throw new Error(`Unsupported symbol: ${sym}`);

    const intervalMin = TF_TO_INTERVAL_MIN[tf];
    if (!intervalMin) throw new Error(`Unsupported timeframe: ${tf}`);

    const sinceTs = Math.floor(Date.now() / 1000) - limit * intervalMin * 60;
    const url = `${KRAKEN_REST_BASE}/0/public/OHLC?pair=${krakenInfo.restPair}&interval=${intervalMin}&since=${sinceTs}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Kraken REST error ${res.status}`);

    const data = (await res.json()) as {
      error: string[];
      result: Record<string, Array<[number, string, string, string, string, string, string, number]>>;
    };

    if (data.error?.length > 0) throw new Error(`Kraken API: ${data.error.join(", ")}`);

    const pairKey = Object.keys(data.result).find((k) => k !== "last");
    if (!pairKey) throw new Error("No data in Kraken response");

    return data.result[pairKey].slice(-limit).map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[6]),
    }));
  }

  /** Public: fetch the last fully-closed candle and run analysis. Used by the manual trigger endpoint. */
  async analyzeLatestClosedCandle(symbol: string, timeframe: string): Promise<LiveSignalResult> {
    const sym = this.normalizeSymbol(symbol);
    const tf = this.normalizeTimeframe(timeframe);

    logger.info({ sym, tf }, "[market] Manual analyze triggered — fetching closed candle");

    const candles = await this.fetchCandles(sym, tf, 5);
    if (candles.length < 2) throw new Error("Insufficient candle data from Kraken");

    // Second-to-last candle is the last CLOSED one
    const closedCandle = candles[candles.length - 2];

    logger.info({ sym, tf, candleTime: closedCandle.time, close: closedCandle.close }, "[market] Running analysis on closed candle");

    const result = await this.runSignalAnalysis(sym, tf, closedCandle);

    // Broadcast to any active SSE clients
    const key = streamKey(sym, tf);
    const state = this.streams.get(key);
    if (state && state.clients.size > 0) {
      this.broadcastSSE(key, {
        type: "candle_closed",
        symbol: sym,
        timeframe: tf,
        candle: closedCandle,
        isClosed: true,
        signal: result,
        ts: Date.now(),
      });
    }

    return result;
  }

  subscribeSSE(symbol: string, timeframe: string, clientId: string, res: Response): void {
    const key = streamKey(symbol, timeframe);

    if (!this.streams.has(key)) {
      this.streams.set(key, {
        ws: null,
        clients: new Map(),
        latestCandle: null,
        reconnectTimer: null,
        reconnectDelay: 1000,
        isClosing: false,
        pingTimer: null,
        candleCloseTimer: null,
        lastAnalyzedCandleTime: 0,
      });
    }

    const state = this.streams.get(key)!;
    state.clients.set(clientId, res);

    logger.info({ symbol, timeframe, clientId, totalClients: state.clients.size }, "[market] SSE client connected");

    this.sendSSE(res, {
      type: "connected",
      symbol,
      timeframe,
      candle: state.latestCandle ?? { time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 },
      isClosed: false,
      ts: Date.now(),
      message: "Connected to live market stream",
    });

    // Start WS if not running
    if (!state.ws || state.ws.readyState === WebSocket.CLOSED || state.ws.readyState === WebSocket.CLOSING) {
      this.connectWebSocket(symbol, timeframe, key);
    }

    // Start timer-based candle close detection if not already running
    if (!state.candleCloseTimer) {
      this.scheduleCandleCloseTimer(symbol, timeframe, key);
    }
  }

  unsubscribeSSE(symbol: string, timeframe: string, clientId: string): void {
    const key = streamKey(symbol, timeframe);
    const state = this.streams.get(key);
    if (!state) return;

    state.clients.delete(clientId);
    logger.info({ symbol, timeframe, clientId, remaining: state.clients.size }, "[market] SSE client disconnected");

    // Keep stream alive for 2 minutes even with no clients (they often reconnect quickly)
    if (state.clients.size === 0) {
      setTimeout(() => {
        const s = this.streams.get(key);
        if (s && s.clients.size === 0) {
          logger.info({ symbol, timeframe }, "[market] No clients remaining — tearing down stream");
          s.isClosing = true;
          if (s.pingTimer) clearInterval(s.pingTimer);
          if (s.candleCloseTimer) clearTimeout(s.candleCloseTimer);
          s.ws?.terminate();
          if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
          this.streams.delete(key);
        }
      }, 120_000); // 2 min grace period
    }
  }

  // ---------------------------------------------------------------------------
  // Timer-based candle close detection (PRIMARY mechanism)
  // ---------------------------------------------------------------------------

  private scheduleCandleCloseTimer(symbol: string, timeframe: string, key: string): void {
    const state = this.streams.get(key);
    if (!state || state.isClosing) return;

    const intervalMin = TF_TO_INTERVAL_MIN[timeframe];
    if (!intervalMin) return;

    const delay = msUntilNextClose(intervalMin);
    logger.info({ symbol, timeframe, delayMs: Math.round(delay), delayMin: (delay / 60000).toFixed(2) },
      "[market] Candle close timer scheduled");

    state.candleCloseTimer = setTimeout(async () => {
      const s = this.streams.get(key);
      if (!s || s.isClosing) return;

      logger.info({ symbol, timeframe }, "[market] ⏰ Candle close timer fired — fetching closed candle");

      try {
        const candles = await this.fetchCandles(symbol, timeframe, 5);
        if (candles.length < 2) {
          logger.warn({ symbol, timeframe }, "[market] Not enough candles returned from Kraken");
          this.scheduleCandleCloseTimer(symbol, timeframe, key);
          return;
        }

        // The second-to-last is the most recently closed candle
        const closedCandle = candles[candles.length - 2];

        // Avoid double-analysis of the same candle
        if (closedCandle.time === s.lastAnalyzedCandleTime) {
          logger.info({ symbol, timeframe, candleTime: closedCandle.time }, "[market] Candle already analyzed — skipping");
          this.scheduleCandleCloseTimer(symbol, timeframe, key);
          return;
        }

        s.lastAnalyzedCandleTime = closedCandle.time;
        logger.info({ symbol, timeframe, candleTime: closedCandle.time, close: closedCandle.close },
          "[market] 📊 Analyzing closed candle");

        // Notify clients that analysis is starting
        if (s.clients.size > 0) {
          this.broadcastSSE(key, {
            type: "analysis_start",
            symbol,
            timeframe,
            candle: closedCandle,
            isClosed: true,
            ts: Date.now(),
            message: "Candle closed — running signal analysis...",
          });
        }

        const signalResult = await this.runSignalAnalysis(symbol, timeframe, closedCandle);

        logger.info({ symbol, timeframe, signal: signalResult.signal, confidence: signalResult.confidenceScore },
          "[market] ✅ Signal analysis complete");

        if (s.clients.size > 0) {
          this.broadcastSSE(key, {
            type: "candle_closed",
            symbol,
            timeframe,
            candle: closedCandle,
            isClosed: true,
            signal: signalResult,
            ts: Date.now(),
          });
        }
      } catch (err) {
        logger.error({ err, symbol, timeframe }, "[market] ❌ Error during timer-based candle close analysis");
      }

      // Schedule next timer
      this.scheduleCandleCloseTimer(symbol, timeframe, key);
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // WebSocket (for tick data only — candle closes handled by timer above)
  // ---------------------------------------------------------------------------

  private connectWebSocket(symbol: string, timeframe: string, key: string): void {
    const state = this.streams.get(key);
    if (!state || state.isClosing) return;

    const krakenInfo = SYMBOL_TO_KRAKEN[symbol];
    const intervalMin = TF_TO_INTERVAL_MIN[timeframe];
    if (!krakenInfo || !intervalMin) return;

    logger.info({ symbol, timeframe, wsUrl: KRAKEN_WS_URL }, "[market] Connecting Kraken WebSocket");

    const ws = new WebSocket(KRAKEN_WS_URL);
    state.ws = ws;

    ws.on("open", () => {
      state.reconnectDelay = 1000;
      logger.info({ symbol, timeframe }, "[market] Kraken WS connected — subscribing to OHLC");

      ws.send(JSON.stringify({
        method: "subscribe",
        params: {
          channel: "ohlc",
          symbol: [krakenInfo.wsPair],
          interval: intervalMin,
        },
      }));

      // WS keepalive ping every 30s
      if (state.pingTimer) clearInterval(state.pingTimer);
      state.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: "ping" }));
        }
      }, 30_000);
    });

    ws.on("message", async (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          channel?: string;
          type?: string;
          method?: string;
          data?: Array<{
            symbol: string;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
            timestamp: string;
            interval_begin: string;
            interval: number;
            confirm: boolean;
          }>;
        };

        // Ignore pong/status/subscription confirmations
        if (!msg.channel || msg.channel !== "ohlc" || !msg.data?.length) return;

        const tick = msg.data[0];
        if (!tick) return;

        const candleTime = Math.floor(new Date(tick.interval_begin).getTime() / 1000);
        const candle: Candle = {
          time: candleTime,
          open: tick.open,
          high: tick.high,
          low: tick.low,
          close: tick.close,
          volume: tick.volume,
        };

        state.latestCandle = candle;

        const s = this.streams.get(key);
        if (!s || s.clients.size === 0) return;

        if (tick.confirm) {
          // WS confirmed candle close — run analysis ONLY if timer hasn't already done it
          if (candle.time !== s.lastAnalyzedCandleTime) {
            logger.info({ symbol, timeframe, candleTime: candle.time }, "[market] WS confirmed candle close — running analysis");
            s.lastAnalyzedCandleTime = candle.time;

            this.broadcastSSE(key, {
              type: "analysis_start",
              symbol,
              timeframe,
              candle,
              isClosed: true,
              ts: Date.now(),
              message: "Candle confirmed via WebSocket — running analysis...",
            });

            this.runSignalAnalysis(symbol, timeframe, candle)
              .then((signalResult) => {
                logger.info({ symbol, timeframe, signal: signalResult.signal }, "[market] WS-triggered analysis complete");
                this.broadcastSSE(key, {
                  type: "candle_closed",
                  symbol,
                  timeframe,
                  candle,
                  isClosed: true,
                  signal: signalResult,
                  ts: Date.now(),
                });
              })
              .catch((err) => {
                logger.error({ err, symbol, timeframe }, "[market] WS-triggered analysis error");
              });
          }
        } else {
          // Tick update
          this.broadcastSSE(key, {
            type: "tick",
            symbol,
            timeframe,
            candle,
            isClosed: false,
            ts: Date.now(),
          });
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("close", (code, reason) => {
      if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
      logger.warn({ symbol, timeframe, code, reason: reason.toString() }, "[market] Kraken WS closed — scheduling reconnect");
      if (state.isClosing) return;
      this.scheduleWsReconnect(symbol, timeframe, key);
    });

    ws.on("error", (err) => {
      logger.error({ err: err.message, symbol, timeframe }, "[market] Kraken WS error");
      if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
      if (state.isClosing) return;
      ws.terminate();
    });
  }

  private scheduleWsReconnect(symbol: string, timeframe: string, key: string): void {
    const state = this.streams.get(key);
    if (!state || state.isClosing || state.clients.size === 0) return;

    const delay = Math.min(state.reconnectDelay, 30_000);
    state.reconnectDelay = Math.min(delay * 2, 30_000);
    logger.info({ symbol, timeframe, delayMs: delay }, "[market] Scheduling WS reconnect");

    state.reconnectTimer = setTimeout(() => {
      const s = this.streams.get(key);
      if (s && !s.isClosing && s.clients.size > 0) {
        this.connectWebSocket(symbol, timeframe, key);
      }
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Signal analysis pipeline
  // ---------------------------------------------------------------------------

  async runSignalAnalysis(symbol: string, timeframe: string, candle: Candle): Promise<LiveSignalResult> {
    const candleData = { ...candle };

    const regimeResult = regimeService.detectRegime({ symbol, timeframe, candleData });
    const signalResult = signalService.generateCandidateSignal({
      symbol, timeframe, regime: regimeResult.regime,
      hasScreenshot: false, hasTradeHistory: false, candleData,
    });
    const riskResult = riskService.calculateRisk({
      symbol, timeframe, regime: regimeResult.regime,
      confidenceScore: signalResult.confidenceScore, candleData,
    });
    const judgement = judgeService.judge({
      candidateSignal: signalResult.signal,
      confidenceScore: signalResult.confidenceScore,
      riskScore: riskResult.riskScore,
      regime: regimeResult.regime,
      riskRewardRatio: riskResult.riskRewardRatio,
      symbol, timeframe,
    });

    let explanation = judgement.explanation;
    if (geminiService.isConfigured()) {
      try {
        const enhanced = await geminiService.enhanceExplanation({
          symbol, timeframe,
          signal: judgement.finalSignal,
          regime: regimeResult.regime,
          confidenceScore: judgement.adjustedConfidence,
          riskScore: riskResult.riskScore,
          strategyNote: `Live candle — O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`,
          signalReasoning: signalResult.reasoning,
        });
        if (enhanced) explanation = enhanced;
      } catch {
        // fallback to deterministic
      }
    }

    const uuid = randomUUID();

    try {
      const runUuid = randomUUID();
      await db.insert(analysisRunsTable).values({
        uuid: runUuid, symbol, timeframe,
        strategyNote: `Live candle — O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}`,
      });
      await db.insert(signalsTable).values({
        uuid, analysisRunUuid: runUuid, symbol, timeframe,
        signal: judgement.finalSignal,
        confidenceScore: judgement.adjustedConfidence,
        riskScore: riskResult.riskScore,
        marketRegime: regimeResult.regime,
        explanation, invalidationZone: riskResult.invalidationZone,
        stopLossSuggestion: riskResult.stopLossSuggestion,
        finalBanner: judgement.finalBanner,
        serviceBreakdown: {
          ingestion: `O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close} V=${candle.volume.toFixed(0)}`,
          signal: signalResult.reasoning.slice(0, 2).join("; "),
          risk: riskResult.description,
          regime: regimeResult.description,
          judge: judgement.explanation.slice(0, 120),
        },
      });
    } catch (dbErr) {
      logger.warn({ dbErr }, "[market] DB insert failed (non-fatal)");
    }

    const targetZone = riskResult.stopLossSuggestion
      ? candle.close + (candle.close - riskResult.stopLossSuggestion) * 2
      : undefined;

    return {
      signal: judgement.finalSignal,
      confidenceScore: judgement.adjustedConfidence,
      riskScore: riskResult.riskScore,
      marketRegime: regimeResult.regime,
      explanation,
      invalidationZone: riskResult.invalidationZone,
      stopLossSuggestion: riskResult.stopLossSuggestion,
      targetZone,
      finalBanner: judgement.finalBanner,
      signalId: uuid,
      computedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // SSE helpers
  // ---------------------------------------------------------------------------

  private sendSSE(res: Response, payload: SSEPayload): void {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // client disconnected
    }
  }

  private broadcastSSE(key: string, payload: SSEPayload): void {
    const state = this.streams.get(key);
    if (!state) return;
    const dead: string[] = [];
    state.clients.forEach((res, clientId) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        dead.push(clientId);
      }
    });
    dead.forEach((id) => state.clients.delete(id));
  }

  getStreamStats(): Array<{ symbol: string; timeframe: string; clients: number; wsState: string; lastAnalyzed: number }> {
    const stats: Array<{ symbol: string; timeframe: string; clients: number; wsState: string; lastAnalyzed: number }> = [];
    this.streams.forEach((state, key) => {
      const [symbol, timeframe] = key.split(":");
      const wsStateMap: Record<number, string> = { 0: "connecting", 1: "open", 2: "closing", 3: "closed" };
      stats.push({
        symbol, timeframe,
        clients: state.clients.size,
        wsState: state.ws ? (wsStateMap[state.ws.readyState] ?? "unknown") : "none",
        lastAnalyzed: state.lastAnalyzedCandleTime,
      });
    });
    return stats;
  }
}

export const marketDataService = new MarketDataService();
