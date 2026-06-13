import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { newsItems, assetSnapshot, type NewsItem, type InsertNewsItem, type AssetSnapshot, type InsertAssetSnapshot } from "@shared/schema";
import { desc, eq, like, or, and } from "drizzle-orm";

const sqlite = new Database("data.db");
const db = drizzle(sqlite);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    sentiment_score REAL NOT NULL,
    impact_level TEXT NOT NULL,
    affected_sectors TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'stocks',
    tags TEXT NOT NULL DEFAULT '[]',
    buyer_pressure REAL NOT NULL,
    seller_pressure REAL NOT NULL,
    g1_text TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS asset_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL,
    change REAL,
    change_percent REAL,
    volume REAL,
    market_cap REAL,
    high_24h REAL,
    low_24h REAL,
    extra TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );
`);

// Favorites table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: add missing columns if they don't exist
try { sqlite.exec(`ALTER TABLE news_items ADD COLUMN category TEXT NOT NULL DEFAULT 'stocks'`); } catch {}
try { sqlite.exec(`ALTER TABLE news_items ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`); } catch {}

export interface Favorite {
  id: number;
  symbol: string;
  name: string;
  category: string;
  addedAt: string;
}

export interface IStorage {
  getAllNews(opts?: { limit?: number; category?: string; sentiment?: string; search?: string; tag?: string }): NewsItem[];
  upsertNews(item: InsertNewsItem): NewsItem | null;
  clearOldNews(keepCount: number): void;
  getAssets(category?: string): AssetSnapshot[];
  getAsset(symbol: string): AssetSnapshot | undefined;
  upsertAsset(snap: InsertAssetSnapshot): AssetSnapshot;
  getStats(): { total: number; bullish: number; bearish: number; neutral: number; highImpact: number; avgBuyerPressure: number; avgSellerPressure: number };
  getFavorites(): Favorite[];
  addFavorite(symbol: string, name: string, category: string): Favorite;
  removeFavorite(symbol: string): void;
  isFavorite(symbol: string): boolean;
}

export const storage: IStorage = {
  getAllNews({ limit = 50, category, sentiment, search, tag } = {}): NewsItem[] {
    let q = db.select().from(newsItems);
    const conditions: any[] = [];
    if (category && category !== "all") conditions.push(eq(newsItems.category, category));
    if (sentiment && sentiment !== "all") conditions.push(eq(newsItems.sentiment, sentiment));
    if (search) conditions.push(like(newsItems.title, `%${search}%`));
    if (tag) conditions.push(like(newsItems.tags, `%${tag}%`));
    if (conditions.length > 0) {
      q = (q as any).where(conditions.length === 1 ? conditions[0] : and(...conditions));
    }
    return (q as any).orderBy(desc(newsItems.fetchedAt)).limit(limit).all();
  },

  upsertNews(item: InsertNewsItem): NewsItem | null {
    const existing = db.select().from(newsItems).where(eq(newsItems.url, item.url)).get();
    if (existing) return null;
    return db.insert(newsItems).values(item).returning().get();
  },

  clearOldNews(keepCount: number): void {
    const allIds = db.select({ id: newsItems.id }).from(newsItems).orderBy(desc(newsItems.fetchedAt)).all();
    if (allIds.length > keepCount) {
      const idsToDelete = allIds.slice(keepCount).map(r => r.id);
      for (const id of idsToDelete) {
        db.delete(newsItems).where(eq(newsItems.id, id)).run();
      }
    }
  },

  getAssets(category?: string): AssetSnapshot[] {
    if (category && category !== "all") {
      return db.select().from(assetSnapshot).where(eq(assetSnapshot.category, category)).all();
    }
    return db.select().from(assetSnapshot).all();
  },

  getAsset(symbol: string): AssetSnapshot | undefined {
    return db.select().from(assetSnapshot).where(eq(assetSnapshot.symbol, symbol)).get();
  },

  upsertAsset(snap: InsertAssetSnapshot): AssetSnapshot {
    const existing = db.select().from(assetSnapshot).where(eq(assetSnapshot.symbol, snap.symbol)).get();
    if (existing) {
      db.delete(assetSnapshot).where(eq(assetSnapshot.symbol, snap.symbol)).run();
    }
    return db.insert(assetSnapshot).values(snap).returning().get();
  },

  getFavorites(): Favorite[] {
    const rows = sqlite.prepare(`SELECT id, symbol, name, category, added_at FROM favorites ORDER BY added_at DESC`).all() as any[];
    return rows.map(r => ({ id: r.id, symbol: r.symbol, name: r.name, category: r.category, addedAt: r.added_at }));
  },

  addFavorite(symbol: string, name: string, category: string): Favorite {
    const existing = sqlite.prepare(`SELECT id FROM favorites WHERE symbol = ?`).get(symbol) as any;
    if (existing) {
      const row = sqlite.prepare(`SELECT id, symbol, name, category, added_at FROM favorites WHERE symbol = ?`).get(symbol) as any;
      return { id: row.id, symbol: row.symbol, name: row.name, category: row.category, addedAt: row.added_at };
    }
    sqlite.prepare(`INSERT INTO favorites (symbol, name, category) VALUES (?, ?, ?)`).run(symbol, name, category);
    const row = sqlite.prepare(`SELECT id, symbol, name, category, added_at FROM favorites WHERE symbol = ?`).get(symbol) as any;
    return { id: row.id, symbol: row.symbol, name: row.name, category: row.category, addedAt: row.added_at };
  },

  removeFavorite(symbol: string): void {
    sqlite.prepare(`DELETE FROM favorites WHERE symbol = ?`).run(symbol);
  },

  isFavorite(symbol: string): boolean {
    return !!sqlite.prepare(`SELECT id FROM favorites WHERE symbol = ?`).get(symbol);
  },

  getStats() {
    const all = db.select().from(newsItems).all();
    const bullish = all.filter(n => n.sentiment === "bullish").length;
    const bearish = all.filter(n => n.sentiment === "bearish").length;
    const neutral = all.filter(n => n.sentiment === "neutral").length;
    const highImpact = all.filter(n => n.impactLevel === "high").length;
    const avgBuyerPressure = all.length ? Math.round(all.reduce((s, n) => s + n.buyerPressure, 0) / all.length) : 50;
    return { total: all.length, bullish, bearish, neutral, highImpact, avgBuyerPressure, avgSellerPressure: 100 - avgBuyerPressure };
  },
};
