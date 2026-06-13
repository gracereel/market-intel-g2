import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const newsItems = sqliteTable("news_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  source: text("source").notNull(),
  url: text("url").notNull(),
  publishedAt: text("published_at").notNull(),
  sentiment: text("sentiment").notNull(), // "bullish" | "bearish" | "neutral"
  sentimentScore: real("sentiment_score").notNull(),
  impactLevel: text("impact_level").notNull(), // "high" | "medium" | "low"
  affectedSectors: text("affected_sectors").notNull(), // JSON array
  category: text("category").notNull().default("stocks"), // "stocks" | "crypto" | "futures" | "oil"
  tags: text("tags").notNull().default("[]"), // JSON array of asset tags e.g. ["BTC","ETH"]
  buyerPressure: real("buyer_pressure").notNull(),
  sellerPressure: real("seller_pressure").notNull(),
  g1Text: text("g1_text").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

export const insertNewsItemSchema = createInsertSchema(newsItems).omit({ id: true });
export type InsertNewsItem = z.infer<typeof insertNewsItemSchema>;
export type NewsItem = typeof newsItems.$inferSelect;

// Unified asset table: stocks, crypto, futures, oil
export const assetSnapshot = sqliteTable("asset_snapshot", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(), // "stocks" | "crypto" | "futures" | "oil"
  price: real("price"),
  change: real("change"),
  changePercent: real("change_percent"),
  volume: real("volume"),
  marketCap: real("market_cap"),
  high24h: real("high_24h"),
  low24h: real("low_24h"),
  extra: text("extra").notNull().default("{}"), // JSON for extra fields
  updatedAt: text("updated_at").notNull(),
});

export const insertAssetSnapshotSchema = createInsertSchema(assetSnapshot).omit({ id: true });
export type InsertAssetSnapshot = z.infer<typeof insertAssetSnapshotSchema>;
export type AssetSnapshot = typeof assetSnapshot.$inferSelect;
