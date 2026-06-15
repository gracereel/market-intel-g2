// ─── Technical Analysis Engine ───────────────────────────────────────────────
// Fetches OHLC candles + computes RSI, MACD, Bollinger Bands,
// support/resistance levels, and trend structure for any asset.
// Used by the AI chat endpoint to give full TA breakdowns.

export interface Candle {
  t: number;  // timestamp ms
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
}

export interface TAResult {
  symbol: string;
  interval: string;
  candles: Candle[];
  // Indicators (latest values)
  rsi14:        number | null;
  macdLine:     number | null;
  macdSignal:   number | null;
  macdHist:     number | null;
  bbUpper:      number | null;
  bbMiddle:     number | null;
  bbLower:      number | null;
  bbWidth:      number | null;    // (upper-lower)/middle *100 — volatility %
  bbPosition:   number | null;    // 0-100: where price sits within the bands
  ema20:        number | null;
  ema50:        number | null;
  ema200:       number | null;
  vwap:         number | null;
  atr14:        number | null;
  supports:     number[];         // up to 3 key support levels
  resistances:  number[];         // up to 3 key resistance levels
  trend:        "uptrend" | "downtrend" | "sideways";
  rsiSignal:    "overbought" | "oversold" | "neutral" | "bullish" | "bearish";
  macdSignalDir:"bullish" | "bearish" | "neutral";
  bbSignal:     "squeeze" | "expansion" | "overbought" | "oversold" | "neutral";
  summary:      string;           // plain-English TA summary
}

// ── Candle fetching ───────────────────────────────────────────────────────────

const CRYPTO_BASES = new Set([
  "BTC","ETH","SOL","XRP","BNB","ADA","DOGE","AVAX","LINK","DOT",
  "MATIC","POL","UNI","LTC","BCH","ETC","ATOM","XLM","ALGO","VET","FIL",
  "TRX","NEAR","APT","ARB","OP","SUI","PEPE","SHIB","FLOKI","INJ",
  "TON","SEI","RENDER","GRT","SAND","MANA","AXS","AAVE","CRV","MKR",
  "ENA","WLD","TIA","STX","HBAR","ICP","BLUR","BONK","WIF","BLUR",
]);

const FUTURES_YAHOO: Record<string,string> = {
  "ES":"ES=F","NQ":"NQ=F","YM":"YM=F","RTY":"RTY=F",
  "GC":"GC=F","SI":"SI=F","CL":"CL=F","NG":"NG=F",
  "ZB":"ZB=F","ZC":"ZC=F","ZS":"ZS=F","BTC-FUT":"BTC=F",
  "GOLD":"GC=F","OIL":"CL=F","CRUDE":"CL=F","WTI":"CL=F","SILVER":"SI=F",
};

function toBinanceSymbol(sym: string): string {
  const base = sym.replace(/USDT$/i,"").replace(/USD$/i,"").toUpperCase();
  return base + "USDT";
}

function isLikelyCrypto(sym: string): boolean {
  const base = sym.replace(/USDT$/i,"").replace(/USD$/i,"").toUpperCase();
  return CRYPTO_BASES.has(base) || CRYPTO_BASES.has(sym.toUpperCase()) ||
         sym.toUpperCase().endsWith("USDT");
}

async function fetchBinanceCandles(sym: string, interval: string, limit: number): Promise<Candle[] | null> {
  const binSym = toBinanceSymbol(sym);
  const endpoints = [
    `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${interval}&limit=${limit}`,
    `https://fapi.binance.com/fapi/v1/klines?symbol=${binSym}&interval=${interval}&limit=${limit}`,
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const raw: any[] = await r.json();
      if (!Array.isArray(raw) || raw.length === 0) continue;
      return raw.map((k: any) => ({
        t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
      }));
    } catch { continue; }
  }
  return null;
}

async function fetchYahooCandles(yahooSym: string, interval: string, limit: number): Promise<Candle[] | null> {
  const yIntMap: Record<string,string> = {
    "1h":"1h","4h":"1h","1d":"1d","1w":"1wk","15m":"15m","5m":"5m",
  };
  const yRangeMap: Record<string,string> = {
    "1h":"730d","4h":"730d","1d":"5y","1w":"10y","15m":"60d","5m":"7d",
  };
  const yInt   = yIntMap[interval]  || "1d";
  const yRange = yRangeMap[interval]|| "5y";

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${yInt}&range=${yRange}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    return ts.map((t: number, i: number) => ({
      t: t * 1000,
      o: +(q.open?.[i]   ?? q.close?.[i] ?? 0),
      h: +(q.high?.[i]   ?? q.close?.[i] ?? 0),
      l: +(q.low?.[i]    ?? q.close?.[i] ?? 0),
      c: +(q.close?.[i]  ?? 0),
      v: +(q.volume?.[i] ?? 0),
    })).filter((c: Candle) => c.c > 0).slice(-limit);
  } catch { return null; }
}

