# Workspace

## Overview

Russian-language AI trading platform for the Moscow Exchange (MOEX) via the Tinkoff Invest API.
pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

Artifacts:
- `artifacts/trader` — web frontend (React 19 + Vite, mobile-first, Russian UI)
- `artifacts/api-server` — Express 5 backend (Tinkoff Invest proxy, AI agent loop, decision logging)
- `artifacts/mockup-sandbox` — component preview server

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL (Neon) + Drizzle ORM, schema `trader`
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from `lib/api-spec/openapi.yaml`)
- **Frontend**: React 19, Vite, TanStack Query, Tailwind, shadcn/ui, recharts
- **Build**: esbuild

## AI Usage

The platform uses **Anthropic Claude Sonnet 4.6** (model id `claude-sonnet-4-6`) via Replit's
built-in Anthropic AI Integration — **no API key is required** in the project's environment;
auth is handled through the Replit AI proxy.

The integration helper is at `artifacts/api-server/src/lib/anthropic.ts` and follows
`.local/skills/ai-integrations-anthropic`. It exports a single `anthropic` client used
everywhere.

### Where Claude is called

1. **Autonomous trading agent** — `artifacts/api-server/src/lib/agent-loop.ts`
   - Loops every N seconds (configurable in settings) over the user's watchlist.
   - For each ticker: fetches recent candles + portfolio context from Tinkoff, sends a Russian
     prompt to Claude asking for a JSON decision: `{ action: "buy" | "sell" | "hold",
     confidence, reasoning, plannedStopLoss?, plannedTakeProfit? }`.
   - Decision is filtered through risk gates (daily loss limit, max order amount, free cash
     check, paper-vs-live mode), then either executed via Tinkoff `OrdersService/PostOrder` or
     recorded as a `hold` / skipped trade in `trade_logs`.
   - Every decision (executed or skipped) is logged with full reasoning, confidence, planned
     SL/TP, and current price.

2. **Per-ticker manual analysis (SSE stream)** — `analyzeOne()` in
   `artifacts/api-server/src/routes/agent.ts`. Same prompt as the loop, streamed back over
   Server-Sent Events so the UI shows the AI "thinking" in real time
   ("Поток мыслей ИИ" panel).

3. **Ticker suggestions** — `GET /agent/suggest-tickers`. Sends Claude a curated list of
   liquid MOEX stocks (SBER, GAZP, LKOH, YDEX, etc.) with the user's free cash and current
   watchlist; returns 3–5 picks with a short reason per pick. Used in the
   "Что добавить в анализ" panel on the agent page.

### Decision-quality scoring (no Claude call — pure logic)

`GET /agent/stats` enriches each of the last 15 decisions with a **verdict**:
- **Executed BUY/SELL**: compares entry price vs current/exit price → `good` / `bad` /
  `neutral` / `early` (if too recent).
- **HOLD**: compares price at decision vs current after ≥30 min → `good`
  (правильно подождал / спасся от падения) / `bad` (упустил рост) / `neutral`.
- **Skipped trades**: `skipped` (with reason like "не хватает на лот").

Aggregates `goodMoves`, `badMoves`, `earlyMoves` so the UI shows
"Точность ИИ: X% (N из M)".

### Modes

- **Paper mode** (default): no real orders sent to Tinkoff. Trades are simulated and tracked
  in `trade_logs` with `mode='paper'`. Paper portfolio is computed in `routes/portfolio.ts`.
- **Live mode**: real orders go through `OrdersService/PostOrder`. Toggled in Settings.

## API endpoints (highlights)

Agent:
- `GET /agent/status`, `POST /agent/start`, `POST /agent/stop`
- `POST /agent/analyze` — SSE stream of AI analysis for one ticker
- `GET /agent/stats` — full stats: P&L, win rate, calibration, recent decisions with verdicts,
  cash + per-watchlist affordability, daily limit usage
- `GET /agent/per-ticker-stats` — AI performance broken down by ticker (decisions, wins/
  losses, realized + unrealized P&L per ticker; sorted by total P&L)
- `GET /agent/equity-curve` — cumulative realized P&L over time as `{ time, pnl, trade }[]`
- `GET /agent/suggest-tickers` — curated MOEX list + Claude's top picks for the budget
- `DELETE /agent/paper/reset` — wipe all paper-mode trade logs (start fresh)
- Watchlist: `GET / POST /agent/watchlist`, `DELETE /agent/watchlist/:figi`

Portfolio / market: `GET /portfolio`, `GET /portfolio/summary`, `GET /portfolio/paper`,
`GET /market/instruments`, `GET /market/instruments/:figi/price`,
`GET /market/instruments/:figi/candles`.

## UI work done

- Full Russian translation of all pages (home, portfolio, agent, layout, not-found).
- **Agent page** redesigned mobile-first with cards:
  - Status / start-stop, allow-trading switch
  - "Деньги и что ИИ может купить" — cash + per-watchlist affordability (lot price, can-afford
    flag)
  - "Что добавить в анализ" — curated popular MOEX tickers grid + Claude's AI picks with
    one-click add to watchlist
  - "Что сделал ИИ" — buy/sell/hold counts, realized + unrealized P&L, win rate
  - "Последние 15 решений — оценка хода" — each decision with a verdict badge
    (✅ good / ❌ bad / ⏳ early / ⛔ skipped), entry-vs-current price, reasoning
  - Watchlist + manual analysis search
- **Portfolio page** fully responsive: 1-col stat summary on mobile, card layout for positions
  on small screens, table on desktop.

## Codegen quirk

Orval's split mode for the zod client only generates `api.ts` (no `api.schemas.ts`), but it
auto-writes a workspace `index.ts` that re-exports both. To avoid build breakage, the `exports`
field of `lib/api-zod/package.json` points directly at `./src/generated/api.ts` and we don't
keep an `index.ts`.

## Key Commands

- `pnpm run typecheck` — typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod from OpenAPI
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure and package details.

## Recently shipped

- UI panels on the agent page wired to `GET /agent/per-ticker-stats`,
  `GET /agent/equity-curve`, and `DELETE /agent/paper/reset`:
  - "Как растёт прибыль ИИ" — equity curve line chart (recharts), refetched every 30s
  - "Эффективность по бумагам" — per-ticker P&L cards with win rate, open lots, avg confidence
  - "Сбросить бумажную симуляцию" — destructive button shown only in paper mode with at
    least one decision; invalidates stats + per-ticker + equity-curve queries on success
