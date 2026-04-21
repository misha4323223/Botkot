import { Router, type IRouter } from "express";
import { db, watchlistTable, tradeLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { AnalyzeAndTradeBody, AddToWatchlistBody } from "@workspace/api-zod";
import { agentState, getAgentStatusResponse } from "../lib/agent-state";
import { getOrCreateSettings } from "./settings";
import { tinkoffPost, parseMoneyValue, parseQuotation } from "../lib/tinkoff";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/agent/status", async (_req, res): Promise<void> => {
  res.json(getAgentStatusResponse());
});

router.post("/agent/start", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (agentState.isRunning) {
    res.json(getAgentStatusResponse());
    return;
  }

  agentState.isRunning = true;
  agentState.nextRunAt = new Date();

  const intervalMs = (s.agentIntervalMinutes ?? 60) * 60 * 1000;
  agentState.intervalId = setInterval(async () => {
    try {
      await runAgentCycle(null);
    } catch (err) {
      logger.error({ err }, "Agent cycle error");
    }
  }, intervalMs);

  runAgentCycle(null).catch((err) => logger.error({ err }, "First agent cycle error"));

  req.log.info("AI trading agent started");
  res.json(getAgentStatusResponse());
});

router.post("/agent/stop", async (req, res): Promise<void> => {
  if (agentState.intervalId) {
    clearInterval(agentState.intervalId);
    agentState.intervalId = null;
  }
  agentState.isRunning = false;
  agentState.nextRunAt = null;
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
      sendEvent({ type: "error", message: "API token not configured. Please add your Tinkoff token in Settings." });
      sendEvent({ done: true });
      res.end();
      return;
    }

    sendEvent({ type: "thinking", message: "Собираю данные о рынке..." });

    // Get portfolio
    let portfolioSummary = "Портфель недоступен";
    try {
      const portData = await tinkoffPost<{ positions?: unknown[]; expectedYield?: { units?: string; nano?: number }; totalAmountPortfolio?: { units?: string; nano?: number } }>(
        "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio",
        { accountId: s.accountId ?? "", currency: "RUB" },
        s.token,
        s.isSandbox
      );
      const totalValue = parseMoneyValue(portData.totalAmountPortfolio);
      const pnl = parseMoneyValue(portData.expectedYield);
      portfolioSummary = `Портфель: ${totalValue.toFixed(0)} ₽, PnL: ${pnl.toFixed(0)} ₽, Позиций: ${portData.positions?.length ?? 0}`;
    } catch (_e) {
      // ignore
    }

    // Get instruments to analyze
    const watchlist = await db.select().from(watchlistTable).limit(10);
    const targetFigi = figi ?? (watchlist.length > 0 ? watchlist[Math.floor(Math.random() * watchlist.length)].figi : null);
    const targetTicker = watchlist.find((w) => w.figi === targetFigi)?.ticker ?? targetFigi ?? "UNKNOWN";

    let priceContext = "";
    if (targetFigi) {
      sendEvent({ type: "thinking", message: `Получаю котировки для ${targetTicker}...` });

      try {
        const priceData = await tinkoffPost<{ lastPrices?: { price?: { units?: string; nano?: number } }[] }>(
          "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
          { figi: [targetFigi] },
          s.token,
          s.isSandbox
        );
        const price = parseQuotation(priceData.lastPrices?.[0]?.price);
        priceContext = `Текущая цена ${targetTicker}: ${price.toFixed(2)} ₽`;
      } catch (_e) {
        priceContext = `Цена для ${targetTicker} недоступна`;
      }
    }

    // Get recent trade logs
    const recentLogs = await db
      .select()
      .from(tradeLogsTable)
      .orderBy(desc(tradeLogsTable.createdAt))
      .limit(5);
    const logContext = recentLogs.length > 0
      ? recentLogs.map((l) => `${l.action.toUpperCase()} ${l.ticker}: ${l.aiReasoning.slice(0, 100)}`).join("\n")
      : "Нет истории сделок";

    sendEvent({ type: "thinking", message: "Анализирую данные с помощью ИИ..." });

    const systemPrompt = `Ты — профессиональный алготрейдер на российском рынке ценных бумаг. 
Ты анализируешь данные и принимаешь торговые решения. Твои решения должны быть обоснованы и консервативны.
Максимальная сумма одной сделки: ${s.maxOrderAmount ?? 1000} ₽.
Допустимый риск на сделку: ${s.riskPercent ?? 2}%.

Отвечай только на русском языке. Будь конкретным и точным.`;

    const userPrompt = `Проанализируй текущую ситуацию и прими торговое решение.

ДАННЫЕ ПОРТФЕЛЯ:
${portfolioSummary}

ИНСТРУМЕНТ ДЛЯ АНАЛИЗА:
${targetFigi ? priceContext : "Нет инструментов в списке наблюдения. Добавь инструменты в Watchlist."}

ИСТОРИЯ ПОСЛЕДНИХ РЕШЕНИЙ:
${logContext}

ЗАДАЧА:
1. Проведи технический анализ доступных данных
2. Оцени рыночные условия (тренд, волатильность, риски)
3. Прими решение: КУПИТЬ / ПРОДАТЬ / ДЕРЖАТЬ
4. Обоснуй решение (2-3 предложения)
5. Если решение КУПИТЬ или ПРОДАТЬ, укажи: количество лотов (1-3), целевую цену, стоп-лосс

Формат ответа:
РЕШЕНИЕ: [КУПИТЬ/ПРОДАТЬ/ДЕРЖАТЬ]
ИНСТРУМЕНТ: [ticker]
ОБОСНОВАНИЕ: [твой анализ]
${executeIfConfident ? "ДЕЙСТВИЕ: Выполнить сделку если уверен на 80%+" : "ДЕЙСТВИЕ: Только анализ, не торговать"}`;

    agentState.totalAnalyses++;
    agentState.lastRunAt = new Date();

    let fullResponse = "";
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
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

    // Parse the decision
    const decisionMatch = fullResponse.match(/РЕШЕНИЕ:\s*(КУПИТЬ|ПРОДАТЬ|ДЕРЖАТЬ)/i);
    const decision = decisionMatch ? decisionMatch[1].toLowerCase() : "hold";
    const actionMap: Record<string, "buy" | "sell" | "hold" | "analyze"> = {
      "купить": "buy",
      "продать": "sell",
      "держать": "hold",
    };
    const action = actionMap[decision] ?? "analyze";

    agentState.lastAction = fullResponse.slice(0, 100);

    // Execute trade if requested and decision is buy/sell
    if (executeIfConfident && (action === "buy" || action === "sell") && targetFigi) {
      sendEvent({ type: "thinking", message: `Исполняю сделку: ${action.toUpperCase()} ${targetTicker}...` });

      try {
        const body: Record<string, unknown> = {
          figi: targetFigi,
          quantity: "1",
          direction: action === "buy" ? "ORDER_DIRECTION_BUY" : "ORDER_DIRECTION_SELL",
          accountId: s.accountId ?? "",
          orderType: "ORDER_TYPE_MARKET",
          orderId: randomUUID(),
        };

        const endpoint = s.isSandbox
          ? "/tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder"
          : "/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder";

        await tinkoffPost(endpoint, body, s.token, s.isSandbox);
        agentState.totalTradesExecuted++;

        await db.insert(tradeLogsTable).values({
          figi: targetFigi,
          ticker: targetTicker,
          action,
          quantity: 1,
          price: null,
          aiReasoning: fullResponse,
          success: true,
        });

        sendEvent({ type: "trade_executed", action, ticker: targetTicker, message: `Сделка исполнена: ${action.toUpperCase()} 1 лот ${targetTicker}` });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Ошибка исполнения сделки";
        await db.insert(tradeLogsTable).values({
          figi: targetFigi ?? "UNKNOWN",
          ticker: targetTicker,
          action,
          aiReasoning: fullResponse,
          success: false,
          errorMessage: errMsg,
        });
        sendEvent({ type: "error", message: `Ошибка исполнения: ${errMsg}` });
      }
    } else {
      // Log the analysis
      if (targetFigi) {
        await db.insert(tradeLogsTable).values({
          figi: targetFigi,
          ticker: targetTicker,
          action: action === "hold" ? "hold" : "analyze",
          aiReasoning: fullResponse,
          success: true,
        });
      }
    }

    sendEvent({ done: true });
    res.end();
  } catch (err) {
    logger.error({ err }, "Agent analyze error");
    const sendSafe = (data: Record<string, unknown>) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_e) { /* ignore */ }
    };
    sendSafe({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
    sendSafe({ done: true });
    res.end();
  }
});

