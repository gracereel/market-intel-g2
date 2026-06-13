import { useState, useEffect, useRef, useCallback, useMemo, KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, X, TrendingUp, TrendingDown, Minus,
  Glasses, Zap, Bitcoin, BarChart2, Fuel, RefreshCw,
  AlertTriangle, ExternalLink, Newspaper, Radio,
  ChevronRight, Activity, Command
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "crypto" | "futures" | "stocks" | "oil" | "currency";

interface Tick {
  symbol: string;
  name: string;
  category: "crypto" | "futures" | "stocks";
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  quoteVolume: number;
  high: number;
  low: number;
  open: number;
  updatedAt: number;
  fundingRate?: number;
  openInterest?: number;
  rank?: number;
  image?: string;
}

type NewsItem = {
  id: number; title: string; summary: string; source: string; url: string;
  publishedAt: string; sentiment: "bullish" | "bearish" | "neutral";
  impactLevel: "high" | "medium" | "low"; affectedSectors: string[];
  category: string; tags: string[]; buyerPressure: number; sellerPressure: number;
  g1Text: string; fetchedAt: string;
};

type AssetDetail = {
  asset: any;
  news: NewsItem[];
  highImpact: NewsItem[];
  topSources: { source: string; count: number }[];
  sentiment: {
    bullish: number; bearish: number; neutral: number; total: number;
    avgBuyerPressure: number; avgSellerPressure: number;
    overall: "bullish" | "bearish" | "neutral";
    bullPct: number; bearPct: number; neutPct: number;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (!n && n !== 0) return "—";
  if (n >= 10000) return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (n >= 0.01) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toFixed(8);
}

function fmtVol(n: number): string {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

function ago(ts: number | string): string {
  const ms = typeof ts === "number" ? ts : new Date(ts).getTime();
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function sentimentColor(s: string) {
  if (s === "bullish") return "text-green-400";
  if (s === "bearish") return "text-red-400";
  return "text-yellow-400";
}

function sentimentBg(s: string) {
  if (s === "bullish") return "bg-green-500/10 text-green-400 border-green-500/20";
  if (s === "bearish") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
}

const COIN_COLORS: Record<string, string> = {
  BTC:"#F7931A",ETH:"#627EEA",BNB:"#F3BA2F",SOL:"#9945FF",XRP:"#00AAE4",
  ADA:"#0033AD",DOGE:"#C2A633",AVAX:"#E84142",LINK:"#2A5ADA",DOT:"#E6007A",
  MATIC:"#8247E5",LTC:"#BFBBBB",UNI:"#FF007A",ATOM:"#2E3148",NEAR:"#00C08B",
  TON:"#0098EA",TRX:"#EF0027",SHIB:"#FFA409",BCH:"#8DC351",APT:"#03BDCB",
  ARB:"#28A0F0",OP:"#FF0420",FTM:"#13B5EC",ALGO:"#00B4D8",VET:"#15BDFF",
  FIL:"#0090FF",SAND:"#04BBFB",MANA:"#FF2D55",AAVE:"#B6509E",INJ:"#00F2FE",
  SUI:"#6FBCF0",SEI:"#9B2CF3",WIF:"#9B5DE5",PEPE:"#4CAF50",FLOKI:"#CF7C2F",
  GRT:"#6747ED",LDO:"#00A3FF",STX:"#5546FF",ENA:"#7B68EE",WLD:"#191919",
  BLUR:"#FF6B35",TIA:"#7B2FBE",HBAR:"#222E44",ICP:"#29ABE2",
};

function coinColor(sym: string): string {
  return COIN_COLORS[sym] || "#22d3ee";
}

// ─── Flash hook ───────────────────────────────────────────────────────────────
// --- Global Search Overlay ---

function GlobalSearch({ allTicks, onSelect, onClose }: {
  allTicks: Tick[];
  onSelect: (tick: Tick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    if (!query.trim()) {
      return allTicks.slice(0, 16);
    }
    const q = query.toLowerCase();
    return allTicks
      .filter(t =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.symbol.replace("USDT", "").toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [query, allTicks]);

  useEffect(() => setActiveIdx(0), [results.length]);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[activeIdx]) { onSelect(results[activeIdx]); }
    else if (e.key === "Escape") { onClose(); }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function catBadge(cat: string) {
    if (cat === "crypto")  return { label: "CRYPTO",  cls: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20" };
    if (cat === "futures") return { label: "FUTURES", cls: "text-purple-400 bg-purple-400/10 border-purple-400/20" };
    if (cat === "oil")     return { label: "OIL",     cls: "text-orange-400 bg-orange-400/10 border-orange-400/20" };
    return                        { label: "STOCK",   cls: "text-blue-400 bg-blue-400/10 border-blue-400/20" };
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center pt-[10vh] px-4"
      style={{ background: "rgba(6,8,14,0.88)", backdropFilter: "blur(14px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "hsl(224 18% 9%)", border: "1px solid rgba(255,255,255,0.1)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <Search className="w-4 h-4 text-green-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search any coin, pair, stock or commodity..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/25 outline-none font-mono"
            data-testid="global-search-input"
          />
          {query ? (
            <button onClick={() => setQuery("")} className="text-white/30 hover:text-white/70 transition-colors">
              <X className="w-4 h-4" />
            </button>
          ) : (
            <kbd className="text-[10px] font-mono text-white/20 border border-white/10 px-1.5 py-0.5 rounded">ESC</kbd>
          )}
        </div>

        {/* Category hint pills */}
        {!query && (
          <div className="flex gap-2 px-4 pt-2.5 pb-1">
            <span className="text-[10px] text-white/25 font-mono">Top by volume:</span>
          </div>
        )}

        {/* Results list */}
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: "360px" }}>
          {results.length === 0 ? (
            <div className="py-12 text-center text-white/25 text-xs font-mono">No results for "{query}"</div>
          ) : results.map((tick, i) => {
            const sym = tick.symbol.replace("USDT", "");
            const cc = coinColor(sym);
            const isUp = tick.changePercent >= 0;
            const badge = catBadge(tick.category);
            return (
              <button
                key={`${tick.category}:${tick.symbol}`}
                data-idx={i}
                data-testid={`search-result-${tick.symbol}`}
                onClick={() => onSelect(tick)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                style={{ background: i === activeIdx ? "rgba(255,255,255,0.05)" : "transparent" }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: cc + "22", color: cc }}
                >
                  {sym.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white">{sym}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="text-[11px] text-white/35 truncate">{tick.name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-mono font-bold text-white">${fmtPrice(tick.price)}</div>
                  <div className={`text-[11px] font-mono ${isUp ? "text-green-400" : "text-red-400"}`}>
                    {isUp ? "+" : ""}{tick.changePercent.toFixed(2)}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <span className="text-[10px] text-white/20 font-mono">↑↓ navigate</span>
          <span className="text-[10px] text-white/20 font-mono">↵ open</span>
          <span className="text-[10px] text-white/20 font-mono">ESC close</span>
          <span className="text-[10px] text-white/25 font-mono ml-auto">{results.length} result{results.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}

function useFlash(value: number, key: string) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef<number>(value);

  useEffect(() => {
    if (value === prevRef.current) return;
    const dir = value > prevRef.current ? "up" : "down";
    setFlash(dir);
    prevRef.current = value;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [value, key]);

  return flash;
}

// ─── SSE Hook ─────────────────────────────────────────────────────────────────
function useLiveTicks() {
  const [ticks, setTicks] = useState<Map<string, Tick>>(new Map());
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    function connect() {
      if (esRef.current) esRef.current.close();

      // Use the same __PORT_5000__ pattern as queryClient.ts
      const BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const url = BASE + "/api/live/stream";

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          if (msg.type === "snapshot") {
            const map = new Map<string, Tick>();
            for (const tick of msg.ticks as Tick[]) {
              const key = `${tick.category}:${tick.symbol}`;
              map.set(key, tick);
            }
            setTicks(map);
          } else if (msg.type === "batch") {
            setTicks(prev => {
              const next = new Map(prev);
              for (const [k, tick] of Object.entries(msg.ticks as Record<string, Tick>)) {
                next.set(k, tick as Tick);
              }
              return next;
            });
          }
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      esRef.current?.close();
    };
  }, []);

  return { ticks, connected };
}

// ─── Prefetch helper — fires on hover so data is ready before click ──────────
function prefetchAsset(sym: string) {
  const key = sym.replace("USDT", "");
  queryClient.prefetchQuery({
    queryKey: ["/api/assets", key],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/assets/${key}`);
      return r.json();
    },
    staleTime: 15000,
  });
}

// ─── Coin Card ────────────────────────────────────────────────────────────────
function CoinCard({ tick, onClick }: { tick: Tick; onClick: () => void }) {
  const flash = useFlash(tick.price, tick.symbol);
  const cc = coinColor(tick.symbol.replace("USDT", ""));
  const isUp = tick.changePercent >= 0;

  return (
    <button
      data-testid={`coin-card-${tick.symbol}`}
      onClick={onClick}
      onMouseEnter={() => prefetchAsset(tick.symbol)}
      className={`
        relative w-full text-left rounded-lg border p-3 transition-all duration-200
        hover:scale-[1.02] hover:shadow-lg cursor-pointer
        ${flash === "up" ? "bg-green-500/10 border-green-500/40" :
          flash === "down" ? "bg-red-500/10 border-red-500/40" :
          "bg-[hsl(224_18%_9%)] border-white/5 hover:border-white/15"}
      `}
      style={{ borderLeftColor: cc, borderLeftWidth: "3px" }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: cc + "22", color: cc }}
            >
              {tick.symbol.replace("USDT", "")}
            </span>
          </div>
          <div className="text-[10px] text-white/40 truncate leading-none">{tick.name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm font-bold text-white leading-tight">
            ${fmtPrice(tick.price)}
          </div>
          <div className={`text-[11px] font-mono font-semibold ${isUp ? "text-green-400" : "text-red-400"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(tick.changePercent).toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-white/30 font-mono">
        Vol {fmtVol(tick.quoteVolume || tick.volume)}
      </div>
      {/* Flash overlay */}
      {flash && (
        <div className={`absolute inset-0 rounded-lg pointer-events-none ${flash === "up" ? "bg-green-500/8" : "bg-red-500/8"}`} />
      )}
    </button>
  );
}

// ─── Futures Card ─────────────────────────────────────────────────────────────
function FuturesCard({ tick, onClick }: { tick: Tick; onClick: () => void }) {
  const flash = useFlash(tick.price, tick.symbol);
  const isUp = tick.changePercent >= 0;
  const base = tick.symbol.replace("USDT", "");
  const cc = coinColor(base);

  return (
    <button
      data-testid={`futures-card-${tick.symbol}`}
      onClick={onClick}
      onMouseEnter={() => prefetchAsset(tick.symbol)}
      className={`
        relative w-full text-left rounded-lg border p-3 transition-all duration-200
        hover:scale-[1.02] cursor-pointer
        ${flash === "up" ? "bg-green-500/10 border-green-500/40" :
          flash === "down" ? "bg-red-500/10 border-red-500/40" :
          "bg-[hsl(224_18%_9%)] border-white/5 hover:border-white/15"}
      `}
      style={{ borderLeftColor: cc, borderLeftWidth: "3px" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">{base}-PERP</div>
          <div className="text-[10px] text-white/40">{tick.name}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm font-bold text-white">${fmtPrice(tick.price)}</div>
          <div className={`text-[11px] font-mono ${isUp ? "text-green-400" : "text-red-400"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(tick.changePercent).toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-white/30 font-mono">
        <span>Vol {fmtVol(tick.quoteVolume)}</span>
        {tick.fundingRate !== undefined && (
          <span className={tick.fundingRate >= 0 ? "text-green-400/60" : "text-red-400/60"}>
            FR {(tick.fundingRate * 100).toFixed(4)}%
          </span>
        )}
      </div>
      {flash && (
        <div className={`absolute inset-0 rounded-lg pointer-events-none ${flash === "up" ? "bg-green-500/8" : "bg-red-500/8"}`} />
      )}
    </button>
  );
}

// ─── Stock Card ───────────────────────────────────────────────────────────────
function StockCard({ tick, onClick }: { tick: Tick; onClick: () => void }) {
  const flash = useFlash(tick.price, tick.symbol);
  const isUp = tick.changePercent >= 0;

  const catColor = tick.symbol === "VIX" ? "#f59e0b" : isUp ? "#22c55e" : "#ef4444";

  return (
    <button
      data-testid={`stock-card-${tick.symbol}`}
      onClick={onClick}
      onMouseEnter={() => prefetchAsset(tick.symbol)}
      className={`
        relative w-full text-left rounded-lg border p-3 transition-all duration-200
        hover:scale-[1.02] cursor-pointer
        ${flash === "up" ? "bg-green-500/10 border-green-500/40" :
          flash === "down" ? "bg-red-500/10 border-red-500/40" :
          "bg-[hsl(224_18%_9%)] border-white/5 hover:border-white/15"}
      `}
      style={{ borderLeftColor: catColor, borderLeftWidth: "3px" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">{tick.symbol}</div>
          <div className="text-[10px] text-white/40 truncate max-w-[100px]">{tick.name}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm font-bold text-white">${fmtPrice(tick.price)}</div>
          <div className={`text-[11px] font-mono ${isUp ? "text-green-400" : "text-red-400"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(tick.changePercent).toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-white/30 font-mono">
        Vol {fmtVol(tick.volume)}
      </div>
      {flash && (
        <div className={`absolute inset-0 rounded-lg pointer-events-none ${flash === "up" ? "bg-green-500/8" : "bg-red-500/8"}`} />
      )}
    </button>
  );
}

// ─── Ticker Tape ──────────────────────────────────────────────────────────────
function TickerTape({ allTicks }: { allTicks: Map<string, Tick> }) {
  // Pick top crypto by volume + all stocks + all futures + all oil
  const items = useMemo(() => {
    // Top 10 crypto by volume only
    return Array.from(allTicks.values())
      .filter(t => t.category === "crypto")
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 10);
  }, [allTicks]);

  if (items.length === 0) return null;

  // Duplicate 3x so scroll looks seamless at any screen width
  const tape = [...items, ...items, ...items];
  const duration = Math.max(20, items.length * 1.2); // ~1.2s per item, min 20s

  return (
    <div className="overflow-hidden border-b border-green-500/20 bg-black/50" style={{ height: "30px" }}>
      <div
        className="flex items-center h-full gap-0 text-[11px] font-mono whitespace-nowrap"
        style={{ animation: `scroll-left ${duration}s linear infinite` }}
      >
        {tape.map((tick, i) => {
          const isUp = tick.changePercent >= 0;
          const sym = tick.symbol.replace("USDT", "");
          const color = tick.category === "crypto" ? coinColor(sym) :
                        tick.category === "oil" ? "#f97316" :
                        tick.category === "futures" ? "#a78bfa" : "#38bdf8";
          return (
            <span key={`${sym}-${i}`} className="flex items-center shrink-0" style={{ paddingRight: "28px" }}>
              <span className="font-bold mr-1" style={{ color }}>{sym}</span>
              <span className="text-white/90 mr-1">${fmtPrice(tick.price)}</span>
              <span className={`font-semibold ${isUp ? "text-green-400" : "text-red-400"}`}>
                {isUp ? "▲" : "▼"}{Math.abs(tick.changePercent).toFixed(2)}%
              </span>
              <span className="text-white/10 ml-7">|</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sentiment Donut ─────────────────────────────────────────────────────────
function SentimentDonut({ bull, bear, neut }: { bull: number; bear: number; neut: number }) {
  const total = bull + bear + neut || 1;
  const bullPct = (bull / total) * 100;
  const bearPct = (bear / total) * 100;
  const neutPct = (neut / total) * 100;

  const r = 36;
  const circ = 2 * Math.PI * r;
  const bullDash = (bullPct / 100) * circ;
  const bearDash = (bearPct / 100) * circ;
  const neutDash = (neutPct / 100) * circ;
  const bullOffset = 0;
  const bearOffset = -(bullDash);
  const neutOffset = -(bullDash + bearDash);

  const overall = bull > bear ? "BULL" : bear > bull ? "BEAR" : "NEUT";
  const overallColor = bull > bear ? "#22c55e" : bear > bull ? "#ef4444" : "#eab308";

  return (
    <div className="flex items-center gap-4">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={r} fill="none" stroke="#ffffff08" strokeWidth="10" />
        {bullPct > 0 && (
          <circle cx="45" cy="45" r={r} fill="none" stroke="#22c55e" strokeWidth="10"
            strokeDasharray={`${bullDash} ${circ - bullDash}`}
            strokeDashoffset={circ * 0.25 + bullOffset}
            transform="rotate(-90 45 45)" />
        )}
        {bearPct > 0 && (
          <circle cx="45" cy="45" r={r} fill="none" stroke="#ef4444" strokeWidth="10"
            strokeDasharray={`${bearDash} ${circ - bearDash}`}
            strokeDashoffset={circ * 0.25 + bearOffset}
            transform="rotate(-90 45 45)" />
        )}
        {neutPct > 0 && (
          <circle cx="45" cy="45" r={r} fill="none" stroke="#eab308" strokeWidth="10"
            strokeDasharray={`${neutDash} ${circ - neutDash}`}
            strokeDashoffset={circ * 0.25 + neutOffset}
            transform="rotate(-90 45 45)" />
        )}
        <text x="45" y="42" textAnchor="middle" fill={overallColor} fontSize="10" fontWeight="bold" fontFamily="monospace">{overall}</text>
        <text x="45" y="55" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace">{total} art</text>
      </svg>
      <div className="text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span className="text-white/60">Bull</span>
          <span className="font-mono text-green-400 font-bold">{bullPct.toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          <span className="text-white/60">Bear</span>
          <span className="font-mono text-red-400 font-bold">{bearPct.toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
          <span className="text-white/60">Neut</span>
          <span className="font-mono text-yellow-400 font-bold">{neutPct.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Currency Strength Panel ────────────────────────────────────────────────
interface CurrencyStrength {
  currency: string;
  strength1h: number;
  strength1d: number;
  rank1h: number;
  rank1d: number;
  updatedAt: number;
}

function CurrencyStrengthPanel() {
  const [timeframe, setTimeframe] = useState<"1h" | "1d">("1d");
  const { data, isLoading } = useQuery<CurrencyStrength[]>({
    queryKey: ["/api/currency/strength"],
    refetchInterval: 60000,
  });

  const FLAGS: Record<string, string> = {
    USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵",
    CHF: "🇨🇭", AUD: "🇦🇺", CAD: "🇨🇦", NZD: "🇳🇿",
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-48 text-white/30 font-mono text-sm">
      Loading currency data...
    </div>
  );

  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center h-48 text-white/30 font-mono text-sm">
      Waiting for forex data...
    </div>
  );

  const sorted = [...data].sort((a, b) =>
    timeframe === "1h" ? b.strength1h - a.strength1h : b.strength1d - a.strength1d
  );

  return (
    <div className="p-4 space-y-3">
      {/* Timeframe toggle */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/40 font-mono text-xs uppercase tracking-wider">Currency Strength</span>
        <div className="flex gap-1">
          {(["1h", "1d"] as const).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 rounded text-xs font-mono font-bold transition-colors ${
                timeframe === tf ? "bg-green-500 text-black" : "bg-white/5 text-white/40 hover:bg-white/10"
              }`}>
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Strength bars */}
      {sorted.map((c, i) => {
        const strength = timeframe === "1h" ? c.strength1h : c.strength1d;
        const rank = timeframe === "1h" ? c.rank1h : c.rank1d;
        const color = strength >= 70 ? "#22c55e" : strength >= 40 ? "#eab308" : "#ef4444";
        const label = strength >= 70 ? "Strong" : strength >= 40 ? "Neutral" : "Weak";
        return (
          <div key={c.currency} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{FLAGS[c.currency] || "🏳️"}</span>
                <span className="font-mono font-bold text-white text-sm">{c.currency}</span>
                <span className="text-white/30 font-mono text-xs">#{rank}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs" style={{ color }}>{label}</span>
                <span className="font-mono font-bold text-sm" style={{ color }}>{strength}</span>
              </div>
            </div>
            <div className="w-full bg-white/5 rounded-full h-2">
              <div className="h-2 rounded-full transition-all duration-500"
                style={{ width: `${strength}%`, backgroundColor: color }} />
            </div>
          </div>
        );
      })}

      <div className="text-white/20 font-mono text-[10px] text-center pt-2">
        Based on 14 major forex pairs · Updates every 60s
      </div>
    </div>
  );
}

// ─── G1 Preview Modal ─────────────────────────────────────────────────────────
function G1Modal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <div className="g1-screen p-4 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2 text-green-400 text-xs font-mono">
            <Glasses className="w-3 h-3" />
            <span>G2 HUD PREVIEW</span>
          </div>
          <button onClick={onClose} className="text-green-400/60 hover:text-green-400"><X className="w-3 h-3" /></button>
        </div>
        <pre className="text-[11px] font-mono text-green-300 leading-relaxed whitespace-pre-wrap">{text}</pre>
        <button
          className="mt-3 w-full text-center text-[10px] font-mono text-green-400 border border-green-500/30 rounded py-1.5 hover:bg-green-500/10 transition-colors"
          onClick={() => { navigator.clipboard?.writeText(text); }}
        >
          COPY TO CLIPBOARD
        </button>
        <div className="mt-3 border-t border-green-500/20 pt-3 space-y-1">
          <div className="text-[9px] font-mono text-green-400/50 uppercase tracking-wider mb-1">G2 Gesture Guide</div>
          <div className="text-[9px] font-mono text-green-400/60">TAP LEFT &nbsp;&nbsp;&nbsp;= Scroll UP</div>
          <div className="text-[9px] font-mono text-green-400/60">TAP RIGHT &nbsp;&nbsp;= Scroll DOWN</div>
          <div className="text-[9px] font-mono text-green-400/60">DBL TAP LEFT = EXIT app</div>
        </div>
      </div>
    </div>
  );
}

// ─── Coin Detail Modal ────────────────────────────────────────────────────────
function CoinModal({ tick, onClose }: { tick: Tick; onClose: () => void }) {
  const [newsFilter, setNewsFilter] = useState<"all" | "bullish" | "bearish" | "neutral">("all");
  const [g1Text, setG1Text] = useState<string | null>(null);
  const sym = tick.symbol.replace("USDT", "");

  // Single query — prefetched on hover so data is instant on click
  const { data: detail, isLoading } = useQuery<AssetDetail>({
    queryKey: ["/api/assets", sym],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/assets/${sym}`);
      return r.json();
    },
    staleTime: 15000,
    retry: 1,
  });

  const allNews = detail?.news || [];
  const filtered = newsFilter === "all" ? allNews : allNews.filter(n => n.sentiment === newsFilter);
  const sent = detail?.sentiment;
  const flash = useFlash(tick.price, tick.symbol);
  const isUp = tick.changePercent >= 0;
  const cc = coinColor(sym);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-[hsl(224_18%_7%)] border border-white/10 rounded-t-2xl sm:rounded-xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[hsl(224_18%_7%)] border-b border-white/5 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: cc + "22", color: cc }}
            >
              {sym.slice(0, 2)}
            </div>
            <div>
              <div className="text-sm font-bold text-white">{tick.name}</div>
              <div className="text-[10px] text-white/40 font-mono">{sym} · {tick.category.toUpperCase()}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Price + stats */}
          <div className={`rounded-xl border p-4 ${flash === "up" ? "bg-green-500/10 border-green-500/30" : flash === "down" ? "bg-red-500/10 border-red-500/30" : "bg-white/2 border-white/5"} transition-all duration-300`}>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-2xl font-bold text-white">${fmtPrice(tick.price)}</span>
              <span className={`font-mono text-sm font-semibold ${isUp ? "text-green-400" : "text-red-400"}`}>
                {isUp ? "▲" : "▼"} {Math.abs(tick.changePercent).toFixed(2)}%
              </span>
              {tick.category === "crypto" || tick.category === "futures" ? (
                <span className="text-[10px] text-white/30 font-mono ml-auto">LIVE · {ago(tick.updatedAt)}</span>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <div className="text-[10px] text-white/30">24H HIGH</div>
                <div className="text-xs font-mono text-green-400">${fmtPrice(tick.high)}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/30">24H LOW</div>
                <div className="text-xs font-mono text-red-400">${fmtPrice(tick.low)}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/30">VOLUME</div>
                <div className="text-xs font-mono text-white/70">{fmtVol(tick.quoteVolume || tick.volume)}</div>
              </div>
            </div>
          </div>

          {/* Sentiment */}
          {sent && (
            <div className="rounded-xl border border-white/5 bg-white/2 p-4">
              <div className="text-[11px] text-white/40 font-mono uppercase tracking-wider mb-3">Market Sentiment</div>
              <SentimentDonut bull={sent.bullish} bear={sent.bearish} neut={sent.neutral} />
              {/* Buyer/Seller bars */}
              <div className="mt-4 space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] text-white/40 mb-1">
                    <span>BUYERS</span><span className="text-green-400">{sent.avgBuyerPressure}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-green-500 transition-all duration-500" style={{ width: `${sent.avgBuyerPressure}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-white/40 mb-1">
                    <span>SELLERS</span><span className="text-red-400">{sent.avgSellerPressure}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-red-500 transition-all duration-500" style={{ width: `${sent.avgSellerPressure}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* High-impact alerts */}
          {detail?.highImpact && detail.highImpact.length > 0 && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-[11px] text-yellow-400 font-mono uppercase tracking-wider">High Impact Alerts</span>
              </div>
              <div className="space-y-2">
                {detail.highImpact.slice(0, 3).map(n => (
                  <div key={n.id} className="flex items-start gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${sentimentBg(n.sentiment)}`}>
                      {n.sentiment.slice(0, 4).toUpperCase()}
                    </span>
                    <a href={n.url} target="_blank" rel="noreferrer"
                      className="text-[11px] text-white/80 hover:text-white line-clamp-2 leading-snug">
                      {n.title}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deep news */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] text-white/40 font-mono uppercase tracking-wider">Deep News Research</div>
              <div className="flex gap-1">
                {(["all","bullish","bearish","neutral"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setNewsFilter(f)}
                    className={`text-[10px] px-2 py-0.5 rounded font-mono border transition-colors ${
                      newsFilter === f ? sentimentBg(f === "all" ? "neutral" : f) : "border-white/10 text-white/30 hover:text-white/60"
                    }`}
                  >
                    {f === "all" ? "ALL" : f.slice(0, 4).toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-white/30 text-xs py-6 font-mono">No news articles found for {sym}</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {filtered.slice(0, 20).map(n => (
                  <div key={n.id} className="rounded-lg border border-white/5 bg-white/2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${sentimentBg(n.sentiment)}`}>
                            {n.sentiment.toUpperCase()}
                          </span>
                          {n.impactLevel === "high" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-400">HIGH</span>
                          )}
                          <span className="text-[10px] text-white/30 font-mono">{n.source}</span>
                          <span className="text-[10px] text-white/20">·</span>
                          <span className="text-[10px] text-white/20 font-mono">{ago(n.publishedAt)}</span>
                        </div>
                        <a href={n.url} target="_blank" rel="noreferrer"
                          className="text-xs text-white/80 hover:text-white leading-snug line-clamp-2">
                          {n.title}
                        </a>
                        {n.summary && (
                          <p className="text-[10px] text-white/40 mt-1 line-clamp-2 leading-relaxed">{n.summary}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <a href={n.url} target="_blank" rel="noreferrer"
                          className="text-white/20 hover:text-white/60 transition-colors">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {n.g1Text && (
                          <button
                            className="text-green-500/40 hover:text-green-400 transition-colors"
                            onClick={() => setG1Text(n.g1Text)}
                            title="View G2 HUD preview"
                          >
                            <Glasses className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Pressure mini-bars */}
                    <div className="flex gap-1 mt-2">
                      <div className="flex-1 h-1 rounded-full bg-white/5">
                        <div className="h-full rounded-full bg-green-500/60" style={{ width: `${n.buyerPressure}%` }} />
                      </div>
                      <span className="text-[9px] text-white/20 font-mono w-8 text-right">B{n.buyerPressure}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* G2 quick preview button */}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-green-400 border-green-500/30 hover:bg-green-500/10 font-mono text-xs"
            onClick={() => {
              const lines = [
                `${sym}/USDT  $${fmtPrice(tick.price).padStart(10)}`,
                `${isUp ? "▲" : "▼"} ${Math.abs(tick.changePercent).toFixed(2)}%   Vol:${fmtVol(tick.quoteVolume || tick.volume)}`,
                sent ? `Bull:${sent.bullPct}% Bear:${sent.bearPct}% Neut:${sent.neutPct}%` : "",
                sent ? `Buyers:${sent.avgBuyerPressure}% Sellers:${sent.avgSellerPressure}%` : "",
                allNews[0] ? allNews[0].title.slice(0, 40) : "No recent news",
              ].filter(Boolean).join("\n");
              setG1Text(lines);
            }}
          >
            <Glasses className="w-3 h-3 mr-2" />
            VIEW G2 HUD PREVIEW
          </Button>
        </div>
      </div>

      {g1Text && <G1Modal text={g1Text} onClose={() => setG1Text(null)} />}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("crypto");
  const [search, setSearch] = useState("");
  const [selectedTick, setSelectedTick] = useState<Tick | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const { ticks, connected } = useLiveTicks();

  // Cmd/Ctrl+K opens global search
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowSearch(s => !s); }
      if (e.key === "Escape") setShowSearch(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Convert map to arrays per category
  const cryptoTicks = useMemo(() => {
    const arr: Tick[] = [];
    ticks.forEach((t, k) => { if (t.category === "crypto") arr.push(t); });
    return arr.sort((a, b) => b.quoteVolume - a.quoteVolume);
  }, [ticks]);

  const futuresTicks = useMemo(() => {
    const arr: Tick[] = [];
    ticks.forEach((t, k) => { if (t.category === "futures") arr.push(t); });
    return arr.sort((a, b) => b.quoteVolume - a.quoteVolume);
  }, [ticks]);

  const stockTicks = useMemo(() => {
    const arr: Tick[] = [];
    ticks.forEach((t, k) => { if (t.category === "stocks") arr.push(t); });
    return arr;
  }, [ticks]);

  const oilTicks = useMemo(() => {
    const arr: Tick[] = [];
    ticks.forEach((t, k) => { if (t.category === "oil") arr.push(t); });
    return arr;
  }, [ticks]);

  // All ticks merged for global search (crypto sorted by volume first)
  const allTicksForSearch = useMemo(() => {
    return [...cryptoTicks, ...futuresTicks, ...stockTicks, ...oilTicks];
  }, [cryptoTicks, futuresTicks, stockTicks, oilTicks]);

  // Filter by search
  const filterTicks = (arr: Tick[]) => {
    if (!search) return arr;
    const q = search.toLowerCase();
    return arr.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q)
    );
  };

  const tabs: { id: Tab; label: string; icon: any; count: number }[] = [
    { id: "crypto",   label: "Crypto",   icon: Bitcoin,   count: cryptoTicks.length },
    { id: "futures",  label: "Futures",  icon: BarChart2,  count: futuresTicks.length },
    { id: "stocks",   label: "Stocks",   icon: TrendingUp, count: stockTicks.length },
    { id: "oil",      label: "Oil",      icon: Fuel,       count: oilTicks.length },
    { id: "currency", label: "FX",       icon: Activity,   count: 8 },
  ];

  const currentTicks = filterTicks(
    tab === "crypto" ? cryptoTicks :
    tab === "futures" ? futuresTicks :
    tab === "stocks" ? stockTicks : oilTicks
  );

  // Loading state (waiting for SSE snapshot)
  const isLoading = ticks.size === 0;

  return (
    <div className="min-h-screen bg-[hsl(224_18%_6%)] text-white" style={{ fontFamily: "'Satoshi', sans-serif" }}>
      {/* Ticker tape */}
      <TickerTape allTicks={ticks} />

      {/* Header */}
      <header className="border-b border-white/5 px-4 py-3 flex items-center justify-between sticky top-8 z-30 bg-[hsl(224_18%_6%)]/95 backdrop-blur-md" style={{ top: "32px" }}>
        <div className="flex items-center gap-3">
          {/* Logo */}
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="Market Intel">
            <rect width="28" height="28" rx="6" fill="hsl(152 68% 42% / 0.15)" />
            <path d="M8 14a6 6 0 1 1 6 6H8v-3h4a3 3 0 1 0-3-3H8v-3z" fill="hsl(152 68% 42%)" />
            <rect x="18" y="8" width="2.5" height="12" rx="1.25" fill="hsl(152 68% 42%)" />
          </svg>
          <div>
            <div className="text-sm font-bold text-white leading-none">Market Intel</div>
            <div className="text-[10px] text-white/30 font-mono leading-none mt-0.5">
              {ticks.size.toLocaleString()} ticks live
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection indicator */}
          <div className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border ${
            connected
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
            {connected ? "LIVE" : "CONNECTING"}
          </div>

          {/* Search button */}
          <button
            data-testid="open-search"
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 text-xs font-mono border border-white/10 px-3 py-1.5 rounded-lg text-white/50 hover:text-white hover:border-green-500/40 hover:bg-green-500/5 transition-all"
          >
            <Search className="w-3 h-3" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline text-[9px] border border-white/10 px-1 rounded text-white/25">⌘K</kbd>
          </button>

          {/* G2 Glasses icon */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono border border-white/10 px-2 py-1 rounded text-white/40">
            <Glasses className="w-3 h-3" />
            G2
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-white/5 sticky z-20 bg-[hsl(224_18%_6%)]" style={{ top: "calc(32px + 57px)" }}>
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => { setTab(t.id); setSearch(""); }}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
                tab === t.id
                  ? "border-green-500 text-green-400"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count > 0 && (
                <span className={`text-[9px] font-mono px-1 rounded ${tab === t.id ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/30"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      {tab !== "currency" && <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <button
          onClick={() => setShowSearch(true)}
          className="flex items-center gap-2 flex-1 max-w-sm text-left text-xs font-mono border border-white/8 rounded-lg px-3 h-8 bg-white/2 text-white/25 hover:border-green-500/30 hover:bg-green-500/4 hover:text-white/50 transition-all"
          data-testid="search-bar-trigger"
        >
          <Search className="w-3 h-3 shrink-0" />
          <span>Search {tab}... any symbol or name</span>
          <kbd className="ml-auto text-[9px] border border-white/10 px-1 rounded text-white/20">⌘K</kbd>
        </button>
        <span className="text-[10px] text-white/20 font-mono shrink-0">
          {currentTicks.length.toLocaleString()} coins
        </span>
      </div>}

      {/* Currency Strength Panel */}
      {tab === "currency" && (
        <main className="px-4 pb-8 mt-2">
          <CurrencyStrengthPanel />
        </main>
      )}

      {/* Grid */}
      {tab !== "currency" && <main className="px-4 pb-8">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 mt-2">
            {Array.from({ length: 24 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-lg bg-white/3" />
            ))}
          </div>
        ) : currentTicks.length === 0 ? (
          <div className="text-center text-white/30 text-sm py-16 font-mono">
            {search ? `No results for "${search}"` : `Waiting for ${tab} data...`}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 mt-1">
            {currentTicks.map(tick => {
              if (tab === "crypto") {
                return <CoinCard key={tick.symbol} tick={tick} onClick={() => setSelectedTick(tick)} />;
              } else if (tab === "futures") {
                return <FuturesCard key={tick.symbol} tick={tick} onClick={() => setSelectedTick(tick)} />;
              } else {
                return <StockCard key={tick.symbol} tick={tick} onClick={() => setSelectedTick(tick)} />;
              }
            })}
          </div>
        )}
      </main>}

      {/* Coin detail modal */}
      {selectedTick && (
        <CoinModal tick={selectedTick} onClose={() => setSelectedTick(null)} />
      )}

      {/* Global search overlay */}
      {showSearch && (
        <GlobalSearch
          allTicks={allTicksForSearch}
          onSelect={(tick) => { setSelectedTick(tick); setShowSearch(false); }}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}
