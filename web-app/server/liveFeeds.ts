/**
 * liveFeeds.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Three real-time data sources, all zero-delay:
 *
 *  1. Binance Spot WebSocket  – ALL active USDT pairs (~350+ coins)
 *     wss://stream.binance.com:9443/ws/!ticker@arr  → 1-second push
 *
 *  2. Binance Futures WebSocket – ALL USDT-M perpetual contracts
 *     wss://fstream.binance.com/public/ws/!ticker@arr → 1-second push
 *
 *  3. Yahoo Finance REST polling – Stocks & index ETFs (every 2 s)
 *     https://query1.finance.yahoo.com/v8/finance/chart/<sym>
 *
 * All data is merged into a single in-memory store and exposed through SSE
 * and REST so the frontend can render zero-latency live ticks.
 */

import WebSocket from "ws";
import axios from "axios";
import { EventEmitter } from "events";

// ─── Shared tick store ────────────────────────────────────────────────────────

export interface Tick {
  symbol: string;
  name: string;
  category: "crypto" | "futures" | "stocks" | "oil";
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  quoteVolume: number;
  updatedAt: number; // ms timestamp
  // order book
  bid?: number;
  ask?: number;
  // futures-specific
  fundingRate?: number;
  openInterest?: number;
  // Upgraded sentiment factors
  cvd?: number;          // Cumulative Volume Delta (aggTrade WS) — buy vol minus sell vol, normalized
  cvdSignal?: number;    // CVD signal [-1,1]: positive = buying pressure
  oiDelta?: number;      // Open Interest % change vs 1 hour ago
  oiSignal?: number;     // OI signal [-1,1]: rising OI + rising price = real trend
  adx?: number;          // ADX-14 (Average Directional Index) — trend strength 0-100
  // crypto extras
  rank?: number;
  image?: string;
}

export const tickStore = new Map<string, Tick>();
export const tickEmitter = new EventEmitter();
tickEmitter.setMaxListeners(500);

// ─── CVD (Cumulative Volume Delta) store ─────────────────────────────────────
// Tracks aggressive buy vs sell volume from aggTrade stream per symbol
// cvdStore[symbol] = { buyVol, sellVol, window: rolling 500 trades }
interface CVDEntry { buyVol: number; sellVol: number; updatedAt: number }
const cvdStore = new Map<string, CVDEntry>();

// ─── Open Interest store ──────────────────────────────────────────────────────
// oiStore[symbol] = { current, prev1h, delta% }
interface OIEntry { current: number; prev1h: number; deltaPercent: number; updatedAt: number }
const oiStore = new Map<string, OIEntry>();

// ─── Price history for ADX calculation ───────────────────────────────────────
// Keep last 30 candle-equivalent closes per symbol (sampled every ~2min)
const priceHistory = new Map<string, number[]>();
const MAX_PRICE_HISTORY = 30;

function recordPriceHistory(symbol: string, price: number) {
  const arr = priceHistory.get(symbol) || [];
  arr.push(price);
  if (arr.length > MAX_PRICE_HISTORY) arr.shift();
  priceHistory.set(symbol, arr);
}

// ADX-14 approximation from price history array
// Uses Wilder smoothing on TR-equivalent (|close[i] - close[i-1]|)
function calcADX(prices: number[]): number {
  if (prices.length < 15) return 25; // default — assume moderate trend
  const period = 14;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const curr = prices[i];
    const prev = prices[i - 1];
    const tr = Math.abs(curr - prev);
    trs.push(tr);
    // Using simplified DM from close-to-close
    if (curr > prev) { plusDMs.push(curr - prev); minusDMs.push(0); }
    else { plusDMs.push(0); minusDMs.push(prev - curr); }
  }

  if (trs.length < period) return 25;

  // Wilder smoothing
  let atr14 = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let plus14 = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let minus14 = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  for (let i = period; i < trs.length; i++) {
    atr14  = atr14  - atr14 / period  + trs[i];
    plus14 = plus14 - plus14 / period + plusDMs[i];
    minus14= minus14- minus14/ period + minusDMs[i];
  }

  if (atr14 === 0) return 25;
  const diPlus  = (plus14  / atr14) * 100;
  const diMinus = (minus14 / atr14) * 100;
  const diSum   = diPlus + diMinus;
  const dx      = diSum > 0 ? Math.abs(diPlus - diMinus) / diSum * 100 : 0;
  return Math.round(dx);
}

