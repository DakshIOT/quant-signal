export interface ParsedStrategy {
  hasScreenshot: boolean;
  hasTradeHistory: boolean;
  hasStrategyNote: boolean;
  strategyNote?: string;
  screenshotFileId?: string;
  tradeFileId?: string;
  summary: string;
}

export interface AnalysisInput {
  symbol: string;
  timeframe: string;
  strategyNote?: string;
  entryPrice?: number;
  stopLoss?: number;
  target?: number;
  marketBias?: string;
  screenshotFileId?: string;
  tradeFileId?: string;
}

export class IngestionService {
  parseInput(input: AnalysisInput): ParsedStrategy {
    const hasScreenshot = !!input.screenshotFileId;
    const hasTradeHistory = !!input.tradeFileId;
    const hasStrategyNote = !!input.strategyNote && input.strategyNote.trim().length > 0;

    const contextParts: string[] = [`Symbol: ${input.symbol}, Timeframe: ${input.timeframe}`];
    if (input.marketBias) contextParts.push(`Market Bias: ${input.marketBias}`);
    if (input.entryPrice) contextParts.push(`Entry: ${input.entryPrice}`);
    if (input.stopLoss) contextParts.push(`Stop Loss: ${input.stopLoss}`);
    if (input.target) contextParts.push(`Target: ${input.target}`);
    if (hasScreenshot) contextParts.push("Chart screenshot provided");
    if (hasTradeHistory) contextParts.push("Trade history CSV provided");
    if (hasStrategyNote) contextParts.push(`Strategy: ${input.strategyNote}`);

    return {
      hasScreenshot,
      hasTradeHistory,
      hasStrategyNote,
      strategyNote: input.strategyNote,
      screenshotFileId: input.screenshotFileId,
      tradeFileId: input.tradeFileId,
      summary: contextParts.join(" | "),
    };
  }

  /**
   * Parse a trade history CSV into structured records.
   *
   * MVP limitation: uses simple comma splitting. Fields containing commas or
   * double-quoted strings (RFC 4180) are not supported. Expected columns (any
   * order, case-insensitive): date/timestamp, symbol/ticker, side/direction,
   * entry/entry_price, exit/exit_price, pnl/profit_loss.
   */
  parseTradeCSV(csvContent: string): Array<{
    date: string;
    symbol: string;
    side: string;
    entry: number;
    exit: number;
    pnl: number;
  }> {
    const lines = csvContent.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));

    const dateIdx = headers.findIndex((h) => h === "date" || h === "timestamp" || h === "time");
    const symbolIdx = headers.findIndex((h) => h === "symbol" || h === "ticker" || h === "asset");
    const sideIdx = headers.findIndex(
      (h) => h === "side" || h === "direction" || h === "type" || h === "action",
    );
    const entryIdx = headers.findIndex(
      (h) => h === "entry" || h === "entry_price" || h === "buy_price" || h === "open",
    );
    const exitIdx = headers.findIndex(
      (h) => h === "exit" || h === "exit_price" || h === "sell_price" || h === "close",
    );
    const pnlIdx = headers.findIndex(
      (h) => h === "pnl" || h === "profit" || h === "gain" || h === "pl" || h === "profit_loss",
    );

    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(",").map((c) => c.trim().replace(/['"]/g, ""));

      try {
        const date = dateIdx >= 0 ? cols[dateIdx] : new Date().toISOString().split("T")[0];
        const symbol = symbolIdx >= 0 ? cols[symbolIdx] : "UNKNOWN";
        const rawSide = sideIdx >= 0 ? cols[sideIdx].toLowerCase() : "buy";
        const VALID_SIDES = ["buy", "sell", "long", "short"] as const;
        const side = VALID_SIDES.includes(rawSide as typeof VALID_SIDES[number]) ? rawSide : "buy";
        const entry = entryIdx >= 0 ? parseFloat(cols[entryIdx]) : 0;
        const exit = exitIdx >= 0 ? parseFloat(cols[exitIdx]) : 0;
        const pnl = pnlIdx >= 0 ? parseFloat(cols[pnlIdx]) : exit - entry;

        if (!isNaN(entry) && !isNaN(exit) && !isNaN(pnl)) {
          records.push({ date, symbol, side, entry, exit, pnl });
        }
      } catch {
        continue;
      }
    }

    return records;
  }
}

export const ingestionService = new IngestionService();
