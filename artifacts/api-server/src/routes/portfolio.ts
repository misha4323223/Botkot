import { Router, type IRouter } from "express";
import { tinkoffPost, parseMoneyValue, parseQuotation } from "../lib/tinkoff";
import { getOrCreateSettings } from "./settings";
import { db, tradeLogsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

const router: IRouter = Router();

router.get("/portfolio/paper", async (_req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  const rows = await db.select().from(tradeLogsTable).where(
    and(eq(tradeLogsTable.mode, "paper"), eq(tradeLogsTable.success, true))
  );

  // Aggregate by ticker: net qty (buys − sells), weighted avg buy price
  const map = new Map<string, { figi: string; ticker: string; qty: number; cost: number; trades: number }>();
  for (const r of rows) {
    if (r.action !== "buy" && r.action !== "sell") continue;
    const key = r.ticker;
    const cur = map.get(key) ?? { figi: r.figi, ticker: r.ticker, qty: 0, cost: 0, trades: 0 };
    const qty = r.quantity ?? 1;
    const price = r.price ?? 0;
    if (r.action === "buy") { cur.qty += qty; cur.cost += qty * price; }
    else { cur.qty -= qty; cur.cost -= qty * price; }
    cur.trades += 1;
    map.set(key, cur);
  }

  const open = Array.from(map.values()).filter(p => p.qty > 0);

  // Fetch current prices
  const figis = open.map(p => p.figi);
  let prices: Record<string, number> = {};
  if (figis.length > 0 && s.token) {
    try {
      const data = await tinkoffPost<{ lastPrices?: { figi?: string; price?: { units?: string; nano?: number } }[] }>(
        "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
        { figi: figis }, s.token, s.isSandbox
      );
      for (const lp of data.lastPrices ?? []) {
        if (lp.figi) prices[lp.figi] = parseQuotation(lp.price);
      }
    } catch (_e) { /* ignore */ }
  }

  const positions = open.map(p => {
    const avg = p.qty > 0 ? p.cost / p.qty : 0;
    const cur = prices[p.figi] ?? 0;
    const value = cur * p.qty;
    const pnl = (cur - avg) * p.qty;
    const pnlPct = avg > 0 ? ((cur - avg) / avg) * 100 : 0;
    return { figi: p.figi, ticker: p.ticker, quantity: p.qty, averagePrice: avg, currentPrice: cur, currentValue: value, unrealizedPnl: pnl, unrealizedPnlPercent: pnlPct, trades: p.trades };
  });

  const totalValue = positions.reduce((a, p) => a + p.currentValue, 0);
  const totalPnl = positions.reduce((a, p) => a + p.unrealizedPnl, 0);

  res.json({ positions, totalValue, totalPnl, paperMode: s.paperMode });
});

router.get("/portfolio/accounts", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.status(400).json({ error: "API token not configured. Please add your Tinkoff token in Settings." });
    return;
  }

  try {
    const data = await tinkoffPost<{ accounts: TinkoffAccount[] }>(
      "/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts",
      {},
      s.token,
      s.isSandbox
    );

    const accounts = (data.accounts ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
    }));
    res.json(accounts);
  } catch (err) {
    req.log.error({ err }, "Failed to get accounts");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to get accounts" });
  }
});

router.get("/portfolio", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.status(400).json({ error: "API token not configured. Please add your Tinkoff token in Settings." });
    return;
  }

  const accountId = s.accountId ?? "";

  try {
    const data = await tinkoffPost<TinkoffPortfolioResponse>(
      "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio",
      { accountId, currency: "RUB" },
      s.token,
      s.isSandbox
    );

    const all = [...(data.positions ?? []), ...(data.virtualPositions ?? [])];
    const positions = all
      .filter((p) => (p.instrumentType ?? "share") !== "currency")
      .map((p) => {
        const avg = parseMoneyValue(p.averagePositionPrice);
        const curr = parseMoneyValue(p.currentPrice);
        const qty = parseMoneyValue(p.quantity);
        const pnl = parseMoneyValue(p.expectedYield);
        const currValue = curr * qty;
        const pnlPct = avg > 0 ? (pnl / (avg * qty)) * 100 : 0;
        return {
          figi: p.figi,
          ticker: p.ticker ?? p.figi,
          name: p.instrumentType ?? p.figi,
          quantity: qty,
          averagePrice: avg,
          currentPrice: curr,
          currentValue: currValue,
          unrealizedPnl: pnl,
          unrealizedPnlPercent: pnlPct,
          instrumentType: p.instrumentType ?? "share",
        };
      });

    res.json({
      positions,
      totalAmountRub: parseMoneyValue(data.totalAmountPortfolio),
      expectedYield: parseMoneyValue(data.expectedYield),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get portfolio");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to get portfolio" });
  }
});

router.get("/portfolio/summary", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.status(400).json({ error: "API token not configured. Please add your Tinkoff token in Settings." });
    return;
  }

  const accountId = s.accountId ?? "";

  try {
    const data = await tinkoffPost<TinkoffPortfolioResponse>(
      "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio",
      { accountId, currency: "RUB" },
      s.token,
      s.isSandbox
    );

    const totalValue = parseMoneyValue(data.totalAmountPortfolio);
    const pnl = parseMoneyValue(data.expectedYield);
    const cashRub = parseMoneyValue(data.totalAmountCurrencies);
    const invested = totalValue > 0 ? totalValue - pnl : 0;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    const dailyPnl = parseMoneyValue(data.dailyYield);
    const dailyPnlPct = parseMoneyValue(data.dailyYieldRelative) * 100;
    const allPositions = [...(data.positions ?? []), ...(data.virtualPositions ?? [])]
      .filter((p) => (p.instrumentType ?? "share") !== "currency");

    res.json({
      totalValue,
      totalPnl: pnl,
      totalPnlPercent: pnlPct,
      dailyPnl,
      dailyPnlPercent: dailyPnlPct,
      positionsCount: allPositions.length,
      cashRub,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get portfolio summary");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to get portfolio summary" });
  }
});

interface TinkoffAccount {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface TinkoffPortfolioResponse {
  positions?: TinkoffPosition[];
  virtualPositions?: TinkoffPosition[];
  totalAmountPortfolio?: { units?: string; nano?: number; currency?: string };
  totalAmountCurrencies?: { units?: string; nano?: number; currency?: string };
  expectedYield?: { units?: string; nano?: number };
  dailyYield?: { units?: string; nano?: number };
  dailyYieldRelative?: { units?: string; nano?: number };
}

interface TinkoffPosition {
  figi: string;
  ticker?: string;
  instrumentType?: string;
  quantity?: { units?: string; nano?: number };
  averagePositionPrice?: { units?: string; nano?: number; currency?: string };
  expectedYield?: { units?: string; nano?: number };
  currentPrice?: { units?: string; nano?: number; currency?: string };
}

export default router;
