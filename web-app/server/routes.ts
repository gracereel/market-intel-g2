import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { fetchAndProcessNews, fetchMarketData, analyzeSentiment, runAccuracyTest, CRYPTO_COINS, FUTURES_CONTRACTS } from "./newsService";
import {
  startLiveFeeds,
  getCryptoTicks,
  getFuturesTicks,
  getStockTicks,
  getOilTicks,
  getTicksByCategory,
  tickEmitter,
  tickStore,
  getCurrencyStrength,
  getForexTicks,
  getForexPairs,
  getDXY,
  startForexFeed,
} from "./liveFeeds";
import { startATRService, getAllATR, getATR } from "./atrService";

let lastFetch = 0;
const COOLDOWN = 3 * 60 * 1000;

async function autoRefresh() {
  if (Date.now() - lastFetch > COOLDOWN) {
    lastFetch = Date.now();
    try { await fetchAndProcessNews(); await fetchMarketData(); } catch (e) { console.error(e); }
  }
}

setTimeout(() => autoRefresh(), 800);

// Start live WebSocket feeds immediately
startLiveFeeds();
startForexFeed();
startATRService();

function parseJson(v: string, fb: any) { try { return JSON.parse(v); } catch { return fb; } }

function toNewsDto(item: any) {
  return { ...item, affectedSectors: parseJson(item.affectedSectors, []), tags: parseJson(item.tags, []) };
}

