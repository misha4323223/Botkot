import { db, watchlistTable, tradeLogsTable } from "@workspace/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { agentState } from "./agent-state";
import { tinkoffPost, parseQuotation, parseMoneyValue } from "./tinkoff";
import { logger } from "./logger";
import { withRetry } from "./openai-retry";
import { computeSnapshot, interpretSnapshot, type Candle, type IndicatorSnapshot } from "./indicators";
import { getNewsForTicker, formatNewsForPrompt } from "./news";
import { randomUUID } from "crypto";

const IMOEX_FIGI = "BBG004730ZJ9";

interface AccountCtx {
  cashRub: number;
  positions: { figi: string; ticker: string; qty: number; avg: number; curr: number; pnl: number }[];
}

interface RawPos {
  figi: string;
  ticker?: string;
  instrumentType?: string;
  quantity?: { units?: string; nano?: number };
  averagePositionPrice?: { units?: string; nano?: number };
  currentPrice?: { units?: string; nano?: number };
  expectedYield?: { units?: string; nano?: number };
}

async function getAccountContext(token: string, accountId: string, isSandbox: boolean): Promise<AccountCtx> {
  try {
    const [portfolio, positionsData] = await Promise.all([
      tinkoffPost<{
        positions?: RawPos[];
        virtualPositions?: RawPos[];
      }>(
        "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio",
        { accountId, currency: "RUB" },
        token,
        isSandbox,
      ),
      tinkoffPost<{
        money?: { currency?: string; units?: string; nano?: number }[];
        blocked?: { currency?: string; units?: string; nano?: number }[];
      }>(
        "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions",
        { accountId },
        token,
        isSandbox,
      ),
    ]);
    const all = [...(portfolio.positions ?? []), ...(portfolio.virtualPositions ?? [])];
    const positions = all
      .filter(p => (p.instrumentType ?? "share") !== "currency")
      .map(p => ({
        figi: p.figi,
        ticker: p.ticker ?? p.figi,
        qty: parseMoneyValue(p.quantity),
        avg: parseMoneyValue(p.averagePositionPrice),
        curr: parseMoneyValue(p.currentPrice),
        pnl: parseMoneyValue(p.expectedYield),
      }))
      .filter(p => p.qty > 0);

    const rubMoney = (positionsData.money ?? []).find(m => (m.currency ?? "").toLowerCase() === "rub");
    const rubBlocked = (positionsData.blocked ?? []).find(b => (b.currency ?? "").toLowerCase() === "rub");
    const free = parseMoneyValue(rubMoney) - parseMoneyValue(rubBlocked);
    return { cashRub: Math.max(0, free), positions };
  } catch (err) {
    logger.error({ err }, "getAccountContext failed");
    return { cashRub: 0, positions: [] };
  }
}

async function getInstrumentLot(figi: string, token: string, isSandbox: boolean): Promise<number> {
  try {
    const data = await tinkoffPost<{ instrument?: { lot?: number } }>(
      "/tinkoff.public.invest.api.contract.v1.InstrumentsService/GetInstrumentBy",
      { idType: "INSTRUMENT_ID_TYPE_FIGI", id: figi },
      token,
      isSandbox
    );
    return data.instrument?.lot ?? 1;
  } catch {
    return 1;
  }
}

async function fetchCandles(
  figi: string,
  token: string,
  isSandbox: boolean,
  interval: "CANDLE_INTERVAL_DAY" | "CANDLE_INTERVAL_HOUR",
  daysBack: number,
): Promise<Candle[]> {
  try {
    const to = new Date();
    const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const data = await tinkoffPost<{
      candles?: {
        open?: { units?: string; nano?: number };
        close?: { units?: string; nano?: number };
        high?: { units?: string; nano?: number };
        low?: { units?: string; nano?: number };
        volume?: string;
        time?: string;
      }[]
    }>(
      "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles",
      { figi, from: from.toISOString(), to: to.toISOString(), interval },
      token,
      isSandbox,
    );
    return (data.candles ?? []).map(c => ({
      open: parseQuotation(c.open),
      high: parseQuotation(c.high),
      low: parseQuotation(c.low),
      close: parseQuotation(c.close),
      volume: Number(c.volume ?? 0),
      time: c.time,
    }));
  } catch {
    return [];
  }
}

