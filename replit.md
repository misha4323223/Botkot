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

### 2026-04-22 (evening) — Lessons journal + Anthropic prompt caching

**Lessons journal (новая таблица `trader.ai_lessons`).**
- Schema: `lib/db/src/schema/lessons.ts` — `id, ticker (nullable=общий), lesson, severity (loss|win|info), closeReason, realizedPnl, relatedTradeLogId, createdAt`. Pushed to Neon via `pnpm --filter @workspace/db run push`.
- Trigger: `journalClosedTrade(...)` вызывается из обоих закрывающих путей в `agent-loop.ts` (`reconcilePaperPositions` и `reconcileLivePositions`). Запись урока создаётся только для «значимых» исходов: stop_loss или |pnl| ≥ 1% от номинала — иначе шум.
- Генерация: дешёвый вызов `claude-haiku-4-5` (max_tokens=200) с промптом «напиши ОДНО предложение-урок ≤180 символов». Стоит ~$0.0001 за урок.
- Чтение: `getLessonsForPrompt(ticker)` тянет 8 последних уроков по бумаге + 7 общих, мержит по дате, отдаёт max 15. Блок инжектится в каждый per-ticker промпт как `═══ ЖУРНАЛ УРОКОВ ═══` с маркерами 🔻/🟢/•.

**Anthropic prompt caching.**
- Per-ticker промпт переструктурирован: system теперь массив из двух блоков.
  - **Static block** (~1200 токенов): идентичность, философия, принципы, JSON-схема ответа, дефолтные SL/TP проценты. Помечен `cache_control: { type: "ephemeral" }`. Идентичен для всех тикеров и всех циклов до изменения risk-параметров.
  - **Dynamic block** (~50 токенов): свободный кэш, размер позиции по конкретной бумаге. Не кешируется.
- Результат: при цикле по 7 тикерам первый вызов пишет кеш, остальные 6 читают его в **10× дешевле** и **на ~250мс быстрее**. Кеш живёт 5 минут — успевает покрыть весь цикл.
- Также static block расширен (роль, принципы, явная отсылка к журналу уроков и калибровке) — это по совпадению повышает качество и теперь "бесплатно" в кеше.

**Сводный список того, что AI теперь видит в каждом per-ticker промпте:**
1. Статичная роль/философия/правила (cached)
2. Динамичный контекст счёта (свободно ₽ + позиция по бумаге)
3. Текущая цена, лот, размер позиции
4. Все открытые позиции портфеля (кросс-тикерный взгляд)
5. Дневные свечи 60д с индикаторами (RSI, MACD, BB, MA, объём)
6. Часовые свечи 5д с индикаторами
7. Сравнение с индексом IMOEX (бумага vs рынок)
8. Свежие новости по бумаге за 7 дней (Финам + MOEX, фильтр по русским алиасам)
9. Калибровка уверенности по бакетам за 30 дней
10. Журнал уроков из закрытых сделок (15 последних)
11. История последних 3 решений по этой бумаге

### 2026-04-22 (later) — Top-3 critical fixes

**1. Live stop-loss / take-profit executor + global position watcher.**
- New `runPositionWatcherCycle()` in `agent-loop.ts` runs every **60s**
  independently of the main agent cycle (which can be hour-long), wired into
  `startAgentLoop` / `stopAgentLoop` via `agentState.watcherIntervalId`.
- Batch fetches last prices for every open position in one
  `MarketDataService/GetLastPrices` call (helper `getLastPrices`).
- Paper mode: existing `reconcilePaperPositions` is now called for **all**
  open paper positions, not just the ticker currently being analyzed.
- Live mode: new `reconcileLivePositions(s)` — when `plannedStopLoss` /
  `plannedTakeProfit` is touched, it places an aggressive opposite limit
  order via Tinkoff `OrdersService/PostOrder` (with `priceLimitPercent`
  slippage toward the touching side so it fills) and marks the trade_log
  closed with `closedAt` / `closePrice` / `realizedPnl` / `closeReason`.
  Only runs when `isMoexOpen()` returns true.