// Well-known coin names
const COIN_NAMES: Record<string, string> = {
  BTC:"Bitcoin",ETH:"Ethereum",BNB:"BNB",SOL:"Solana",XRP:"XRP",
  ADA:"Cardano",DOGE:"Dogecoin",AVAX:"Avalanche",LINK:"Chainlink",
  DOT:"Polkadot",MATIC:"Polygon",POL:"Polygon",LTC:"Litecoin",UNI:"Uniswap",
  ATOM:"Cosmos",NEAR:"NEAR",TON:"Toncoin",TRX:"TRON",
  SHIB:"Shiba Inu",BCH:"Bitcoin Cash",APT:"Aptos",ARB:"Arbitrum",
  OP:"Optimism",FTM:"Fantom",ALGO:"Algorand",VET:"VeChain",
  FIL:"Filecoin",SAND:"The Sandbox",MANA:"Decentraland",
  AAVE:"Aave",COMP:"Compound",MKR:"Maker",SNX:"Synthetix",
  GRT:"The Graph",INJ:"Injective",SUI:"Sui",SEI:"Sei",
  WIF:"dogwifhat",PEPE:"Pepe",FLOKI:"Floki",
  JTO:"Jito",JUP:"Jupiter",PYTH:"Pyth",BONK:"Bonk",
  RUNE:"THORChain",EGLD:"MultiversX",THETA:"Theta",
  EOS:"EOS",XLM:"Stellar",IOTA:"IOTA",NEO:"NEO",
  DASH:"Dash",ZEC:"Zcash",XMR:"Monero",HBAR:"Hedera",
  ICP:"Internet Computer",FLOW:"Flow",MINA:"Mina",
  CRV:"Curve",YFI:"Yearn.Finance",SUSHI:"SushiSwap",
  BAL:"Balancer",ZIL:"Zilliqa",ENJ:"Enjin",CHZ:"Chiliz",
  ANKR:"Ankr",ONE:"Harmony",HOT:"Holo",GALA:"Gala",
  IMX:"Immutable X",LDO:"Lido",STX:"Stacks",CFX:"Conflux",
  KAVA:"Kava",ROSE:"Oasis",OCEAN:"Ocean Protocol",
  WLD:"Worldcoin",BLUR:"Blur",TIA:"Celestia",
  MANTA:"Manta",STRK:"Starknet",PIXEL:"Pixels",
  PORTAL:"Portal",ALT:"AltLayer",ETHFI:"Ether.fi",
  OMNI:"Omni",REZ:"Renzo",BB:"BounceBit",
  NOT:"Notcoin",IO:"io.net",ZK:"ZKsync",LISTA:"Lista DAO",
  ZRO:"LayerZero",EIGEN:"EigenLayer",HMSTR:"Hamster Kombat",
  CATI:"Catizen",BANANA:"Banana",DOGS:"DOGS",MAJOR:"MAJOR",
  GRASS:"Grass",NEIRO:"Neiro",CELO:"Celo",ENA:"Ethena",
  W:"Wormhole",TNSR:"Tensor",SAGA:"Saga",BOME:"Book of Meme",
};

const FUTURES_CONTRACT_NAMES: Record<string, string> = {
  BTCUSDT:"BTC Perp",ETHUSDT:"ETH Perp",SOLUSDT:"SOL Perp",
  XRPUSDT:"XRP Perp",BNBUSDT:"BNB Perp",ADAUSDT:"ADA Perp",
  DOGEUSDT:"DOGE Perp",AVAXUSDT:"AVAX Perp",LINKUSDT:"LINK Perp",
  MATICUSDT:"MATIC Perp",DOTUSDT:"DOT Perp",LTCUSDT:"LTC Perp",
  ARBUSDT:"ARB Perp",OPUSDT:"OP Perp",INJUSDT:"INJ Perp",
  SUIUSDT:"SUI Perp",RUNEUSDT:"RUNE Perp",SEIUSDT:"SEI Perp",
  WIFUSDT:"WIF Perp",PEPEUSDT:"PEPE Perp",TRXUSDT:"TRX Perp",
  ATOMUSDT:"ATOM Perp",NEARUSDT:"NEAR Perp",FTMUSDT:"FTM Perp",
  ALGOUSDT:"ALGO Perp",VETUSDT:"VET Perp",FILUSDT:"FIL Perp",
  LDOUSDT:"LDO Perp",STXUSDT:"STX Perp",ENAUSDT:"ENA Perp",
  WLDUSDT:"WLD Perp",BLURSUDT:"BLUR Perp",TIAUSDT:"TIA Perp",
  JUPUSDT:"JUP Perp",BONKUSDT:"BONK Perp",PYTHUSDT:"PYTH Perp",
  JTOUSDT:"JTO Perp",NOTUSDT:"NOT Perp",IOUSDT:"IO Perp",
  EIGENUSDT:"EIGEN Perp",HBARUSDT:"HBAR Perp",ICPUSDT:"ICP Perp",
  GALAUSDT:"GALA Perp",IMXUSDT:"IMX Perp",CFXUSDT:"CFX Perp",
  APEUSDT:"APE Perp",GMTUSDT:"GMT Perp",SANDUSDT:"SAND Perp",
  MANAUSDT:"MANA Perp",AXSUSDT:"AXS Perp",CRVUSDT:"CRV Perp",
  MKRUSDT:"MKR Perp",AAVEUSDT:"AAVE Perp",SNXUSDT:"SNX Perp",
  GRTUSDT:"GRT Perp",CELOUSDT:"CELO Perp",FLOWUSDT:"FLOW Perp",
};

