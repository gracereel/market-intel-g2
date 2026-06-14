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

  // ── Waitlist ──────────────────────────────────────────────────────────────
  app.post("/api/waitlist", (req, res) => {
    const { email, name = "", reason = "" } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });
    const result = storage.addToWaitlist(String(email), String(name), String(reason));
    if (result.alreadyExists) return res.status(409).json({ error: "already_exists", message: "You're already on the waitlist!" });
    res.json({ success: true, message: "You're on the list! We'll be in touch soon." });
  });

  // Admin only — protected by master password
  const adminAuth = (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.APP_PASSWORD}`) return res.status(401).json({ error: "Unauthorized" });
    next();
  };

  app.get("/api/waitlist", adminAuth, (req, res) => {
    res.json(storage.getWaitlist());
  });

  // ── Invite passwords (admin only) ─────────────────────────────────────────
  app.get("/api/invites", adminAuth, (_req, res) => {
    res.json(storage.getInvitePasswords());
  });

  app.post("/api/invites", adminAuth, (req, res) => {
    const { label = "", password } = req.body || {};
    if (!password || String(password).trim().length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }
    const result = storage.addInvitePassword(String(label).trim(), String(password).trim());
    if (result.alreadyExists) return res.status(409).json({ error: "That password already exists" });
    res.json({ success: true });
  });

  app.delete("/api/invites/:id", adminAuth, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    storage.deleteInvitePassword(id);
    res.json({ success: true });
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

  // ── Favorites ─────────────────────────────────────────────────────────────
  app.get("/api/favorites", (_req, res) => {
    res.json(storage.getFavorites());
  });

  app.post("/api/favorites", (req, res) => {
    const { symbol, name, category } = req.body;
    if (!symbol || !name || !category) return res.status(400).json({ error: "symbol, name, category required" });
    const fav = storage.addFavorite(symbol, name, category);
    res.json(fav);
  });

  app.delete("/api/favorites/:symbol", (req, res) => {
    storage.removeFavorite(req.params.symbol);
    res.json({ ok: true });
  });

  // ── Positions (Limit Order Tracker) ──────────────────────────────────────
  app.get("/api/positions", (_req, res) => {
    res.json(storage.getPositions());
  });

  app.post("/api/positions", (req, res) => {
    const { symbol, name, category, entryPrice, quantity, targetPrice, stopLoss, notes } = req.body;
    if (!symbol || !name || !entryPrice || !quantity) {
      return res.status(400).json({ error: "symbol, name, entryPrice, quantity are required" });
    }
    const pos = storage.addPosition({
      symbol: String(symbol).toUpperCase(),
      name: String(name),
      category: String(category || "crypto"),
      entryPrice: parseFloat(entryPrice),
      quantity: parseFloat(quantity),
      targetPrice: targetPrice != null ? parseFloat(targetPrice) : null,
      stopLoss: stopLoss != null ? parseFloat(stopLoss) : null,
      notes: notes ? String(notes) : "",
    });
    res.json(pos);
  });

  app.patch("/api/positions/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const { targetPrice, stopLoss, quantity, notes, status, closePrice } = req.body;
    const updates: any = {};
    if (targetPrice !== undefined)  updates.targetPrice  = targetPrice != null ? parseFloat(targetPrice) : null;
    if (stopLoss !== undefined)     updates.stopLoss     = stopLoss != null ? parseFloat(stopLoss) : null;
    if (quantity !== undefined)     updates.quantity     = parseFloat(quantity);
    if (notes !== undefined)        updates.notes        = String(notes);
    if (status !== undefined)       updates.status       = String(status);
    if (closePrice !== undefined) {
      updates.closePrice = parseFloat(closePrice);
      updates.closedAt   = new Date().toISOString();
      updates.status     = "closed";
    }
    const pos = storage.updatePosition(id, updates);
    if (!pos) return res.status(404).json({ error: "Position not found" });
    res.json(pos);
  });

  app.delete("/api/positions/:id", (req, res) => {
    const id = parseInt(req.params.id);
    storage.deletePosition(id);
    res.json({ success: true });
  });

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

  // ── AI Market Chat ────────────────────────────────────────────────────────
  app.post("/api/chat", async (req: Request, res: Response) => {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message required" });
    }

    // Build live market context from current tick data
    const cryptoTicks = getCryptoTicks().slice(0, 15);
    const futuresTicks = getFuturesTicks().slice(0, 8);

    const formatTick = (t: any) => {
      const chg = t.changePercent >= 0 ? `+${t.changePercent.toFixed(2)}%` : `${t.changePercent.toFixed(2)}%`;
      const adx = t.adx ? ` ADX:${t.adx.toFixed(0)}` : "";
      const oi = t.oiSignal ? ` OI:${t.oiSignal > 0 ? "+" : ""}${t.oiSignal.toFixed(2)}` : "";
      return `${t.symbol}: $${Number(t.price).toLocaleString()} (${chg})${adx}${oi}`;
    };

    const contextLines = [
      "=== LIVE MARKET DATA (right now) ===",
      "-- Crypto --",
      ...cryptoTicks.map(formatTick),
      "-- Futures --",
      ...futuresTicks.map(formatTick),
    ].join("\n");

    const systemPrompt = `You are Market Intel AI, an institutional-grade market analyst assistant embedded inside the Market Intel trading platform. You have access to real-time market data streamed directly from the platform.

Your role:
- Answer market questions with precision and confidence
- Reference the live data when relevant
- Provide actionable trading insights
- Keep responses concise (2-4 paragraphs max) unless a detailed breakdown is requested
- Use professional trading terminology
- Never give financial advice disclaimers unless directly asked for investment advice