**2. Cheap-lot watchlist seeder.** New `seedCheapTickers(s)` runs once on
agent startup, idempotently adds VTBR / RUAL / FEES to `trader.watchlist` if
missing (FIGIs resolved at runtime via `InstrumentsService/FindInstrument`,
filtered to TQBR class / RUB currency). Solves the deadlock where balance
~200₽ < cheapest existing lot 326₽. Verified: FEES added, VTBR/RUAL already
present so skipped.

**3. Confidence calibration feedback in the prompt.** New
`getCalibrationSummary(mode)` looks at the last 30 days of CLOSED trades,
buckets them by reported confidence (90-100%, 80-89%, 70-79%, <70%) and
reports the realized win-rate and total P&L per bucket. The block is
injected into the per-ticker prompt as
`═══ ОБРАТНАЯ СВЯЗЬ ПО ТВОИМ ПРОШЛЫМ РЕШЕНИЯМ ═══`, with an instruction
"если высокая уверенность даёт низкий win-rate — снижай уверенность".
Self-correcting loop against the documented overconfidence (64% of decisions
were in 90–100% bucket).

Verified: server boots cleanly, log line
`Agent loop + SL/TP watcher started cycleMin: 60 watcherSec: 60` confirms
both intervals registered; first agent cycle ran (Agent decision SBER hold
97% live).

### 2026-04-22 — News context for the AI
- New module `artifacts/api-server/src/lib/news.ts`:
  - Sources: Финам company-news RSS (`https://www.finam.ru/analysis/conews/rsspoint/`)
    and MOEX `https://iss.moex.com/iss/sitenews.json?lang=ru&limit=50`.
  - Filter: ticker symbol + Russian aliases dictionary (`TICKER_ALIASES`) for
    35+ tickers (Сбер, Газпром, ВТБ, Яндекс, Русал, Совкомбанк, Лукойл,
    Роснефть, Татнефть, Новатэк, Норникель, Полюс, Северсталь, НЛМК, МТС,
    Аэрофлот, Алроса, Позитив, Озон, Тинькофф/Т-Банк, X5/Пятёрочка, Мосбиржа,
    ПИК, ЛСР, Самолёт, Фосагро, Акрон, ММК, Ростелеком, ФСК/Россети, Русгидро,
    Интер РАО, и пр.). Add new tickers here when expanding the watchlist.
  - Drops items older than 7 days, max 6 items per ticker.
  - Two-layer cache: per-source feed (10 min) + per-ticker filtered result (10 min).
  - 5s fetch timeout with `AbortController`; degrades silently to last-cached or empty.
  - HTML entity decoding (`&quot;`, `&laquo;`, `&#NNN;`, etc.) and CDATA stripping.
  - Exported helpers: `getNewsForTicker(ticker)` and `formatNewsForPrompt(items)`.
- Wired into the prompt in two places:
  - Autonomous loop: `artifacts/api-server/src/lib/agent-loop.ts` — per-ticker
    prompt now contains a "Свежие новости по бумаге" block before the decisions
    history.
  - Manual SSE analyze: `artifacts/api-server/src/routes/agent.ts` — emits a
    `thinking` SSE event "Подгружаю свежие новости по {TICKER}..." then injects
    a "═══ СВЕЖИЕ НОВОСТИ ПО БУМАГЕ ═══" section into the user prompt.
- Verified live: SBER (рекордные дивиденды 37,64 ₽), GAZP (новые залежи,
  энергоблоки), VTBR (падение на заявлениях Костина о допкапитале), YDEX
  (финальные дивиденды 110 ₽). For thin names without coverage (RUAL, SVCB,
  LNZLP) returns empty block instead of hallucinating.

### 2026-04-23 — 5 weaknesses addressed (overconfidence, spread, sector, tape, stale orders)
1. **Overconfidence cap** — `getCalibrationStats` returns per-bucket realized
   win-rates; `applyCalibrationCap` mechanically blends 60% historical +
   40% raw confidence (capped by raw, only when bucket n≥5). Effective vs raw
   confidence both stored in signals JSON. Reasoning gets a `📉` line when
   clamped.