const STOCK_TICKERS: { sym: string; name: string; subcat: string }[] = [
  // Index ETFs
  { sym: "SPY",  name: "S&P 500 ETF",        subcat: "index" },
  { sym: "QQQ",  name: "Nasdaq 100 ETF",      subcat: "index" },
  { sym: "DIA",  name: "Dow Jones ETF",       subcat: "index" },
  { sym: "IWM",  name: "Russell 2000 ETF",    subcat: "index" },
  { sym: "^VIX", name: "VIX Fear Index",      subcat: "index" },
  // Mega-cap
  { sym: "AAPL", name: "Apple",               subcat: "mega" },
  { sym: "MSFT", name: "Microsoft",           subcat: "mega" },
  { sym: "NVDA", name: "NVIDIA",              subcat: "mega" },
  { sym: "GOOGL",name: "Alphabet",            subcat: "mega" },
  { sym: "AMZN", name: "Amazon",              subcat: "mega" },
  { sym: "META", name: "Meta",                subcat: "mega" },
  { sym: "TSLA", name: "Tesla",               subcat: "mega" },
  { sym: "TSM",  name: "TSMC",                subcat: "mega" },
  // Finance
  { sym: "JPM",  name: "JPMorgan Chase",      subcat: "finance" },
  { sym: "GS",   name: "Goldman Sachs",       subcat: "finance" },
  { sym: "BAC",  name: "Bank of America",     subcat: "finance" },
  { sym: "V",    name: "Visa",                subcat: "finance" },
  // Futures (via Yahoo)
  { sym: "ES=F", name: "S&P 500 Futures",     subcat: "futures" },
  { sym: "NQ=F", name: "Nasdaq Futures",      subcat: "futures" },
  { sym: "YM=F", name: "Dow Futures",         subcat: "futures" },
  { sym: "RTY=F",name: "Russell Futures",     subcat: "futures" },
  { sym: "GC=F", name: "Gold Futures",        subcat: "futures" },
  { sym: "SI=F", name: "Silver Futures",      subcat: "futures" },
  { sym: "ZB=F", name: "30Y Bond Futures",    subcat: "futures" },
  { sym: "CL=F", name: "WTI Crude Oil",       subcat: "oil" },
  { sym: "BZ=F", name: "Brent Crude",         subcat: "oil" },
  { sym: "NG=F", name: "Natural Gas",         subcat: "oil" },
  { sym: "RB=F", name: "RBOB Gasoline",       subcat: "oil" },
  { sym: "HG=F", name: "Copper Futures",      subcat: "futures" },
];

// ─── 1. Binance Spot — data-stream.binance.vision (no geo-block) ─────────────
// stream.binance.com:9443 is geo-blocked (451). data-stream.binance.vision is
// the official Binance mirror that is NOT geo-blocked. We use combined streams
// (batches of 200 pairs) for true zero-delay WebSocket updates.

let spotWs: WebSocket | null = null;
let spotReconnectTimer: NodeJS.Timeout | null = null;
let spotWsFailed = false;
let spotRestPoller: NodeJS.Timeout | null = null;
const spotWsConnections: WebSocket[] = [];

// Dead / collapsed / duplicate coins — block from appearing in the app
const BLOCKLIST = new Set([
  // Rebranded / duplicate
  "MATIC",  // rebranded to POL
  "BTTC",   // BitTorrent old chain

  // Dead / collapsed coins
  "LUNC", "LUNA", "LUNA2", "USTC", "UST",

  // Stablecoins — not tradeable assets
  "USDC", "USDT", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "GUSD",
  "USDD", "SUSD", "FRAX", "LUSD", "USD1", "PYUSD", "CEUR", "CUSD",

  // Gold/commodity tokens (shown separately in oil tab)
  "XAUT", "PAXG",

  // Different project often confused with Polygon
  "POLY",   // Polymath — NOT Polygon, confusing name

  // Low quality / meme coins with no fundamentals
  "BABY", "NIGHT", "MEGA", "RIF", "DEXE", "STG",
  "LAZIO", "PORTO", "SANTOS", "ATM", "BAR", "CITY", "JUV", "PSG", "ACM", "ASR", "OG",
  "ALPACA", "CHESS", "AUCTION", "AUTO",
]);

function processSpotTickers(tickers: any[]) {
  // Supports both Binance WS format (t.s, t.c, t.o, t.v, t.q, t.h, t.l)
  // and REST format (t.symbol, t.lastPrice, t.openPrice, t.volume, t.quoteVolume, t.highPrice, t.lowPrice)
  const now = Date.now();
  const changed: string[] = [];
  for (const t of tickers) {
    // Normalize: WS uses 's', REST uses 'symbol'
    const sym: string = t.s || t.symbol || "";
    if (!sym || !sym.endsWith("USDT")) continue;
    const base = sym.replace("USDT", "");
    if (BLOCKLIST.has(base)) continue; // skip dead/fake/duplicate coins
    // WS uses 'c' (last price), REST uses 'lastPrice'
    const price = parseFloat(t.c || t.lastPrice || "0");
    const open  = parseFloat(t.o || t.openPrice || "0");
    const change = price - open;
    const changePct = open ? (change / open) * 100 : parseFloat(t.priceChangePercent || "0");
    const tick: Tick = {
      symbol: base,
      name: COIN_NAMES[base] || base,
      category: "crypto",
      price,
      change: Math.round(change * 10000) / 10000,
      changePercent: Math.round(changePct * 100) / 100,
      volume: parseFloat(t.v || t.volume || "0"),
      quoteVolume: parseFloat(t.q || t.quoteVolume || "0"),
      high: parseFloat(t.h || t.highPrice || "0"),
      low:  parseFloat(t.l || t.lowPrice  || "0"),
      open,
      updatedAt: now,
    };
    tickStore.set(`crypto:${base}`, tick);
    changed.push(`crypto:${base}`);
  }
  if (changed.length > 0) tickEmitter.emit("batch", changed);
}

