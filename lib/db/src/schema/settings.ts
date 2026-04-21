import { pgTable, text, boolean, real, integer, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  token: text("token"),
  isSandbox: boolean("is_sandbox").notNull().default(false),
  accountId: text("account_id"),
  maxOrderAmount: real("max_order_amount").notNull().default(1000),
  riskPercent: real("risk_percent").notNull().default(2),
  agentIntervalMinutes: integer("agent_interval_minutes").notNull().default(60),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
