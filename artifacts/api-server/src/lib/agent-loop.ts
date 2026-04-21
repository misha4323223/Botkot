import { db, watchlistTable, tradeLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { agentState } from "./agent-state";
import { tinkoffPost, parseQuotation, parseMoneyValue } from "./tinkoff";
import { logger } from "./logger";
import { withRetry } from "./openai-retry";
import { randomUUID } from "crypto";

interface AgentContext {
  cashRub: number;
  positions: { figi: string; qty: number; avg: number; curr: number; pnl: number }[];
}

async function getAccountContext(token: string, accountId: string, isSandbox: boolean): Promise<AgentContext> {
  try {
    const data = await tinkoffPost<{
      positions?: { figi: string; quantity?: { units?: string; nano?: number }; averagePositionPrice?: { units?: string; nano?: number }; currentPrice?: { units?: string; nano?: number }; expectedYield?: { units?: string; nano?: number } }[];
      totalAmountCurrencies?: { units?: string; nano?: number };
    }>(
      "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio",
      { accountId, currency: "RUB" },
      token,
      isSandbox
    );
    const positions = (data.positions ?? [])
      .map(p => ({
        figi: p.figi,
        qty: parseMoneyValue(p.quantity),
        avg: parseMoneyValue(p.averagePositionPrice),
        curr: parseMoneyValue(p.currentPrice),
        pnl: parseMoneyValue(p.expectedYield),
      }))
      .filter(p => p.qty > 0);
    return { cashRub: parseMoneyValue(data.totalAmountCurrencies), positions };
  } catch {
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

/**
 * MOEX main session: Mon–Fri 10:00–18:50 Moscow time (UTC+3).
 * Evening session for some instruments: 19:05–23:50, but we skip it for safety.
 */
export function isMoexOpen(): { open: boolean; reason: string } {
  const nowUtc = new Date();
  // Moscow is UTC+3
  const msk = new Date(nowUtc.getTime() + 3 * 60 * 60 * 1000);
  const day = msk.getUTCDay(); // 0=Sun, 6=Sat
  const h = msk.getUTCHours();
  const m = msk.getUTCMinutes();
  const timeMin = h * 60 + m;

  if (day === 0 || day === 6) {
    return { open: false, reason: `Биржа закрыта: выходной день (${day === 0 ? "воскресенье" : "суббота"})` };
  }
  // Main session: 10:00 (600) – 18:50 (1130)
  if (timeMin < 600) {
    return { open: false, reason: `Биржа ещё не открылась — откроется в 10:00 МСК (сейчас ${h}:${String(m).padStart(2, "0")} МСК)` };
  }
  if (timeMin >= 1130) {
    return { open: false, reason: `Биржа закрыта — основная сессия до 18:50 МСК (сейчас ${h}:${String(m).padStart(2, "0")} МСК)` };
  }
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

export async function getCandleSummary(figi: string, token: string, isSandbox: boolean): Promise<string> {
  try {
    const to = new Date();
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

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
      { figi, from: from.toISOString(), to: to.toISOString(), interval: "CANDLE_INTERVAL_DAY" },
      token,
      isSandbox
    );

    const candles = data.candles ?? [];
    if (candles.length === 0) return "История свечей недоступна.";

    const recent = candles.slice(-20);
    const closes = recent.map(c => parseQuotation(c.close));
    const highs = recent.map(c => parseQuotation(c.high));
    const lows = recent.map(c => parseQuotation(c.low));
    const volumes = recent.map(c => Number(c.volume ?? 0));

    const first = closes[0];
    const last = closes[closes.length - 1];
    const change = first > 0 ? ((last - first) / first * 100).toFixed(1) : "0";
    const maxHigh = Math.max(...highs).toFixed(2);
    const minLow = Math.min(...lows).toFixed(2);
    const avgVol = Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length);
    const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, closes.length);
    const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, closes.length);
    const trend = last > ma5 && ma5 > ma10 ? "восходящий" : last < ma5 && ma5 < ma10 ? "нисходящий" : "боковой";

    const candleRows = recent.slice(-10).map((c) => {
      const d = c.time ? new Date(c.time).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) : "—";
      return `  ${d}: O=${parseQuotation(c.open).toFixed(2)} H=${parseQuotation(c.high).toFixed(2)} L=${parseQuotation(c.low).toFixed(2)} C=${parseQuotation(c.close).toFixed(2)} Vol=${c.volume ?? 0}`;
    }).join("\n");

    return `История (30д, ${candles.length} свечей): изм. ${change}%, диапазон ${minLow}–${maxHigh}₽, MA5=${ma5.toFixed(2)}, MA10=${ma10.toFixed(2)}, тренд: ${trend}, ср.объём: ${avgVol.toLocaleString()}\nПоследние 10 дней:\n${candleRows}`;
  } catch {
    return "История свечей недоступна.";
  }
}