// Use data-stream.binance.vision — official mirror, NOT geo-blocked
// Step 1: seed prices via REST, Step 2: open batched WS for zero-delay updates
async function connectBinanceSpot() {
  let pairs: string[] = [];
  try {
    const r = await axios.get("https://data-api.binance.vision/api/v3/ticker/24hr", {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    });
    // Seed initial prices immediately from REST
    processSpotTickers(r.data);
    pairs = (r.data as any[])
      .filter((t: any) => t.symbol.endsWith("USDT") && parseFloat(t.lastPrice) > 0)
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .map((t: any) => (t.symbol as string));
    console.log(`[Binance Spot] Seeded ${pairs.length} pairs from REST, opening WS streams...`);
  } catch (e: any) {
    console.error("[Binance Spot] REST seed failed:", e.message);
    // Retry in 5s
    setTimeout(connectBinanceSpot, 5000);
    return;
  }

  // Close any existing WS connections
  for (const ws of spotWsConnections) { try { ws.terminate(); } catch {} }
  spotWsConnections.length = 0;

  // Batch into groups of 200 (Binance limit per connection)
  const BATCH = 200;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const batch = pairs.slice(i, i + BATCH);
    const streams = batch.map(s => s.toLowerCase() + "@ticker").join("/");
    const url = `wss://data-stream.binance.vision/stream?streams=${streams}`;
    openSpotBatchWs(url, Math.floor(i / BATCH));
  }
}

function openSpotBatchWs(url: string, batchIdx: number) {
  const ws = new WebSocket(url);
  spotWsConnections.push(ws);
  let pingTimer: NodeJS.Timeout | null = null;

  ws.on("open", () => {
    console.log(`[Binance Spot WS-${batchIdx}] Connected (zero-delay)`);
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 20000);
  });

  ws.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.data) processSpotTickers([msg.data]);
    } catch {}
  });

  ws.on("close", (code) => {
    if (pingTimer) clearInterval(pingTimer);
    console.log(`[Binance Spot WS-${batchIdx}] Closed (${code}), reconnecting in 5s...`);
    setTimeout(() => openSpotBatchWs(url, batchIdx), 5000);
  });

  ws.on("error", (err) => {
    if (pingTimer) clearInterval(pingTimer);
    console.error(`[Binance Spot WS-${batchIdx}] Error:`, err.message);
  });
}

// ─── 2. Binance Futures WebSocket ─────────────────────────────────────────────

let futWs: WebSocket | null = null;
let futWsFailed = false;
let futRestPoller: NodeJS.Timeout | null = null;

function processFuturesTickers(tickers: any[]) {
  const now = Date.now();
  const changed: string[] = [];
  for (const t of tickers) {
    const sym: string = t.s || t.symbol || "";
    if (!sym || !sym.endsWith("USDT")) continue;
    const symBase = sym.replace("USDT", "");
    if (BLOCKLIST.has(symBase)) continue;
    const price = parseFloat(t.c || t.lastPrice || "0");
    const open  = parseFloat(t.o || t.openPrice || "0");
    const change = price - open;
    const changePct = open ? (change / open) * 100 : parseFloat(t.priceChangePercent || "0");
    const tick: Tick = {
      symbol: sym,
      name: FUTURES_CONTRACT_NAMES[sym] || symBase + " Perp",
      category: "futures",
      price,
      change: Math.round(change * 10000) / 10000,
      changePercent: Math.round(changePct * 100) / 100,
      volume: parseFloat(t.v || t.volume || "0"),
      quoteVolume: parseFloat(t.q || t.quoteVolume || "0"),
      high: parseFloat(t.h || t.highPrice || "0"),
      low:  parseFloat(t.l || t.lowPrice  || "0"),
      open,
      updatedAt: now,
    };
    tickStore.set(`futures:${sym}`, tick);
    changed.push(`futures:${sym}`);
  }
  if (changed.length > 0) tickEmitter.emit("batch", changed);
}

const FUTURES_ENDPOINTS = [
  "https://fapi.binance.com/fapi/v1/ticker/24hr",
  "https://data-api.binance.vision/fapi/v1/ticker/24hr",  // mirror
  "https://www.binance.com/fapi/v1/ticker/24hr",          // proxy fallback
];

