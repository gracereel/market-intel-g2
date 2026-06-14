import RSSParser from "rss-parser";
import axios from "axios";
import { storage } from "./storage";
import type { InsertNewsItem } from "@shared/schema";

const parser = new RSSParser({ timeout: 8000 });

// ─── RSS Feeds ────────────────────────────────────────────────────────────────

const RSS_FEEDS = [
  // Stocks / macro
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^DJI,^IXIC&region=US&lang=en-US", source: "Yahoo Finance", category: "stocks" },
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC Markets", category: "stocks" },
  { url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", source: "CNBC Business", category: "stocks" },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", source: "MarketWatch", category: "stocks" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", source: "NYT Business", category: "stocks" },
  { url: "https://feeds.bloomberg.com/markets/news.rss", source: "Bloomberg", category: "stocks" },
  // Crypto
  { url: "https://cointelegraph.com/rss", source: "CoinTelegraph", category: "crypto" },
  { url: "https://coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk", category: "crypto" },
  { url: "https://cryptonews.com/news/feed/", source: "CryptoNews", category: "crypto" },
  { url: "https://decrypt.co/feed", source: "Decrypt", category: "crypto" },
  { url: "https://www.theblock.co/rss.xml", source: "The Block", category: "crypto" },
  { url: "https://beincrypto.com/feed/", source: "BeInCrypto", category: "crypto" },
  { url: "https://bitcoinist.com/feed/", source: "Bitcoinist", category: "crypto" },
  { url: "https://newsbtc.com/feed/", source: "NewsBTC", category: "crypto" },
  { url: "https://ambcrypto.com/feed/", source: "AMBCrypto", category: "crypto" },
  // Futures / derivatives
  { url: "https://www.cmegroup.com/rss/market-insights.xml", source: "CME Group", category: "futures" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=ES%3DF,NQ%3DF,GC%3DF,CL%3DF&region=US&lang=en-US", source: "Yahoo Futures", category: "futures" },
  { url: "https://www.cnbc.com/id/10000867/device/rss/rss.html", source: "CNBC Energy", category: "futures" },
  // Oil / commodities
  { url: "https://oilprice.com/rss/main", source: "OilPrice.com", category: "oil" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=CL%3DF,BZ%3DF,NG%3DF&region=US&lang=en-US", source: "Yahoo Oil", category: "oil" },
];

// ─── Coin / contract keyword maps ────────────────────────────────────────────

export const CRYPTO_COINS: Record<string, { keywords: string[]; name: string; coingeckoId: string }> = {
  BTC:   { name: "Bitcoin",     coingeckoId: "bitcoin",           keywords: ["bitcoin", "btc", "satoshi", "halving", "lightning network", "taproot", "ordinals"] },
  ETH:   { name: "Ethereum",    coingeckoId: "ethereum",          keywords: ["ethereum", "eth", "ether", "vitalik", "merge", "erc-20", "erc20", "dencun", "proto-danksharding"] },
  BNB:   { name: "BNB",         coingeckoId: "binancecoin",       keywords: ["bnb", "binance coin", "bsc", "binance smart chain", "bnb chain"] },
  SOL:   { name: "Solana",      coingeckoId: "solana",            keywords: ["solana", "sol", "solana network", "solana labs", "saga phone"] },
  XRP:   { name: "XRP",         coingeckoId: "ripple",            keywords: ["xrp", "ripple", "ripplenet", "xrpl", "ripple labs"] },
  ADA:   { name: "Cardano",     coingeckoId: "cardano",           keywords: ["cardano", "ada", "hoskinson", "ouroboros", "iohk"] },
  DOGE:  { name: "Dogecoin",    coingeckoId: "dogecoin",          keywords: ["doge", "dogecoin", "dogecoin foundation"] },
  AVAX:  { name: "Avalanche",   coingeckoId: "avalanche-2",       keywords: ["avalanche", "avax", "avax network", "ava labs"] },
  LINK:  { name: "Chainlink",   coingeckoId: "chainlink",         keywords: ["chainlink", "link oracle", "chainlink network", "link token"] },
  DOT:   { name: "Polkadot",    coingeckoId: "polkadot",          keywords: ["polkadot", " dot ", "parachain", "substrate", "gavin wood polkadot"] },
  POL:   { name: "Polygon",     coingeckoId: "matic-network",     keywords: ["pol token", "pol coin", " pol ", "polygon 2.0", "polygon ecosystem token", "polygon upgrade", "polygon matic", "matic network"] },
  LTC:   { name: "Litecoin",    coingeckoId: "litecoin",          keywords: ["litecoin", "ltc", "litecoin network"] },
  UNI:   { name: "Uniswap",     coingeckoId: "uniswap",           keywords: ["uniswap", " uni ", "dex", "defi swap", "uniswap v4", "uniswap labs"] },
  ATOM:  { name: "Cosmos",      coingeckoId: "cosmos",            keywords: ["cosmos hub", " atom ", "ibc protocol", "cosmos network", "tendermint"] },
  NEAR:  { name: "NEAR",        coingeckoId: "near",              keywords: ["near protocol", "near network", "near blockchain"] },
  TON:   { name: "Toncoin",     coingeckoId: "the-open-network",  keywords: ["toncoin", " ton ", "telegram coin", "ton blockchain", "the open network"] },
  TRX:   { name: "TRON",        coingeckoId: "tron",              keywords: ["tron", " trx ", "justin sun", "tron network", "tron foundation"] },
  SUI:   { name: "Sui",         coingeckoId: "sui",               keywords: ["sui network", " sui ", "mysten labs", "sui blockchain"] },
  APT:   { name: "Aptos",       coingeckoId: "aptos",             keywords: ["aptos", " apt ", "aptos network", "aptos labs"] },
  OP:    { name: "Optimism",    coingeckoId: "optimism",          keywords: ["optimism", " op token", "optimistic rollup", "op mainnet"] },
  ARB:   { name: "Arbitrum",    coingeckoId: "arbitrum",          keywords: ["arbitrum", " arb ", "arb token", "arbitrum one", "arbitrum nova"] },
  SHIB:  { name: "Shiba Inu",   coingeckoId: "shiba-inu",         keywords: ["shiba inu", "shib", "shiba token", "shibarium"] },
  PEPE:  { name: "Pepe",        coingeckoId: "pepe",              keywords: ["pepe coin", " pepe ", "pepe token", "pepe memecoin"] },
  WLD:   { name: "Worldcoin",   coingeckoId: "worldcoin-wld",     keywords: ["worldcoin", " wld ", "world id", "sam altman crypto"] },
  INJ:   { name: "Injective",   coingeckoId: "injective-protocol",keywords: ["injective", " inj ", "injective protocol"] },
  FET:   { name: "Fetch.ai",    coingeckoId: "fetch-ai",          keywords: ["fetch.ai", " fet ", "fetch ai token", "artificial superintelligence alliance"] },
  RENDER:{ name: "Render",      coingeckoId: "render-token",      keywords: ["render token", "rndr", " render ", "rendernetwork"] },
  SEI:   { name: "Sei",         coingeckoId: "sei-network",       keywords: ["sei network", " sei ", "sei blockchain"] },
  BONK:  { name: "Bonk",        coingeckoId: "bonk",              keywords: ["bonk coin", " bonk ", "bonk token", "solana meme bonk"] },
  WIF:   { name: "dogwifhat",   coingeckoId: "dogwifcoin",        keywords: ["dogwifhat", " wif ", "wif token", "wif coin"] },
};

export const FUTURES_CONTRACTS: Record<string, { keywords: string[]; name: string; yahooSym: string; category: string }> = {
  ES:    { name: "S&P 500 Futures",      yahooSym: "ES=F",  category: "futures", keywords: ["e-mini s&p", "s&p 500 futures", "es futures", "sp500 futures"] },
  NQ:    { name: "Nasdaq 100 Futures",   yahooSym: "NQ=F",  category: "futures", keywords: ["nasdaq futures", "nq futures", "e-mini nasdaq"] },
  YM:    { name: "Dow Jones Futures",    yahooSym: "YM=F",  category: "futures", keywords: ["dow futures", "ym futures", "e-mini dow"] },
  RTY:   { name: "Russell 2000 Futures", yahooSym: "RTY=F", category: "futures", keywords: ["russell futures", "rty", "small cap futures"] },
  GC:    { name: "Gold Futures",         yahooSym: "GC=F",  category: "futures", keywords: ["gold futures", "comex gold", "gc futures"] },
  SI:    { name: "Silver Futures",       yahooSym: "SI=F",  category: "futures", keywords: ["silver futures", "si futures", "comex silver"] },
  ZB:    { name: "30Y T-Bond Futures",   yahooSym: "ZB=F",  category: "futures", keywords: ["bond futures", "treasury futures", "zb futures"] },
  WTI:   { name: "WTI Crude Oil",        yahooSym: "CL=F",  category: "oil",     keywords: ["wti", "crude oil", "west texas", "cl futures", "nymex crude"] },
  BRENT: { name: "Brent Crude Oil",      yahooSym: "BZ=F",  category: "oil",     keywords: ["brent", "brent crude", "bz futures", "ice brent"] },
  NG:    { name: "Natural Gas",          yahooSym: "NG=F",  category: "oil",     keywords: ["natural gas", "ng futures", "natgas"] },
  RB:    { name: "RBOB Gasoline",        yahooSym: "RB=F",  category: "oil",     keywords: ["gasoline futures", "rbob", "rb futures"] },
};

// ─── Sentiment engine v2 ──────────────────────────────────────────────────────
//
//  Improvements over v1:
//  1. 100+ bullish / 100+ bearish keywords (domain-specific: crypto + stocks + oil + macro)
//  2. Multi-word PHRASE matching with 2x weight
//  3. Title weighting: title tokens score 2x body tokens
//  4. Negation handling: 4-word window before a keyword flips its polarity
//  5. No Math.random() — buyer pressure is deterministic from keyword scores
//  6. Threshold raised 0.15 -> 0.25 (reduces false neutral)
//  7. Confidence % returned alongside sentiment
//

// Single-word signals (1 point each)
const BULLISH_SINGLE = [
  // Price action
  "surge", "soar", "rally", "rallies", "gain", "rise", "jump", "leap", "climb",
  "skyrocket", "spike", "accelerate", "boom", "blast",
  // Sentiment
  "bullish", "optimistic", "confident", "upbeat", "positive",
  // Business
  "beat", "outperform", "profit", "growth", "expand", "launch",
  "breakthrough", "innovation", "partnership", "deal", "merger", "acquisition",
  "revenue", "dividend", "buyback", "overweight",
  // Crypto-specific
  "adoption", "institutional", "accumulate", "hodl", "moon", "pump",
  "staking", "yield", "airdrop", "listing", "mainstream", "whales",
  "accumulation", "inflow", "inflows", "demand",
  // Macro bullish
  "recovery", "rebound", "easing", "stimulus", "dovish",
  "cut", "pivot", "tailwind",
  // Tech -- removed generic upgrade/scalability (too ambiguous for neutral news)
  "integration", "deployment", "throughput",
  "approval", "approve", "granted", "certified", "compliance",
  // Oil/commodities bullish
  "supply cut", "opec cut", "undersupply", "shortage", "tighter",
];

const BEARISH_SINGLE = [
  // Price action
  "crash", "crashes", "crashed", "plunge", "plunges", "fall", "drop", "decline", "slump", "tumble",
  "sink", "collapse", "collapses", "tank", "nosedive", "freefall",
  "hike", "hikes", "hiked",
  // Sentiment
  "bearish", "pessimistic", "fearful", "panic", "fear", "uncertainty",
  // Business
  "miss", "loss", "losses", "downgrade", "layoff", "layoffs", "bankrupt",
  "bankruptcy", "default", "debt", "deficit", "downside", "underperform",
  "sell", "selloff", "dump", "withdraw", "outflow", "outflows",
  // Macro bearish
  "recession", "stagflation", "contraction", "slowdown", "tighten",
  "hawkish", "hike", "overheating", "contagion", "devaluation",
  // Crypto bearish
  "hack", "exploit", "rug", "scam", "fraud", "phishing", "stolen",
  "liquidation", "liquidated", "delisting", "ban", "banned",
  "crackdown", "enforcement", "sanction", "blacklist",
  // Regulation
  "lawsuit", "probe", "investigation", "fine", "penalty", "illegal",
  "violation", "subpoena", "indictment", "charges",
  // Risk
  "risk", "warning", "caution", "concern", "threat", "vulnerability",
  "correction", "overhead", "resistance", "reversal", "breakdown",
  // Oil/commodities bearish
  "oversupply", "glut", "surplus", "demand destruction", "drawdown",
  "inventory build", "weak demand",
];

// Multi-word PHRASES (2 points each — stronger signal)
const BULLISH_PHRASES = [
  "all-time high", "ath", "record high", "new high", "52-week high",
  "etf approved", "spot etf", "etf approval", "sec approves",
  "rate cut", "fed pivot", "interest rate cut", "dovish fed",
  "above resistance", "breaks resistance", "golden cross",
  "massive rally", "strong rally", "bull run", "bull market",
  "spot bitcoin etf", "bitcoin etf", "institutional buying",
  "strong earnings", "earnings beat", "revenue growth",
  "market rally", "stocks rally", "crypto rally",
  "buy the dip", "buying pressure", "strong demand",
  "supply squeeze", "short squeeze",
  "opec cut production", "production cut",
  "fed rate cut", "central bank cut",
  "positive sentiment", "market optimism",
  "breaking out", "breakout confirmed",
];

const BEARISH_PHRASES = [
  "all-time low", "new low", "52-week low", "record low",
  "rate hike", "interest rate hike", "fed hike", "hikes rates", "hawkish fed",
  "below support", "breaks support", "death cross",
  "major hack", "exchange hack", "bridge exploit", "protocol exploit",
  "sec lawsuit", "sec charges", "doj charges", "class action",
  "mass liquidation", "forced liquidation", "margin call",
  "bank failure", "bank collapse", "banking crisis",
  "trade war", "trade tariff", "import tariff",
  "recession fears", "recession risk", "economic slowdown",
  "inflation surge", "cpi higher", "hot inflation",
  "market crash", "stock market crash", "crypto crash",
  "bear market", "bear trend",
  "regulatory crackdown", "crypto ban", "exchange ban",
  "negative sentiment", "market fear",
  "sell pressure", "selling pressure", "heavy selling",
  "flash crash", "circuit breaker",
  "opec increases production", "production increase", "oil glut",
  "fails to hold", "fails to rally", "unable to break",
];

// High-impact keywords (trigger high impact flag)
const HIGH_IMPACT_KW = [
  "all-time high", "ath", "etf approved", "spot etf",
  "hack", "exploit", "bankruptcy", "recession",
  "crisis", "fraud", "ban", "emergency", "record",
  "halving", "rate cut", "rate hike", "merger", "acquisition",
  "sec approves", "sec charges", "doj charges",
  "flash crash", "market crash", "bank collapse",
];

// Negation words — if any of these precede a keyword within 4 words, flip polarity
const NEGATION_WORDS = [
  "not", "no", "never", "without", "fail", "fails", "failed",
  "unable", "deny", "denies", "denied", "reject", "rejects", "rejected",
  "miss", "misses", "missed", "lack", "lacks", "lacking",
  "avoid", "avoids", "halts", "halt", "stop", "stops", "stopped",
  "barely", "struggle", "struggles", "wont", "cannot", "cant",
  "unlikely", "doubt", "doubts",
];

/** Check if a negation word appears within 4 words before OR 3 words after `matchIndex` */
function isNegated(words: string[], matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 4);
  const end = Math.min(words.length, matchIndex + 4);
  const window = words.slice(start, end);
  return window.some(w => NEGATION_WORDS.includes(w));
}

/** Tokenise into words, preserving position */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(Boolean);
}

export interface SentimentResult {
  sentiment: "bullish" | "bearish" | "neutral";
  score: number;
  impactLevel: "high" | "medium" | "low";
  buyerPressure: number;
  sellerPressure: number;
  confidence: number; // 0-100
}

export function analyzeSentiment(title: string, body?: string): SentimentResult {
  // Build combined text — title tokens count 2x
  const titleWords = tokenize(title);
  const bodyWords = body ? tokenize(body) : [];
  // For phrase matching: title text 2x
  const titleLower = title.toLowerCase();
  const bodyLower = (body || "").toLowerCase();
  const fullLower = titleLower + " " + bodyLower;

  let bullScore = 0;
  let bearScore = 0;
  let highImpact = false;

  // --- PHRASE matching (2 pts each, check negation at phrase start position) ---
  for (const phrase of BULLISH_PHRASES) {
    const idx = titleLower.indexOf(phrase);
    if (idx !== -1) {
      const wordsBeforeInTitle = tokenize(titleLower.substring(0, idx));
      const negated = isNegated(wordsBeforeInTitle, wordsBeforeInTitle.length);
      if (negated) bearScore += 2; else bullScore += 4; // title = 2x phrase = 2pts -> 4
      if (HIGH_IMPACT_KW.includes(phrase)) highImpact = true;
    }
    const idxB = bodyLower.indexOf(phrase);
    if (idxB !== -1) {
      const wordsBeforeInBody = tokenize(bodyLower.substring(0, idxB));
      const negated = isNegated(wordsBeforeInBody, wordsBeforeInBody.length);
      if (negated) bearScore += 2; else bullScore += 2;
      if (HIGH_IMPACT_KW.includes(phrase)) highImpact = true;
    }
  }
  for (const phrase of BEARISH_PHRASES) {
    const idx = titleLower.indexOf(phrase);
    if (idx !== -1) {
      const wordsBeforeInTitle = tokenize(titleLower.substring(0, idx));
      const negated = isNegated(wordsBeforeInTitle, wordsBeforeInTitle.length);
      if (negated) bullScore += 4; else bearScore += 4;
      if (HIGH_IMPACT_KW.includes(phrase)) highImpact = true;
    }
    const idxB = bodyLower.indexOf(phrase);
    if (idxB !== -1) {
      const wordsBeforeInBody = tokenize(bodyLower.substring(0, idxB));
      const negated = isNegated(wordsBeforeInBody, wordsBeforeInBody.length);
      if (negated) bullScore += 2; else bearScore += 2;
      if (HIGH_IMPACT_KW.includes(phrase)) highImpact = true;
    }
  }

  // --- SINGLE-WORD matching with negation, title 2x weight ---
  for (const kw of BULLISH_SINGLE) {
    // Title scan
    const tidx = titleWords.indexOf(kw);
    if (tidx !== -1) {
      if (isNegated(titleWords, tidx)) bearScore += 2;
      else bullScore += 2;
    }
    // Body scan
    const bidx = bodyWords.indexOf(kw);
    if (bidx !== -1) {
      if (isNegated(bodyWords, bidx)) bearScore += 1;
      else bullScore += 1;
    }
  }
  for (const kw of BEARISH_SINGLE) {
    if (HIGH_IMPACT_KW.includes(kw)) highImpact = true;
    // Title scan
    const tidx = titleWords.indexOf(kw);
    if (tidx !== -1) {
      if (isNegated(titleWords, tidx)) bullScore += 2;
      else bearScore += 2;
    }
    // Body scan
    const bidx = bodyWords.indexOf(kw);
    if (bidx !== -1) {
      if (isNegated(bodyWords, bidx)) bullScore += 1;
      else bearScore += 1;
    }
  }

  // Also flag high impact from raw keyword presence in full text
  for (const kw of HIGH_IMPACT_KW) {
    if (fullLower.includes(kw)) highImpact = true;
  }

  const total = bullScore + bearScore;
  const score = total === 0 ? 0 : (bullScore - bearScore) / total;

  // Threshold 0.25 — must be clearly directional to avoid false neutral
  const THRESHOLD = 0.25;
  const sentiment: "bullish" | "bearish" | "neutral" =
    score > THRESHOLD ? "bullish" :
    score < -THRESHOLD ? "bearish" : "neutral";

  const impactLevel: "high" | "medium" | "low" =
    highImpact ? "high" : total > 8 ? "medium" : "low";

  // Buyer pressure: deterministic from score, no random noise
  // score is -1 to +1; map to 15-85 range
  const normalizedScore = Math.max(-1, Math.min(1, score));
  const buyerPressure = Math.round(50 + normalizedScore * 35);
  const clampedBuyer = Math.min(Math.max(buyerPressure, 15), 85);

  // Confidence: how strongly the signals dominate
  // Base: ratio of dominant side to total, boosted by total signal count
  const dominance = total === 0 ? 0 : Math.abs(bullScore - bearScore) / total;
  const signalBoost = Math.min(total / 20, 1); // max boost at 20+ signal points
  const confidence = Math.round((0.4 + dominance * 0.4 + signalBoost * 0.2) * 100);
  const clampedConfidence = Math.min(Math.max(confidence, total === 0 ? 30 : 45), 95);

  return {
    sentiment,
    score,
    impactLevel,
    buyerPressure: clampedBuyer,
    sellerPressure: 100 - clampedBuyer,
    confidence: clampedConfidence,
  };
}

// ─── Accuracy Self-Test ───────────────────────────────────────────────────────
// Run with: node -e "require('./dist/newsService.js').runAccuracyTest()"
// Or called from a test route.

const TEST_HEADLINES: Array<{ headline: string; expected: "bullish" | "bearish" | "neutral" }> = [
  { headline: "Bitcoin surges to new all-time high above $100,000", expected: "bullish" },
  { headline: "SEC approves first spot Bitcoin ETF for US market", expected: "bullish" },
  { headline: "Ethereum breaks resistance, rally continues to $5000", expected: "bullish" },
  { headline: "Federal Reserve signals rate cut in next meeting", expected: "bullish" },
  { headline: "Institutional investors accumulate Bitcoin amid bull run", expected: "bullish" },
  { headline: "Solana launches major upgrade improving throughput by 10x", expected: "bullish" },
  { headline: "Crypto market rallies as CPI data shows inflation cooling", expected: "bullish" },
  { headline: "Goldman Sachs upgrades crypto sector, calls BTC a buy", expected: "bullish" },
  { headline: "DeFi protocol TVL hits record high after major expansion", expected: "bullish" },
  { headline: "Short squeeze drives Bitcoin 20% gain in 24 hours", expected: "bullish" },
  { headline: "Bitcoin crashes below $30,000 on massive sell-off", expected: "bearish" },
  { headline: "SEC files lawsuit against major crypto exchange", expected: "bearish" },
  { headline: "Exchange suffers major hack, $400 million stolen", expected: "bearish" },
  { headline: "Federal Reserve hikes rates by 75 basis points", expected: "bearish" },
  { headline: "Crypto exchange files for bankruptcy amid liquidity crisis", expected: "bearish" },
  { headline: "Ethereum drops below support as bear market deepens", expected: "bearish" },
  { headline: "Recession fears grow as GDP contracts for second quarter", expected: "bearish" },
  { headline: "Regulatory crackdown on crypto spreads to Europe", expected: "bearish" },
  { headline: "Liquidations wipe out $1 billion as market crashes", expected: "bearish" },
  { headline: "Bitcoin fails to rally despite positive macro data", expected: "bearish" },
  { headline: "Bitcoin holds steady as traders await Fed decision", expected: "neutral" },
  { headline: "Ethereum network upgrade scheduled for next month", expected: "neutral" },
  { headline: "Crypto market volume remains flat ahead of weekend", expected: "neutral" },
  { headline: "Analyst says Bitcoin could go up or down from here", expected: "neutral" },
  { headline: "Major bank explores blockchain technology for payments", expected: "neutral" },
  { headline: "Oil prices stabilize after weeks of volatility", expected: "neutral" },
  { headline: "Market does not crash despite recession fears", expected: "bullish" },  // negation test
  { headline: "No rate hike expected from Fed this month", expected: "bullish" },       // negation test
  { headline: "Bitcoin rejected at resistance, unable to break $70k", expected: "bearish" }, // negation test
  { headline: "Analysts say rally will not continue into Q4", expected: "bearish" },    // negation test
];

export function runAccuracyTest(): { accuracy: number; passed: number; failed: number; results: any[] } {
  const results: any[] = [];
  let passed = 0;
  for (const test of TEST_HEADLINES) {
    const result = analyzeSentiment(test.headline);
    const ok = result.sentiment === test.expected;
    if (ok) passed++;
    results.push({
      headline: test.headline,
      expected: test.expected,
      got: result.sentiment,
      score: result.score.toFixed(3),
      confidence: result.confidence,
      pass: ok ? "PASS" : "FAIL",
    });
  }
  const accuracy = Math.round((passed / TEST_HEADLINES.length) * 100);
  return { accuracy, passed, failed: TEST_HEADLINES.length - passed, results };
}

// ─── Sector / tag detection ───────────────────────────────────────────────────

const SECTOR_MAP: Record<string, string[]> = {
  "Tech":     ["apple", "microsoft", "google", "nvidia", "ai", "chip", "semiconductor", "software"],
  "Finance":  ["bank", "fed", "interest rate", "bond", "treasury", "credit", "goldman", "jpmorgan"],
  "Energy":   ["oil", "gas", "energy", "crude", "opec", "renewable", "solar"],
  "DeFi":     ["defi", "protocol", "tvl", "yield", "liquidity", "amm", "dex", "uniswap", "aave"],
  "NFT":      ["nft", "opensea", "collection", "mint", "metaverse"],
  "Macro":    ["gdp", "cpi", "inflation", "fed", "federal reserve", "unemployment", "jobs"],
  "Layer2":   ["layer 2", "l2", "rollup", "optimism", "arbitrum", "polygon", "zk"],
  "Exchange": ["binance", "coinbase", "kraken", "bybit", "okx", "exchange"],
};

export function detectSectors(text: string): string[] {
  const lower = text.toLowerCase();
  const found = Object.entries(SECTOR_MAP).filter(([, kws]) => kws.some(k => lower.includes(k))).map(([s]) => s);
  return found.length ? found : ["General"];
}

export function detectTags(text: string, category: string): string[] {
  const lower = text.toLowerCase();
  if (category === "crypto") {
    return Object.entries(CRYPTO_COINS)
      .filter(([, v]) => v.keywords.some(k => lower.includes(k)))
      .map(([sym]) => sym);
  }
  if (category === "futures" || category === "oil") {
    return Object.entries(FUTURES_CONTRACTS).filter(([, v]) => v.keywords.some(k => lower.includes(k))).map(([sym]) => sym);
  }
  return [];
}

export function formatForG1(title: string, sentiment: string, buyerPressure: number, sellerPressure: number, impactLevel: string): string {
  const icon = sentiment === "bullish" ? "UP BULLISH" : sentiment === "bearish" ? "DN BEARISH" : "-- NEUTRAL";
  const clean = title.replace(/[^\x20-\x7E]/g, "").trim();
  const l1 = clean.substring(0, 40);
  const l2 = clean.length > 40 ? clean.substring(40, 80) : "";
  const l3 = `${icon} | ${impactLevel.toUpperCase()} IMPACT`.substring(0, 40);
  const l4 = `BUY ${buyerPressure}% ${"|".repeat(Math.floor(buyerPressure / 10))}`.substring(0, 40);
  const l5 = `SEL ${sellerPressure}% ${"|".repeat(Math.floor(sellerPressure / 10))}`.substring(0, 40);
  return [l1, l2, l3, l4, l5].filter(Boolean).join("\n");
}

// ─── Fetch & process RSS ──────────────────────────────────────────────────────

export async function fetchAndProcessNews(): Promise<number> {
  let added = 0;
  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      for (const item of (result.items || []).slice(0, 20)) {
        const title = item.title || "";
        const summary = item.contentSnippet || item.summary || item.content || "";
        const url = item.link || item.guid || "";
        const publishedAt = item.pubDate || item.isoDate || new Date().toISOString();
        if (!title || !url) continue;

        // Pass title separately so analyzeSentiment can weight it 2x
        const { sentiment, score, impactLevel, buyerPressure, sellerPressure, confidence } =
          analyzeSentiment(title, summary);
        const sectors = detectSectors(title + " " + summary);
        const tags = detectTags(title + " " + summary, feed.category);
        const g1Text = formatForG1(title, sentiment, buyerPressure, sellerPressure, impactLevel);

        const inserted = storage.upsertNews({
          title, summary: summary.substring(0, 600) || title, source: feed.source,
          url, publishedAt, sentiment, sentimentScore: score, impactLevel,
          affectedSectors: JSON.stringify(sectors), category: feed.category,
          tags: JSON.stringify(tags), buyerPressure, sellerPressure, g1Text,
          fetchedAt: new Date().toISOString(),
        });
        if (inserted) added++;
      }
    } catch (err) {
      console.error(`Feed error ${feed.source}:`, (err as Error).message);
    }
  }
  storage.clearOldNews(500);
  return added;
}

