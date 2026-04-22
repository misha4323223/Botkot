import { Router, type IRouter } from "express";
import { db, watchlistTable, tradeLogsTable } from "@workspace/db";
import { eq, desc, and, isNull, isNotNull, gte } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { AnalyzeAndTradeBody, AddToWatchlistBody } from "@workspace/api-zod";
import { agentState, getAgentStatusResponse } from "../lib/agent-state";
import { getOrCreateSettings } from "./settings";
import { tinkoffPost, parseMoneyValue, parseQuotation } from "../lib/tinkoff";
import { getCandleSummary, startAgentLoop, stopAgentLoop, runAgentCycle, isMoexOpen } from "../lib/agent-loop";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/agent/status", async (_req, res): Promise<void> => {
  res.json(getAgentStatusResponse());
});

router.post("/agent/start", async (req, res): Promise<void> => {
  if (agentState.isRunning) {
    res.json(getAgentStatusResponse());
    return;
  }
  await startAgentLoop();
  req.log.info("AI trading agent started");
  res.json(getAgentStatusResponse());
});

router.post("/agent/stop", async (req, res): Promise<void> => {
  stopAgentLoop();
  req.log.info("AI trading agent stopped");
  res.json(getAgentStatusResponse());
});

router.post("/agent/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeAndTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { figi, executeIfConfident } = parsed.data;
    const s = await getOrCreateSettings();

    if (!s.token) {
      sendEvent({ type: "error", message: "Токен API не настроен. Добавьте токен Tinkoff в Настройках." });
      sendEvent({ done: true });
      res.end();
      return;
    }

    sendEvent({ type: "thinking", message: "Собираю данные портфеля..." });

    // Get portfolio
    let portfolioSummary = "Портфель недоступен";
    try {
      const portData = await tinkoffPost<{
        positions?: { figi?: string }[];
        expectedYield?: { units?: string; nano?: number };
        totalAmountPortfolio?: { units?: string; nano?: number };
      }>(
        "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio",
        { accountId: s.accountId ?? "", currency: "RUB" },
        s.token,
        s.isSandbox
      );
      const totalValue = parseMoneyValue(portData.totalAmountPortfolio);
      const pnl = parseMoneyValue(portData.expectedYield);
      portfolioSummary = `Стоимость: ${totalValue.toFixed(0)} ₽, PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(0)} ₽, Позиций: ${portData.positions?.length ?? 0}`;
    } catch (_e) { /* ignore */ }

    const watchlist = await db.select().from(watchlistTable).orderBy(watchlistTable.id);
    const targetsList: { figi: string; ticker: string }[] = figi
      ? [{ figi, ticker: watchlist.find(w => w.figi === figi)?.ticker ?? figi }]
      : watchlist.map(w => ({ figi: w.figi, ticker: w.ticker }));

    if (targetsList.length === 0) {
      sendEvent({ type: "error", message: "Список наблюдения пуст. Добавьте акции." });
      sendEvent({ done: true });
      res.end();
      return;
    }

    sendEvent({ type: "thinking", message: `Будет проанализировано тикеров: ${targetsList.length} (по порядку)` });

    for (let i = 0; i < targetsList.length; i++) {
      const cur = targetsList[i];
      sendEvent({ type: "thinking", message: `\n\n══════ [${i + 1}/${targetsList.length}] ${cur.ticker} ══════` });
      await analyzeOne(cur.figi, cur.ticker, sendEvent, s, executeIfConfident, portfolioSummary);
    }

    sendEvent({ done: true });
    res.end();
    return;
  } catch (err) {
    logger.error({ err }, "Agent analyze error");
    try {
      res.write(`data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Неизвестная ошибка" })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (_e) { /* ignore */ }
  }
});

async function analyzeOne(
  targetFigi: string,
  targetTicker: string,
  sendEvent: (data: Record<string, unknown>) => void,
  s: Awaited<ReturnType<typeof getOrCreateSettings>>,
  executeIfConfident: boolean,
  portfolioSummary: string,
): Promise<void> {
  try {

    sendEvent({ type: "thinking", message: `Получаю котировки для ${targetTicker}...` });

    let currentPrice = 0;
    try {
      const priceData = await tinkoffPost<{ lastPrices?: { price?: { units?: string; nano?: number } }[] }>(
        "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
        { figi: [targetFigi] },
        s.token,
        s.isSandbox
      );
      currentPrice = parseQuotation(priceData.lastPrices?.[0]?.price);
    } catch (_e) { /* ignore */ }

    sendEvent({ type: "thinking", message: `Загружаю историю свечей ${targetTicker} за 30 дней...` });
    const candleSummaryText = await getCandleSummary(targetFigi, s.token, s.isSandbox ?? false);

    const recentLogs = await db.select().from(tradeLogsTable).orderBy(desc(tradeLogsTable.createdAt)).limit(5);
    const logContext = recentLogs.length > 0
      ? recentLogs.map((l) => `${new Date(l.createdAt).toLocaleDateString("ru-RU")} ${l.action.toUpperCase()} ${l.ticker}: ${l.aiReasoning.slice(0, 120)}`).join("\n")
      : "История сделок отсутствует";

    sendEvent({ type: "thinking", message: `Анализирую ${targetTicker} с помощью ИИ...` });

    const systemPrompt = `Ты — профессиональный алготрейдер на Московской Бирже с глубоким знанием технического анализа.
Твоя задача — принять взвешенное торговое решение на основе реальных данных.

Параметры риска:
- Максимальная сумма одной сделки: ${s.maxOrderAmount ?? 1000} ₽
- Допустимый риск на сделку: ${s.riskPercent ?? 2}%
- Режим: ${executeIfConfident ? "ТОРГОВЛЯ (исполни сделку если уверен ≥80%)" : "ТОЛЬКО АНАЛИЗ (без исполнения)"}

Всегда отвечай на русском языке. Будь конкретным и обоснованным.`;

    const userPrompt = `Проанализируй акцию ${targetTicker} и прими торговое решение.

═══ ДАННЫЕ ПОРТФЕЛЯ ═══
${portfolioSummary}

═══ ИНСТРУМЕНТ: ${targetTicker} ═══
Текущая цена: ${currentPrice > 0 ? `${currentPrice.toFixed(2)} ₽` : "недоступна"}

${candleSummaryText}

═══ ИСТОРИЯ РЕШЕНИЙ ═══
${logContext}

═══ ЗАДАНИЕ ═══
1. Проведи технический анализ: тренд, уровни поддержки/сопротивления, сигналы MA, объём
2. Оцени риски (волатильность, текущий тренд)
3. Прими чёткое решение: КУПИТЬ / ПРОДАТЬ / ДЕРЖАТЬ
4. Обоснуй решение (3-4 предложения с конкретными числами из данных)
5. При КУПИТЬ/ПРОДАТЬ укажи: количество лотов (1-3), целевую цену, стоп-лосс

Формат:
РЕШЕНИЕ: [КУПИТЬ/ПРОДАТЬ/ДЕРЖАТЬ]
ИНСТРУМЕНТ: ${targetTicker}
УВЕРЕННОСТЬ: [%]
ОБОСНОВАНИЕ: [детальный анализ]
ПАРАМЕТРЫ: Стоп-лосс: X ₽ | Цель: Y ₽ | Лотов: N`;

    agentState.totalAnalyses++;
    agentState.lastRunAt = new Date();

    let fullResponse = "";
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
      ],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const content = event.delta.text;
        fullResponse += content;
        sendEvent({ type: "content", content });
      }
    }

    const decisionMatch = fullResponse.match(/РЕШЕНИЕ:\s*(КУПИТЬ|ПРОДАТЬ|ДЕРЖАТЬ)/i);
    const decision = decisionMatch ? decisionMatch[1].toLowerCase() : "hold";
    const actionMap: Record<string, "buy" | "sell" | "hold" | "analyze"> = {
      "купить": "buy", "продать": "sell", "держать": "hold",
    };
    const action = actionMap[decision] ?? "hold";

    const confMatch = fullResponse.match(/УВЕРЕННОСТЬ:\s*(\d+)/i);
    const confidence = confMatch ? parseInt(confMatch[1]) : 50;

    agentState.lastAction = `${action.toUpperCase()} ${targetTicker} (${confidence}%)`;

    if (executeIfConfident && (action === "buy" || action === "sell") && confidence >= 80) {
      const market = isMoexOpen();
      if (!market.open) {
        sendEvent({ type: "thinking", message: `⏰ ${market.reason}. Анализ сохранён, сделка отложена до открытия биржи.` });
        await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action: "hold", aiReasoning: `${fullResponse}\n\n⏰ Сделка не исполнена: ${market.reason}`, success: true, mode: s.paperMode ? "paper" : "live", confidence });
        return;
      }
      if (s.paperMode) {
        sendEvent({ type: "thinking", message: `[PAPER] Записываю симуляцию: ${action.toUpperCase()} ${targetTicker} по ₽${currentPrice.toFixed(2)}` });
        await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action, quantity: 1, price: currentPrice || null, aiReasoning: `[PAPER] ${fullResponse}`, success: true, mode: "paper", confidence });
        return;
      }
      sendEvent({ type: "thinking", message: `Уверенность ${confidence}% ≥ 80% — исполняю: ${action === "buy" ? "КУПИТЬ" : "ПРОДАТЬ"} ${targetTicker}...` });
      try {
        await tinkoffPost(
          s.isSandbox
            ? "/tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder"
            : "/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder",
          {
            figi: targetFigi,
            quantity: "1",
            direction: action === "buy" ? "ORDER_DIRECTION_BUY" : "ORDER_DIRECTION_SELL",
            accountId: s.accountId ?? "",
            orderType: "ORDER_TYPE_MARKET",
            orderId: randomUUID(),
          },
          s.token,
          s.isSandbox
        );
        agentState.totalTradesExecuted++;
        await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action, quantity: 1, price: currentPrice || null, aiReasoning: fullResponse, success: true, mode: "live", confidence });
        sendEvent({ type: "trade_executed", action, ticker: targetTicker, message: `✅ Сделка исполнена: ${action === "buy" ? "КУПЛЕН" : "ПРОДАН"} 1 лот ${targetTicker} по ₽${currentPrice.toFixed(2)}` });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Ошибка исполнения";
        await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action, aiReasoning: fullResponse, success: false, errorMessage: errMsg, mode: "live", confidence });
        sendEvent({ type: "error", message: `Ошибка исполнения: ${errMsg}` });
      }
    } else {
      if (executeIfConfident && (action === "buy" || action === "sell") && confidence < 80) {
        sendEvent({ type: "thinking", message: `Уверенность ${confidence}% < 80% — сделка не исполняется (недостаточно уверен).` });
      }
      await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action: action === "hold" ? "hold" : "analyze", aiReasoning: fullResponse, success: true, mode: s.paperMode ? "paper" : "live", confidence });
    }
  } catch (err) {
    logger.error({ err, ticker: targetTicker }, "analyzeOne error");
    sendEvent({ type: "error", message: `Ошибка ${targetTicker}: ${err instanceof Error ? err.message : "неизвестная"}` });
  }
}

router.get("/agent/stats", async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  const mode: "paper" | "live" = s.paperMode ? "paper" : "live";
  const all = await db.select().from(tradeLogsTable).where(eq(tradeLogsTable.mode, mode)).orderBy(desc(tradeLogsTable.createdAt));
  const decisions = all.filter(r => r.action === "buy" || r.action === "sell" || r.action === "hold");
  const trades = all.filter(r => (r.action === "buy" || r.action === "sell") && r.success);
  const buyCount = decisions.filter(r => r.action === "buy").length;
  const sellCount = decisions.filter(r => r.action === "sell").length;
  const holdCount = decisions.filter(r => r.action === "hold").length;
  const closed = trades.filter(r => r.closedAt != null);
  const open = trades.filter(r => r.closedAt == null);
  const wins = closed.filter(r => (r.realizedPnl ?? 0) > 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const realizedPnl = closed.reduce((a, r) => a + (r.realizedPnl ?? 0), 0);

  // Unrealized for open paper positions: need current prices
  let unrealizedPnl = 0;
  if (open.length > 0 && s.token) {
    const figis = Array.from(new Set(open.map(o => o.figi)));
    try {
      const data = await tinkoffPost<{ lastPrices?: { figi?: string; price?: { units?: string; nano?: number } }[] }>(
        "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
        { figi: figis }, s.token, s.isSandbox,
      );
      const prices = new Map<string, number>();
      for (const p of data.lastPrices ?? []) if (p.figi) prices.set(p.figi, parseQuotation(p.price));
      for (const o of open) {
        const cur = prices.get(o.figi) ?? 0;
        if (cur <= 0) continue;
        const entry = o.price ?? 0;
        const qty = o.quantity ?? 0;
        unrealizedPnl += o.action === "buy" ? (cur - entry) * qty : (entry - cur) * qty;
      }
    } catch { /* ignore */ }
  }

  const avgConf = decisions.length > 0 ? decisions.reduce((a, r) => a + (r.confidence ?? 0), 0) / decisions.length : 0;

  // Calibration buckets by confidence on CLOSED trades
  const buckets: Array<{ bucket: string; min: number; max: number; decisions: number; wins: number; winRate: number }> = [
    { bucket: "0-49%", min: 0, max: 50, decisions: 0, wins: 0, winRate: 0 },
    { bucket: "50-69%", min: 50, max: 70, decisions: 0, wins: 0, winRate: 0 },
    { bucket: "70-79%", min: 70, max: 80, decisions: 0, wins: 0, winRate: 0 },
    { bucket: "80-89%", min: 80, max: 90, decisions: 0, wins: 0, winRate: 0 },
    { bucket: "90-100%", min: 90, max: 101, decisions: 0, wins: 0, winRate: 0 },
  ];
  for (const t of closed) {
    const c = t.confidence ?? 0;
    const b = buckets.find(x => c >= x.min && c < x.max);
    if (b) {
      b.decisions++;
      if ((t.realizedPnl ?? 0) > 0) b.wins++;
    }
  }
  for (const b of buckets) b.winRate = b.decisions > 0 ? (b.wins / b.decisions) * 100 : 0;

  // Buy-and-hold compare: take first trade per ticker price vs current
  let agentReturnPct = 0;
  let buyHoldReturnPct = 0;
  if (closed.length > 0) {
    const totalEntry = closed.reduce((a, r) => a + ((r.price ?? 0) * (r.quantity ?? 0)), 0);
    agentReturnPct = totalEntry > 0 ? (realizedPnl / totalEntry) * 100 : 0;
  }
  if (s.token) {
    try {
      // Per-ticker first buy: compare to current price
      const firstBuyByTicker = new Map<string, { entry: number; figi: string }>();
      for (const t of [...trades].reverse()) {
        if (t.action !== "buy") continue;
        if (!firstBuyByTicker.has(t.ticker)) firstBuyByTicker.set(t.ticker, { entry: t.price ?? 0, figi: t.figi });
      }
      if (firstBuyByTicker.size > 0) {
        const figis = Array.from(firstBuyByTicker.values()).map(v => v.figi);
        const data = await tinkoffPost<{ lastPrices?: { figi?: string; price?: { units?: string; nano?: number } }[] }>(
          "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
          { figi: figis }, s.token, s.isSandbox,
        );
        const cur = new Map<string, number>();
        for (const p of data.lastPrices ?? []) if (p.figi) cur.set(p.figi, parseQuotation(p.price));
        let sumPct = 0; let n = 0;
        for (const [, v] of firstBuyByTicker) {
          const c = cur.get(v.figi) ?? 0;
          if (v.entry > 0 && c > 0) { sumPct += ((c - v.entry) / v.entry) * 100; n++; }
        }
        buyHoldReturnPct = n > 0 ? sumPct / n : 0;
      }
    } catch { /* ignore */ }
  }

  // Daily usage
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const today = await db.select().from(tradeLogsTable).where(and(eq(tradeLogsTable.mode, mode), gte(tradeLogsTable.createdAt, dayStart)));
  const dailyTradesUsed = today.filter(r => r.action === "buy" || r.action === "sell").length;
  const dailyLossUsedRub = Math.max(0, -today.reduce((a, r) => a + (r.realizedPnl ?? 0), 0));

  // Suppress unused warnings
  void isNull; void isNotNull;

  // Cash + per-watchlist affordability
  let cashRub = 0;
  const affordability: Array<{ ticker: string; figi: string; lastPrice: number; lot: number; lotPriceRub: number; canAffordLots: number }> = [];
  if (s.token && s.accountId) {
    try {
      const positionsData = await tinkoffPost<{ money?: { currency?: string; units?: string; nano?: number }[]; blocked?: { currency?: string; units?: string; nano?: number }[] }>(
        "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions",
        { accountId: s.accountId }, s.token, s.isSandbox,
      );
      const rub = (positionsData.money ?? []).find(m => (m.currency ?? "").toLowerCase() === "rub");
      const blk = (positionsData.blocked ?? []).find(b => (b.currency ?? "").toLowerCase() === "rub");
      cashRub = Math.max(0, parseMoneyValue(rub) - parseMoneyValue(blk));
    } catch { /* ignore */ }

    try {
      const wl = await db.select().from(watchlistTable);
      if (wl.length > 0) {
        const figis = wl.map(w => w.figi);
        const [pricesResp, ...lotsResp] = await Promise.all([
          tinkoffPost<{ lastPrices?: { figi?: string; price?: { units?: string; nano?: number } }[] }>(
            "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
            { figi: figis }, s.token, s.isSandbox,
          ),
          ...wl.map(w => tinkoffPost<{ instrument?: { lot?: number } }>(
            "/tinkoff.public.invest.api.contract.v1.InstrumentsService/GetInstrumentBy",
            { idType: "INSTRUMENT_ID_TYPE_FIGI", id: w.figi }, s.token!, s.isSandbox,
          ).catch(() => ({ instrument: { lot: 1 } }))),
        ]);
        const priceMap = new Map<string, number>();
        for (const p of pricesResp.lastPrices ?? []) if (p.figi) priceMap.set(p.figi, parseQuotation(p.price));
        wl.forEach((w, i) => {
          const lastPrice = priceMap.get(w.figi) ?? 0;
          const lot = lotsResp[i]?.instrument?.lot ?? 1;
          const lotPriceRub = lastPrice * lot;
          const budget = Math.min(s.maxOrderAmount ?? cashRub, cashRub);
          const canAffordLots = lotPriceRub > 0 ? Math.floor(budget / lotPriceRub) : 0;
          affordability.push({ ticker: w.ticker, figi: w.figi, lastPrice, lot, lotPriceRub, canAffordLots });
        });
      }
    } catch { /* ignore */ }
  }

  // Recent decisions (last 15) with parsed skipReason + verdict
  const recentRows = all.slice(0, 15);

  // Fetch current prices for unique figis
  const recentPrices = new Map<string, number>();
  if (recentRows.length > 0 && s.token) {
    try {
      const figis = Array.from(new Set(recentRows.map(r => r.figi)));
      const data = await tinkoffPost<{ lastPrices?: { figi?: string; price?: { units?: string; nano?: number } }[] }>(
        "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
        { figi: figis }, s.token, s.isSandbox,
      );
      for (const p of data.lastPrices ?? []) if (p.figi) recentPrices.set(p.figi, parseQuotation(p.price));
    } catch { /* ignore */ }
  }

  type Verdict = "good" | "bad" | "neutral" | "early" | "skipped";
  const recentDecisions = recentRows.map(r => {
    const reasoning = r.aiReasoning ?? "";
    const skipMatch = reasoning.match(/⛔\s*(.+?)(?:\n|$)/);
    const wasExecuted = (r.action === "buy" || r.action === "sell") && (r.success ?? false) && !skipMatch;
    const currentPrice = recentPrices.get(r.figi) ?? null;
    const entry = r.price ?? 0;
    const qty = r.quantity ?? 0;
    const ageMin = (Date.now() - r.createdAt.getTime()) / 60000;

    let verdict: Verdict = "early";
    let verdictText = "Рано судить";
    let pnlNow: number | null = null;
    let pnlPct: number | null = null;

    if (!wasExecuted && r.action !== "hold") {
      verdict = "skipped";
      verdictText = "Не сделал";
    } else if (r.action === "hold") {
      // Compare entry (price logged at decision) vs current
      if (entry > 0 && currentPrice && currentPrice > 0 && ageMin >= 30) {
        const movePct = ((currentPrice - entry) / entry) * 100;
        pnlPct = movePct;
        if (Math.abs(movePct) < 0.5) { verdict = "good"; verdictText = "Правильно подождал"; }
        else if (movePct > 1.5) { verdict = "bad"; verdictText = `Упустил рост +${movePct.toFixed(1)}%`; }
        else if (movePct < -1.5) { verdict = "good"; verdictText = `Спасся от падения ${movePct.toFixed(1)}%`; }
        else { verdict = "neutral"; verdictText = `Цена сдвинулась на ${movePct >= 0 ? "+" : ""}${movePct.toFixed(1)}%`; }
      } else {
        verdict = "early";
        verdictText = entry > 0 ? "Ждём движения цены" : "Без цены — нечего сравнить";
      }
    } else if (wasExecuted && r.action === "buy") {
      if (r.closedAt != null && r.realizedPnl != null) {
        pnlNow = r.realizedPnl;
        pnlPct = entry > 0 && qty > 0 ? (r.realizedPnl / (entry * qty)) * 100 : null;
        if (r.realizedPnl > 0) { verdict = "good"; verdictText = `Закрыта в плюс ${pnlPct ? `(+${pnlPct.toFixed(1)}%)` : ""}`; }
        else if (r.realizedPnl < 0) { verdict = "bad"; verdictText = `Закрыта в минус ${pnlPct ? `(${pnlPct.toFixed(1)}%)` : ""}`; }
        else { verdict = "neutral"; verdictText = "Закрыта в ноль"; }
      } else if (currentPrice && currentPrice > 0 && entry > 0 && qty > 0) {
        pnlNow = (currentPrice - entry) * qty;
        pnlPct = ((currentPrice - entry) / entry) * 100;
        if (pnlPct > 1) { verdict = "good"; verdictText = `Пока в плюсе +${pnlPct.toFixed(1)}%`; }
        else if (pnlPct < -1) { verdict = "bad"; verdictText = `Пока в минусе ${pnlPct.toFixed(1)}%`; }
        else { verdict = "neutral"; verdictText = `Около входа (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`; }
      }
    } else if (wasExecuted && r.action === "sell") {
      if (r.realizedPnl != null) {
        pnlNow = r.realizedPnl;
        pnlPct = entry > 0 && qty > 0 ? (r.realizedPnl / (entry * qty)) * 100 : null;
        if (r.realizedPnl > 0) { verdict = "good"; verdictText = `Зафиксировал прибыль ${pnlPct ? `(+${pnlPct.toFixed(1)}%)` : ""}`; }
        else if (r.realizedPnl < 0) { verdict = "bad"; verdictText = `Закрыл с убытком ${pnlPct ? `(${pnlPct.toFixed(1)}%)` : ""}`; }
        else { verdict = "neutral"; verdictText = "Без прибыли"; }
      }
    }

    return {
      id: r.id,
      ticker: r.ticker,
      action: r.action,
      confidence: r.confidence ?? 0,
      executed: wasExecuted,
      skipReason: skipMatch ? skipMatch[1].trim() : null,
      reasoning: reasoning.replace(/⛔.+$/s, "").trim().slice(0, 400),
      quantity: r.quantity,
      price: r.price,
      realizedPnl: r.realizedPnl,
      createdAt: r.createdAt.toISOString(),
      currentPrice,
      pnlNow,
      pnlPct,
      verdict,
      verdictText,
    };
  });

  // Aggregate verdicts (only on judgable: good/bad)
  const judgable = recentDecisions.filter(d => d.verdict === "good" || d.verdict === "bad");
  const goodMoves = judgable.filter(d => d.verdict === "good").length;
  const badMoves = judgable.filter(d => d.verdict === "bad").length;
  const earlyMoves = recentDecisions.filter(d => d.verdict === "early").length;

  res.json({
    mode,
    totalDecisions: decisions.length,
    totalTrades: trades.length,
    openPositions: open.length,
    closedPositions: closed.length,
    winRate,
    realizedPnl,
    unrealizedPnl,
    avgConfidence: avgConf,
    calibration: buckets.map(b => ({ bucket: b.bucket, decisions: b.decisions, wins: b.wins, winRate: b.winRate })),
    vsBuyAndHold: { agentReturnPct, buyHoldReturnPct },
    dailyLossUsedRub,
    dailyTradesUsed,
    cashRub,
    affordability,
    recentDecisions,
    buyCount,
    sellCount,
    holdCount,
    goodMoves,
    badMoves,
    earlyMoves,
  });
});

router.get("/agent/per-ticker-stats", async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  const mode: "paper" | "live" = s.paperMode ? "paper" : "live";
  const all = await db.select().from(tradeLogsTable).where(eq(tradeLogsTable.mode, mode)).orderBy(desc(tradeLogsTable.createdAt));

  const byTicker = new Map<string, {
    ticker: string; figi: string; decisions: number; buys: number; sells: number; holds: number;
    closedTrades: number; wins: number; losses: number; realizedPnl: number;
    avgConfidence: number; confSum: number; confN: number; lastDecisionAt: string;
    openLots: number; openValue: number;
  }>();
  for (const r of all) {
    let b = byTicker.get(r.ticker);
    if (!b) {
      b = { ticker: r.ticker, figi: r.figi, decisions: 0, buys: 0, sells: 0, holds: 0,
        closedTrades: 0, wins: 0, losses: 0, realizedPnl: 0,
        avgConfidence: 0, confSum: 0, confN: 0, lastDecisionAt: r.createdAt.toISOString(),
        openLots: 0, openValue: 0 };
      byTicker.set(r.ticker, b);
    }
    b.decisions++;
    if (r.action === "buy") b.buys++;
    else if (r.action === "sell") b.sells++;
    else if (r.action === "hold") b.holds++;
    if ((r.confidence ?? 0) > 0) { b.confSum += r.confidence ?? 0; b.confN++; }
    if (r.closedAt != null && r.realizedPnl != null) {
      b.closedTrades++;
      b.realizedPnl += r.realizedPnl;
      if (r.realizedPnl > 0) b.wins++;
      else if (r.realizedPnl < 0) b.losses++;
    }
    if (r.action === "buy" && r.success && r.closedAt == null && r.quantity != null && r.price != null) {
      b.openLots += r.quantity;
      b.openValue += r.quantity * r.price;
    }
  }

  // Current prices for unrealized
  const figis = Array.from(new Set(Array.from(byTicker.values()).filter(x => x.openLots > 0).map(x => x.figi)));
  const priceMap = new Map<string, number>();
  if (figis.length > 0 && s.token) {
    try {
      const data = await tinkoffPost<{ lastPrices?: { figi?: string; price?: { units?: string; nano?: number } }[] }>(
        "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
        { figi: figis }, s.token, s.isSandbox,
      );
      for (const p of data.lastPrices ?? []) if (p.figi) priceMap.set(p.figi, parseQuotation(p.price));
    } catch { /* ignore */ }
  }

  const tickers = Array.from(byTicker.values()).map(b => {
    b.avgConfidence = b.confN > 0 ? b.confSum / b.confN : 0;
    const cur = priceMap.get(b.figi) ?? 0;
    const unrealizedPnl = (cur > 0 && b.openLots > 0) ? cur * b.openLots - b.openValue : 0;
    const winRate = b.closedTrades > 0 ? (b.wins / b.closedTrades) * 100 : 0;
    const totalPnl = b.realizedPnl + unrealizedPnl;
    return {
      ticker: b.ticker, decisions: b.decisions, buys: b.buys, sells: b.sells, holds: b.holds,
      closedTrades: b.closedTrades, wins: b.wins, losses: b.losses, winRate,
      realizedPnl: b.realizedPnl, unrealizedPnl, totalPnl,
      avgConfidence: b.avgConfidence, lastDecisionAt: b.lastDecisionAt,
      openLots: b.openLots,
    };
  });
  tickers.sort((a, b) => b.totalPnl - a.totalPnl);
  res.json({ mode, tickers });
});

router.get("/agent/equity-curve", async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  const mode: "paper" | "live" = s.paperMode ? "paper" : "live";
  // Take all closed trades, sort by closedAt asc, cumsum realizedPnl
  const closed = await db.select().from(tradeLogsTable)
    .where(and(eq(tradeLogsTable.mode, mode), isNotNull(tradeLogsTable.closedAt)))
    .orderBy(tradeLogsTable.closedAt);
  let acc = 0;
  const points: Array<{ time: string; pnl: number; trade: number }> = [{ time: closed[0]?.closedAt?.toISOString() ?? new Date().toISOString(), pnl: 0, trade: 0 }];
  closed.forEach((c, i) => {
    acc += c.realizedPnl ?? 0;
    points.push({ time: c.closedAt!.toISOString(), pnl: acc, trade: i + 1 });
  });
  res.json({ mode, points, totalPnl: acc, tradesCount: closed.length });
});

router.delete("/agent/paper/reset", async (_req, res): Promise<void> => {
  const deleted = await db.delete(tradeLogsTable).where(eq(tradeLogsTable.mode, "paper")).returning({ id: tradeLogsTable.id });
  res.json({ deletedCount: deleted.length });
});

// Curated list of liquid MOEX stocks
const POPULAR_TICKERS: Array<{ ticker: string; name: string; sector: string }> = [
  { ticker: "SBER", name: "Сбербанк", sector: "Банки" },
  { ticker: "VTBR", name: "ВТБ", sector: "Банки" },
  { ticker: "TCSG", name: "ТКС Холдинг", sector: "Банки" },
  { ticker: "GAZP", name: "Газпром", sector: "Нефть и газ" },
  { ticker: "LKOH", name: "Лукойл", sector: "Нефть и газ" },
  { ticker: "ROSN", name: "Роснефть", sector: "Нефть и газ" },
  { ticker: "NVTK", name: "Новатэк", sector: "Нефть и газ" },
  { ticker: "TATN", name: "Татнефть", sector: "Нефть и газ" },
  { ticker: "GMKN", name: "Норникель", sector: "Металлы" },
  { ticker: "CHMF", name: "Северсталь", sector: "Металлы" },
  { ticker: "NLMK", name: "НЛМК", sector: "Металлы" },
  { ticker: "PLZL", name: "Полюс", sector: "Золото" },
  { ticker: "MAGN", name: "ММК", sector: "Металлы" },
  { ticker: "MGNT", name: "Магнит", sector: "Ритейл" },
  { ticker: "YDEX", name: "Яндекс", sector: "IT" },
  { ticker: "OZON", name: "Ozon", sector: "Ритейл" },
  { ticker: "MTSS", name: "МТС", sector: "Телеком" },
  { ticker: "RTKM", name: "Ростелеком", sector: "Телеком" },
  { ticker: "AFLT", name: "Аэрофлот", sector: "Транспорт" },
  { ticker: "PHOR", name: "ФосАгро", sector: "Удобрения" },
  { ticker: "AFKS", name: "АФК Система", sector: "Холдинг" },
  { ticker: "ALRS", name: "Алроса", sector: "Алмазы" },
];

interface ResolvedInstrument { ticker: string; name: string; sector: string; figi: string; lot: number; lastPrice: number; lotPriceRub: number; canAfford: boolean }
const figiCache = new Map<string, { figi: string; lot: number; name: string }>();

async function resolvePopular(token: string, isSandbox: boolean): Promise<ResolvedInstrument[]> {
  const resolved: ResolvedInstrument[] = [];
  const toFetch: typeof POPULAR_TICKERS = [];
  for (const t of POPULAR_TICKERS) {
    if (figiCache.has(t.ticker)) continue;
    toFetch.push(t);
  }

  await Promise.all(toFetch.map(async t => {
    try {
      const data = await tinkoffPost<{ instruments?: { figi?: string; ticker?: string; name?: string; lot?: number; classCode?: string; instrumentType?: string }[] }>(
        "/tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument",
        { query: t.ticker, instrumentKind: "INSTRUMENT_TYPE_SHARE", apiTradeAvailableFlag: true },
        token, isSandbox,
      );
      const match = (data.instruments ?? []).find(i => (i.ticker ?? "").toUpperCase() === t.ticker && (i.classCode ?? "").startsWith("TQ"))
        ?? (data.instruments ?? []).find(i => (i.ticker ?? "").toUpperCase() === t.ticker)
        ?? data.instruments?.[0];
      if (match?.figi) figiCache.set(t.ticker, { figi: match.figi, lot: match.lot ?? 1, name: match.name ?? t.name });
    } catch { /* skip */ }
  }));

  const allFigis = POPULAR_TICKERS.map(t => figiCache.get(t.ticker)?.figi).filter((f): f is string => !!f);
  let priceMap = new Map<string, number>();
  if (allFigis.length > 0) {
    try {
      const lp = await tinkoffPost<{ lastPrices?: { figi?: string; price?: { units?: string; nano?: number } }[] }>(
        "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
        { figi: allFigis }, token, isSandbox,
      );
      for (const p of lp.lastPrices ?? []) if (p.figi) priceMap.set(p.figi, parseQuotation(p.price));
    } catch { /* ignore */ }
  }

  for (const t of POPULAR_TICKERS) {
    const cached = figiCache.get(t.ticker);
    if (!cached) continue;
    const lastPrice = priceMap.get(cached.figi) ?? 0;
    const lotPriceRub = lastPrice * cached.lot;
    resolved.push({
      ticker: t.ticker, name: t.name, sector: t.sector,
      figi: cached.figi, lot: cached.lot,
      lastPrice, lotPriceRub, canAfford: false,
    });
  }
  return resolved;
}

router.get("/agent/suggest-tickers", async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) { res.json({ cashRub: 0, tickers: [], aiPicks: [] }); return; }

  // Get cash
  let cashRub = 0;
  if (s.accountId) {
    try {
      const positionsData = await tinkoffPost<{ money?: { currency?: string; units?: string; nano?: number }[]; blocked?: { currency?: string; units?: string; nano?: number }[] }>(
        "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions",
        { accountId: s.accountId }, s.token, s.isSandbox,
      );
      const rub = (positionsData.money ?? []).find(m => (m.currency ?? "").toLowerCase() === "rub");
      const blk = (positionsData.blocked ?? []).find(b => (b.currency ?? "").toLowerCase() === "rub");
      cashRub = Math.max(0, parseMoneyValue(rub) - parseMoneyValue(blk));
    } catch { /* ignore */ }
  }

  const tickers = await resolvePopular(s.token, s.isSandbox ?? false);
  const budget = Math.min(s.maxOrderAmount ?? cashRub, cashRub);
  for (const t of tickers) t.canAfford = t.lotPriceRub > 0 && t.lotPriceRub <= budget;

  // Sort: affordable first, then by lotPrice ascending
  tickers.sort((a, b) => {
    if (a.canAfford !== b.canAfford) return a.canAfford ? -1 : 1;
    return a.lotPriceRub - b.lotPriceRub;
  });

  // Already in watchlist
  const wl = await db.select().from(watchlistTable);
  const inListFigis = new Set(wl.map(w => w.figi));

  // Ask Claude for picks
  let aiPicks: Array<{ ticker: string; reason: string }> = [];
  try {
    const candidates = tickers.filter(t => !inListFigis.has(t.figi)).slice(0, 15);
    const prompt = `У пользователя свободно ${cashRub.toFixed(2)} ₽ на счёте МосБиржи.
Уже в списке наблюдения: ${wl.map(w => w.ticker).join(", ") || "ничего"}.
Доступные акции (тикер, сектор, цена 1 лота):
${candidates.map(c => `${c.ticker} (${c.sector}) — ₽${c.lotPriceRub.toFixed(0)} за лот ${c.canAfford ? "✓ хватит" : "✗ не хватит"}`).join("\n")}

Подскажи 3-5 акций для добавления в список наблюдения. Учитывай:
- Бюджет (лучше те, на которые хватает хотя бы на 1 лот)
- Диверсификация по секторам
- Ликвидность и популярность
Ответь ТОЛЬКО JSON-массивом без markdown:
[{"ticker":"SBER","reason":"кратко почему стоит следить, 1-2 предложения"}, ...]`;

    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content.filter(b => b.type === "text").map(b => (b as { text?: string }).text ?? "").join("").trim().replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      aiPicks = parsed
        .filter((p): p is { ticker: string; reason: string } => p && typeof p.ticker === "string" && typeof p.reason === "string")
        .slice(0, 5);
    }
  } catch (err) {
    logger.warn({ err }, "Claude ticker suggest failed");
  }

  res.json({
    cashRub,
    tickers: tickers.map(t => ({ ...t, inWatchlist: inListFigis.has(t.figi) })),
    aiPicks,
  });
});

router.get("/agent/watchlist", async (_req, res): Promise<void> => {
  const items = await db.select().from(watchlistTable).orderBy(desc(watchlistTable.addedAt));
  res.json(items.map((i) => ({ id: i.id, figi: i.figi, ticker: i.ticker, name: i.name, addedAt: i.addedAt.toISOString() })));
});

router.post("/agent/watchlist", async (req, res): Promise<void> => {
  const parsed = AddToWatchlistBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [item] = await db.insert(watchlistTable).values(parsed.data).returning();
  res.status(201).json({ id: item.id, figi: item.figi, ticker: item.ticker, name: item.name, addedAt: item.addedAt.toISOString() });
});

router.delete("/agent/watchlist/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(watchlistTable).where(eq(watchlistTable.id, id));
  res.sendStatus(204);
});

export default router;