async function pollBinanceFuturesRest() {
  for (const url of FUTURES_ENDPOINTS) {
    try {
      const r = await axios.get(url, {
        timeout: 5000,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      processFuturesTickers(r.data);
      console.log(`[Binance Futures REST] Updated ${r.data.length} perpetuals via ${url}`);
      return;
    } catch (e: any) {
      console.error(`[Binance Futures REST] ${url} failed: ${e.message}`);
    }
  }
}

function startFuturesRestFallback() {
  if (futRestPoller) return;
  console.log("[Binance Futures] Falling back to REST polling every 3s");
  pollBinanceFuturesRest();
  futRestPoller = setInterval(pollBinanceFuturesRest, 500);
}

function connectBinanceFutures() {
  if (futWsFailed) { startFuturesRestFallback(); return; }
  if (futWs) { try { futWs.terminate(); } catch {} }

  console.log("[Binance Futures] Connecting via WebSocket...");
  futWs = new WebSocket("wss://fstream.binance.com/public/ws/!ticker@arr");

  let pingTimer: NodeJS.Timeout | null = null;

  futWs.on("open", () => {
    console.log("[Binance Futures] WS Connected - streaming all perpetuals");
    pingTimer = setInterval(() => {
      if (futWs?.readyState === WebSocket.OPEN) futWs.ping();
    }, 30000);
  });

  futWs.on("message", (raw: Buffer) => {
    try { processFuturesTickers(JSON.parse(raw.toString())); } catch {}
  });

  futWs.on("close", (code) => {
    if (pingTimer) clearInterval(pingTimer);
    if (code === 451 || futWsFailed) {
      futWsFailed = true;
      startFuturesRestFallback();
    } else {
      console.log(`[Binance Futures] Disconnected (${code}), reconnecting in 3s...`);
      setTimeout(connectBinanceFutures, 3000);
    }
  });

  futWs.on("error", (err) => {
    console.error("[Binance Futures] WS Error:", err.message);
    futWsFailed = true;
    if (pingTimer) clearInterval(pingTimer);
    try { futWs?.terminate(); } catch {}
    startFuturesRestFallback();
  });
}

let stockPoller: NodeJS.Timeout | null = null;

const DISPLAY_MAP: Record<string, string> = {
  "ES=F":"ES", "NQ=F":"NQ", "YM=F":"YM", "RTY=F":"RTY",
  "GC=F":"GC", "SI=F":"SI", "ZB=F":"ZB", "CL=F":"WTI",
  "BZ=F":"BRENT", "NG=F":"NG", "RB=F":"RB", "HG=F":"HG",
  "^VIX":"VIX",
};
const SUBCAT_MAP: Record<string, "stocks"|"futures"|"oil"> = {
  "index":"stocks","mega":"stocks","finance":"stocks",
  "futures":"futures","oil":"oil",
};

// Fetch ALL symbols in one batch call using Yahoo v7 quote endpoint
async function fetchYahooBatch(syms: string[]): Promise<Record<string, any>> {
  const symbols = syms.join(',');
  const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com",
  };
  const urls = [
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketDayHigh,regularMarketDayLow,regularMarketOpen`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketDayHigh,regularMarketDayLow,regularMarketOpen`,
  ];
  for (const url of urls) {
    try {
      const r = await axios.get(url, { timeout: 10000, headers });
      const results: any[] = r.data?.quoteResponse?.result || [];
      const map: Record<string, any> = {};
      for (const q of results) map[q.symbol] = q;
      return map;
    } catch (e: any) {
      console.warn(`[Stocks] batch fetch failed: ${e.message}`);
    }
  }
  return {};
}

async function pollStocks() {
  const now = Date.now();
  const changed: string[] = [];

  const syms = STOCK_TICKERS.map(m => m.sym);
  const quotes = await fetchYahooBatch(syms);

  for (const meta of STOCK_TICKERS) {
    const q = quotes[meta.sym];
    if (!q) continue;
    const displaySym = DISPLAY_MAP[meta.sym] || meta.sym;
    const cat = SUBCAT_MAP[meta.subcat] || "stocks";
    const key = `${cat}:${displaySym}`;
    const price = q.regularMarketPrice ?? 0;
    tickStore.set(key, {
      symbol: displaySym,
      name: meta.name,
      category: cat,
      price,
      change: Math.round((q.regularMarketChange ?? 0) * 100) / 100,
      changePercent: Math.round((q.regularMarketChangePercent ?? 0) * 100) / 100,
      volume: q.regularMarketVolume ?? 0,
      quoteVolume: 0,
      high: q.regularMarketDayHigh ?? price,
      low:  q.regularMarketDayLow  ?? price,
      open: q.regularMarketOpen    ?? price,
      updatedAt: now,
    });
    changed.push(key);
  }

  if (changed.length) {
    tickEmitter.emit("batch", changed);
    console.log(`[Stocks] Updated ${changed.length} tickers`);
  }
}

// ─── 3. Binance Spot bookTicker — real-time best bid/ask ─────────────────────
// Stream: wss://stream.binance.com:9443/ws/!bookTicker
// Gives best bid price + qty, best ask price + qty for every symbol in real time

let bookWs: WebSocket | null = null;

function startBookTicker() {
  if (bookWs) { try { bookWs.terminate(); } catch {} }
  bookWs = new WebSocket("wss://stream.binance.com:9443/ws/!bookTicker");

  bookWs.on("open", () => {
    console.log("[BookTicker] Connected — streaming bid/ask for all pairs");
  });

  bookWs.on("message", (raw: Buffer) => {
    try {
      const d = JSON.parse(raw.toString());
      // d = { u, s, b, B, a, A } — symbol, bestBid, bestAsk
      const sym = d.s as string;
      if (!sym || !sym.endsWith("USDT")) return;
      const base = sym.replace("USDT", "");
      const key = `crypto:${base}`;
      const existing = tickStore.get(key);
      if (existing) {
        existing.bid = parseFloat(d.b) || existing.bid;
        existing.ask = parseFloat(d.a) || existing.ask;
      }
      // Also update futures
      const futKey = `futures:${sym}`;
      const futExisting = tickStore.get(futKey);
      if (futExisting) {
        futExisting.bid = parseFloat(d.b) || futExisting.bid;
        futExisting.ask = parseFloat(d.a) || futExisting.ask;
      }
    } catch {}
  });

  bookWs.on("close", () => {
    console.log("[BookTicker] Disconnected — reconnecting in 3s");
    setTimeout(startBookTicker, 3000);
  });

  bookWs.on("error", () => {
    try { bookWs?.terminate(); } catch {}
  });
}

// ─── 4. CVD WebSocket — Binance aggTrade stream ──────────────────────────────
// aggTrade gives every trade with m=true (market maker = seller) or m=false (buyer)
// We subscribe to top 20 crypto pairs for real-time CVD
const CVD_SYMBOLS = ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","ADAUSDT",
  "DOGEUSDT","AVAXUSDT","LINKUSDT","DOTUSDT","MATICUSDT","LTCUSDT",
  "UNIUSDT","ATOMUSDT","NEARUSDT","INJUSDT","SUIUSDT","ARBUSDT","OPUSDT","WIFUSDT"];

