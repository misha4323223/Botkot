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

  // Recent decisions (last 15) with parsed skipReason
  const recentDecisions = all.slice(0, 15).map(r => {
    const reasoning = r.aiReasoning ?? "";
    const skipMatch = reasoning.match(/⛔\s*(.+?)(?:\n|$)/);
    const wasExecuted = (r.action === "buy" || r.action === "sell") && (r.success ?? false) && !skipMatch;
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
    };
  });

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