${contextLines}`;

    const apiKey = process.env.PERPLEXITY_API_KEY;

    if (apiKey) {
      // Use Perplexity Sonar for real web-search grounded answers
      try {
        const resp = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: message },
            ],
            max_tokens: 600,
            temperature: 0.2,
          }),
        });
        if (!resp.ok) throw new Error(`Perplexity API error: ${resp.status}`);
        const data = await resp.json() as any;
        const answer = data.choices?.[0]?.message?.content || "No response";
        return res.json({ answer });
      } catch (err) {
        console.error("Perplexity API error:", err);
        // Fall through to built-in analyst
      }
    }

    // Built-in analyst: rule-based smart responses using live data
    const q = message.toLowerCase();
    const allTicks = [...cryptoTicks, ...futuresTicks];

    // Find mentioned ticker
    const mentionedTick = allTicks.find(t =>
      q.includes(t.symbol.toLowerCase()) ||
      q.includes(t.symbol.replace("USDT","").toLowerCase()) ||
      (t.name && q.includes(t.name.toLowerCase()))
    );

    let answer = "";

    if (mentionedTick) {
      const t = mentionedTick;
      const dir = t.changePercent >= 0 ? "up" : "down";
      const strength = Math.abs(t.changePercent) > 3 ? "strongly" : Math.abs(t.changePercent) > 1 ? "moderately" : "slightly";
      const adxStr = t.adx ? (t.adx >= 25 ? `The ADX reading of ${t.adx.toFixed(0)} confirms a trending regime.` : `ADX at ${t.adx.toFixed(0)} suggests ranging/choppy conditions — lower signal reliability.`) : "";
      const oiStr = t.oiSignal ? (t.oiSignal > 0.2 ? "Open interest is rising, suggesting new money is entering this move." : t.oiSignal < -0.2 ? "Open interest is declining — the move may be driven by position liquidation rather than conviction." : "") : "";
      answer = `**${t.symbol}** is currently trading at **$${Number(t.price).toLocaleString()}**, ${strength} ${dir} ${Math.abs(t.changePercent).toFixed(2)}% on the session. ${adxStr} ${oiStr}\n\nKey levels to watch: support near $${(t.low * 0.995).toFixed(2)} and resistance at $${(t.high * 1.005).toFixed(2)} based on today's range. The 24h range spans $${(t.high - t.low).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}.`;
    } else if (q.includes("top") || q.includes("best") || q.includes("mover") || q.includes("gainer")) {
      const sorted = [...allTicks].sort((a, b) => b.changePercent - a.changePercent);
      const top3 = sorted.slice(0, 3).map(t => `**${t.symbol}** +${t.changePercent.toFixed(2)}%`).join(", ");
      answer = `Today's top movers: ${top3}.\n\nStrong momentum in these names could indicate sector rotation or macro catalysts driving risk appetite. Watch for follow-through volume on the leader — sustained ADX above 25 is the key confirmation.`;
    } else if (q.includes("worst") || q.includes("loser") || q.includes("bear") || q.includes("dump") || q.includes("drop")) {
      const sorted = [...allTicks].sort((a, b) => a.changePercent - b.changePercent);
      const bot3 = sorted.slice(0, 3).map(t => `**${t.symbol}** ${t.changePercent.toFixed(2)}%`).join(", ");
      answer = `Weakest performers today: ${bot3}.\n\nPersistent selling pressure in these pairs may reflect macro risk-off sentiment or asset-specific negative catalysts. Monitor if the broader crypto market follows — a sector-wide decline suggests macro drivers rather than idiosyncratic news.`;
    } else if (q.includes("btc") || q.includes("bitcoin")) {
      const btc = allTicks.find(t => t.symbol === "BTCUSDT" || t.symbol === "BTC");
      if (btc) {
        answer = `Bitcoin is currently at **$${Number(btc.price).toLocaleString()}**, ${btc.changePercent >= 0 ? "+" : ""}${btc.changePercent.toFixed(2)}% on the day. As the market leader, BTC price action typically sets the tone for altcoin sentiment. ${btc.adx ? (btc.adx >= 25 ? `The trending ADX (${btc.adx.toFixed(0)}) suggests the current directional move has conviction.` : `A low ADX (${btc.adx.toFixed(0)}) indicates consolidation — expect range-bound price action until a breakout.`) : ""}\n\nKey institutional levels: round numbers ($${Math.round(btc.price / 1000) * 1000}k) often act as psychological support/resistance.`;
      } else {
        answer = "Bitcoin data is currently loading. Check the dashboard for the latest BTC price.";
      }
    } else if (q.includes("market") || q.includes("overview") || q.includes("summary")) {
      const gainers = allTicks.filter(t => t.changePercent > 0).length;
      const losers = allTicks.filter(t => t.changePercent < 0).length;
      const sentiment = gainers > losers ? "risk-on" : gainers < losers ? "risk-off" : "mixed";
      answer = `**Market Overview:** ${gainers} assets are up, ${losers} are down — overall sentiment is **${sentiment}**.\n\nTop crypto leaders are ${allTicks.slice(0,3).map(t => `${t.symbol} (${t.changePercent >= 0 ? "+" : ""}${t.changePercent.toFixed(1)}%)`).join(", ")}. Cross-asset correlation is a key factor to monitor — if BTC, SPX futures, and gold are all moving in the same direction, macro forces are dominant.`;
    } else {
      answer = `Based on current live data across ${allTicks.length} tracked instruments, the market is showing mixed signals. To get a specific analysis, ask me about a particular asset (e.g., "What's BTC doing?"), sector (e.g., "How are futures performing?"), or condition (e.g., "Who are today's top movers?").\n\nThe High Confidence Signals panel on your dashboard highlights pairs where 5+ timeframes align — those are the highest-probability setups right now.`;
    }

    return res.json({ answer });
  });

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