router.get("/agent/watchlist", async (_req, res): Promise<void> => {
  const items = await db.select().from(watchlistTable).orderBy(desc(watchlistTable.addedAt));
  res.json(
    items.map((i) => ({
      id: i.id,
      figi: i.figi,
      ticker: i.ticker,
      name: i.name,
      addedAt: i.addedAt.toISOString(),
    }))
  );
});

router.post("/agent/watchlist", async (req, res): Promise<void> => {
  const parsed = AddToWatchlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [item] = await db
    .insert(watchlistTable)
    .values(parsed.data)
    .returning();

  res.status(201).json({
    id: item.id,
    figi: item.figi,
    ticker: item.ticker,
    name: item.name,
    addedAt: item.addedAt.toISOString(),
  });
});

router.delete("/agent/watchlist/:id", async (req, res): Promise<void> => {
  const raw = req.params.id;
  const id = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.delete(watchlistTable).where(eq(watchlistTable.id, id));
  res.sendStatus(204);
});

async function runAgentCycle(specificFigi: string | null) {
  try {
    const s = await getOrCreateSettings();
    if (!s.token) return;

    const watchlist = await db.select().from(watchlistTable).limit(5);
    const targets = specificFigi ? [{ figi: specificFigi, ticker: specificFigi, name: specificFigi }] : watchlist;
    if (targets.length === 0) return;

    agentState.lastRunAt = new Date();
    agentState.nextRunAt = new Date(Date.now() + (s.agentIntervalMinutes ?? 60) * 60 * 1000);
    agentState.totalAnalyses++;

    const target = targets[Math.floor(Math.random() * targets.length)];

    let priceContext = "";
    try {
      const priceData = await tinkoffPost<{ lastPrices?: { price?: { units?: string; nano?: number } }[] }>(
        "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
        { figi: [target.figi] },
        s.token,
        s.isSandbox
      );
      const price = parseQuotation(priceData.lastPrices?.[0]?.price);
      priceContext = `Текущая цена ${target.ticker}: ${price.toFixed(2)} ₽`;
    } catch (_e) {
      priceContext = "Цена недоступна";
    }

    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты — алготрейдер. Максимальная сумма: ${s.maxOrderAmount} ₽. Риск: ${s.riskPercent}%. Отвечай кратко.`,
        },
        {
          role: "user",
          content: `${priceContext}\nПрими решение: КУПИТЬ/ПРОДАТЬ/ДЕРЖАТЬ ${target.ticker}. Обоснование в 1 предложении.`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "ДЕРЖАТЬ";
    const decision = text.includes("КУПИТЬ") ? "buy" : text.includes("ПРОДАТЬ") ? "sell" : "hold";

    agentState.lastAction = text.slice(0, 100);

    if (decision !== "hold") {
      try {
        const body = {
          figi: target.figi,
          quantity: "1",
          direction: decision === "buy" ? "ORDER_DIRECTION_BUY" : "ORDER_DIRECTION_SELL",
          accountId: s.accountId ?? "",
          orderType: "ORDER_TYPE_MARKET",
          orderId: randomUUID(),
        };
        const endpoint = s.isSandbox
          ? "/tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder"
          : "/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder";

        await tinkoffPost(endpoint, body, s.token, s.isSandbox);
        agentState.totalTradesExecuted++;

        await db.insert(tradeLogsTable).values({
          figi: target.figi,
          ticker: target.ticker,
          action: decision,
          quantity: 1,
          aiReasoning: text,
          success: true,
        });
      } catch (err) {
        await db.insert(tradeLogsTable).values({
          figi: target.figi,
          ticker: target.ticker,
          action: decision,
          aiReasoning: text,
          success: false,
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        });
      }
    } else {
      await db.insert(tradeLogsTable).values({
        figi: target.figi,
        ticker: target.ticker,
        action: "hold",
        aiReasoning: text,
        success: true,
      });
    }
  } catch (err) {
    logger.error({ err }, "Background agent cycle error");
  }
}

export default router;
