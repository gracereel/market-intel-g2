/**
 * ATR (Average True Range) Service — Full Coverage
 * Covers ALL crypto on app, ALL futures pairs, ALL stocks, ALL 28 forex pairs.
 * ATR-14 from daily candles. Refreshes every 4 hours.
 */

import axios from "axios";

const atrStore = new Map<string, { atr: number; atrPct: number; updatedAt: number }>();
let atrPoller: NodeJS.Timeout | null = null;

// ── ATR-14 calculation ────────────────────────────────────────────────────────
function calcATR(candles: { high: number; low: number; close: number }[]): { atr: number; atrPct: number } | null {
  const clean = candles.filter(c => c.high > 0 && c.low > 0 && c.close > 0);
  if (clean.length < 2) return null;
  const trs: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    const { high, low } = clean[i];
    const prevClose = clean[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  const period = Math.min(14, trs.length);
  const recent = trs.slice(-period);
  const atr = recent.reduce((a, b) => a + b, 0) / recent.length;
  const lastClose = clean[clean.length - 1].close;
  const atrPct = lastClose > 0 ? (atr / lastClose) * 100 : 0;
  return { atr: parseFloat(atr.toFixed(6)), atrPct: parseFloat(atrPct.toFixed(3)) };
}

// ── Binance klines — used for ALL crypto and futures perps ───────────────────
async function fetchBinanceATR(symbol: string, market: "spot" | "futures" = "spot"): Promise<{ atr: number; atrPct: number } | null> {
  try {
    const sym = symbol.endsWith("USDT") ? symbol : symbol + "USDT";
    const baseUrl = market === "futures"
      ? "https://fapi.binance.com/fapi/v1/klines"
      : "https://data-api.binance.vision/api/v3/klines";
    const r = await axios.get(baseUrl, {
      params: { symbol: sym, interval: "1d", limit: 20 },
      timeout: 8000,
    });
    const candles: any[] = r.data;
    if (!candles || candles.length < 2) return null;
    return calcATR(candles.map(c => ({
      high:  parseFloat(c[2]),
      low:   parseFloat(c[3]),
      close: parseFloat(c[4]),
    })));
  } catch { return null; }
}

// ── Yahoo Finance OHLC — stocks, ETFs, traditional futures, forex pairs ───────
async function fetchYahooATR(symbol: string): Promise<{ atr: number; atrPct: number } | null> {
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2mo`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2mo`,
  ];
  for (const url of urls) {
    try {
      const r = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Referer": "https://finance.yahoo.com",
        },
      });
      const result = r.data?.chart?.result?.[0];
      if (!result) continue;
      const highs:  number[] = result.indicators?.quote?.[0]?.high  || [];
      const lows:   number[] = result.indicators?.quote?.[0]?.low   || [];
      const closes: number[] = result.indicators?.quote?.[0]?.close || [];
      if (highs.length < 2) continue;
      const candles = highs.map((h, i) => ({ high: h, low: lows[i], close: closes[i] }));
      return calcATR(candles);
    } catch { /* try next url */ }
  }
  return null;
}

// ── ALL crypto symbols shown in the app ──────────────────────────────────────
const ALL_CRYPTO = [
  // Top tier
  "BTC","ETH","BNB","SOL","XRP","ADA","DOGE","AVAX","DOT","LINK",
  "UNI","MATIC","POL","LTC","BCH","ATOM","ETC","FIL","APT","ARB",
  "OP","NEAR","ICP","VET","ALGO","HBAR","STX","EGLD","XLM","TRX","TON",
  // DeFi
  "AAVE","COMP","MKR","SNX","CRV","YFI","SUSHI","BAL","GRT","INJ",
  // Gaming/NFT
  "SAND","MANA","AXS","APE","ENJ","CHZ","GALA","IMX","FLOW","GMT",
  // Layer 2 / New
  "SUI","SEI","STRK","MANTA","ZK","EIGEN","TIA","WLD","BLUR","ENA",
  "W","PYTH","JTO","JUP","BONK","NOTUSDT","IO",
  // Meme
  "WIF","PEPE","FLOKI","BOME","NEIRO","DOGS",
  // Other
  "RUNE","FTM","ZEC","XMR","DASH","NEO","IOTA","EOS","ONE","ZIL",
  "ANKR","HOT","LDO","CFX","KAVA","ROSE","OCEAN","CELO","THETA",
  "HBAR","ICP","GALA","IMX","CFX","NOT","CATI","GRASS","LISTA","ZRO",
];

// ── ALL futures perp pairs (Binance) ─────────────────────────────────────────
const ALL_FUTURES_PERP = [
  "BTC","ETH","SOL","XRP","BNB","ADA","DOGE","AVAX","LINK","MATIC",
  "DOT","LTC","ARB","OP","INJ","SUI","RUNE","SEI","WIF","PEPE",
  "TRX","ATOM","NEAR","FTM","ALGO","VET","FIL","LDO","STX","ENA",
  "WLD","BLUR","TIA","JUP","BONK","PYTH","JTO","NOT","IO","EIGEN",
  "HBAR","ICP","GALA","IMX","APE","GMT","SAND","MANA","AXS","CRV",
  "MKR","AAVE","SNX","GRT","CELO","FLOW","ETC",
];