let cvdWs: WebSocket | null = null;

function startCVDStream() {
  if (cvdWs) { try { cvdWs.terminate(); } catch {} }
  const streams = CVD_SYMBOLS.map(s => s.toLowerCase() + "@aggTrade").join("/");
  const url = `wss://data-stream.binance.vision/stream?streams=${streams}`;
  cvdWs = new WebSocket(url);

  cvdWs.on("open", () => {
    console.log("[CVD] aggTrade stream connected — tracking buy/sell pressure");
  });

  cvdWs.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      const d = msg.data;
      if (!d || !d.s) return;
      const sym = d.s as string;
      const qty = parseFloat(d.q || "0");
      const isBuyerMaker = d.m as boolean; // m=true → seller is maker (sell trade), m=false → buy trade
      const entry = cvdStore.get(sym) || { buyVol: 0, sellVol: 0, updatedAt: 0 };

      if (isBuyerMaker) {
        entry.sellVol += qty;
      } else {
        entry.buyVol += qty;
      }
      entry.updatedAt = Date.now();

      // Reset CVD window every 5 minutes to prevent stale accumulation
      if (Date.now() - entry.updatedAt > 300000) {
        entry.buyVol = qty;
        entry.sellVol = 0;
      }

      cvdStore.set(sym, entry);

      // Update tick with CVD signal
      const base = sym.replace("USDT", "");
      const tick = tickStore.get(`crypto:${base}`);
      if (tick) {
        const total = entry.buyVol + entry.sellVol;
        if (total > 0) {
          const cvdRatio = (entry.buyVol - entry.sellVol) / total; // [-1, 1]
          tick.cvd = parseFloat((entry.buyVol - entry.sellVol).toFixed(2));
          tick.cvdSignal = Math.max(-1, Math.min(1, cvdRatio * 3)); // amplify
        }
      }
      // Also update futures
      const futTick = tickStore.get(`futures:${sym}`);
      if (futTick) {
        const total = entry.buyVol + entry.sellVol;
        if (total > 0) {
          const cvdRatio = (entry.buyVol - entry.sellVol) / total;
          futTick.cvd = parseFloat((entry.buyVol - entry.sellVol).toFixed(2));
          futTick.cvdSignal = Math.max(-1, Math.min(1, cvdRatio * 3));
        }
      }
    } catch {}
  });

  cvdWs.on("close", () => {
    console.log("[CVD] Stream closed — reconnecting in 5s");
    setTimeout(startCVDStream, 5000);
  });

  cvdWs.on("error", (err) => {
    console.error("[CVD] Error:", err.message);
    try { cvdWs?.terminate(); } catch {}
  });
}

// ─── 5. Open Interest polling — Binance Futures REST ─────────────────────────
// Poll OI every 60s, compute delta vs last reading
const OI_SYMBOLS = CVD_SYMBOLS; // same top 20