// ─── Market data ──────────────────────────────────────────────────────────────

export async function fetchMarketData(): Promise<void> {
  await Promise.allSettled([fetchCryptoData(), fetchFuturesOilData(), fetchStocksData()]);
}

async function yahooQuote(yahooSym: string, displaySym: string, name: string, category: string) {
  try {
    const r = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=2d`,
      { timeout: 7000, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const meta = r.data?.chart?.result?.[0]?.meta;
    if (!meta) return;
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose || meta.previousClose || price;
    const change = price - prev;
    storage.upsertAsset({
      symbol: displaySym, name, category,
      price: Math.round(price * 1000) / 1000,
      change: Math.round(change * 1000) / 1000,
      changePercent: Math.round((change / prev) * 10000) / 100,
      volume: meta.regularMarketVolume || null,
      marketCap: null,
      high24h: meta.regularMarketDayHigh || null,
      low24h: meta.regularMarketDayLow || null,
      extra: "{}",
      updatedAt: new Date().toISOString(),
    });
  } catch (e) { console.error(`Yahoo ${yahooSym}:`, (e as Error).message); }
}

async function fetchStocksData() {
  await Promise.allSettled([
    yahooQuote("SPY", "SPY", "S&P 500 ETF", "stocks"),
    yahooQuote("QQQ", "QQQ", "Nasdaq 100 ETF", "stocks"),
    yahooQuote("DIA", "DIA", "Dow Jones ETF", "stocks"),
    yahooQuote("IWM", "IWM", "Russell 2000 ETF", "stocks"),
    yahooQuote("^VIX", "VIX", "VIX Fear Index", "stocks"),
  ]);
}

async function fetchFuturesOilData() {
  await Promise.allSettled(
    Object.entries(FUTURES_CONTRACTS).map(([sym, v]) => yahooQuote(v.yahooSym, sym, v.name, v.category))
  );
}

async function fetchCryptoData() {
  const ids = Object.values(CRYPTO_COINS).map(c => c.coingeckoId).join(",");
  try {
    const r = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=20&sparkline=false&price_change_percentage=24h`,
      { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }
    );
    for (const coin of r.data as any[]) {
      const entry = Object.entries(CRYPTO_COINS).find(([, v]) => v.coingeckoId === coin.id);
      if (!entry) continue;
      const [sym, meta] = entry;
      storage.upsertAsset({
        symbol: sym, name: meta.name, category: "crypto",
        price: coin.current_price,
        change: coin.price_change_24h,
        changePercent: Math.round(coin.price_change_percentage_24h * 100) / 100,
        volume: coin.total_volume,
        marketCap: coin.market_cap,
        high24h: coin.high_24h,
        low24h: coin.low_24h,
        extra: JSON.stringify({ rank: coin.market_cap_rank, image: coin.image, ath: coin.ath, athChangePercent: coin.ath_change_percentage }),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error("CoinGecko failed, falling back to Yahoo:", (e as Error).message);
    await Promise.allSettled([
      yahooQuote("BTC-USD", "BTC", "Bitcoin", "crypto"),
      yahooQuote("ETH-USD", "ETH", "Ethereum", "crypto"),
      yahooQuote("SOL-USD", "SOL", "Solana", "crypto"),
      yahooQuote("XRP-USD", "XRP", "XRP", "crypto"),
      yahooQuote("BNB-USD", "BNB", "BNB", "crypto"),
      yahooQuote("DOGE-USD", "DOGE", "Dogecoin", "crypto"),
    ]);
  }
}