// ── ALL stocks and traditional futures used in app ────────────────────────────
const ALL_STOCKS_FUTURES: string[] = [
  // Index ETFs
  "SPY","QQQ","DIA","IWM","^VIX",
  // Mega-cap stocks
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","TSM",
  // Finance
  "JPM","GS","BAC","V",
  // Futures (Yahoo =F format)
  "ES=F","NQ=F","YM=F","RTY=F",           // equity futures
  "GC=F","SI=F","HG=F",                    // metals
  "CL=F","BZ=F","NG=F","RB=F","HO=F",     // energy
  "ZB=F","ZN=F",                           // bonds
];

// ── ALL 28 forex pairs + DXY ──────────────────────────────────────────────────
const ALL_FOREX: string[] = [
  // Major USD pairs
  "EURUSD=X","GBPUSD=X","USDJPY=X","USDCHF=X","AUDUSD=X","USDCAD=X","NZDUSD=X",
  // EUR crosses
  "EURGBP=X","EURJPY=X","EURCHF=X","EURAUD=X","EURCAD=X","EURNZD=X",
  // GBP crosses
  "GBPJPY=X","GBPCHF=X","GBPAUD=X","GBPCAD=X","GBPNZD=X",
  // JPY crosses
  "CHFJPY=X","AUDJPY=X","CADJPY=X","NZDJPY=X",
  // Other crosses
  "AUDCAD=X","AUDNZD=X","AUDCHF=X","CADCHF=X","NZDCAD=X","NZDCHF=X",
];

// ── Small delay helper ────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function refreshATR() {
  const now = Date.now();
  console.log("[ATR] Starting full refresh...");

  // 1. ALL crypto — Binance spot (parallel, no rate limit)
  const uniqueCrypto = Array.from(new Set(ALL_CRYPTO));
  await Promise.allSettled(uniqueCrypto.map(async (sym) => {
    const result = await fetchBinanceATR(sym, "spot");
    if (result) atrStore.set(`crypto:${sym}`, { ...result, updatedAt: now });
  }));
  console.log(`[ATR] Crypto done: ${atrStore.size} symbols`);

  // 2. ALL futures perps — Binance futures (parallel)
  const uniqueFutures = Array.from(new Set(ALL_FUTURES_PERP));
  await Promise.allSettled(uniqueFutures.map(async (sym) => {
    const result = await fetchBinanceATR(sym, "futures");
    // Store under same crypto: key so FuturesCard lookup works
    if (result) atrStore.set(`crypto:${sym}`, { ...result, updatedAt: now });
  }));
  console.log(`[ATR] Futures perps done: ${atrStore.size} symbols`);

  // 3. Stocks + traditional futures — Yahoo (throttled to avoid 429)
  for (const sym of ALL_STOCKS_FUTURES) {
    const result = await fetchYahooATR(sym);
    if (result) {
      const key = sym.replace("=X","").replace("=F","F").replace("^","");
      atrStore.set(`other:${key}`, { ...result, updatedAt: now });
    }
    await delay(300);
  }
  console.log(`[ATR] Stocks/futures done: ${atrStore.size} symbols`);

  // 4. ALL 28 forex pairs — Yahoo (throttled)
  for (const sym of ALL_FOREX) {
    const result = await fetchYahooATR(sym);
    if (result) {
      const key = sym.replace("=X","");  // e.g. "EURUSD"
      atrStore.set(`forex:${key}`, { ...result, updatedAt: now });
      // Also store as other: so FX panel can look it up
      atrStore.set(`other:${key}`, { ...result, updatedAt: now });
    }
    await delay(350);
  }
  console.log(`[ATR] Forex done: ${atrStore.size} total symbols stored`);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getATR(symbol: string): { atr: number; atrPct: number } | null {
  const clean = symbol.replace("USDT","").replace("=X","").replace("=F","F").replace("^","");

  // Try all key namespaces
  return (
    atrStore.get(`crypto:${clean}`) ??
    atrStore.get(`forex:${clean}`) ??
    atrStore.get(`other:${clean}`) ??
    null
  );
}

export function getAllATR(): Record<string, { atr: number; atrPct: number }> {
  const result: Record<string, { atr: number; atrPct: number }> = {};
  for (const [key, val] of Array.from(atrStore.entries())) {
    result[key] = { atr: val.atr, atrPct: val.atrPct };
  }
  return result;
}

export function getATRCoverage(): { total: number; crypto: number; forex: number; other: number } {
  let crypto = 0, forex = 0, other = 0;
  for (const key of Array.from(atrStore.keys())) {
    if (key.startsWith("crypto:")) crypto++;
    else if (key.startsWith("forex:")) forex++;
    else other++;
  }
  return { total: atrStore.size, crypto, forex, other };
}

export function startATRService() {
  refreshATR();
  atrPoller = setInterval(refreshATR, 4 * 60 * 60 * 1000);
  console.log("[ATR] Service started — covering all crypto, futures, stocks, forex");
}
