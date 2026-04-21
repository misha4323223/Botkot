import { text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { traderSchema } from "./_schema";

export const watchlistTable = traderSchema.table("watchlist", {
  id: serial("id").primaryKey(),
  figi: text("figi").notNull(),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const insertWatchlistSchema = createInsertSchema(watchlistTable).omit({ id: true, addedAt: true });
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type Watchlist = typeof watchlistTable.$inferSelect;