export async function registerRoutes(_: Server, app: Express) {

  // ── News ──────────────────────────────────────────────────────────────────
  app.get("/api/news", async (req, res) => {
    await autoRefresh();
    const { category, sentiment, search, tag, limit } = req.query;
    const items = storage.getAllNews({
      limit: parseInt(limit as string) || 60,
      category: category as string,
      sentiment: sentiment as string,
      search: search as string,
      tag: tag as string,
    });
    res.json(items.map(toNewsDto));
  });

  // Latest single headline — for G2 glasses breaking news detection
  app.get("/api/news/latest", async (req, res) => {
    await autoRefresh();
    const items = storage.getAllNews({ limit: 1 });
    if (items.length === 0) return res.json(null);
    res.json(toNewsDto(items[0]));
  });

  app.post("/api/news/refresh", async (req, res) => {
    lastFetch = 0;
    const added = await fetchAndProcessNews();
    await fetchMarketData();
    res.json({ success: true, added });
  });

  // ── Assets (list) ─────────────────────────────────────────────────────────
  app.get("/api/assets", (req, res) => {
    const { category } = req.query;
    const assets = storage.getAssets(category as string).map(a => ({
      ...a, extra: parseJson(a.extra, {}),
    }));
    res.json(assets);
  });

  // ── Asset detail — deep research ──────────────────────────────────────────
  // -- Asset detail — works for ALL coins (stored + live-tick fallback) --
  app.get("/api/assets/:symbol", (req, res) => {
    const symbol = req.params.symbol.toUpperCase();

    // Try stored asset first; synthesise one from the live tick store if missing
    let asset: any = storage.getAsset(symbol);
    if (!asset) {
      const tick = tickStore.get(`crypto:${symbol}`) ||
                   tickStore.get(`futures:${symbol}USDT`) ||
                   tickStore.get(`futures:${symbol}`) ||
                   tickStore.get(`stocks:${symbol}`) ||
                   tickStore.get(`oil:${symbol}`);
      if (tick) {
        asset = {
          symbol,
          name: tick.name,
          category: tick.category,
          price: tick.price,
          change: tick.change,
          changePercent: tick.changePercent,
          volume: tick.volume,
          marketCap: null,
          high24h: tick.high,
          low24h: tick.low,
          extra: {},
          updatedAt: new Date(tick.updatedAt).toISOString(),
        };
      } else {
        // No tick — still return sentiment computed from news
        asset = {
          symbol, name: symbol, category: "crypto", price: null,
          change: null, changePercent: null, volume: null, marketCap: null,
          high24h: null, low24h: null, extra: {}, updatedAt: new Date().toISOString()
        };
      }
    } else {
      asset = { ...asset, extra: parseJson(asset.extra, {}) };
    }

    // Pull news tagged to this symbol
    let news = storage.getAllNews({ limit: 300, tag: symbol }).map(toNewsDto);

    // If sparse, broaden to category-level news
    if (news.length < 8) {
      const broader = storage.getAllNews({ limit: 60, category: asset.category }).map(toNewsDto);
      const existingIds = new Set(news.map((n: any) => n.id));
      news = [...news, ...broader.filter((n: any) => !existingIds.has(n.id))];
    }
    news = news.slice(0, 40);

    const bull  = news.filter((n: any) => n.sentiment === "bullish").length;
    const bear  = news.filter((n: any) => n.sentiment === "bearish").length;
    const neut  = news.filter((n: any) => n.sentiment === "neutral").length;
    const total = news.length;
    const avgBuy = total ? Math.round(news.reduce((s: number, n: any) => s + n.buyerPressure, 0) / total) : 50;

    const sourceCounts: Record<string, number> = {};
    for (const n of news) sourceCounts[(n as any).source] = (sourceCounts[(n as any).source] || 0) + 1;
    const topSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([source, count]) => ({ source, count }));

    const highImpact = news.filter((n: any) => n.impactLevel === "high");

    res.json({
      asset,
      news,
      highImpact,
      topSources,
      sentiment: {
        bullish: bull, bearish: bear, neutral: neut, total,
        avgBuyerPressure: avgBuy, avgSellerPressure: 100 - avgBuy,
        overall: bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral",
        bullPct: total ? Math.round(bull / total * 100) : 0,
        bearPct: total ? Math.round(bear / total * 100) : 0,
        neutPct: total ? Math.round(neut / total * 100) : 0,
      },
    });
  });;

  // ── Sentiment accuracy self-test ──────────────────────────────────────────
  app.get("/api/sentiment/accuracy", (_req, res) => {
    const result = runAccuracyTest();
    res.json(result);
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get("/api/stats", (req, res) => res.json(storage.getStats()));

  // Currency strength endpoints
  app.get("/api/currency/strength", (_req, res) => {
    res.json(getCurrencyStrength());
  });

  app.get("/api/currency/forex", (_req, res) => {
    res.json(getForexTicks());
  });

  app.get("/api/currency/pairs", (_req, res) => {
    res.json(getForexPairs());
  });

  app.get("/api/currency/dxy", (_req, res) => {
    const dxy = getDXY();
    if (!dxy) return res.status(503).json({ error: "DXY not yet loaded" });
    res.json(dxy);
  });

  // ATR endpoints
  app.get("/api/atr", (_req, res) => {
    res.json(getAllATR());
  });

  app.get("/api/atr/:symbol", (req, res) => {
    const result = getATR(req.params.symbol);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.json(result);
  });

  // ── Crypto meta ───────────────────────────────────────────────────────────
  app.get("/api/meta/crypto", (req, res) => {
    res.json(Object.entries(CRYPTO_COINS).map(([sym, v]) => ({ symbol: sym, name: v.name, coingeckoId: v.coingeckoId })));
  });

  // ── Futures meta ──────────────────────────────────────────────────────────
  app.get("/api/meta/futures", (req, res) => {
    res.json(Object.entries(FUTURES_CONTRACTS).map(([sym, v]) => ({
      symbol: sym, name: v.name, yahooSym: v.yahooSym, category: v.category,
    })));
  });

  // ── Live ticks REST (snapshot) ────────────────────────────────────────────
  app.get("/api/live/ticks", (req, res) => {
    const { category } = req.query;
    let ticks;
    switch (category) {
      case "crypto":  ticks = getCryptoTicks(); break;
      case "futures": ticks = getFuturesTicks(); break;
      case "stocks":  ticks = getStockTicks(); break;
      case "oil":     ticks = getOilTicks(); break;
      default:        ticks = getTicksByCategory(category as string || "all"); break;
    }
    res.json(ticks);
  });

  // ── Live SSE stream ────────────────────────────────────────────────────────
  app.get("/api/live/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Send initial snapshot of all ticks
    const allTicks = Array.from(tickStore.values());
    res.write(`data: ${JSON.stringify({ type: "snapshot", ticks: allTicks })}\n\n`);

    // Keep-alive ping every 25s
    const keepAlive = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 25000);

    // Push updates as they arrive
    const onBatch = (changedKeys: string[]) => {
      const updated: Record<string, any> = {};
      for (const key of changedKeys) {
        const tick = tickStore.get(key);
        if (tick) updated[key] = tick;
      }
      if (Object.keys(updated).length > 0) {
        res.write(`data: ${JSON.stringify({ type: "batch", ticks: updated })}\n\n`);
      }
    };

    tickEmitter.on("batch", onBatch);

    req.on("close", () => {
      clearInterval(keepAlive);
      tickEmitter.off("batch", onBatch);
    });
  });
}
