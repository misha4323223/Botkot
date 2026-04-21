import { Router, type IRouter } from "express";
import { tinkoffPost, parseMoneyValue } from "../lib/tinkoff";
import { getOrCreateSettings } from "./settings";

const router: IRouter = Router();

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
