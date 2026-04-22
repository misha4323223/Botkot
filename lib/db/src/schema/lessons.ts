import { text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { traderSchema } from "./_schema";

export const lessonsTable = traderSchema.table("ai_lessons", {
  id: serial("id").primaryKey(),
  ticker: text("ticker"),
  lesson: text("lesson").notNull(),
  severity: text("severity").notNull().default("info"),
  closeReason: text("close_reason"),
  realizedPnl: real("realized_pnl"),
  relatedTradeLogId: integer("related_trade_log_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLessonSchema = createInsertSchema(lessonsTable).omit({ id: true, createdAt: true });
export type InsertLesson = z.infer<typeof insertLessonSchema>;
export type Lesson = typeof lessonsTable.$inferSelect;