async function pollOpenInterest() {
  for (const sym of OI_SYMBOLS) {
    try {
      const r = await axios.get(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`,
        { timeout: 5000, headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const oi = parseFloat(r.data?.openInterest || "0");
      if (oi === 0) continue;

      const existing = oiStore.get(sym);
      const prev1h = existing ? existing.current : oi;
      const delta = prev1h > 0 ? ((oi - prev1h) / prev1h) * 100 : 0;

      oiStore.set(sym, { current: oi, prev1h, deltaPercent: delta, updatedAt: Date.now() });

      // Compute OI signal: combine OI delta with price direction
      const base = sym.replace("USDT", "");
      const tick = tickStore.get(`crypto:${base}`) || tickStore.get(`futures:${sym}`);
      if (tick) {
        const priceUp = tick.changePercent > 0;
        const oiRising = delta > 0;
        // Rising price + rising OI = real trend (bullish)
        // Rising price + falling OI = short squeeze (bearish lean — likely reversal)
        // Falling price + rising OI = real downtrend (bearish)
        // Falling price + falling OI = long liquidation (reversal possible)
        let oiSig = 0;
        if (priceUp && oiRising)    oiSig =  Math.min(1, delta / 2);   // confirmed bull
        if (priceUp && !oiRising)   oiSig = -Math.min(0.5, -delta / 3); // squeeze warning
        if (!priceUp && oiRising)   oiSig = -Math.min(1, delta / 2);   // confirmed bear
        if (!priceUp && !oiRising)  oiSig =  Math.min(0.3, -delta / 4); // possible reversal

        const tickCrypto = tickStore.get(`crypto:${base}`);
        const tickFut    = tickStore.get(`futures:${sym}`);
        if (tickCrypto) { tickCrypto.oiDelta = delta; tickCrypto.oiSignal = oiSig; }
        if (tickFut)    { tickFut.oiDelta    = delta; tickFut.oiSignal    = oiSig; }
      }
    } catch { /* non-critical */ }
  }
}

// ─── 6. Price history sampler for ADX ────────────────────────────────────────
function samplePricesForADX() {
  for (const [key, tick] of tickStore.entries()) {
    if (tick.price > 0) {
      const sym = tick.symbol;
      recordPriceHistory(sym, tick.price);
      const history = priceHistory.get(sym) || [];
      if (history.length >= 15) {
        tick.adx = calcADX(history);
      }
    }
  }
}

// ─── Start all feeds ──────────────────────────────────────────────────────────

export function startLiveFeeds() {
  connectBinanceSpot();
  startBookTicker();
  startCVDStream();

  // OI polling every 60s (non-critical, skip silently if blocked)
  pollOpenInterest();
  setInterval(pollOpenInterest, 60000);

  // Sample prices for ADX every 2 minutes
  setInterval(samplePricesForADX, 120000);

  // Binance Futures WS: try WebSocket, fall back to REST if no USDT perp data after 8s
  // (Yahoo futures already populates "futures" category, so check for USDT perps specifically)
  connectBinanceFutures();
  setTimeout(() => {
    const perpCount = Array.from(tickStore.values()).filter(t => t.category === "futures" && t.symbol.endsWith("USDT")).length;
    if (perpCount === 0) {
      console.log("[LiveFeeds] No Binance USDT perps from WS after 8s, forcing REST fallback");
      futWsFailed = true;
      startFuturesRestFallback();
    }
  }, 8000);

  // Poll stocks/oil every 5 seconds (Yahoo chart API - one call per ticker)
  pollStocks();
  stockPoller = setInterval(pollStocks, 5000);

  console.log("[LiveFeeds] All feeds started");
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getTicksByCategory(category: string): Tick[] {
  const all = Array.from(tickStore.values());
  if (!category || category === "all") return all;
  return all.filter(t => t.category === category);
}

export function getTick(key: string): Tick | undefined {
  return tickStore.get(key);
}

// Return all crypto ticks sorted by quoteVolume desc
export function getCryptoTicks(): Tick[] {
  return Array.from(tickStore.values())
    .filter(t => t.category === "crypto")
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
}

// Return all futures ticks sorted by quoteVolume desc
export function getFuturesTicks(): Tick[] {
  return Array.from(tickStore.values())
    .filter(t => t.category === "futures")
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
}

export function getStockTicks(): Tick[] {
  return Array.from(tickStore.values()).filter(t => t.category === "stocks");
}

export function getOilTicks(): Tick[] {
  return Array.from(tickStore.values()).filter(t => t.category === "oil");
}

// ─── Currency Strength (Full Trading Terminal) ─────────────────────────────────

const MAJOR_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"];

// 28 major pairs (all combinations of 8 currencies) + additional exotic/commodity pairs
const FOREX_PAIRS_28 = [
  // USD pairs
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

// Extended set with indices and commodities context
const FOREX_EXTENDED = [
  "DX-Y.NYB",   // DXY Dollar Index
  "USDSGD=X","USDHKD=X","USDMXN=X","USDZAR=X","USDNOK=X","USDSEK=X","USDDKK=X",
];

export interface ForexPair {
  symbol: string;
  base: string;
  quote: string;
  price: number;
  change1h: number;
  change4h: number;
  change1d: number;
  change1w: number;
  open: number;
  high: number;
  low: number;
  bid: number;
  ask: number;
  spread: number;  // in pips
  updatedAt: number;
}

// Legacy alias for compatibility
export interface ForexTick extends ForexPair {}

export interface CurrencyStrength {
  currency: string;
  strength1h: number;
  strength4h: number;
  strength1d: number;
  strength1w: number;
  rank1h: number;
  rank4h: number;
  rank1d: number;
  rank1w: number;
  change1h: number;  // raw avg % change
  change1d: number;
  pairsCount: number;
  updatedAt: number;
}

export interface ForexPairDetail {
  symbol: string;
  base: string;
  quote: string;
  price: number;
  change1h: number;
  change4h: number;
  change1d: number;
  change1w: number;
  spread: number;
  high: number;
  low: number;
  updatedAt: number;
}

export interface DXYData {
  value: number;
  change1d: number;
  change1w: number;
  updatedAt: number;
}

const forexStore = new Map<string, ForexPair>();
let dxyData: DXYData | null = null;
let forexPoller: NodeJS.Timeout | null = null;
let forexDetailPoller: NodeJS.Timeout | null = null;

// Parse pair base/quote from Yahoo symbol
function parsePair(sym: string): { base: string; quote: string } | null {
  const clean = sym.replace('=X', '').replace('-Y.NYB','').replace('.NYB','');
  if (clean.length < 6) return null;
  return { base: clean.slice(0, 3).toUpperCase(), quote: clean.slice(3, 6).toUpperCase() };
}

// Fetch all 28 major pairs in one Yahoo batch call
async function fetchForexBatch(): Promise<void> {
  const allSymbols = [...FOREX_PAIRS_28, ...FOREX_EXTENDED];
  const symbols = allSymbols.join(',');
  const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://finance.yahoo.com",
  };

  const urls = [
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,bid,ask`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,bid,ask`,
  ];

  for (const url of urls) {
    try {
      const r = await axios.get(url, { timeout: 12000, headers });
      const results: any[] = r.data?.quoteResponse?.result || [];
      const now = Date.now();

      for (const q of results) {
        const sym: string = q.symbol || '';
        
        // Handle DXY separately
        if (sym === 'DX-Y.NYB') {
          dxyData = {
            value: q.regularMarketPrice ?? 0,
            change1d: q.regularMarketChangePercent ?? 0,
            change1w: 0,
            updatedAt: now,
          };
          continue;
        }

        const parsed = parsePair(sym);
        if (!parsed) continue;
        const { base, quote } = parsed;

        const price = q.regularMarketPrice ?? 0;
        const change1d = q.regularMarketChangePercent ?? 0;
        // Approximate shorter timeframes from daily
        const change1h = change1d / 8;   // ~1/8 of daily
        const change4h = change1d / 2;   // ~1/2 of daily
        const change1w = change1d * 3.5; // approx weekly (3.5x daily)
        const open = q.regularMarketOpen ?? price;
        const high = q.regularMarketDayHigh ?? price;
        const low = q.regularMarketDayLow ?? price;
        const bid = q.bid ?? price;
        const ask = q.ask ?? price;

        // Calculate spread in pips (JPY pairs: 2 decimal, others: 4 decimal)
        const pipFactor = quote === 'JPY' || base === 'JPY' ? 100 : 10000;
        const spread = price > 0 ? Math.abs(ask - bid) * pipFactor : 0;

        forexStore.set(sym, { 
          symbol: sym, base, quote, price, 
          change1h, change4h, change1d, change1w,
          open, high, low, bid, ask, spread,
          updatedAt: now 
        });
      }

      console.log(`[Forex] Updated ${results.length} pairs (${forexStore.size} in store)`);
      return;
    } catch (e: any) {
      console.warn(`[Forex] batch fetch failed (${url.includes('query1') ? 'q1' : 'q2'}): ${e.message}`);
    }
  }
}

// Build strength scores from cross-pair data using weighted averaging
function buildStrengthScores(timeframe: 'change1h' | 'change4h' | 'change1d' | 'change1w'): Record<string, number[]> {
  const scores: Record<string, number[]> = {};
  for (const cur of MAJOR_CURRENCIES) scores[cur] = [];

  for (const tick of Array.from(forexStore.values())) {
    const { base, quote } = tick;
    const change = tick[timeframe];
    if (!MAJOR_CURRENCIES.includes(base) && !MAJOR_CURRENCIES.includes(quote)) continue;
    // Base gained → positive for base, negative for quote
    if (scores[base]) scores[base].push(change);
    if (scores[quote]) scores[quote].push(-change);
  }
  return scores;
}

// Normalize array of raw scores to 0-100
function normalizeScores(scores: Record<string, number[]>): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const cur of MAJOR_CURRENCIES) {
    const arr = scores[cur];
    raw[cur] = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }
  const vals = Object.values(raw);
  const min = Math.min(...vals), max = Math.max(...vals);
  const norm: Record<string, number> = {};
  for (const cur of MAJOR_CURRENCIES) {
    norm[cur] = max === min ? 50 : Math.round(((raw[cur] - min) / (max - min)) * 100);
  }
  return norm;
}

export function getCurrencyStrength(): CurrencyStrength[] {
  const now = Date.now();
  if (forexStore.size === 0) return [];

  const s1h = buildStrengthScores('change1h');
  const s4h = buildStrengthScores('change4h');
  const s1d = buildStrengthScores('change1d');
  const s1w = buildStrengthScores('change1w');

  const n1h = normalizeScores(s1h);
  const n4h = normalizeScores(s4h);
  const n1d = normalizeScores(s1d);
  const n1w = normalizeScores(s1w);

  const result: CurrencyStrength[] = MAJOR_CURRENCIES.map(cur => ({
    currency: cur,
    strength1h: n1h[cur] ?? 50,
    strength4h: n4h[cur] ?? 50,
    strength1d: n1d[cur] ?? 50,
    strength1w: n1w[cur] ?? 50,
    rank1h: 0, rank4h: 0, rank1d: 0, rank1w: 0,
    change1h: s1h[cur]?.length ? s1h[cur].reduce((a, b) => a + b, 0) / s1h[cur].length : 0,
    change1d: s1d[cur]?.length ? s1d[cur].reduce((a, b) => a + b, 0) / s1d[cur].length : 0,
    pairsCount: (s1d[cur] || []).length,
    updatedAt: now,
  }));

  // Assign ranks (1 = strongest)
  const rankFor = (arr: CurrencyStrength[], key: keyof CurrencyStrength) => {
    const sorted = [...arr].sort((a, b) => (b[key] as number) - (a[key] as number));
    arr.forEach(r => {
      const idx = sorted.findIndex(s => s.currency === r.currency);
      if (key === 'strength1h') r.rank1h = idx + 1;
      else if (key === 'strength4h') r.rank4h = idx + 1;
      else if (key === 'strength1d') r.rank1d = idx + 1;
      else if (key === 'strength1w') r.rank1w = idx + 1;
    });
  };
  rankFor(result, 'strength1h');
  rankFor(result, 'strength4h');
  rankFor(result, 'strength1d');
  rankFor(result, 'strength1w');

  return result.sort((a, b) => a.rank1d - b.rank1d);
}

export function getForexTicks(): ForexPair[] {
  return Array.from(forexStore.values());
}

// Return all 28 major pairs with full detail for the pair table
export function getForexPairs(): ForexPairDetail[] {
  return Array.from(forexStore.values())
    .filter(t => FOREX_PAIRS_28.includes(t.symbol))
    .map(t => ({
      symbol: t.symbol.replace('=X', ''),
      base: t.base,
      quote: t.quote,
      price: t.price,
      change1h: t.change1h,
      change4h: t.change4h,
      change1d: t.change1d,
      change1w: t.change1w,
      spread: t.spread,
      high: t.high,
      low: t.low,
      updatedAt: t.updatedAt,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function getDXY(): DXYData | null {
  return dxyData;
}

export function startForexFeed() {
  fetchForexBatch();
  forexPoller = setInterval(fetchForexBatch, 60000); // refresh every 60s
}
