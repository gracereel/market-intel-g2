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
  category: "crypto" | "futures" | "stocks";
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  quoteVolume: number;
  updatedAt: number; // ms timestamp
  // futures-specific
  fundingRate?: number;
  openInterest?: number;
  // crypto extras
  rank?: number;
  image?: string;
}

export const tickStore = new Map<string, Tick>();
export const tickEmitter = new EventEmitter();
tickEmitter.setMaxListeners(500);

// Well-known coin names
const COIN_NAMES: Record<string, string> = {
  BTC:"Bitcoin",ETH:"Ethereum",BNB:"BNB",SOL:"Solana",XRP:"XRP",
  ADA:"Cardano",DOGE:"Dogecoin",AVAX:"Avalanche",LINK:"Chainlink",
  DOT:"Polkadot",MATIC:"Polygon",POL:"POL (Polygon)",LTC:"Litecoin",UNI:"Uniswap",
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
  ICP:"Internet Computer",FLOW:"Flow",SAND:"Sandbox",
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
  "MATIC",  // rebranded to POL — same coin, show POL only
  "LUNC",   // Terra Luna Classic — collapsed May 2022
  "LUNA",   // Terra 2.0 — effectively dead
  "USTC",   // collapsed UST stablecoin
  "UST",    // same collapsed stablecoin
  "LUNA2",  // another Terra variant
  "BUSD",   // Binance USD — discontinued
  "BTTC",   // BitTorrent old chain
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

// ─── Start all feeds ──────────────────────────────────────────────────────────

export function startLiveFeeds() {
  connectBinanceSpot();

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

// ─── Currency Strength ────────────────────────────────────────────────────────

const MAJOR_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"];

// Forex pairs to fetch — each currency vs USD and cross pairs for strength calc
const FOREX_PAIRS = [
  "EURUSD=X","GBPUSD=X","USDJPY=X","USDCHF=X","AUDUSD=X","USDCAD=X","NZDUSD=X",
  "EURGBP=X","EURJPY=X","GBPJPY=X","AUDJPY=X","CADJPY=X","EURCHF=X","GBPCHF=X",
];

export interface ForexTick {
  symbol: string;
  base: string;
  quote: string;
  price: number;
  change1h: number;
  change1d: number;
  updatedAt: number;
}

export interface CurrencyStrength {
  currency: string;
  strength1h: number;  // 0-100
  strength1d: number;  // 0-100
  rank1h: number;
  rank1d: number;
  updatedAt: number;
}

const forexStore = new Map<string, ForexTick>();
let forexPoller: NodeJS.Timeout | null = null;

async function fetchForexBatch(): Promise<void> {
  const symbols = FOREX_PAIRS.join(',');
  const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://finance.yahoo.com",
  };
  const urls = [
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent`,
  ];

  for (const url of urls) {
    try {
      const r = await axios.get(url, { timeout: 10000, headers });
      const results: any[] = r.data?.quoteResponse?.result || [];
      const now = Date.now();
      for (const q of results) {
        const sym: string = q.symbol || '';
        // Parse base/quote from symbol like EURUSD=X
        const clean = sym.replace('=X', '');
        const base = clean.slice(0, 3).toUpperCase();
        const quote = clean.slice(3, 6).toUpperCase();
        const price = q.regularMarketPrice ?? 0;
        const change1d = q.regularMarketChangePercent ?? 0;
        // Estimate 1h change as ~1/6 of daily change (approximation)
        const change1h = change1d / 6;
        forexStore.set(sym, { symbol: sym, base, quote, price, change1h, change1d, updatedAt: now });
      }
      console.log(`[Forex] Updated ${results.length} pairs`);
      return;
    } catch (e: any) {
      console.warn(`[Forex] batch fetch failed: ${e.message}`);
    }
  }
}

export function getCurrencyStrength(): CurrencyStrength[] {
  const now = Date.now();
  // Calculate strength score for each currency based on its performance vs all others
  const scores1h: Record<string, number[]> = {};
  const scores1d: Record<string, number[]> = {};

  for (const cur of MAJOR_CURRENCIES) {
    scores1h[cur] = [];
    scores1d[cur] = [];
  }

  for (const tick of forexStore.values()) {
    const { base, quote, change1h, change1d } = tick;
    // Base currency gained if change is positive
    if (scores1h[base]) scores1h[base].push(change1h);
    if (scores1d[base]) scores1d[base].push(change1d);
    // Quote currency lost if change is positive (inverse)
    if (scores1h[quote]) scores1h[quote].push(-change1h);
    if (scores1d[quote]) scores1d[quote].push(-change1d);
  }

  // Average scores
  const raw1h: Record<string, number> = {};
  const raw1d: Record<string, number> = {};
  for (const cur of MAJOR_CURRENCIES) {
    raw1h[cur] = scores1h[cur].length ? scores1h[cur].reduce((a, b) => a + b, 0) / scores1h[cur].length : 0;
    raw1d[cur] = scores1d[cur].length ? scores1d[cur].reduce((a, b) => a + b, 0) / scores1d[cur].length : 0;
  }

  // Normalize to 0-100
  const vals1h = Object.values(raw1h);
  const vals1d = Object.values(raw1d);
  const min1h = Math.min(...vals1h), max1h = Math.max(...vals1h);
  const min1d = Math.min(...vals1d), max1d = Math.max(...vals1d);
  const norm = (v: number, min: number, max: number) => max === min ? 50 : Math.round(((v - min) / (max - min)) * 100);

  const result = MAJOR_CURRENCIES.map(cur => ({
    currency: cur,
    strength1h: norm(raw1h[cur], min1h, max1h),
    strength1d: norm(raw1d[cur], min1d, max1d),
    rank1h: 0,
    rank1d: 0,
    updatedAt: now,
  }));

  // Rank (1 = strongest)
  const sorted1h = [...result].sort((a, b) => b.strength1h - a.strength1h);
  const sorted1d = [...result].sort((a, b) => b.strength1d - a.strength1d);
  for (let i = 0; i < result.length; i++) {
    result[i].rank1h = sorted1h.findIndex(r => r.currency === result[i].currency) + 1;
    result[i].rank1d = sorted1d.findIndex(r => r.currency === result[i].currency) + 1;
  }

  return result.sort((a, b) => a.rank1d - b.rank1d);
}

export function getForexTicks(): ForexTick[] {
  return Array.from(forexStore.values());
}

export function startForexFeed() {
  fetchForexBatch();
  forexPoller = setInterval(fetchForexBatch, 60000); // refresh every 60s (forex moves slow)
}