export function isMoexOpen(): { open: boolean; reason: string } {
  const nowUtc = new Date();
  const msk = new Date(nowUtc.getTime() + 3 * 60 * 60 * 1000);
  const day = msk.getUTCDay();
  const h = msk.getUTCHours();
  const m = msk.getUTCMinutes();
  const timeMin = h * 60 + m;
  if (day === 0 || day === 6) return { open: false, reason: `Биржа закрыта: выходной (${day === 0 ? "вс" : "сб"})` };
  if (timeMin < 600) return { open: false, reason: `Биржа ещё не открылась (сейчас ${h}:${String(m).padStart(2, "0")} МСК)` };
  if (timeMin >= 1130) return { open: false, reason: `Биржа закрыта — основная сессия до 18:50 МСК` };
  return { open: true, reason: "Биржа открыта" };
}

export async function getOrCreateSettingsForLoop() {
  const { settingsTable } = await import("@workspace/db");
  const { decryptString } = await import("./crypto");
  const rows = await db.select().from(settingsTable).limit(1);
  let row = rows[0];
  if (!row) {
    [row] = await db.insert(settingsTable).values({}).returning();
  }
  return { ...row, token: decryptString(row.token) };
}

/** Backward-compat textual summary for /agent/analyze route */
export async function getCandleSummary(figi: string, token: string, isSandbox: boolean): Promise<string> {
  const candles = await fetchCandles(figi, token, isSandbox, "CANDLE_INTERVAL_DAY", 30);
  if (candles.length === 0) return "История свечей недоступна.";
  const snap = computeSnapshot(candles);
  const notes = interpretSnapshot(snap).map(n => `  • ${n}`).join("\n");
  return `История (30д, ${candles.length} свечей): изм. ${snap.changePct.toFixed(1)}%, диапазон ${snap.rangeMin.toFixed(2)}–${snap.rangeMax.toFixed(2)}₽, MA5=${snap.ma5.toFixed(2)}, MA10=${snap.ma10.toFixed(2)}, тренд: ${snap.trend}\nИндикаторы:\n${notes}`;
}

interface DecisionJson {
  decision: "buy" | "sell" | "hold";
  confidence: number;
  reasoning: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
}

function parseDecisionJson(raw: string): DecisionJson | null {
  try {
    const trimmed = raw.trim().replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(trimmed);
    const dec = String(parsed.decision ?? "").toLowerCase();
    if (!["buy", "sell", "hold"].includes(dec)) return null;
    const conf = Number(parsed.confidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 100) return null;
    return {
      decision: dec as DecisionJson["decision"],
      confidence: Math.round(conf),
      reasoning: String(parsed.reasoning ?? ""),
      stopLoss: parsed.stopLoss != null ? Number(parsed.stopLoss) : null,
      takeProfit: parsed.takeProfit != null ? Number(parsed.takeProfit) : null,
    };
  } catch {
    return null;
  }
}

function startOfDayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

async function getDailyStats(mode: "paper" | "live") {
  const since = startOfDayUtc();
  const rows = await db.select().from(tradeLogsTable).where(and(gte(tradeLogsTable.createdAt, since), eq(tradeLogsTable.mode, mode)));
  const trades = rows.filter(r => r.action === "buy" || r.action === "sell");
  const realized = rows.reduce((acc, r) => acc + (r.realizedPnl ?? 0), 0);
  return { tradesCount: trades.length, realizedPnl: realized };
}

/** Close paper positions whose stop or take has been hit at currentPrice. */
async function reconcilePaperPositions(figi: string, currentPrice: number): Promise<void> {
  if (currentPrice <= 0) return;
  const open = await db.select().from(tradeLogsTable).where(and(
    eq(tradeLogsTable.figi, figi),
    eq(tradeLogsTable.mode, "paper"),
    isNull(tradeLogsTable.closedAt),
  ));
  for (const pos of open) {
    if (pos.action !== "buy" && pos.action !== "sell") continue;
    const entry = pos.price ?? 0;
    if (entry <= 0) continue;
    const isLong = pos.action === "buy";
    let closeReason: string | null = null;
    if (pos.plannedStopLoss != null) {
      if (isLong && currentPrice <= pos.plannedStopLoss) closeReason = "stop_loss";
      if (!isLong && currentPrice >= pos.plannedStopLoss) closeReason = "stop_loss";
    }
    if (!closeReason && pos.plannedTakeProfit != null) {
      if (isLong && currentPrice >= pos.plannedTakeProfit) closeReason = "take_profit";
      if (!isLong && currentPrice <= pos.plannedTakeProfit) closeReason = "take_profit";
    }
    if (closeReason) {
      const qty = pos.quantity ?? 0;
      const pnl = isLong ? (currentPrice - entry) * qty : (entry - currentPrice) * qty;
      await db.update(tradeLogsTable).set({
        closedAt: new Date(),
        closePrice: currentPrice,
        realizedPnl: pnl,
        closeReason,
      }).where(eq(tradeLogsTable.id, pos.id));
      logger.info({ figi, ticker: pos.ticker, closeReason, pnl }, "Paper position closed");
    }
  }
}

