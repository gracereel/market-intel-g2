/**
 * ATR (Average True Range) Service
 * Fetches 14 daily candles and computes ATR-14 for crypto, stocks, futures, and forex.
 * ATR measures expected daily move — useful for stop placement and position sizing.
 */

import axios from "axios";

const atrStore = new Map<string, { atr: number; atrPct: number; updatedAt: number }>();
let atrPoller: NodeJS.Timeout | null = null;

// ── Crypto ATR via Binance (free, no key) ─────────────────────────────────────
async function fetchCryptoATR(symbol: string): Promise<{ atr: number; atrPct: number } | null> {
  try {
    const sym = symbol.endsWith("USDT") ? symbol : symbol + "USDT";
    const r = await axios.get("https://data-api.binance.vision/api/v3/klines", {
      params: { symbol: sym, interval: "1d", limit: 15 },
      timeout: 8000,
    });
    const candles: any[] = r.data;
    if (!candles || candles.length < 2) return null;
    return calcATR(candles.map(c => ({
      high: parseFloat(c[2]),
      low:  parseFloat(c[3]),
      close: parseFloat(c[4]),
    })));
  } catch { return null; }
}

// ── Stocks/Futures/Forex ATR via Yahoo Finance batch ─────────────────────────
async function fetchYahooOHLC(symbol: string): Promise<{ atr: number; atrPct: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
    const r = await axios.get(url, {
      timeout: 8000,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Referer": "https://finance.yahoo.com",
      },
    });
    const result = r.data?.chart?.result?.[0];
    if (!result) return null;
    const highs: number[] = result.indicators?.quote?.[0]?.high || [];
    const lows:  number[] = result.indicators?.quote?.[0]?.low  || [];
    const closes:number[] = result.indicators?.quote?.[0]?.close|| [];
    if (highs.length < 2) return null;
    const candles = highs.map((h, i) => ({ high: h, low: lows[i], close: closes[i] }))
      .filter(c => c.high && c.low && c.close);
    return calcATR(candles);
  } catch { return null; }
}

// ── ATR-14 calculation ────────────────────────────────────────────────────────
function calcATR(candles: { high: number; low: number; close: number }[]): { atr: number; atrPct: number } | null {
  if (candles.length < 2) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  const period = Math.min(14, trs.length);
  const recent = trs.slice(-period);
  const atr = recent.reduce((a, b) => a + b, 0) / recent.length;
  const lastClose = candles[candles.length - 1].close;
  const atrPct = lastClose > 0 ? (atr / lastClose) * 100 : 0;
  return { atr: Math.round(atr * 10000) / 10000, atrPct: Math.round(atrPct * 100) / 100 };
}

// ── Crypto symbols to compute ATR for ────────────────────────────────────────
const TOP_CRYPTO = [
  "BTC","ETH","BNB","SOL","XRP","ADA","DOGE","AVAX","DOT","LINK",
  "UNI","MATIC","LTC","BCH","ATOM","ETC","FIL","APT","ARB","OP",
  "NEAR","ICP","VET","ALGO","HBAR","STX","EGLD","XLM","TRX","TON",
];

const STOCK_SYMS = [
  "SPY","QQQ","DIA","IWM","^VIX",
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","TSM",
  "JPM","GS","BAC","V",
  "ES=F","NQ=F","YM=F","RTY=F","GC=F","SI=F","ZB=F","CL=F","BZ=F","NG=F","RB=F","HG=F",
  "EURUSD=X","GBPUSD=X","USDJPY=X","USDCHF=X","AUDUSD=X","USDCAD=X","NZDUSD=X",
];

async function refreshATR() {
  const now = Date.now();

  // Crypto — Binance klines (fast, no rate limit)
  await Promise.allSettled(TOP_CRYPTO.map(async (sym) => {
    const result = await fetchCryptoATR(sym);
    if (result) atrStore.set(`crypto:${sym}`, { ...result, updatedAt: now });
  }));

  // Stocks/futures/forex — Yahoo (one at a time with small delay)
  for (const sym of STOCK_SYMS) {
    const result = await fetchYahooOHLC(sym);
    if (result) {
      const key = sym.replace("=X", "").replace("=F", "F");
      atrStore.set(`other:${key}`, { ...result, updatedAt: now });
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`[ATR] Updated ${atrStore.size} symbols`);
}

export function getATR(symbol: string): { atr: number; atrPct: number } | null {
  // Try crypto first
  const crypto = atrStore.get(`crypto:${symbol.replace("USDT", "")}`);
  if (crypto) return crypto;
  // Try other (stocks/futures/forex)
  const clean = symbol.replace("USDT", "").replace("=X", "").replace("=F", "F");
  const other = atrStore.get(`other:${clean}`);
  if (other) return other;
  return null;
}

export function getAllATR(): Record<string, { atr: number; atrPct: number }> {
  const result: Record<string, { atr: number; atrPct: number }> = {};
  for (const [key, val] of atrStore.entries()) {
    result[key] = { atr: val.atr, atrPct: val.atrPct };
  }
  return result;
}

export function startATRService() {
  refreshATR(); // run immediately on start
  atrPoller = setInterval(refreshATR, 4 * 60 * 60 * 1000); // refresh every 4 hours (daily ATR doesn't change fast)
  console.log("[ATR] Service started");
}
