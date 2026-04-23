import { tinkoffPost, parseQuotation } from "./tinkoff";
import { logger } from "./logger";

export interface OrderBookL1 {
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  spreadPct: number;
  midPrice: number;
  imbalance: number;
}

interface RawOrder {
  price?: { units?: string; nano?: number };
  quantity?: string | number;
}

interface RawOrderBook {
  bids?: RawOrder[];
  asks?: RawOrder[];
  lastPrice?: { units?: string; nano?: number };
  closePrice?: { units?: string; nano?: number };
  limitUp?: { units?: string; nano?: number };
  limitDown?: { units?: string; nano?: number };
}

function qtyToNum(q: unknown): number {
  if (typeof q === "number") return q;
  if (typeof q === "string") return Number(q) || 0;
  return 0;
}

export async function getOrderBookL1(
  figi: string,
  token: string,
  isSandbox: boolean,
  depth = 5,
): Promise<OrderBookL1 | null> {
  try {
    const data = await tinkoffPost<RawOrderBook>(
      "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetOrderBook",
      { figi, depth },
      token,
      isSandbox,
    );
    const topBid = (data.bids ?? [])[0];
    const topAsk = (data.asks ?? [])[0];
    const bid = parseQuotation(topBid?.price);
    const ask = parseQuotation(topAsk?.price);
    if (bid <= 0 || ask <= 0 || ask < bid) return null;

    const bidQty = qtyToNum(topBid?.quantity);
    const askQty = qtyToNum(topAsk?.quantity);

    // Aggregate top-N depth for imbalance signal: positive = buyers stronger.
    const totalBidVol = (data.bids ?? []).slice(0, depth).reduce((a, b) => a + qtyToNum(b.quantity), 0);
    const totalAskVol = (data.asks ?? []).slice(0, depth).reduce((a, b) => a + qtyToNum(b.quantity), 0);
    const imbalanceDenom = totalBidVol + totalAskVol;
    const imbalance = imbalanceDenom > 0 ? (totalBidVol - totalAskVol) / imbalanceDenom : 0;

    const mid = (bid + ask) / 2;
    const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 0;

    return { bid, ask, bidQty, askQty, spreadPct, midPrice: mid, imbalance };
  } catch (err) {
    logger.warn({ err, figi }, "getOrderBookL1 failed");
    return null;
  }
}

export function formatOrderBookForPrompt(ob: OrderBookL1 | null, lot: number): string {
  if (!ob) return "Стакан недоступен.";
  const imbalanceLabel = ob.imbalance > 0.2 ? "покупатели сильнее"
    : ob.imbalance < -0.2 ? "продавцы сильнее"
    : "баланс";
  const spreadFlag = ob.spreadPct > 0.5 ? " ⚠️ ШИРОКИЙ СПРЕД" : ob.spreadPct > 0.2 ? " (заметный)" : "";
  return `Bid ${ob.bid.toFixed(2)}₽ × ${ob.bidQty} лотов | Ask ${ob.ask.toFixed(2)}₽ × ${ob.askQty} лотов
Спред: ${ob.spreadPct.toFixed(2)}%${spreadFlag} | Mid: ${ob.midPrice.toFixed(2)}₽
Дисбаланс топ-5: ${(ob.imbalance * 100).toFixed(0)}% (${imbalanceLabel})
Лот: ${lot} шт.`;
}
