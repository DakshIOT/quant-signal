import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { marketDataService } from "../services/marketDataService.js";

const router: IRouter = Router();

router.get("/market/candles", async (req: Request, res: Response) => {
  const { symbol, timeframe, limit } = req.query;

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "invalid_params", message: "symbol is required" });
    return;
  }
  if (!timeframe || typeof timeframe !== "string") {
    res.status(400).json({ error: "invalid_params", message: "timeframe is required" });
    return;
  }

  const sym = marketDataService.normalizeSymbol(symbol);
  const tf = marketDataService.normalizeTimeframe(timeframe);

  if (!marketDataService.isValidSymbol(sym)) {
    res.status(400).json({ error: "invalid_params", message: `Unsupported symbol: ${sym}` });
    return;
  }
  if (!marketDataService.isValidTimeframe(tf)) {
    res.status(400).json({ error: "invalid_params", message: `Unsupported timeframe: ${tf}` });
    return;
  }

  const parsedLimit = Math.min(500, Math.max(1, parseInt(String(limit ?? "300"), 10) || 300));

  try {
    const candles = await marketDataService.fetchCandles(sym, tf, parsedLimit);
    res.json({ symbol: sym, timeframe: tf, candles });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch candles from Kraken");
    res.status(502).json({ error: "upstream_error", message: "Failed to fetch market data" });
  }
});

router.get("/market/stream", (req: Request, res: Response) => {
  const { symbol, timeframe } = req.query;

  if (!symbol || typeof symbol !== "string" || !timeframe || typeof timeframe !== "string") {
    res.status(400).json({ error: "invalid_params", message: "symbol and timeframe are required" });
    return;
  }

  const sym = marketDataService.normalizeSymbol(symbol);
  const tf = marketDataService.normalizeTimeframe(timeframe);

  if (!marketDataService.isValidSymbol(sym) || !marketDataService.isValidTimeframe(tf)) {
    res.status(400).json({ error: "invalid_params", message: "Unsupported symbol or timeframe" });
    return;
  }

  const clientId = randomUUID();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders();

  marketDataService.subscribeSSE(sym, tf, clientId, res);

  // Send a keepalive comment every 5 seconds to prevent proxy timeout
  const keepAlive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 5_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    marketDataService.unsubscribeSSE(sym, tf, clientId);
  });
});

// Manual trigger: analyze latest closed candle immediately
router.post("/market/analyze-candle", async (req: Request, res: Response) => {
  const { symbol, timeframe } = req.body as { symbol?: string; timeframe?: string };

  if (!symbol || !timeframe) {
    res.status(400).json({ error: "invalid_params", message: "symbol and timeframe are required" });
    return;
  }

  const sym = marketDataService.normalizeSymbol(symbol);
  const tf = marketDataService.normalizeTimeframe(timeframe);

  if (!marketDataService.isValidSymbol(sym) || !marketDataService.isValidTimeframe(tf)) {
    res.status(400).json({ error: "invalid_params", message: "Unsupported symbol or timeframe" });
    return;
  }

  try {
    req.log.info({ sym, tf }, "Manual candle analysis triggered");
    const result = await marketDataService.analyzeLatestClosedCandle(sym, tf);
    res.json({ ok: true, result });
  } catch (err) {
    req.log.error({ err }, "Manual candle analysis failed");
    res.status(502).json({ error: "analysis_failed", message: String(err) });
  }
});

router.get("/market/stats", (_req: Request, res: Response) => {
  res.json({ streams: marketDataService.getStreamStats() });
});

export default router;