/**
 * Batch fetch last prices for multiple FIGIs in one Tinkoff call.
 * Returns a Map<figi, price>; missing prices are simply absent.
 */
async function getLastPrices(figis: string[], token: string, isSandbox: boolean): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (figis.length === 0) return out;
  try {
    const data = await tinkoffPost<{ lastPrices?: { figi?: string; price?: { units?: string; nano?: number } }[] }>(
      "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
      { figi: figis },
      token,
      isSandbox,
    );
    for (const lp of data.lastPrices ?? []) {
      const p = parseQuotation(lp.price);
      if (lp.figi && p > 0) out.set(lp.figi, p);
    }
  } catch (err) {
    logger.error({ err, count: figis.length }, "getLastPrices failed");
  }
  return out;
}

/**
 * Live SL/TP executor. For each open live position whose stop or take has been
 * hit at currentPrice, place an opposite limit order with priceLimitPercent
 * slippage and mark the trade_log as closed. Only runs when MOEX is open.
 */
async function reconcileLivePositions(s: Awaited<ReturnType<typeof getOrCreateSettingsForLoop>>): Promise<void> {
  if (!s.token || !s.accountId) return;
  const market = isMoexOpen();
  if (!market.open) return;

  const open = await db.select().from(tradeLogsTable).where(and(
    eq(tradeLogsTable.mode, "live"),
    eq(tradeLogsTable.success, true),
    isNull(tradeLogsTable.closedAt),
  ));
  const tradeable = open.filter(p => (p.action === "buy" || p.action === "sell")
    && (p.plannedStopLoss != null || p.plannedTakeProfit != null)
    && (p.quantity ?? 0) > 0
    && (p.price ?? 0) > 0);
  if (tradeable.length === 0) return;

  const figis = Array.from(new Set(tradeable.map(p => p.figi)));
  const prices = await getLastPrices(figis, s.token, s.isSandbox ?? false);
  const slip = (s.priceLimitPercent ?? 0.5) / 100;

  for (const pos of tradeable) {
    const cur = prices.get(pos.figi);
    if (!cur || cur <= 0) continue;
    const entry = pos.price ?? 0;
    const isLong = pos.action === "buy";

    let closeReason: string | null = null;
    if (pos.plannedStopLoss != null) {
      if (isLong && cur <= pos.plannedStopLoss) closeReason = "stop_loss";
      if (!isLong && cur >= pos.plannedStopLoss) closeReason = "stop_loss";
    }
    if (!closeReason && pos.plannedTakeProfit != null) {
      if (isLong && cur >= pos.plannedTakeProfit) closeReason = "take_profit";
      if (!isLong && cur <= pos.plannedTakeProfit) closeReason = "take_profit";
    }
    if (!closeReason) continue;

    // Convert units to lots for closing order (qty in trade_log was lots*lotSize)
    const lotSize = await getInstrumentLot(pos.figi, s.token, s.isSandbox ?? false);
    const lots = Math.max(1, Math.floor((pos.quantity ?? 0) / Math.max(1, lotSize)));

    // Aggressive limit toward the touching side so it fills quickly
    const limitPrice = isLong ? cur * (1 - slip) : cur * (1 + slip);
    const units = Math.floor(limitPrice);
    const nano = Math.round((limitPrice - units) * 1e9);

    try {
      await tinkoffPost(
        "/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder",
        {
          figi: pos.figi,
          quantity: String(lots),
          direction: isLong ? "ORDER_DIRECTION_SELL" : "ORDER_DIRECTION_BUY",
          accountId: s.accountId,
          orderType: "ORDER_TYPE_LIMIT",
          price: { units: String(units), nano },
          orderId: randomUUID(),
        },
        s.token,
        s.isSandbox ?? false,
      );
      const qty = pos.quantity ?? 0;
      const pnl = isLong ? (cur - entry) * qty : (entry - cur) * qty;
      await db.update(tradeLogsTable).set({
        closedAt: new Date(),
        closePrice: cur,
        realizedPnl: pnl,
        closeReason,
      }).where(eq(tradeLogsTable.id, pos.id));
      logger.info({ figi: pos.figi, ticker: pos.ticker, closeReason, pnl, cur }, "LIVE position closed by watcher");
    } catch (err) {
      logger.error({ err, figi: pos.figi, ticker: pos.ticker }, "LIVE close order failed");
    }
  }
}

