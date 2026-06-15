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

  // ── Heatmap custom picks ─────────────────────────────────────────────────
  let heatmapPicks: string[] = [];
  app.get("/api/heatmap-picks", (_req, res) => {
    res.json({ keys: heatmapPicks });
  });
  app.post("/api/heatmap-picks", (req, res) => {
    const { keys } = req.body;
    if (!Array.isArray(keys)) return res.status(400).json({ error: "keys must be array" });
    heatmapPicks = keys.filter((k: any) => typeof k === "string");
    res.json({ ok: true, count: heatmapPicks.length });
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
    const { message, history } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message required" });
    }

    // ── Build comprehensive live market context ───────────────────────────
    const cryptoTicks  = getCryptoTicks();
    const futuresTicks = getFuturesTicks();
    const stockTicks   = getStockTicks();
    const oilTicks     = getOilTicks();
    const forexTicks   = getForexTicks();

    const fmtTick = (t: any) => {
      const chg  = `${t.changePercent >= 0 ? "+" : ""}${Number(t.changePercent).toFixed(2)}%`;
      const adx  = t.adx     != null ? ` ADX:${Number(t.adx).toFixed(0)}`                                           : "";
      const oi   = t.oiSignal!= null ? ` OI:${t.oiSignal > 0 ? "+" : ""}${Number(t.oiSignal).toFixed(2)}`          : "";
      const cvd  = t.cvdSignal!=null  ? ` CVD:${t.cvdSignal > 0 ? "+" : ""}${Number(t.cvdSignal).toFixed(2)}`      : "";
      const fund = t.fundingRate!=null? ` FR:${(t.fundingRate*100).toFixed(4)}%`                                     : "";
      const vol  = t.quoteVolume > 0  ? ` Vol:$${(t.quoteVolume/1e6).toFixed(1)}M`                                  : "";
      const rng  = (t.high && t.low)  ? ` H:${Number(t.high).toFixed(4)} L:${Number(t.low).toFixed(4)}`            : "";
      return `  ${t.symbol}|${t.name || t.symbol}: $${Number(t.price).toLocaleString(undefined,{maximumFractionDigits:6})} (${chg})${adx}${oi}${cvd}${fund}${vol}${rng}`;
    };

    const fmtForex = (t: any) => {
      const chg = `${t.change1d >= 0 ? "+" : ""}${Number(t.change1d).toFixed(3)}%`;
      return `  ${t.symbol}: ${Number(t.price).toFixed(5)} (${chg}) spread:${t.spread}pip`;
    };

    // Top 30 crypto by volume, all futures, top 20 stocks, all oil, top 20 forex
    const topCrypto  = [...cryptoTicks].sort((a,b) => (b.quoteVolume||0)-(a.quoteVolume||0)).slice(0,30);
    const topStocks  = stockTicks.slice(0,20);
    const topForex   = Array.isArray(forexTicks) ? forexTicks.slice(0,20) : [];

    const contextLines = [
      "=== LIVE MARKET DATA (streaming now) ===",
      `Timestamp: ${new Date().toUTCString()}`,
      "",
      "── CRYPTO (top 30 by volume) ──",
      ...topCrypto.map(fmtTick),
      "",
      "── FUTURES / COMMODITIES ──",
      ...futuresTicks.map(fmtTick),
      "",
      "── OIL ──",
      ...oilTicks.map(fmtTick),
      "",
      "── STOCKS ──",
      ...topStocks.map(fmtTick),
      "",
      "── FOREX ──",
      ...topForex.map(fmtForex),
    ].join("\n");

    const systemPrompt = `You are Market Intel AI — an elite, institutional-grade market analyst built into the Market Intel G2 trading platform. You are deeply knowledgeable in:

• Technical Analysis: support/resistance, trend structure, breakouts, momentum, RSI, MACD, Bollinger Bands, volume analysis, candlestick patterns
• On-chain & Derivatives: funding rates, open interest, CVD (Cumulative Volume Delta), liquidation levels, perpetual basis
• Macro & Fundamentals: Fed policy, DXY correlation, risk-on/risk-off dynamics, sector rotation, earnings, economic data
• Crypto-specific: BTC dominance, altcoin cycles, Layer 1/2 narratives, DeFi, NFT markets, whale activity
• Forex: central bank policy, carry trades, economic calendar, currency strength
• Equities: earnings, sector analysis, index structure, growth vs value rotation

You have access to REAL-TIME data from the platform streamed seconds ago. Use it to give precise, current answers.

BEHAVIOR:
- Answer ANY market question — there is no question you can't address
- Always reference the live data when applicable (prices, % changes, ADX, OI, CVD, funding rates)
- For specific assets: give price, trend direction, key levels (based on H/L range), momentum bias, and a clear directional view
- For macro questions: synthesize across asset classes using the live data
- For "should I buy/sell" questions: give a professional technical analysis view with key levels and risk factors
- Be direct, concise, and confident — like a trading desk analyst
- Use markdown formatting: **bold** for key numbers and conclusions, bullet points for lists
- Keep responses focused: 3-6 sentences for simple questions, structured breakdown for complex ones
- Include relevant data fields (ADX trend strength, OI direction, CVD pressure, funding rate) when available
- ADX interpretation: <20=ranging/choppy, 20-25=weak trend, 25-40=trending, 40+=strong trend
- OI signal: positive=rising OI (new money in), negative=declining OI (liquidation)
- CVD signal: positive=aggressive buying, negative=aggressive selling
- Funding rate: positive=longs paying (overheated), negative=shorts paying (oversold)

${contextLines}`;

    const apiKey = process.env.PERPLEXITY_API_KEY;

    if (apiKey) {
      try {
        // Build message history for multi-turn context
        const msgs: any[] = [{ role: "system", content: systemPrompt }];
        if (Array.isArray(history)) {
          for (const h of history.slice(-6)) { // last 6 turns for context
            if (h.role && h.content) msgs.push({ role: h.role, content: h.content });
          }
        }
        msgs.push({ role: "user", content: message });

        const resp = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar-pro",
            messages: msgs,
            max_tokens: 1024,
            temperature: 0.15,
          }),
        });
        if (!resp.ok) throw new Error(`Perplexity API ${resp.status}: ${await resp.text()}`);
        const data = await resp.json() as any;
        const answer = data.choices?.[0]?.message?.content || "No response received.";
        return res.json({ answer });
      } catch (err) {
        console.error("Perplexity sonar-pro error:", err);
        // Fall through to built-in analyst
      }
    }

    // ── Built-in analyst fallback (no API key) ───────────────────────────
    const q = message.toLowerCase();
    const allTicks = [...cryptoTicks, ...futuresTicks, ...stockTicks, ...oilTicks];

    const ALIAS: Record<string, string[]> = {
      bitcoin:["BTC"],ethereum:["ETH"],solana:["SOL"],ripple:["XRP"],xrp:["XRP"],
      cardano:["ADA"],dogecoin:["DOGE"],doge:["DOGE"],shiba:["SHIB"],shib:["SHIB"],
      avalanche:["AVAX"],avax:["AVAX"],chainlink:["LINK"],link:["LINK"],
      polkadot:["DOT"],dot:["DOT"],uniswap:["UNI"],uni:["UNI"],
      litecoin:["LTC"],ltc:["LTC"],bnb:["BNB"],binance:["BNB"],
      tron:["TRX"],trx:["TRX"],near:["NEAR"],atom:["ATOM"],cosmos:["ATOM"],
      pepe:["PEPE"],wif:["WIF"],bonk:["BONK"],aptos:["APT"],apt:["APT"],
      sui:["SUI"],injective:["INJ"],inj:["INJ"],arbitrum:["ARB"],arb:["ARB"],
      optimism:["OP"],polygon:["MATIC","POL"],matic:["MATIC"],
      gold:["GC=F","GC"],oil:["CL=F","CL"],crude:["CL=F","CL"],wti:["CL=F","CL"],
      silver:["SI=F","SI"],"sp500":["ES=F","ES"],spx:["ES=F","ES"],
      nasdaq:["NQ=F","NQ"],nq:["NQ=F","NQ"],dow:["YM=F","YM"],
      russell:["RTY=F","RTY"],apple:["AAPL"],tesla:["TSLA"],nvidia:["NVDA"],
      microsoft:["MSFT"],amazon:["AMZN"],google:["GOOGL"],meta:["META"],
      eurusd:["EURUSD"],euro:["EURUSD"],gbpusd:["GBPUSD"],pound:["GBPUSD"],
      usdjpy:["USDJPY"],yen:["USDJPY"],
    };

    function findTick(query: string) {
      for (const [alias, syms] of Object.entries(ALIAS)) {
        if (query.includes(alias)) {
          for (const s of syms) {
            const found = allTicks.find(t =>
              t.symbol.toUpperCase() === s ||
              t.symbol.toUpperCase().replace("USDT","") === s ||
              t.symbol.toUpperCase().replace("=F","") === s
            );
            if (found) return found;
          }
        }
      }
      return allTicks.find(t => {
        const s = t.symbol.toLowerCase().replace("usdt","").replace("=f","");
        return query.includes(s) || (t.name && query.includes(t.name.toLowerCase()));
      }) || null;
    }

    function analyzeTick(t: any): string {
      const price  = Number(t.price);
      const chgPct = Number(t.changePercent);
      const chgStr = `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%`;
      const name   = t.name ? `**${t.name} (${t.symbol.replace("USDT","")})` : `**${t.symbol.replace("USDT","")}**`;
      const rangeSize = (t.high||0) - (t.low||0);
      const rangePos  = rangeSize > 0 ? Math.round(((price - t.low) / rangeSize) * 100) : 50;
      const nearHigh  = rangePos > 80, nearLow = rangePos < 20;

      const adxLine = t.adx != null
        ? (t.adx >= 40 ? `ADX ${t.adx.toFixed(0)} — **strong trend**, high directional conviction.`
         : t.adx >= 25 ? `ADX ${t.adx.toFixed(0)} — **trending** regime, signals are reliable.`
         : t.adx >= 20 ? `ADX ${t.adx.toFixed(0)} — **weak trend**, use caution.`
         : `ADX ${t.adx.toFixed(0)} — **ranging/choppy**, low confidence for trend trades.`) : "";

      const oiLine = t.oiSignal != null
        ? (t.oiSignal > 0.3  ? "OI rising sharply — **new institutional money** entering."
         : t.oiSignal > 0.1  ? "OI rising — move has **institutional participation**."
         : t.oiSignal < -0.3 ? "OI falling sharply — **liquidation driven**, not conviction."
         : t.oiSignal < -0.1 ? "OI declining — participants exiting."
         : "") : "";

      const cvdLine = t.cvdSignal != null
        ? (t.cvdSignal > 0.3  ? "CVD: **aggressive buyers** dominating order flow."
         : t.cvdSignal < -0.3 ? "CVD: **aggressive sellers** in control."
         : "") : "";

      const fundLine = t.fundingRate != null
        ? (t.fundingRate > 0.001  ? `Funding ${(t.fundingRate*100).toFixed(4)}% — **longs overheated**, squeeze risk.`
         : t.fundingRate < -0.001 ? `Funding ${(t.fundingRate*100).toFixed(4)}% — **shorts overheated**, squeeze risk.`
         : "") : "";

      const rangeLine = rangeSize > 0
        ? `At **${rangePos}%** of daily range ($${t.low.toLocaleString()} – $${t.high.toLocaleString()}). ${nearHigh ? "Near session high — watch for resistance." : nearLow ? "Near session low — watch for support." : "Mid-range — no immediate key level."}`
        : "";

      const bullCount = [chgPct>0, (t.oiSignal||0)>0.1, (t.cvdSignal||0)>0.2, rangePos>60].filter(Boolean).length;
      const bearCount = [chgPct<0, (t.oiSignal||0)<-0.1, (t.cvdSignal||0)<-0.2, rangePos<40].filter(Boolean).length;
      const bias = bullCount >= 3 ? "**Bias: BULLISH** — majority of factors align upside."
                 : bearCount >= 3 ? "**Bias: BEARISH** — majority of factors align downside."
                 : "**Bias: NEUTRAL/MIXED** — wait for clearer confluence.";

      return [
        `${name}** is at **$${price.toLocaleString()}** (${chgStr}) on the session.`,
        rangeLine, adxLine, oiLine, cvdLine, fundLine, bias,
      ].filter(Boolean).join("\n");
    }

    const tick = findTick(q);
    let answer = "";

    if (tick) {
      answer = analyzeTick(tick);
    } else if (/top|best|gainer|pump|leader|mover/.test(q)) {
      const top5 = [...allTicks].sort((a,b)=>b.changePercent-a.changePercent).slice(0,5);
      answer = `**Top Movers:**\n${top5.map(t=>`• **${t.symbol.replace("USDT","")}** +${t.changePercent.toFixed(2)}% — $${Number(t.price).toLocaleString()}`).join("\n")}`;
    } else if (/worst|loser|dump|drop|crash|sell/.test(q)) {
      const bot5 = [...allTicks].sort((a,b)=>a.changePercent-b.changePercent).slice(0,5);
      answer = `**Biggest Losers:**\n${bot5.map(t=>`• **${t.symbol.replace("USDT","")}** ${t.changePercent.toFixed(2)}% — $${Number(t.price).toLocaleString()}`).join("\n")}`;
    } else if (/futures|gold|oil|sp500|spx|nasdaq|nq|dow|russell|commodity/.test(q)) {
      answer = `**Futures & Commodities:**\n${futuresTicks.concat(oilTicks).map(t=>`• **${t.symbol}** $${Number(t.price).toLocaleString()} (${t.changePercent>=0?"+":""}${t.changePercent.toFixed(2)}%)`).join("\n")}`;
    } else if (/stock|equit|share|nyse|nasdaq/.test(q)) {
      answer = `**Stocks:**\n${stockTicks.slice(0,10).map(t=>`• **${t.symbol}** $${Number(t.price).toLocaleString()} (${t.changePercent>=0?"+":""}${t.changePercent.toFixed(2)}%)`).join("\n")}`;
    } else if (/forex|fx|currency|eur|gbp|jpy|usd|cad|aud/.test(q)) {
      answer = topForex.length
        ? `**Forex:**\n${topForex.slice(0,10).map((t:any)=>`• **${t.symbol}** ${Number(t.price).toFixed(5)} (${t.change1d>=0?"+":""}${Number(t.change1d).toFixed(3)}%)`).join("\n")}`
        : "Forex data loading — check the FX tab.";
    } else if (/market|overview|summary|sentiment|how.*market|what.*market/.test(q)) {
      const up   = allTicks.filter(t=>t.changePercent>0).length;
      const down = allTicks.filter(t=>t.changePercent<0).length;
      const tone = up > down*1.3 ? "risk-on" : down > up*1.3 ? "risk-off" : "mixed";
      const top  = [...allTicks].sort((a,b)=>b.changePercent-a.changePercent)[0];
      const btc  = allTicks.find(t=>t.symbol==="BTC"||t.symbol==="BTCUSDT");
      answer = `**Market Overview:** ${up} up / ${down} down — overall tone is **${tone}**.\n\n${btc?`BTC: $${Number(btc.price).toLocaleString()} (${btc.changePercent>=0?"+":""}${btc.changePercent.toFixed(2)}%)\n`:""}\nLeader: **${top?.symbol.replace("USDT","")}** +${top?.changePercent.toFixed(2)}%`;
    } else {
      const up  = allTicks.filter(t=>t.changePercent>0).length;
      const btc = allTicks.find(t=>t.symbol==="BTC"||t.symbol==="BTCUSDT");
      answer = `I can answer questions about any asset on your dashboard. Try:\n\n• **"Analyze BTC"** or **"What's ETH doing?"**\n• **"Top movers today"**\n• **"Futures overview"**\n• **"Market sentiment"**\n• **"Is gold bullish?"**\n\nRight now: **${up}** assets up. ${btc?`BTC at $${Number(btc.price).toLocaleString()} (${btc.changePercent>=0?"+":""}${btc.changePercent.toFixed(2)}%).`:""}`;
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
