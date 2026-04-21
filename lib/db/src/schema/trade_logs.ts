import { text, serial, timestamp, boolean, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { traderSchema } from "./_schema";

export const tradeLogsTable = traderSchema.table("trade_logs", {
  id: serial("id").primaryKey(),
  figi: text("figi").notNull(),
  ticker: text("ticker").notNull(),
  action: text("action").notNull(),
  quantity: integer("quantity"),
  price: real("price"),
  aiReasoning: text("ai_reasoning").notNull(),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  mode: text("mode").notNull().default("paper"),
  confidence: integer("confidence").notNull().default(0),
  signals: text("signals"),
  plannedStopLoss: real("planned_stop_loss"),
  plannedTakeProfit: real("planned_take_profit"),
  closedAt: timestamp("closed_at"),
  closePrice: real("close_price"),
  realizedPnl: real("realized_pnl"),
  closeReason: text("close_reason"),
});

export const insertTradeLogSchema = createInsertSchema(tradeLogsTable).omit({ id: true, createdAt: true });
export type InsertTradeLog = z.infer<typeof insertTradeLogSchema>;
export type TradeLog = typeof tradeLogsTable.$inferSelect;