/**
 * Position watcher cycle — runs frequently (every 60s) independently of the
 * main agent cycle. Closes paper positions in-DB and live positions via
 * Tinkoff orders when SL/TP levels are touched.
 */
export async function runPositionWatcherCycle(): Promise<void> {
  const s = await getOrCreateSettingsForLoop();
  if (!s.token) return;

  // Paper: pull all open paper positions, batch fetch prices, reconcile per-figi
  const openPaper = await db.select().from(tradeLogsTable).where(and(
    eq(tradeLogsTable.mode, "paper"),
    isNull(tradeLogsTable.closedAt),
  ));
  const paperFigis = Array.from(new Set(openPaper
    .filter(p => p.action === "buy" || p.action === "sell")
    .map(p => p.figi)));
  if (paperFigis.length > 0) {
    const prices = await getLastPrices(paperFigis, s.token, s.isSandbox ?? false);
    for (const f of paperFigis) {
      const px = prices.get(f);
      if (px && px > 0) await reconcilePaperPositions(f, px);
    }
  }

  // Live: separate path because closing requires a real order
  await reconcileLivePositions(s);
}

/**
 * Compute calibration stats over the last 30 days of CLOSED trades.
 * Bucketizes by reported confidence and reports realized win-rate per bucket.
 * Returned as a short Russian text block to inject into the LLM prompt as a
 * self-reflection tool — counters overconfidence by showing the model how
 * its high-confidence calls have actually performed.
 */
async function getCalibrationSummary(mode: "paper" | "live"): Promise<string> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const closed = await db.select().from(tradeLogsTable).where(and(
    eq(tradeLogsTable.mode, mode),
    gte(tradeLogsTable.createdAt, since),
  ));
  const settled = closed.filter(r => r.closedAt != null && r.realizedPnl != null && (r.action === "buy" || r.action === "sell"));
  if (settled.length < 3) return "Калибровка: пока недостаточно закрытых сделок (<3) для оценки качества прогнозов.";

  const buckets: Array<{ label: string; lo: number; hi: number }> = [
    { label: "90-100%", lo: 90, hi: 101 },
    { label: "80-89%", lo: 80, hi: 90 },
    { label: "70-79%", lo: 70, hi: 80 },
    { label: "<70%", lo: 0, hi: 70 },
  ];

  const lines = buckets.map(b => {
    const inB = settled.filter(r => (r.confidence ?? 0) >= b.lo && (r.confidence ?? 0) < b.hi);
    if (inB.length === 0) return null;
    const wins = inB.filter(r => (r.realizedPnl ?? 0) > 0).length;
    const totalPnl = inB.reduce((a, r) => a + (r.realizedPnl ?? 0), 0);
    const winRate = Math.round((wins / inB.length) * 100);
    return `  • уверенность ${b.label}: ${inB.length} сделок, прибыльных ${wins} (${winRate}%), суммарный P&L ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}₽`;
  }).filter((x): x is string => x !== null);

  if (lines.length === 0) return "Калибровка: нет закрытых сделок в учтённых бакетах уверенности.";
  return `Твоя калибровка за 30 дней (${settled.length} закрытых сделок):\n${lines.join("\n")}\n→ Если высокая уверенность даёт низкий win-rate — снижай уверенность для следующих решений.`;
}

const CHEAP_TICKER_HINTS = ["VTBR", "RUAL", "FEES"];

/**
 * Add cheap-lot blue chips (VTBR, RUAL, FEES) to the watchlist if missing.
 * Resolves FIGIs via Tinkoff FindInstrument. Idempotent. Called once on agent
 * startup so the agent has at least some tickers it can actually afford.
 */
