import { db } from "@workspace/db";
import { analysisRunsTable, signalsTable } from "@workspace/db/schema";
import { randomUUID } from "crypto";
import { count } from "drizzle-orm";

const SEED_SIGNALS = [
  {
    symbol: "BTCUSDT", timeframe: "1h", signal: "Buy" as const,
    confidenceScore: 82, riskScore: 38, marketRegime: "breakout" as const,
    finalBanner: "Safe" as const, marketBias: "bullish",
    explanation: "Strong bullish momentum with breakout above key resistance. Risk parameters within acceptable range.",
    invalidationZone: "Price below 62000 invalidates this setup",
    stopLossSuggestion: 62000,
  },
  {
    symbol: "ETHUSDT", timeframe: "4h", signal: "Buy" as const,
    confidenceScore: 68, riskScore: 52, marketRegime: "trend" as const,
    finalBanner: "Caution" as const, marketBias: "bullish",
    explanation: "Uptrend intact but elevated risk due to broader market uncertainty. Reduce position size.",
    invalidationZone: "Price below 3200 invalidates this setup",
    stopLossSuggestion: 3200,
  },
  {
    symbol: "EURUSD", timeframe: "1h", signal: "Sell" as const,
    confidenceScore: 74, riskScore: 45, marketRegime: "breakdown" as const,
    finalBanner: "Safe" as const, marketBias: "bearish",
    explanation: "Bearish breakdown below key support. Short-side thesis is well-defined.",
    invalidationZone: "Price above 1.0920 invalidates this setup",
    stopLossSuggestion: 1.092,
  },
  {
    symbol: "AAPL", timeframe: "1d", signal: "Buy" as const,
    confidenceScore: 91, riskScore: 22, marketRegime: "trend" as const,
    finalBanner: "Safe" as const, marketBias: "bullish",
    explanation: "High-confidence long setup with excellent risk-to-reward ratio. Macro environment favorable.",
    invalidationZone: "Price below 178 invalidates this setup",
    stopLossSuggestion: 178,
  },
  {
    symbol: "NIFTY", timeframe: "15m", signal: "Sell" as const,
    confidenceScore: 55, riskScore: 61, marketRegime: "breakout" as const,
    finalBanner: "Caution" as const, marketBias: "bearish",
    explanation: "Potential breakdown signal but insufficient conviction. Elevated risk — consider waiting for confirmation.",
    invalidationZone: "Price above 22500 invalidates this setup",
    stopLossSuggestion: 22500,
  },
  {
    symbol: "XAUUSD", timeframe: "4h", signal: "Hold" as const,
    confidenceScore: 48, riskScore: 55, marketRegime: "ranging" as const,
    finalBanner: "Caution" as const, marketBias: "neutral",
    explanation: "Market in a ranging regime. No clear directional conviction. Better to wait for a breakout.",
    invalidationZone: "N/A — Hold signal, no active entry",
    stopLossSuggestion: undefined,
  },
];

async function seed() {
  const [existing] = await db.select({ total: count() }).from(signalsTable);
  if (existing && existing.total > 0) {
    console.log(`Database already has ${existing.total} signal(s). Skipping seed.`);
    process.exit(0);
  }

  console.log("Seeding QuantSignal database with sample signals...");

  for (const s of SEED_SIGNALS) {
    const runUuid = randomUUID();
    const sigUuid = randomUUID();

    await db.insert(analysisRunsTable).values({
      uuid: runUuid,
      symbol: s.symbol,
      timeframe: s.timeframe,
      marketBias: s.marketBias,
      status: "completed",
    });

    await db.insert(signalsTable).values({
      uuid: sigUuid,
      analysisRunUuid: runUuid,
      symbol: s.symbol,
      timeframe: s.timeframe,
      signal: s.signal,
      confidenceScore: s.confidenceScore,
      riskScore: s.riskScore,
      marketRegime: s.marketRegime,
      explanation: s.explanation,
      invalidationZone: s.invalidationZone,
      stopLossSuggestion: s.stopLossSuggestion ?? null,
      finalBanner: s.finalBanner,
      serviceBreakdown: { ingestion: "Seed data", signal: "Seed", risk: "Seed", regime: "Seed", judge: "Seed" },
    });

    console.log(`  Inserted: ${s.symbol} ${s.timeframe} → ${s.signal} (${s.confidenceScore}% conf)`);
  }

  console.log(`\nSeed complete. ${SEED_SIGNALS.length} sample signals inserted.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
