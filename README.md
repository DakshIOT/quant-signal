<div align="center">

# QuantSignal

**AI-powered live market signal validation platform for crypto traders, quants, and researchers.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-5-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://orm.drizzle.team/)
[![Gemini](https://img.shields.io/badge/AI-Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)

[Live Demo](https://dakshiot.github.io/quant-signal) · [Features](#features) · [Screenshots](#screenshots) · [Architecture](#architecture) · [Getting Started](#getting-started) · [API](#api-reference)

<img src="docs/assets/demo.gif" alt="QuantSignal Demo" width="900" />

</div>

---

## Overview

**QuantSignal** is a live-analysis trading assistant that combines real-time market data, TradingView-powered candlestick charts, a structured multi-service signal engine, and an AI explanation layer into a single, clean interface.

> This is **not** a price prediction bot. It is a trade setup **validation and signal-assistance** tool designed to help you think more clearly about live market conditions.

The platform watches live candle closes, runs a modular signal pipeline, and delivers structured results — direction, confidence, risk score, regime, stop loss, target, invalidation zone, and a plain-English explanation — automatically, every time a candle closes.

---

## Features

### Live Analysis
- **Real-time candlestick chart** via TradingView Lightweight Charts v5
- **Server-Sent Events (SSE)** stream from backend — persistent, reconnect-safe
- **Timer-based candle close detection** — fires precisely at each interval boundary (1m / 5m / 15m / 1h) via REST fetch, independent of WebSocket state
- **WebSocket tick data** from Kraken for price updates between closes
- **Auto signal analysis** — runs the full pipeline on every closed candle, no user action required
- **"Analyze Now"** manual trigger button for immediate analysis on demand

### Signal Engine (Modular Pipeline)
```
Closed Candle (OHLCV)
       ↓
  Regime Detection     →  Trend / Range / Volatile / Breakout
       ↓
  Signal Generation    →  Buy / Sell / Hold / Avoid  +  Confidence %
       ↓
  Risk Calculator      →  Risk Score / Stop Loss / Target / Invalidation Zone
       ↓
  Judge Service        →  Final signal adjudication, banner verdict
       ↓
  AI Explanation       →  Gemini-powered plain-English reasoning
       ↓
  Database Storage     →  Every result persisted with symbol, timeframe, candle time
```

### Manual Setup Analysis
- Enter symbol, timeframe, entry price, stop loss, target, market bias, and strategy notes
- Upload a chart screenshot for visual context (PNG/JPG/WEBP)
- Upload a trade history CSV for performance-aware signal adjustment
- Full AI-assisted validation with the same signal pipeline

### Dashboard & History
- Overview of all analysis runs with real-time stats
- Signal history table: symbol, timeframe, signal, confidence, risk, regime, date
- Total analyses, buy signals, sell signals, average confidence

### Status Indicators
- `Live data connected` / `Connecting...` / `Disconnected`
- `Candle forming` / `Candle closed`
- `Waiting for candle close` / `Running analysis...` / `Done at HH:mm:ss`
- `Analysis failed` with error detail

---

## Screenshots

### Dashboard — Signal History & Stats
![Dashboard](docs/assets/dashboard.png)

### Live Analysis — Real-Time Chart + Auto Signal
![Live Analysis](docs/assets/live-analysis.png)

### Analyze Setup — Manual Trade Validation
![Analyze Setup](docs/assets/analyze-setup.png)

### Upload Chart Screenshot
![Upload Screenshot](docs/assets/upload-screenshot.png)

### Upload Trade History (CSV)
![Upload Trades](docs/assets/upload-trades.png)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React + Vite)                   │
│  Dashboard · Live Analysis · Analyze Setup · Upload · Settings  │
└───────────────────────────┬─────────────────────────────────────┘
                            │  REST + SSE
┌───────────────────────────▼─────────────────────────────────────┐
│                     Express 5 API Server                        │
│                                                                 │
│  Routes:                                                        │
│   GET  /api/market/candles         — Candle history (REST)      │
│   GET  /api/market/stream          — SSE live stream            │
│   POST /api/market/analyze-candle  — Manual trigger             │
│   POST /api/analyze                — Full setup analysis        │
│   GET  /api/signals/history        — Signal history             │
│   POST /api/upload/screenshot      — Chart upload               │
│   POST /api/upload/trades          — Trade CSV upload           │
│                                                                 │
│  Services:                                                      │
│   marketDataService  — Kraken WS + REST + timer-based closes    │
│   regimeService      — Trend / Range / Volatile / Breakout      │
│   signalService      — Candidate Buy/Sell/Hold/Avoid + score    │
│   riskService        — Stop loss / target / invalidation        │
│   judgeService       — Final adjudication + banner              │
│   geminiService      — AI explanation (graceful fallback)       │
└─────────┬───────────────────────────────┬───────────────────────┘
          │ WebSocket (ticks)             │ REST (candle history)
          ▼                               ▼
   Kraken Exchange                  Kraken REST API
   wss://ws.kraken.com/v2           api.kraken.com/0/public/OHLC
          │
          ▼
   Timer-based candle close
   Math.ceil(now / intervalMs) * intervalMs
   → fetch REST → run pipeline → broadcast SSE

┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL + Drizzle ORM                     │
│   analysis_runs · signals · uploaded_files · trade_history      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19 · Vite 6 · TypeScript 5.9 · Tailwind CSS v4 · shadcn/ui |
| **Charts** | TradingView Lightweight Charts v5 |
| **Backend** | Express 5 · Node.js 24 · TypeScript |
| **Database** | PostgreSQL · Drizzle ORM · drizzle-zod |
| **Market Data** | Kraken REST API + WebSocket v2 |
| **AI Layer** | Google Gemini API (optional — graceful fallback if not configured) |
| **API Contract** | OpenAPI 3.1 · Orval codegen · React Query |
| **Monorepo** | pnpm workspaces |
| **Validation** | Zod v4 |
| **File Uploads** | Multer |

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL database (or use `DATABASE_URL` env var)

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/quant-signal.git
cd quant-signal
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set environment variables

Create a `.env` file in the root (or set these in your environment):

```env
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/quantsignal

# Optional — enables AI-powered explanations
GEMINI_API_KEY=your_gemini_api_key_here

# Kraken API (defaults are set — only override if needed)
KRAKEN_REST_BASE_URL=https://api.kraken.com
KRAKEN_WS_URL=wss://ws.kraken.com/v2
```

> **Gemini API key** is optional. If not set, the signal pipeline runs with deterministic explanations. Get one free at [ai.google.dev](https://ai.google.dev/).

### 4. Set up the database

```bash
pnpm --filter @workspace/db run push
```

### 5. Start the servers

```bash
# Start API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Start frontend (port auto-assigned)
pnpm --filter @workspace/quant-signal run dev
```

Open your browser to the frontend URL shown in the terminal.

---

## API Reference

### Market Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/market/candles` | Fetch OHLCV candle history |
| `GET` | `/api/market/stream` | SSE live stream (tick + candle close + signal events) |
| `POST` | `/api/market/analyze-candle` | Analyze the latest closed candle immediately |
| `GET` | `/api/market/stats` | Active stream stats |

**SSE Event Types:**

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | — | Stream handshake |
| `tick` | `candle, isClosed: false` | Live price tick from Kraken WS |
| `analysis_start` | `candle, isClosed: true` | Candle just closed, analysis beginning |
| `candle_closed` | `candle, isClosed: true, signal` | Analysis complete with full signal result |

### Signal Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/analyze` | Full setup analysis (symbol, timeframe, optional fields) |
| `GET` | `/api/signals/history` | Paginated signal history |
| `POST` | `/api/upload/screenshot` | Upload chart screenshot (PNG/JPG/WEBP) |
| `POST` | `/api/upload/trades` | Upload trade history CSV |

### Example — Manual Candle Analysis

```bash
curl -X POST http://localhost:8080/api/market/analyze-candle \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BTCUSDT", "timeframe": "1m"}'
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "signal": "Buy",
    "confidenceScore": 72,
    "riskScore": 34,
    "marketRegime": "trend",
    "explanation": "BTC/USD on the 1m timeframe shows momentum...",
    "invalidationZone": "Below candle low at 69,120 — close below invalidates setup",
    "stopLossSuggestion": 69120.00,
    "targetZone": 69450.00,
    "finalBanner": "Safe",
    "signalId": "uuid-here",
    "computedAt": "2026-03-22T07:00:00.000Z"
  }
}
```

### Trade History CSV Format

```csv
date,symbol,side,entry,exit,pnl
2024-01-15,BTCUSDT,long,42000,43500,1500
2024-01-16,ETHUSDT,short,2300,2150,150
```

---

## Project Structure

```
workspace/
├── artifacts/
│   ├── api-server/              # Express 5 API server
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── analyze.ts        # POST /analyze
│   │       │   ├── market.ts         # Live data routes
│   │       │   ├── signals.ts        # Signal history
│   │       │   └── uploads.ts        # File uploads
│   │       └── services/
│   │           ├── marketDataService.ts  # Kraken WS + timer closes + SSE
│   │           ├── regimeService.ts      # Market regime detection
│   │           ├── signalService.ts      # Signal generation
│   │           ├── riskService.ts        # Risk / stop / target
│   │           ├── judgeService.ts       # Final adjudication
│   │           ├── geminiService.ts      # AI explanation
│   │           └── ingestionService.ts   # Input parsing
│   └── quant-signal/            # React + Vite frontend
│       └── src/
│           ├── pages/
│           │   ├── dashboard.tsx         # Signal history
│           │   ├── live-chart.tsx        # Live Analysis page
│           │   ├── analyze.tsx           # Manual analysis form
│           │   ├── upload-screenshot.tsx # Chart upload
│           │   └── upload-trades.tsx     # Trade CSV upload
│           └── components/
│               ├── SignalBadge.tsx
│               └── Layout.tsx
├── lib/
│   ├── db/                      # Drizzle schema + migrations
│   ├── api-spec/                # OpenAPI 3.1 spec
│   └── api-client-react/        # Generated React Query hooks
└── docs/
    └── assets/                  # README screenshots
```

---

## Signal Output Fields

| Field | Type | Description |
|-------|------|-------------|
| `signal` | `Buy / Sell / Hold / Avoid` | Primary direction verdict |
| `confidenceScore` | `0–100` | How confident the engine is in this signal |
| `riskScore` | `0–100` | Risk level of the current setup |
| `marketRegime` | `trend / range / volatile / breakout` | Current market condition |
| `stopLossSuggestion` | `number` | Calculated stop loss price |
| `targetZone` | `number` | 2:1 RR target price |
| `invalidationZone` | `string` | Condition that would invalidate the signal |
| `finalBanner` | `Safe / Caution / Avoid` | Overall trade quality verdict |
| `explanation` | `string` | AI-generated plain-English reasoning |

---

## Philosophy

QuantSignal is built around a few principles:

- **Live market awareness first** — signals come from real closed candles, not mock data
- **Risk before direction** — the risk score and stop loss are computed before the final signal is issued
- **AI as assistant, not oracle** — Gemini explains the reasoning; it does not make the final call
- **Modular pipeline** — each service (regime, signal, risk, judge) is independent and testable
- **Transparent logic** — every signal comes with an invalidation condition and explanation

---

## Disclaimer

QuantSignal is an educational and research tool. It is **not financial advice**. Signal outputs should not be used as the sole basis for any trading decision. Always do your own analysis and manage your risk appropriately.

---

## License

[MIT](LICENSE)
