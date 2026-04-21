import { Router, type IRouter } from "express";
import { db, watchlistTable, tradeLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
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

    const watchlist = await db.select().from(watchlistTable).limit(10);
    const targetFigi = figi ?? (watchlist.length > 0 ? watchlist[Math.floor(Math.random() * watchlist.length)].figi : null);
    const targetItem = watchlist.find((w) => w.figi === targetFigi);
    const targetTicker = targetItem?.ticker ?? targetFigi ?? "UNKNOWN";

    if (!targetFigi) {
      sendEvent({ type: "error", message: "Список наблюдения пуст. Добавьте акции." });
      sendEvent({ done: true });
      res.end();
      return;
    }

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
    const stream = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_completion_tokens: 1500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
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
        sendEvent({ type: "thinking", message: `⏰ ${market.reason}. Анализ сохранён, сделка отложена до открытия биржи (10:00 МСК).` });
        await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action: "hold", aiReasoning: `${fullResponse}\n\n⏰ Сделка не исполнена: ${market.reason}`, success: true });
        sendEvent({ done: true });
        res.end();
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
        await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action, quantity: 1, price: currentPrice || null, aiReasoning: fullResponse, success: true });
        sendEvent({ type: "trade_executed", action, ticker: targetTicker, message: `✅ Сделка исполнена: ${action === "buy" ? "КУПЛЕН" : "ПРОДАН"} 1 лот ${targetTicker} по ₽${currentPrice.toFixed(2)}` });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Ошибка исполнения";
        await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action, aiReasoning: fullResponse, success: false, errorMessage: errMsg });
        sendEvent({ type: "error", message: `Ошибка исполнения: ${errMsg}` });
      }
    } else {
      if (executeIfConfident && (action === "buy" || action === "sell") && confidence < 80) {
        sendEvent({ type: "thinking", message: `Уверенность ${confidence}% < 80% — сделка не исполняется (недостаточно уверен).` });
      }
      await db.insert(tradeLogsTable).values({ figi: targetFigi, ticker: targetTicker, action: action === "hold" ? "hold" : "analyze", aiReasoning: fullResponse, success: true });
    }

    sendEvent({ done: true });
    res.end();
  } catch (err) {
    logger.error({ err }, "Agent analyze error");
    try {
      res.write(`data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Неизвестная ошибка" })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (_e) { /* ignore */ }
  }
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