async function seedCheapTickers(s: Awaited<ReturnType<typeof getOrCreateSettingsForLoop>>): Promise<void> {
  if (!s.token) return;
  const existing = await db.select().from(watchlistTable);
  const haveTickers = new Set(existing.map(w => w.ticker.toUpperCase()));
  const toAdd = CHEAP_TICKER_HINTS.filter(t => !haveTickers.has(t));
  if (toAdd.length === 0) return;

  for (const ticker of toAdd) {
    try {
      const data = await tinkoffPost<{ instruments?: { figi?: string; ticker?: string; name?: string; classCode?: string; currency?: string }[] }>(
        "/tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument",
        { query: ticker, instrumentKind: "INSTRUMENT_TYPE_SHARE", apiTradeAvailableFlag: true },
        s.token,
        s.isSandbox ?? false,
      );
      const match = (data.instruments ?? []).find(i => (i.ticker ?? "").toUpperCase() === ticker
        && (i.classCode === "TQBR" || (i.currency ?? "").toLowerCase() === "rub"));
      if (!match?.figi) {
        logger.warn({ ticker }, "seedCheapTickers: instrument not found");
        continue;
      }
      await db.insert(watchlistTable).values({
        figi: match.figi,
        ticker,
        name: match.name ?? ticker,
      });
      logger.info({ ticker, figi: match.figi }, "seedCheapTickers: added");
    } catch (err) {
      logger.error({ err, ticker }, "seedCheapTickers failed");
    }
  }
}

interface CycleResult {
  ticker: string;
  decision: string;
  confidence: number;
  executed: boolean;
  skipReason?: string;
  mode: "paper" | "live";
}

