import { text, boolean, real, integer, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { traderSchema } from "./_schema";

export const settingsTable = traderSchema.table("settings", {
  id: serial("id").primaryKey(),
  token: text("token"),
  isSandbox: boolean("is_sandbox").notNull().default(false),
  accountId: text("account_id"),
  maxOrderAmount: real("max_order_amount").notNull().default(1000),
  riskPercent: real("risk_percent").notNull().default(2),
  agentIntervalMinutes: integer("agent_interval_minutes").notNull().default(60),
  paperMode: boolean("paper_mode").notNull().default(true),
  confidenceThreshold: integer("confidence_threshold").notNull().default(80),
  stopLossPercent: real("stop_loss_percent").notNull().default(3),
  takeProfitPercent: real("take_profit_percent").notNull().default(5),
  dailyLossLimitRub: real("daily_loss_limit_rub").notNull().default(0),
  maxTradesPerDay: integer("max_trades_per_day").notNull().default(0),
  priceLimitPercent: real("price_limit_percent").notNull().default(0.5),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