export async function runAgentCycle(specificFigi: string | null) {
  const s = await getOrCreateSettingsForLoop();
  if (!s.token) return;

  const watchlist = await db.select().from(watchlistTable).limit(5);
  const targets = specificFigi
    ? [{ figi: specificFigi, ticker: specificFigi, name: specificFigi }]
    : watchlist;
  if (targets.length === 0) return;

  agentState.lastRunAt = new Date();
  agentState.nextRunAt = new Date(Date.now() + (s.agentIntervalMinutes ?? 60) * 60 * 1000);
  agentState.totalAnalyses++;

  const target = targets[Math.floor(Math.random() * targets.length)];

  let currentPrice = 0;
  try {
    const priceData = await tinkoffPost<{ lastPrices?: { price?: { units?: string; nano?: number } }[] }>(
      "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
      { figi: [target.figi] },
      s.token,
      s.isSandbox
    );
    currentPrice = parseQuotation(priceData.lastPrices?.[0]?.price);
  } catch { /* ignore */ }

  const candleSummary = await getCandleSummary(target.figi, s.token, s.isSandbox ?? false);

  const recentLogs = await db.select().from(tradeLogsTable).orderBy(desc(tradeLogsTable.createdAt)).limit(3);
  const logCtx = recentLogs.map(l => `${l.action.toUpperCase()} ${l.ticker}: ${l.aiReasoning.slice(0, 80)}`).join("\n") || "Нет истории";

  const ctx = await getAccountContext(s.token, s.accountId ?? "", s.isSandbox ?? false);
  const lot = await getInstrumentLot(target.figi, s.token, s.isSandbox ?? false);
  const myPosition = ctx.positions.find(p => p.figi === target.figi);
  const positionsSummary = ctx.positions.length === 0
    ? "Открытых позиций нет."
    : ctx.positions.map(p => `  ${p.figi}: ${p.qty} шт. по ${p.avg.toFixed(2)}₽ (тек. ${p.curr.toFixed(2)}₽, P&L ${p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}₽)`).join("\n");
  const myPosSummary = myPosition
    ? `У тебя уже есть ${myPosition.qty} шт. по средней ${myPosition.avg.toFixed(2)}₽, P&L ${myPosition.pnl >= 0 ? "+" : ""}${myPosition.pnl.toFixed(2)}₽.`
    : "По этой бумаге позиции нет.";

  const response = await withRetry(() => openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: `Ты — алготрейдер на Московской Бирже. Максимальная сумма ордера: ${s.maxOrderAmount} ₽. Риск: ${s.riskPercent}%. Отвечай кратко на русском.\nПравила:\n— Не покупай, если на счёте недостаточно свободных средств.\n— Не продавай, если позиции по бумаге нет.\n— Учитывай текущий P&L открытых позиций.`,
      },
      {
        role: "user",
        content: `Состояние счёта:\nСвободно ₽: ${ctx.cashRub.toFixed(2)}\nОткрытые позиции:\n${positionsSummary}\n\nКандидат: ${target.ticker} (${target.figi})\nТекущая цена: ${currentPrice > 0 ? `${currentPrice.toFixed(2)} ₽` : "н/д"}, лот: ${lot}\n${myPosSummary}\n\n${candleSummary}\n\nИстория решений:\n${logCtx}\n\nПрими решение: КУПИТЬ/ПРОДАТЬ/ДЕРЖАТЬ.\nФормат: РЕШЕНИЕ: X | УВЕРЕННОСТЬ: N% | ОБОСНОВАНИЕ: (1 предложение)`,
      },
    ],
  }));

  const text = response.choices[0]?.message?.content ?? "ДЕРЖАТЬ";
  const decision = /КУПИТЬ/i.test(text) ? "buy" : /ПРОДАТЬ/i.test(text) ? "sell" : "hold";
  const confMatch = text.match(/УВЕРЕННОСТЬ:\s*(\d+)/i);
  const confidence = confMatch ? parseInt(confMatch[1]) : 50;

  agentState.lastAction = `${decision.toUpperCase()} ${target.ticker} (${confidence}%)`;
  logger.info({ decision, ticker: target.ticker, confidence }, "Agent cycle decision");

  if (decision !== "hold" && confidence >= 80) {
    const market = isMoexOpen();
    if (!market.open) {
      logger.info({ ticker: target.ticker, reason: market.reason }, "Trade skipped: market closed");
      await db.insert(tradeLogsTable).values({
        figi: target.figi,
        ticker: target.ticker,
        action: "hold",
        aiReasoning: `${text}\n\n⏰ Сделка не исполнена: ${market.reason}`,
        success: true,
      });
    } else {
      // Compute order quantity (in lots).
      let lots = 0;
      let skipReason = "";
      if (decision === "buy") {
        if (currentPrice <= 0) {
          skipReason = "нет текущей цены";
        } else {
          const budget = Math.min(s.maxOrderAmount, ctx.cashRub);
          const lotPrice = currentPrice * lot;
          lots = Math.floor(budget / lotPrice);
          if (lots <= 0) {
            skipReason = `недостаточно средств (нужно ${lotPrice.toFixed(2)}₽ за лот, свободно ${ctx.cashRub.toFixed(2)}₽, лимит ${s.maxOrderAmount}₽)`;
          }
        }
      } else {
        // sell
        if (!myPosition || myPosition.qty <= 0) {
          skipReason = "нет позиции для продажи";
        } else {
          lots = Math.max(1, Math.floor(myPosition.qty / lot));
        }
      }

      if (skipReason) {
        await db.insert(tradeLogsTable).values({
          figi: target.figi,
          ticker: target.ticker,
          action: "hold",
          aiReasoning: `${text}\n\n⛔ Сделка не исполнена: ${skipReason}`,
          success: true,
        });
        logger.info({ ticker: target.ticker, decision, skipReason }, "Trade skipped");
      } else {
        try {
          await tinkoffPost(
            s.isSandbox
              ? "/tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder"
              : "/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder",
            {
              figi: target.figi,
              quantity: String(lots),
              direction: decision === "buy" ? "ORDER_DIRECTION_BUY" : "ORDER_DIRECTION_SELL",
              accountId: s.accountId ?? "",
              orderType: "ORDER_TYPE_MARKET",
              orderId: randomUUID(),
            },
            s.token,
            s.isSandbox
          );
          agentState.totalTradesExecuted++;
          await db.insert(tradeLogsTable).values({ figi: target.figi, ticker: target.ticker, action: decision as "buy" | "sell", quantity: lots * lot, price: currentPrice || null, aiReasoning: text, success: true });
          logger.info({ ticker: target.ticker, decision, confidence, lots }, "Trade executed by agent");
        } catch (err) {
          await db.insert(tradeLogsTable).values({ figi: target.figi, ticker: target.ticker, action: decision as "buy" | "sell", aiReasoning: text, success: false, errorMessage: err instanceof Error ? err.message : "Unknown" });
          logger.error({ err, ticker: target.ticker }, "Trade execution failed");
        }
      }
    }
  } else {
    await db.insert(tradeLogsTable).values({ figi: target.figi, ticker: target.ticker, action: "hold", aiReasoning: text, success: true });
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

  const intervalMs = (s.agentIntervalMinutes ?? 60) * 60 * 1000;
  agentState.intervalId = setInterval(async () => {
    try { await runAgentCycle(null); } catch (err) { logger.error({ err }, "Agent cycle error"); }
  }, intervalMs);

  // Run first cycle immediately
  runAgentCycle(null).catch(err => logger.error({ err }, "First agent cycle error"));
}

export function stopAgentLoop(): void {
  if (agentState.intervalId) {
    clearInterval(agentState.intervalId);
    agentState.intervalId = null;
  }
  agentState.isRunning = false;
  agentState.nextRunAt = null;
}
