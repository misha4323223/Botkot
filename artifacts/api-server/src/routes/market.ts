import { Router, type IRouter } from "express";
import { tinkoffPost, parseQuotation } from "../lib/tinkoff";
import { getOrCreateSettings } from "./settings";

const router: IRouter = Router();

router.get("/market/instruments", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.json([]);
    return;
  }

  const query = String(req.query.query ?? "");
  const type = String(req.query.type ?? "stock");

  try {
    const data = await tinkoffPost<{ instruments: TinkoffInstrument[] }>(
      "/tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument",
      { query, instrumentKind: typeToKind(type), apiTradeAvailableFlag: true },
      s.token,
      s.isSandbox
    );

    const instruments = (data.instruments ?? []).slice(0, 50).map((i) => ({
      figi: i.figi,
      ticker: i.ticker,
      name: i.name,
      type: kindToType(i.instrumentType ?? ""),
      currency: i.currency ?? "rub",
      exchange: i.exchange ?? "",
      lot: i.lot ?? 1,
    }));
    res.json(instruments);
  } catch (err) {
    req.log.error({ err }, "Failed to search instruments");
    res.json([]);
  }
});

router.get("/market/instruments/:figi/price", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.status(400).json({ error: "API token not configured" });
    return;
  }

  const figi = Array.isArray(req.params.figi) ? req.params.figi[0] : req.params.figi;

  try {
    const data = await tinkoffPost<{ lastPrices: TinkoffLastPrice[] }>(
      "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
      { figi: [figi] },
      s.token,
      s.isSandbox
    );

    const lp = data.lastPrices?.[0];
    res.json({
      figi,
      price: parseQuotation(lp?.price),
      time: lp?.time ?? new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get last price");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

router.get("/market/instruments/:figi/candles", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.json([]);
    return;
  }

  const figi = Array.isArray(req.params.figi) ? req.params.figi[0] : req.params.figi;
  const interval = String(req.query.interval ?? "day");
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    const data = await tinkoffPost<{ candles: TinkoffCandle[] }>(
      "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles",
      {
        figi,
        from: from.toISOString(),
        to: to.toISOString(),
        interval: intervalToEnum(interval),
      },
      s.token,
      s.isSandbox
    );

    const candles = (data.candles ?? []).map((c) => ({
      time: c.time,
      open: parseQuotation(c.open),
      high: parseQuotation(c.high),
      low: parseQuotation(c.low),
      close: parseQuotation(c.close),
      volume: Number(c.volume ?? 0),
    }));
    res.json(candles);
  } catch (err) {
    req.log.error({ err }, "Failed to get candles");
    res.json([]);
  }
});

function typeToKind(type: string): string {
  switch (type) {
    case "stock": return "INSTRUMENT_TYPE_SHARE";
    case "etf": return "INSTRUMENT_TYPE_ETF";
    case "bond": return "INSTRUMENT_TYPE_BOND";
    case "currency": return "INSTRUMENT_TYPE_CURRENCY";
    default: return "INSTRUMENT_TYPE_SHARE";
  }
}

function kindToType(kind: string): string {
  if (kind.includes("SHARE")) return "stock";
  if (kind.includes("ETF")) return "etf";
  if (kind.includes("BOND")) return "bond";
  if (kind.includes("CURRENCY")) return "currency";
  return "stock";
}

function intervalToEnum(interval: string): string {
  switch (interval) {
    case "1min": return "CANDLE_INTERVAL_1_MIN";
    case "5min": return "CANDLE_INTERVAL_5_MIN";
    case "15min": return "CANDLE_INTERVAL_15_MIN";
    case "hour": return "CANDLE_INTERVAL_HOUR";
    case "day": return "CANDLE_INTERVAL_DAY";
    case "week": return "CANDLE_INTERVAL_WEEK";
    case "month": return "CANDLE_INTERVAL_MONTH";
    default: return "CANDLE_INTERVAL_DAY";
  }
}

interface TinkoffInstrument {
  figi: string;
  ticker: string;
  name: string;
  instrumentType?: string;
  currency?: string;
  exchange?: string;
  lot?: number;
}

interface TinkoffLastPrice {
  figi: string;
  price?: { units?: string; nano?: number };
  time?: string;
}

interface TinkoffCandle {
  open?: { units?: string; nano?: number };
  high?: { units?: string; nano?: number };
  low?: { units?: string; nano?: number };
  close?: { units?: string; nano?: number };
  volume?: number;
  time: string;
}

export default router;