async function analyzeOneTicker(target: { figi: string; ticker: string }, s: Awaited<ReturnType<typeof getOrCreateSettingsForLoop>>, ctx: AccountCtx, indexSnap: IndicatorSnapshot | null): Promise<CycleResult> {
  // Fetch candles
  const dailyCandles = await fetchCandles(target.figi, s.token!, s.isSandbox ?? false, "CANDLE_INTERVAL_DAY", 60);
  const hourlyCandles = await fetchCandles(target.figi, s.token!, s.isSandbox ?? false, "CANDLE_INTERVAL_HOUR", 5);
  if (dailyCandles.length < 20) {
    return { ticker: target.ticker, decision: "hold", confidence: 0, executed: false, skipReason: "недостаточно истории", mode: s.paperMode ? "paper" : "live" };
  }
  const dailySnap = computeSnapshot(dailyCandles);
  const hourlySnap = hourlyCandles.length >= 10 ? computeSnapshot(hourlyCandles) : null;
  const currentPrice = dailySnap.lastClose;

  // Reconcile any open paper positions for this ticker
  await reconcilePaperPositions(target.figi, currentPrice);

  const lot = await getInstrumentLot(target.figi, s.token!, s.isSandbox ?? false);
  const myPosition = ctx.positions.find(p => p.figi === target.figi);

  const recentLogs = await db.select().from(tradeLogsTable).where(eq(tradeLogsTable.ticker, target.ticker)).orderBy(desc(tradeLogsTable.createdAt)).limit(3);
  const logCtx = recentLogs.map(l => `${new Date(l.createdAt).toISOString().slice(0, 10)} ${l.action.toUpperCase()} (${l.confidence ?? "?"}%): ${l.aiReasoning.slice(0, 100)}`).join("\n") || "Нет истории";

  const dailyNotes = interpretSnapshot(dailySnap);
  const hourlyNotes = hourlySnap ? interpretSnapshot(hourlySnap) : [];

  const news = await getNewsForTicker(target.ticker);
  const newsBlock = formatNewsForPrompt(news);

  const calibrationBlock = await getCalibrationSummary(s.paperMode ? "paper" : "live");

  const indexLine = indexSnap
    ? `IMOEX за тот же период: изм. ${indexSnap.changePct.toFixed(1)}%, тренд ${indexSnap.trend}. Бумага vs индекс: ${(dailySnap.changePct - indexSnap.changePct >= 0 ? "+" : "")}${(dailySnap.changePct - indexSnap.changePct).toFixed(1)}%`
    : "IMOEX недоступен";

  const positionsSummary = ctx.positions.length === 0
    ? "Открытых позиций нет."
    : ctx.positions.map(p => `  ${p.ticker}: ${p.qty} шт. @ ${p.avg.toFixed(2)}₽ (тек. ${p.curr.toFixed(2)}, P&L ${p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}₽)`).join("\n");

  const stopPctSuggest = s.stopLossPercent;
  const takePctSuggest = s.takeProfitPercent;

  const systemPrompt = `Ты — алготрейдер на МосБирже. Анализируй данные и принимай решение.
Правила:
— Не покупай при недостатке кэша (свободно: ${ctx.cashRub.toFixed(2)} ₽).
— Не продавай без позиции (по этой бумаге у тебя ${myPosition ? `${myPosition.qty} шт.` : "0 шт."}).
— Учитывай RSI/MACD/BB/объём вместе, а не один индикатор.
— Уверенность — реальная вероятность правильного направления, без завышения.
— Стоп-лосс ставь на ${stopPctSuggest}% от цены входа (для buy — ниже, для sell — выше).
— Тейк-профит на ${takePctSuggest}% от входа.
Отвечай ТОЛЬКО JSON-объектом без markdown, со схемой:
{"decision":"buy|sell|hold","confidence":0-100,"reasoning":"...","stopLoss":число|null,"takeProfit":число|null}`;

  const userPrompt = `Бумага: ${target.ticker} (${target.figi})
Текущая цена: ${currentPrice.toFixed(2)} ₽, лот: ${lot}
Свободно ₽: ${ctx.cashRub.toFixed(2)}
${myPosition ? `По этой бумаге: ${myPosition.qty} шт. @ ${myPosition.avg.toFixed(2)}, P&L ${myPosition.pnl.toFixed(2)}₽` : "Позиции нет."}
Все позиции:
${positionsSummary}

ДНЕВНЫЕ (60д, ${dailyCandles.length} свечей): изм. ${dailySnap.changePct.toFixed(1)}%, диапазон ${dailySnap.rangeMin.toFixed(2)}–${dailySnap.rangeMax.toFixed(2)}, тренд ${dailySnap.trend}
${dailyNotes.map(n => `• ${n}`).join("\n")}

${hourlySnap ? `ЧАСОВЫЕ (5д, ${hourlyCandles.length} свечей): изм. ${hourlySnap.changePct.toFixed(1)}%, тренд ${hourlySnap.trend}
${hourlyNotes.map(n => `• ${n}`).join("\n")}` : "Часовые свечи недоступны."}

${indexLine}

Свежие новости по бумаге (последние, проверь нет ли санкций/дивидендов/корп.событий):
${newsBlock}

═══ ОБРАТНАЯ СВЯЗЬ ПО ТВОИМ ПРОШЛЫМ РЕШЕНИЯМ ═══
${calibrationBlock}

История решений по этой бумаге:
${logCtx}`;

  const response = await withRetry<{ content: Array<{ type: string; text?: string }> }>(() => anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: `${systemPrompt}\n\nВАЖНО: Отвечай ТОЛЬКО валидным JSON-объектом, без markdown-обёртки и без пояснений вокруг.`,
    messages: [
      { role: "user", content: userPrompt },
    ],
  }));

  const raw = response.content
    .filter(b => b.type === "text")
    .map(b => b.text ?? "")
    .join("");
  const parsed = parseDecisionJson(raw);
  if (!parsed) {
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: "hold",
      aiReasoning: `Невалидный ответ модели: ${raw.slice(0, 300)}`,
      mode: s.paperMode ? "paper" : "live",
      confidence: 0, success: true,
    });
    return { ticker: target.ticker, decision: "hold", confidence: 0, executed: false, skipReason: "невалидный JSON", mode: s.paperMode ? "paper" : "live" };
  }

  const mode: "paper" | "live" = s.paperMode ? "paper" : "live";
  const confidence = parsed.confidence;
  const decision = parsed.decision;
  const signalsJson = JSON.stringify({ daily: dailySnap, hourly: hourlySnap, index: indexSnap });
  const reasoning = parsed.reasoning || raw;

  agentState.lastAction = `${decision.toUpperCase()} ${target.ticker} (${confidence}%, ${mode})`;
  logger.info({ ticker: target.ticker, decision, confidence, mode }, "Agent decision");

  // Below threshold or hold → log and return
  if (decision === "hold" || confidence < s.confidenceThreshold) {
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: decision,
      aiReasoning: reasoning, signals: signalsJson,
      mode, confidence, success: true,
    });
    return { ticker: target.ticker, decision, confidence, executed: false, skipReason: decision === "hold" ? undefined : `уверенность ${confidence}% < ${s.confidenceThreshold}%`, mode };
  }

  // Daily limits
  const stats = await getDailyStats(mode);
  if (s.maxTradesPerDay > 0 && stats.tradesCount >= s.maxTradesPerDay) {
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: "hold",
      aiReasoning: `${reasoning}\n\n⛔ Дневной лимит сделок (${s.maxTradesPerDay}) достигнут.`,
      signals: signalsJson, mode, confidence, success: true,
    });
    return { ticker: target.ticker, decision, confidence, executed: false, skipReason: "лимит сделок/день", mode };
  }
  if (s.dailyLossLimitRub > 0 && -stats.realizedPnl >= s.dailyLossLimitRub) {
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: "hold",
      aiReasoning: `${reasoning}\n\n⛔ Дневной лимит убытка (${s.dailyLossLimitRub} ₽) достигнут.`,
      signals: signalsJson, mode, confidence, success: true,
    });
    return { ticker: target.ticker, decision, confidence, executed: false, skipReason: "дневной лимит убытка", mode };
  }

  // Compute lots and stop/take
  let lots = 0;
  let skipReason = "";
  if (decision === "buy") {
    if (currentPrice <= 0) { skipReason = "нет цены"; }
    else {
      const budget = Math.min(s.maxOrderAmount, ctx.cashRub);
      const lotPrice = currentPrice * lot;
      lots = Math.floor(budget / lotPrice);
      if (lots <= 0) skipReason = `нужно ${lotPrice.toFixed(2)}₽ за лот, бюджет ${budget.toFixed(2)}₽`;
    }
  } else {
    if (!myPosition || myPosition.qty <= 0) skipReason = "нет позиции для продажи";
    else lots = Math.max(1, Math.floor(myPosition.qty / lot));
  }

  if (skipReason) {
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: "hold",
      aiReasoning: `${reasoning}\n\n⛔ ${skipReason}`,
      signals: signalsJson, mode, confidence, success: true,
    });
    return { ticker: target.ticker, decision, confidence, executed: false, skipReason, mode };
  }

  // Stop/take from model or default
  const defaultStop = decision === "buy" ? currentPrice * (1 - s.stopLossPercent / 100) : currentPrice * (1 + s.stopLossPercent / 100);
  const defaultTake = decision === "buy" ? currentPrice * (1 + s.takeProfitPercent / 100) : currentPrice * (1 - s.takeProfitPercent / 100);
  const stopLoss = parsed.stopLoss && parsed.stopLoss > 0 ? parsed.stopLoss : defaultStop;
  const takeProfit = parsed.takeProfit && parsed.takeProfit > 0 ? parsed.takeProfit : defaultTake;

  // PAPER MODE — никаких реальных ордеров
  if (mode === "paper") {
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: decision,
      quantity: lots * lot, price: currentPrice,
      aiReasoning: `[PAPER] ${reasoning}`, signals: signalsJson,
      mode, confidence, success: true,
      plannedStopLoss: stopLoss, plannedTakeProfit: takeProfit,
    });
    agentState.totalTradesExecuted++;
    return { ticker: target.ticker, decision, confidence, executed: true, mode };
  }

  // LIVE MODE — only when market is open
  const market = isMoexOpen();
  if (!market.open) {
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: "hold",
      aiReasoning: `${reasoning}\n\n⏰ ${market.reason}`,
      signals: signalsJson, mode, confidence, success: true,
    });
    return { ticker: target.ticker, decision, confidence, executed: false, skipReason: market.reason, mode };
  }

  // Limit order with priceLimitPercent slippage
  const slip = s.priceLimitPercent / 100;
  const limitPrice = decision === "buy" ? currentPrice * (1 + slip) : currentPrice * (1 - slip);
  const units = Math.floor(limitPrice);
  const nano = Math.round((limitPrice - units) * 1e9);

  try {
    await tinkoffPost(
      "/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder",
      {
        figi: target.figi,
        quantity: String(lots),
        direction: decision === "buy" ? "ORDER_DIRECTION_BUY" : "ORDER_DIRECTION_SELL",
        accountId: s.accountId ?? "",
        orderType: "ORDER_TYPE_LIMIT",
        price: { units: String(units), nano },
        orderId: randomUUID(),
      },
      s.token!,
      s.isSandbox,
    );
    agentState.totalTradesExecuted++;
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: decision,
      quantity: lots * lot, price: currentPrice,
      aiReasoning: reasoning, signals: signalsJson,
      mode, confidence, success: true,
      plannedStopLoss: stopLoss, plannedTakeProfit: takeProfit,
    });
    return { ticker: target.ticker, decision, confidence, executed: true, mode };
  } catch (err) {
    await db.insert(tradeLogsTable).values({
      figi: target.figi, ticker: target.ticker, action: decision,
      aiReasoning: reasoning, signals: signalsJson,
      mode, confidence, success: false,
      errorMessage: err instanceof Error ? err.message : "Unknown",
    });
    logger.error({ err, ticker: target.ticker }, "Live trade failed");
    return { ticker: target.ticker, decision, confidence, executed: false, skipReason: "ошибка ордера", mode };
  }
}

