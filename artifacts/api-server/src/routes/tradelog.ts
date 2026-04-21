import { Router, type IRouter } from "express";
import { db, tradeLogsTable } from "@workspace/db";
import { desc, count, sql } from "drizzle-orm";
import { ListTradeLogsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tradelog", async (req, res): Promise<void> => {
  const params = ListTradeLogsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const offset = params.success ? (params.data.offset ?? 0) : 0;

  const logs = await db
    .select()
    .from(tradeLogsTable)
    .orderBy(desc(tradeLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(
    logs.map((l) => ({
      id: l.id,
      figi: l.figi,
      ticker: l.ticker,
      action: l.action,
      quantity: l.quantity,
      price: l.price,
      aiReasoning: l.aiReasoning,
      success: l.success,
      errorMessage: l.errorMessage,
      createdAt: l.createdAt.toISOString(),
    }))
  );
});

router.get("/tradelog/stats", async (_req, res): Promise<void> => {
  const rows = await db.select().from(tradeLogsTable);
  const trades = rows.filter((r) => r.action === "buy" || r.action === "sell");
  const successful = trades.filter((r) => r.success);

  res.json({
    totalTrades: trades.length,
    successfulTrades: successful.length,
    winRate: trades.length > 0 ? successful.length / trades.length : 0,
    totalPnl: 0,
    avgHoldingHours: 0,
  });
});

export default router;