2. **Order book / spread** — `lib/orderbook.ts` calls `GetOrderBook` (depth=5)
   for every ticker, formats top-5 bids/asks + spread% + imbalance into the
   prompt under `СТАКАН`. Hard gate `MAX_SPREAD_PCT=0.5` forces HOLD on
   wide-spread names regardless of LLM confidence. Live limit-order pricing
   now uses the actual ask/bid touch + tiny pad instead of `currentPrice ±
   slippage`.
3. **Stale orders** — watcher cycle now also calls `GetOrders` and cancels
   any NEW/PARTIALLY_FILL order older than `ORDER_TIMEOUT_MIN=5`.
4. **Sector concentration** — `lib/sectors.ts` ships ~80-ticker MOEX
   sector map. `computeSectorExposure` runs each cycle, the breakdown goes
   into the prompt under `ПОРТФЕЛЬ ПО СЕКТОРАМ`, and `checkSectorCap`
   blocks live buys that would push any sector over `SECTOR_CAP_PCT=35%`.
5. **Tape signals** — `computeTapeSignals` in `lib/indicators.ts` derives
   short-window momentum, per-bar velocity, volume burst ratio,
   body-to-range %, consecutive-bar streak. Surfaced in prompt under `ТЕЙП`.

System prompt extended with three new principle sections (`СТАКАН И
ЛИКВИДНОСТЬ`, `КОРРЕЛЯЦИИ И ДИВЕРСИФИКАЦИЯ`, `ТЕЙП И МИКРОСТРУКТУРА`) and
a tighter overconfidence rule (90+% confidence requires ≥4 independent
confluences). The whole static block is still served from Anthropic prompt
cache.

Also fixed: `accountId` lazy auto-detect in `getOrCreateSettings` and
`getOrCreateSettingsForLoop` — fetches first OPEN account on demand. Cleared
duplicate settings row.

Self-rated trading strength: was 3-4/10 (overconfident, no microstructure,
no risk awareness beyond per-trade SL/TP). Should now sit at 5-6/10 — there
is real liquidity and concentration discipline, and overconfidence is
mechanically curbed even if the LLM ignores its own calibration block.

### Known gaps / next priorities (discussed 2026-04-22, not yet implemented)
1. **Stop-loss / take-profit executor** — AI emits levels but no watcher
   enforces them between cycles. Need a 30–60s polling loop on open positions
   or real conditional orders via Tinkoff API.
2. **Balance vs lot size** — live account ~200₽, `max_order_amount`=200₽,
   cheapest watchlist lot SBER 326₽ → system physically cannot trade. Either
   top up to ~3000₽ or add cheap-lot tickers (VTBR ~100₽, RUAL ~40₽, FEES).
3. **Confidence calibration** — 64% of 174 decisions land in 90–100% bucket.
   Feed the AI a daily summary of how its high-confidence calls actually
   performed (post-mortem reflection).
4. **Order book / spread awareness** — currently uses `lastPrice` only; thin
   names have 1–3% spread. Pull `getOrderBook` before placing.
5. **Trading session check** — block orders during MOEX opening auction
   (09:50–10:00) and weekend sessions where appropriate.
6. **Order status tracking** — confirm limit orders fill, cancel stale ones.
7. **Portfolio concentration / correlation guard** — prevent piling into
   correlated names (e.g., 3 oil stocks).
8. Macro snapshot (key rate, USD/RUB, Brent, RTS) as a structured prompt block.
9. Dividend / earnings calendar to avoid unintended ex-div entries.
10. Log of rejected ideas (not just executed ones) for transparency.
- UI panels on the agent page wired to `GET /agent/per-ticker-stats`,
  `GET /agent/equity-curve`, and `DELETE /agent/paper/reset`:
  - "Как растёт прибыль ИИ" — equity curve line chart (recharts), refetched every 30s
  - "Эффективность по бумагам" — per-ticker P&L cards with win rate, open lots, avg confidence
  - "Сбросить бумажную симуляцию" — destructive button shown only in paper mode with at
    least one decision; invalidates stats + per-ticker + equity-curve queries on success