export async function fetchCandles(sym: string, interval: string = "1d", limit: number = 200): Promise<Candle[] | null> {
  const upper = sym.toUpperCase();

  // Crypto
  if (isLikelyCrypto(upper)) {
    return await fetchBinanceCandles(upper, interval, limit);
  }

  // Traditional futures
  if (FUTURES_YAHOO[upper]) {
    return await fetchYahooCandles(FUTURES_YAHOO[upper], interval, limit);
  }

  // Yahoo-style futures (ES=F etc.)
  if (upper.endsWith("=F")) {
    return await fetchYahooCandles(upper, interval, limit);
  }

  // Forex (6-char, no digits)
  if (upper.length === 6 && !/\d/.test(upper) && !upper.endsWith("=F")) {
    return await fetchYahooCandles(`${upper}=X`, interval, limit);
  }

  // Stock fallback
  return await fetchYahooCandles(upper, interval, limit);
}

// ── Indicator math ────────────────────────────────────────────────────────────

function ema(closes: number[], period: number): number[] {
  if (closes.length < period) return closes.map(() => NaN);
  const k = 2 / (period + 1);
  const result: number[] = new Array(closes.length).fill(NaN);
  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function macd(closes: number[]): { macdLine: number[], signal: number[], hist: number[] } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => isNaN(ema12[i]) || isNaN(ema26[i]) ? NaN : ema12[i] - ema26[i]);
  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalArr = ema(macdLine.map(v => isNaN(v) ? 0 : v), 9);
  const hist = macdLine.map((m, i) => isNaN(m) || isNaN(signalArr[i]) ? NaN : m - signalArr[i]);
  return { macdLine, signal: signalArr, hist };
}

function bollingerBands(closes: number[], period: number = 20, mult: number = 2): { upper: number[], middle: number[], lower: number[] } {
  const middle = closes.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = closes.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
  const upper = closes.map((_, i) => {
    if (isNaN(middle[i])) return NaN;
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return mean + mult * std;
  });
  const lower = closes.map((_, i) => {
    if (isNaN(middle[i])) return NaN;
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return mean - mult * std;
  });
  return { upper, middle, lower };
}

function calcATR(candles: Candle[], period: number = 14): number[] {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prev = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prev), Math.abs(c.l - prev));
  });
  const result: number[] = new Array(candles.length).fill(NaN);
  if (tr.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  result[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
  }
  return result;
}

function calcVWAP(candles: Candle[]): number {
  let cumPV = 0, cumV = 0;
  // Use last 30 candles for VWAP
  const slice = candles.slice(-30);
  for (const c of slice) {
    const typical = (c.h + c.l + c.c) / 3;
    cumPV += typical * c.v;
    cumV  += c.v;
  }
  return cumV > 0 ? cumPV / cumV : NaN;
}

// Find pivot support/resistance levels from recent highs and lows
function findSRLevels(candles: Candle[], count: number = 3): { supports: number[], resistances: number[] } {
  const recent = candles.slice(-50);
  const price = recent[recent.length - 1]?.c ?? 0;

  // Find local swing highs and lows (window = 3)
  const swingHighs: number[] = [];
  const swingLows: number[]  = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const h = recent[i].h;
    const l = recent[i].l;
    if (h > recent[i-1].h && h > recent[i-2].h && h > recent[i+1].h && h > recent[i+2].h) {
      swingHighs.push(h);
    }
    if (l < recent[i-1].l && l < recent[i-2].l && l < recent[i+1].l && l < recent[i+2].l) {
      swingLows.push(l);
    }
  }

  // Sort and cluster nearby levels (within 0.5% of each other)
  function cluster(levels: number[], above: boolean): number[] {
    const sorted = above
      ? levels.filter(l => l > price).sort((a, b) => a - b)
      : levels.filter(l => l < price).sort((a, b) => b - a);
    const clustered: number[] = [];
    for (const lv of sorted) {
      if (clustered.length === 0 || Math.abs(lv - clustered[clustered.length - 1]) / price > 0.005) {
        clustered.push(lv);
        if (clustered.length >= count) break;
      }
    }
    return clustered.map(v => Math.round(v * 10000) / 10000);
  }

  return {
    resistances: cluster(swingHighs, true),
    supports:    cluster(swingLows, false),
  };
}

// ── Main TA computation ───────────────────────────────────────────────────────

