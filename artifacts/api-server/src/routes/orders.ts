import { Router, type IRouter } from "express";
import { tinkoffPost, parseMoneyValue, parseQuotation } from "../lib/tinkoff";
import { getOrCreateSettings } from "./settings";
import { PlaceOrderBody } from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router: IRouter = Router();

router.get("/orders", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.json([]);
    return;
  }

  try {
    const data = await tinkoffPost<{ orders: TinkoffOrder[] }>(
      "/tinkoff.public.invest.api.contract.v1.OrdersService/GetOrders",
      { accountId: s.accountId ?? "" },
      s.token,
      s.isSandbox
    );

    const orders = (data.orders ?? []).map((o) => ({
      orderId: o.orderId,
      figi: o.figi,
      ticker: o.figi,
      direction: o.direction?.includes("BUY") ? "buy" : "sell",
      type: o.orderType?.includes("LIMIT") ? "limit" : "market",
      quantity: o.lotsRequested ?? 0,
      price: o.initialSecurityPrice ? parseMoneyValue(o.initialSecurityPrice) : null,
      status: o.executionReportStatus ?? "UNKNOWN",
      createdAt: o.orderDate ?? new Date().toISOString(),
    }));
    res.json(orders);
  } catch (err) {
    req.log.error({ err }, "Failed to get orders");
    res.json([]);
  }
});

router.post("/orders", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.status(400).json({ error: "API token not configured" });
    return;
  }

  const parsed = PlaceOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { figi, direction, quantity, orderType, price } = parsed.data;

  try {
    const body: Record<string, unknown> = {
      figi,
      quantity: String(quantity),
      direction: direction === "buy" ? "ORDER_DIRECTION_BUY" : "ORDER_DIRECTION_SELL",
      accountId: s.accountId ?? "",
      orderType: orderType === "limit" ? "ORDER_TYPE_LIMIT" : "ORDER_TYPE_MARKET",
      orderId: randomUUID(),
    };

    if (orderType === "limit" && price != null) {
      const units = Math.floor(price);
      const nano = Math.round((price - units) * 1e9);
      body.price = { units: String(units), nano };
    }

    const endpoint = s.isSandbox
      ? "/tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder"
      : "/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder";

    const data = await tinkoffPost<TinkoffOrderResult>(endpoint, body, s.token, s.isSandbox);

    res.status(201).json({
      orderId: data.orderId,
      figi,
      ticker: figi,
      direction,
      type: orderType,
      quantity,
      price: price ?? null,
      status: data.executionReportStatus ?? "PENDING",
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to place order");
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to place order" });
  }
});

router.delete("/orders/:orderId", async (req, res): Promise<void> => {
  const s = await getOrCreateSettings();
  if (!s.token) {
    res.status(404).json({ error: "API token not configured" });
    return;
  }

  const raw = req.params.orderId;
  const orderId = Array.isArray(raw) ? raw[0] : raw;

  try {
    await tinkoffPost(
      "/tinkoff.public.invest.api.contract.v1.OrdersService/CancelOrder",
      { accountId: s.accountId ?? "", orderId },
      s.token,
      s.isSandbox
    );
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Failed to cancel order");
    res.status(404).json({ error: err instanceof Error ? err.message : "Failed to cancel order" });
  }
});

interface TinkoffOrder {
  orderId: string;
  figi: string;
  direction?: string;
  orderType?: string;
  lotsRequested?: number;
  initialSecurityPrice?: { units?: string; nano?: number; currency?: string };
  executionReportStatus?: string;
  orderDate?: string;
}

interface TinkoffOrderResult {
  orderId: string;
  executionReportStatus?: string;
}

export default router;
