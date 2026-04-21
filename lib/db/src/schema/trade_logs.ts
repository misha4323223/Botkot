import { pgTable, text, serial, timestamp, boolean, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradeLogsTable = pgTable("trade_logs", {
  id: serial("id").primaryKey(),
  figi: text("figi").notNull(),
  ticker: text("ticker").notNull(),
  action: text("action").notNull(), // buy | sell | hold | analyze
  quantity: integer("quantity"),
  price: real("price"),
  aiReasoning: text("ai_reasoning").notNull(),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTradeLogSchema = createInsertSchema(tradeLogsTable).omit({ id: true, createdAt: true });
export type InsertTradeLog = z.infer<typeof insertTradeLogSchema>;
export type TradeLog = typeof tradeLogsTable.$inferSelect;