export async function computeTA(sym: string, interval: string = "1d"): Promise<TAResult | null> {
  const candles = await fetchCandles(sym, interval, 250);
  if (!candles || candles.length < 30) return null;

  const closes = candles.map(c => c.c);
  const price  = closes[closes.length - 1];

  // RSI
  const rsiArr   = rsi(closes, 14);
  const rsi14    = rsiArr[rsiArr.length - 1] ?? null;

  // MACD
  const macdData  = macd(closes);
  const macdLine  = macdData.macdLine[macdData.macdLine.length - 1] ?? null;
  const macdSig   = macdData.signal[macdData.signal.length - 1] ?? null;
  const macdHist  = macdData.hist[macdData.hist.length - 1] ?? null;

  // Bollinger Bands
  const bb        = bollingerBands(closes, 20, 2);
  const bbU       = bb.upper[bb.upper.length - 1]   ?? null;
  const bbM       = bb.middle[bb.middle.length - 1] ?? null;
  const bbL       = bb.lower[bb.lower.length - 1]   ?? null;
  const bbWidth   = bbU != null && bbL != null && bbM != null && bbM > 0
    ? ((bbU - bbL) / bbM) * 100 : null;
  const bbPosition = bbU != null && bbL != null && bbU > bbL
    ? ((price - bbL) / (bbU - bbL)) * 100 : null;

  // EMAs
  const ema20arr  = ema(closes, 20);
  const ema50arr  = ema(closes, 50);
  const ema200arr = ema(closes, 200);
  const ema20v    = ema20arr[ema20arr.length - 1] ?? null;
  const ema50v    = ema50arr[ema50arr.length - 1] ?? null;
  const ema200v   = ema200arr[ema200arr.length - 1] ?? null;

  // VWAP
  const vwap = calcVWAP(candles);

  // ATR
  const atrArr = calcATR(candles, 14);
  const atr14  = atrArr[atrArr.length - 1] ?? null;

  // Support / Resistance
  const { supports, resistances } = findSRLevels(candles, 3);

  // Trend determination
  let trend: TAResult["trend"] = "sideways";
  if (ema20v && ema50v && ema200v) {
    if (price > ema20v && ema20v > ema50v && ema50v > ema200v) trend = "uptrend";
    else if (price < ema20v && ema20v < ema50v && ema50v < ema200v) trend = "downtrend";
  } else if (ema20v && ema50v) {
    if (price > ema20v && ema20v > ema50v) trend = "uptrend";
    else if (price < ema20v && ema20v < ema50v) trend = "downtrend";
  }

  // RSI signal
  let rsiSignal: TAResult["rsiSignal"] = "neutral";
  if (rsi14 != null) {
    if (rsi14 >= 70) rsiSignal = "overbought";
    else if (rsi14 <= 30) rsiSignal = "oversold";
    else if (rsi14 > 55) rsiSignal = "bullish";
    else if (rsi14 < 45) rsiSignal = "bearish";
  }

  // MACD signal
  let macdSignalDir: TAResult["macdSignalDir"] = "neutral";
  if (macdLine != null && macdSig != null) {
    if (macdLine > macdSig && macdHist != null && macdHist > 0) macdSignalDir = "bullish";
    else if (macdLine < macdSig && macdHist != null && macdHist < 0) macdSignalDir = "bearish";
  }

  // BB signal
  let bbSignal: TAResult["bbSignal"] = "neutral";
  if (bbWidth != null && bbPosition != null) {
    if (bbWidth < 2)       bbSignal = "squeeze";
    else if (bbWidth > 8)  bbSignal = "expansion";
    else if (bbPosition > 95) bbSignal = "overbought";
    else if (bbPosition < 5)  bbSignal = "oversold";
  }

  // Plain-English summary
  const fmt = (n: number | null, d: number = 2) => n != null ? n.toFixed(d) : "N/A";
  const priceFmt = price > 100 ? price.toLocaleString(undefined, {maximumFractionDigits:2}) : price.toFixed(6);

  const summaryParts: string[] = [];
  summaryParts.push(`Price: $${priceFmt}`);
  summaryParts.push(`Trend: ${trend.toUpperCase()} (EMA20:${fmt(ema20v)} / EMA50:${fmt(ema50v)} / EMA200:${fmt(ema200v)})`);
  summaryParts.push(`RSI(14): ${fmt(rsi14,1)} — ${rsiSignal.toUpperCase()}`);
  summaryParts.push(`MACD: line ${fmt(macdLine,4)} | signal ${fmt(macdSig,4)} | hist ${fmt(macdHist,4)} — ${macdSignalDir.toUpperCase()}`);
  summaryParts.push(`Bollinger: upper ${fmt(bbU)} | mid ${fmt(bbM)} | lower ${fmt(bbL)} | width ${fmt(bbWidth,1)}% | pos ${fmt(bbPosition,0)}% — ${bbSignal.toUpperCase()}`);
  if (atr14 != null) summaryParts.push(`ATR(14): ${fmt(atr14)} (${((atr14/price)*100).toFixed(2)}% of price)`);
  if (!isNaN(vwap)) summaryParts.push(`VWAP: $${fmt(vwap)}`);
  if (resistances.length) summaryParts.push(`Resistance levels: ${resistances.map(r=>r.toLocaleString()).join(" → ")}`);
  if (supports.length)    summaryParts.push(`Support levels: ${supports.map(s=>s.toLocaleString()).join(" → ")}`);

  return {
    symbol: sym, interval, candles,
    rsi14, macdLine, macdSignal: macdSig, macdHist, bbUpper: bbU,
    bbMiddle: bbM, bbLower: bbL, bbWidth, bbPosition,
    ema20: ema20v, ema50: ema50v, ema200: ema200v,
    vwap: isNaN(vwap) ? null : vwap, atr14,
    supports, resistances, trend,
    rsiSignal, macdSignalDir, bbSignal,
    summary: summaryParts.join("\n"),
  };
}