export async function runAgentCycle(specificFigi: string | null) {
  const s = await getOrCreateSettingsForLoop();
  if (!s.token) return;

  const watchlist = await db.select().from(watchlistTable);
  const targets = specificFigi
    ? [{ figi: specificFigi, ticker: specificFigi }]
    : watchlist.map(w => ({ figi: w.figi, ticker: w.ticker }));
  if (targets.length === 0) return;

  agentState.lastRunAt = new Date();
  agentState.nextRunAt = new Date(Date.now() + (s.agentIntervalMinutes ?? 60) * 60 * 1000);
  agentState.totalAnalyses += targets.length;

  const ctx = await getAccountContext(s.token, s.accountId ?? "", s.isSandbox ?? false);

  // IMOEX baseline once per cycle
  const indexCandles = await fetchCandles(IMOEX_FIGI, s.token, s.isSandbox ?? false, "CANDLE_INTERVAL_DAY", 60);
  const indexSnap = indexCandles.length >= 20 ? computeSnapshot(indexCandles) : null;

  for (const target of targets) {
    try {
      await analyzeOneTicker(target, s, ctx, indexSnap);
    } catch (err) {
      logger.error({ err, ticker: target.ticker }, "Analyze failed");
    }
  }
}

export async function startAgentLoop(): Promise<void> {
  if (agentState.isRunning) return;

  const s = await getOrCreateSettingsForLoop();
  if (!s.token) {
    logger.info("Agent auto-start skipped: no token");
    return;
  }

  const watchlist = await db.select().from(watchlistTable).limit(1);
  if (watchlist.length === 0) {
    logger.info("Agent auto-start skipped: empty watchlist");
    return;
  }

  agentState.isRunning = true;
  agentState.nextRunAt = new Date();

  // One-shot: ensure cheap-lot blue chips are in the watchlist so the agent
  // has something it can actually buy when balance is small.
  seedCheapTickers(s).catch(err => logger.error({ err }, "seedCheapTickers failed"));

  const intervalMs = (s.agentIntervalMinutes ?? 60) * 60 * 1000;
  agentState.intervalId = setInterval(async () => {
    try { await runAgentCycle(null); } catch (err) { logger.error({ err }, "Agent cycle error"); }
  }, intervalMs);

  // Independent SL/TP watcher — runs every 60s regardless of agent cycle so
  // stops/takes are honored even between (potentially hour-long) cycles.
  const watcherMs = 60 * 1000;
  agentState.watcherIntervalId = setInterval(async () => {
    try { await runPositionWatcherCycle(); } catch (err) { logger.error({ err }, "Position watcher error"); }
  }, watcherMs);

  logger.info({ cycleMin: s.agentIntervalMinutes ?? 60, watcherSec: 60 }, "Agent loop + SL/TP watcher started");
  runAgentCycle(null).catch(err => logger.error({ err }, "First agent cycle error"));
  runPositionWatcherCycle().catch(err => logger.error({ err }, "First watcher cycle error"));
}

export function stopAgentLoop(): void {
  if (agentState.intervalId) {
    clearInterval(agentState.intervalId);
    agentState.intervalId = null;
  }
  if (agentState.watcherIntervalId) {
    clearInterval(agentState.watcherIntervalId);
    agentState.watcherIntervalId = null;
  }
  agentState.isRunning = false;
  agentState.nextRunAt = null;
}

// Suppress unused import warning
void sql;
