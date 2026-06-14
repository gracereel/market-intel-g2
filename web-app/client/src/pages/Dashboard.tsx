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
  ChevronRight, Activity, Command, Star,
  Bell, Filter, Flame, Clock, ArrowUpRight, Globe,
  Target, PlusCircle, Trash2, Edit3, CheckCircle, TrendingUp as TrendUp, ChevronDown
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "crypto" | "futures" | "stocks" | "oil" | "currency" | "favorites" | "positions";

interface Tick {
  symbol: string;
  name: string;
  category: "crypto" | "futures" | "stocks" | "oil";
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  quoteVolume: number;
  high: number;
  low: number;
  open: number;
  updatedAt: number;
  bid?: number;
  ask?: number;
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
  if (s === "bullish") return "text-[#ffc040]";
  if (s === "bearish") return "text-[#ff5566]";
  return "text-[#ffc040]";
}

function sentimentBg(s: string) {
  if (s === "bullish") return "bg-[#ffc040]/10 text-[#ffc040] border-[#ffc040]/28";
  if (s === "bearish") return "bg-[#ff5566]/10 text-[#ff5566] border-[#ff5566]/28";
  return "bg-[#ffc040]/12 text-[#ffc040] border-[#ffc040]/28";
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
    if (cat === "oil")     return { label: "OIL",     cls: "text-[#ffaa40] bg-orange-400/10 border-orange-400/20" };
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
          <Search className="w-4 h-4 text-[#ffc040] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search any coin, pair, stock or commodity..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-[#ffc040]/38 outline-none font-mono"
            data-testid="global-search-input"
          />
          {query ? (
            <button onClick={() => setQuery("")} className="text-[#ffc040]/45 hover:text-[#ffc040]/88 transition-colors">
              <X className="w-4 h-4" />
            </button>
          ) : (
            <kbd className="text-[10px] font-mono text-[#ffc040]/30 border border-[#ffc040]/20 px-1.5 py-0.5 rounded">ESC</kbd>
          )}
        </div>

        {/* Category hint pills */}
        {!query && (
          <div className="flex gap-2 px-4 pt-2.5 pb-1">
            <span className="text-[10px] text-[#ffc040]/38 font-mono">Top by volume:</span>
          </div>
        )}

        {/* Results list */}
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: "360px" }}>
          {results.length === 0 ? (
            <div className="py-12 text-center text-[#ffc040]/38 text-xs font-mono">No results for "{query}"</div>
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
                  <div className="text-[11px] text-[#ffc040]/52 truncate">{tick.name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-mono font-bold text-white">${fmtPrice(tick.price)}</div>
                  <div className={`text-[11px] font-mono ${isUp ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
                    {isUp ? "+" : ""}{tick.changePercent.toFixed(2)}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <span className="text-[10px] text-[#ffc040]/30 font-mono">↑↓ navigate</span>
          <span className="text-[10px] text-[#ffc040]/30 font-mono">↵ open</span>
          <span className="text-[10px] text-[#ffc040]/30 font-mono">ESC close</span>
          <span className="text-[10px] text-[#ffc040]/38 font-mono ml-auto">{results.length} result{results.length !== 1 ? "s" : ""}</span>
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
function CoinCard({ tick, onClick, atr, starBtn }: { tick: Tick; onClick: () => void; atr?: { atr: number; atrPct: number } | null; starBtn?: React.ReactNode }) {
  const flash = useFlash(tick.price, tick.symbol);
  const cc = coinColor(tick.symbol.replace("USDT", ""));
  const isUp = tick.changePercent >= 0;

  return (
    <button
      data-testid={`coin-card-${tick.symbol}`}
      onClick={onClick}
      onMouseEnter={() => prefetchAsset(tick.symbol)}
      className={`
        group relative w-full text-left rounded-lg border p-3 transition-all duration-200
        hover:scale-[1.02] hover:shadow-lg cursor-pointer
        ${flash === "up" ? "bg-[#ffc040]/10 border-[#ffc040]/50" :
          flash === "down" ? "bg-[#ff5566]/10 border-[#ff5566]/45" :
          "bg-[#181410] border-[#ffc040]/22 hover:border-[#ffc040]/50 hover:shadow-[0_0_20px_rgba(255,192,64,0.12)]"}
      `}
      style={{ borderLeftColor: cc, borderLeftWidth: "3px" }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide"
              style={{ backgroundColor: cc + "22", color: cc }}
            >
              {tick.symbol.replace("USDT", "")}
            </span>
          </div>
          <div className="text-[10px] text-[#ffc040]/70 truncate leading-none font-medium">{tick.name}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-base font-bold text-[#fff8e8] leading-tight">
            ${fmtPrice(tick.price)}
          </div>
          <div className={`text-[11px] font-mono font-semibold ${isUp ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(tick.changePercent).toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-[#ffc040]/58 font-mono">Vol {fmtVol(tick.quoteVolume || tick.volume)}</span>
        {atr && (
          <span className="text-[10px] font-mono text-[#ffc040]/85 font-semibold" title="ATR-14 (daily expected move)">
            ATR {atr.atrPct.toFixed(2)}%
          </span>
        )}
      </div>
      {starBtn}
      {/* Flash overlay */}
      {flash && (
        <div className={`absolute inset-0 rounded-lg pointer-events-none ${flash === "up" ? "bg-[#ffc040]/8" : "bg-[#ff5566]/8"}`} />
      )}
    </button>
  );
}

// ─── Futures Card ─────────────────────────────────────────────────────────────
function FuturesCard({ tick, onClick, atr, starBtn }: { tick: Tick; onClick: () => void; atr?: { atr: number; atrPct: number } | null; starBtn?: React.ReactNode }) {
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
        group relative w-full text-left rounded-lg border p-3 transition-all duration-200
        hover:scale-[1.02] cursor-pointer
        ${flash === "up" ? "bg-[#ffc040]/10 border-[#ffc040]/50" :
          flash === "down" ? "bg-[#ff5566]/10 border-[#ff5566]/45" :
          "bg-[#181410] border-[#ffc040]/22 hover:border-[#ffc040]/50 hover:shadow-[0_0_20px_rgba(255,192,64,0.12)]"}
      `}
      style={{ borderLeftColor: cc, borderLeftWidth: "3px" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">{base}-PERP</div>
          <div className="text-[10px] text-[#ffc040]/70">{tick.name}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-base font-bold text-[#fff8e8]">${fmtPrice(tick.price)}</div>
          <div className={`text-[11px] font-mono ${isUp ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(tick.changePercent).toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-[#ffc040]/45 font-mono">
        <span>Vol {fmtVol(tick.quoteVolume)}</span>
        {tick.fundingRate !== undefined && (
          <span className={tick.fundingRate >= 0 ? "text-[#ffc040]/60" : "text-[#ff5566]/60"}>
            FR {(tick.fundingRate * 100).toFixed(4)}%
          </span>
        )}
      </div>
      {atr && (
        <div className="mt-1 text-right">
          <span className="text-[10px] font-mono text-[#ffc040]/85 font-semibold" title="ATR-14 (daily expected move)">
            ATR {atr.atrPct.toFixed(2)}%
          </span>
        </div>
      )}
      {starBtn}
      {flash && (
        <div className={`absolute inset-0 rounded-lg pointer-events-none ${flash === "up" ? "bg-[#ffc040]/8" : "bg-[#ff5566]/8"}`} />
      )}
    </button>
  );
}

// ─── Stock Card ───────────────────────────────────────────────────────────────
function StockCard({ tick, onClick, atr, starBtn }: { tick: Tick; onClick: () => void; atr?: { atr: number; atrPct: number } | null; starBtn?: React.ReactNode }) {
  const flash = useFlash(tick.price, tick.symbol);
  const isUp = tick.changePercent >= 0;

  const catColor = tick.symbol === "VIX" ? "#f59e0b" : isUp ? "#22c55e" : "#ef4444";

  return (
    <button
      data-testid={`stock-card-${tick.symbol}`}
      onClick={onClick}
      onMouseEnter={() => prefetchAsset(tick.symbol)}
      className={`
        group relative w-full text-left rounded-lg border p-3 transition-all duration-200
        hover:scale-[1.02] cursor-pointer
        ${flash === "up" ? "bg-[#ffc040]/10 border-[#ffc040]/50" :
          flash === "down" ? "bg-[#ff5566]/10 border-[#ff5566]/45" :
          "bg-[#181410] border-[#ffc040]/22 hover:border-[#ffc040]/50 hover:shadow-[0_0_20px_rgba(255,192,64,0.12)]"}
      `}
      style={{ borderLeftColor: catColor, borderLeftWidth: "3px" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-white">{tick.symbol}</div>
          <div className="text-[10px] text-[#ffc040]/58 truncate max-w-[100px]">{tick.name}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-base font-bold text-[#fff8e8]">${fmtPrice(tick.price)}</div>
          <div className={`text-[11px] font-mono ${isUp ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(tick.changePercent).toFixed(2)}%
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-[#ffc040]/58 font-mono">Vol {fmtVol(tick.volume)}</span>
        {atr && (
          <span className="text-[10px] font-mono text-[#ffc040]/85 font-semibold" title="ATR-14 (daily expected move)">
            ATR {atr.atrPct.toFixed(2)}%
          </span>
        )}
      </div>
      {starBtn}
      {flash && (
        <div className={`absolute inset-0 rounded-lg pointer-events-none ${flash === "up" ? "bg-[#ffc040]/8" : "bg-[#ff5566]/8"}`} />
      )}
    </button>
  );
}

// ─── Semicircle Gauge ────────────────────────────────────────────────────────
function SentGauge({ tf, pct, label, color, size }: { tf: string; pct: number; label: string; color: string; size: number }) {
  const isFinal = size >= 110;
  // Uses stroke-dasharray trick: no arc endpoint math = no clipping ever.
  // The semicircle is always the FULL track path.
  // We reveal pct% of it via dashoffset. The SVG is just a rectangle.
  const W = size;
  const sw = Math.round(W * 0.18);   // bold speedometer stroke
  const R = (W - sw) / 2 - 2;       // radius fills width
  const cx = W / 2;
  const cy = W / 2 + 2;

  // Full semicircle circumference (half circle)
  const semi = Math.PI * R;         // π * R

  // dasharray = full semicircle length; dashoffset = hidden portion
  const dashTotal = semi;
  const dashFill  = (pct / 100) * semi;
  const dashOffset = semi - dashFill;  // hide from right end backwards

  // The SVG height = cy + sw/2 + 6 (just past the bottom endpoints)
  const svgH = cy + sw / 2 + 6;

  // Track path: left endpoint → arc over top → right endpoint (fixed, never changes)
  const lx = (cx - R).toFixed(1), rx = (cx + R).toFixed(1), cyS = cy.toFixed(1), RS = R.toFixed(1);
  const arcPath = `M ${lx} ${cyS} A ${RS} ${RS} 0 0 1 ${rx} ${cyS}`;

  // ViewBox top = 0, but arc top = cy - R = W/2+2 - (W/2-sw/2-4) = sw/2+6 ≥ 11px from top
  // So the stroke (sw/2 outward from arc) top = sw/2+6 - sw/2 = 6px from top — safe.

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      background: "#100d07",
      border: "1px solid rgba(255,192,64,0.13)",
      borderRadius: 16,
      paddingTop: 8, paddingBottom: 10, paddingLeft: 12, paddingRight: 12,
      minWidth: W + 16,
      flexShrink: 0,
    }}>
      <svg width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`} style={{ display: "block", overflow: "visible" }}>
        {/* Track — full dim semicircle */}
        <path d={arcPath} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={sw} strokeLinecap="round" />
        {/* Fill — same path, revealed via dasharray */}
        {pct > 0 && (
          <path
            d={arcPath}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${dashFill.toFixed(2)} ${(dashTotal - dashFill + 999).toFixed(2)}`}
            style={{ filter: `drop-shadow(0 0 6px ${color}aa)` }}
          />
        )}
        {/* Zone threshold tick marks — Short(40%) and Long(60%) */}
        {[
          { pct: 40, col: "#ff5566", label: "40" },
          { pct: 60, col: "#4ade80", label: "60" },
        ].map(({ pct: tp, col, label: tl }) => {
          // Point on the arc at tp%
          const tTheta = (tp / 100) * Math.PI;
          const tx = cx - R * Math.cos(tTheta);
          const ty = cy - R * Math.sin(tTheta);
          // Direction outward from center
          const nx = Math.cos(Math.PI - tTheta);
          const ny = -Math.sin(Math.PI - tTheta);
          const tickLen = sw * 0.9;
          const x1 = (tx - nx * (sw * 0.55)).toFixed(1);
          const y1 = (ty - ny * (sw * 0.55)).toFixed(1);
          const x2 = (tx + nx * (tickLen - sw * 0.55)).toFixed(1);
          const y2 = (ty + ny * (tickLen - sw * 0.55)).toFixed(1);
          // Label position — slightly further out
          const lx2 = (tx + nx * (tickLen + 3)).toFixed(1);
          const ly2 = (ty + ny * (tickLen + 3)).toFixed(1);
          return (
            <g key={tp}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={1.5} strokeLinecap="round" opacity={0.9} />
              {!isFinal && (
                <text x={lx2} y={ly2} textAnchor="middle" dominantBaseline="middle"
                  style={{ fontSize: W * 0.07, fontFamily: "monospace", fill: col, fontWeight: 700, opacity: 0.85 }}>
                  {tl}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <div style={{ fontSize: isFinal ? 26 : 18, fontWeight: 800, color, fontFamily: "monospace", lineHeight: 1 }}>{pct}%</div>
        <div style={{ fontSize: isFinal ? 11 : 9, color: "rgba(255,248,232,0.55)", marginTop: 3, fontFamily: "sans-serif" }}>{label}</div>
      </div>
      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.7)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 6, fontFamily: "monospace" }}>{tf}</div>
    </div>
  );
}

// ─── Market Sentiment Panel ──────────────────────────────────────────────────
const TIMEFRAMES = ["5M","15M","1H","4H","12H","1D","1W"];

// Multi-factor sentiment — uses price action, range position, volume, and momentum
// Each timeframe has different sensitivity so short TFs react faster than weekly
function getSentimentForTick(tick: Tick, tf: string): { label: string; score: number } {
  const change = tick.changePercent ?? 0;
  const price  = tick.price  ?? 0;
  const high   = tick.high   ?? price;
  const low    = tick.low    ?? price;
  const open   = tick.open   ?? price;

  // 1. Momentum: how strong is the move relative to timeframe sensitivity
  //    Short TFs need smaller moves to register; longer TFs need bigger moves
  const tfSensitivity: Record<string, number> = {
    "5M": 0.3, "15M": 0.6, "1H": 1.2, "4H": 2.0, "12H": 3.5, "1D": 5.0, "1W": 10.0,
  };
  const sens = tfSensitivity[tf] ?? 1.0;
  // Normalize change to [-1, 1] based on timeframe sensitivity
  const momentum = Math.max(-1, Math.min(1, change / sens));

  // 2. Price position in day's range (Williams %R style)
  // 1.0 = at high (bullish), 0.0 = at low (bearish), 0.5 = middle (neutral)
  const range = high - low;
  const rangePos = range > 0 ? (price - low) / range : 0.5;
  const rangeSignal = (rangePos - 0.5) * 2; // [-1, 1]

  // 3. Open vs Close (candlestick body direction)
  const bodySignal = open > 0 ? Math.max(-1, Math.min(1, (price - open) / open * 20)) : 0;

  // 4. Breakout signal: price near or breaking day high/low
  //    If price >= 98% of high → bullish breakout (+1)
  //    If price <= 102% of low → bearish breakout (-1)
  //    Scaled by how close to the level (0 if in middle of range)
  let breakout = 0;
  if (high > 0 && low > 0 && range > 0) {
    const distFromHigh = (high - price) / range;  // 0 = at high, 1 = at low
    const distFromLow  = (price - low)  / range;  // 0 = at low,  1 = at high
    if (distFromHigh < 0.05) breakout =  1.0;      // within 5% of high = bullish breakout
    else if (distFromLow < 0.05) breakout = -1.0;  // within 5% of low  = bearish breakout
    else if (distFromHigh < 0.15) breakout =  0.5; // approaching high
    else if (distFromLow  < 0.15) breakout = -0.5; // approaching low
  }

  // 5. Bid/Ask order pressure
  // bid > ask proximity to price = buying pressure (bullish)
  // ask >> bid = selling pressure (bearish)
  // Order imbalance = (bid - ask) / spread, normalized to [-1, 1]
  let orderPressure = 0;
  const bid = tick.bid ?? 0;
  const ask = tick.ask ?? 0;
  if (bid > 0 && ask > 0 && price > 0) {
    const spread = ask - bid;
    // Mid price vs actual price: if price closer to ask = buyers lifting offers = bullish
    const mid = (bid + ask) / 2;
    const pressureRaw = spread > 0 ? (price - mid) / (spread / 2) : 0;
    orderPressure = Math.max(-1, Math.min(1, pressureRaw));
  }

  // 6. Funding rate signal (futures only) — negative = shorts paying longs = bullish
  let fundingSignal = 0;
  if (tick.fundingRate !== undefined) {
    // Funding rates typically -0.1% to +0.1% per 8h
    fundingSignal = Math.max(-1, Math.min(1, -(tick.fundingRate) * 1000));
  }

  // 7. Combine all signals
  // Momentum 40%, breakout 20%, range position 15%, bid/ask 15%, body 5%, funding 5%
  const raw = momentum * 0.40 + breakout * 0.20 + rangeSignal * 0.15 + orderPressure * 0.15 + bodySignal * 0.05 + fundingSignal * 0.05;
  const score = Math.max(-1, Math.min(1, raw));

  const abs = Math.abs(score);
  if (abs < 0.15) return { label: "Neutral", score: 0 };
  if (score > 0) {
    if (abs >= 0.65) return { label: "Strong Bull", score };
    if (abs >= 0.35) return { label: "Bullish", score };
    return { label: "Bullish", score };
  } else {
    if (abs >= 0.65) return { label: "Strong Bear", score };
    if (abs >= 0.35) return { label: "Bearish", score };
    return { label: "Bearish", score };
  }
}

function sentColor(label: string) {
  if (label === "Strong Bull") return "#ffffff";
  if (label === "Bullish") return "#e8e8e8";
  if (label === "Strong Bear") return "#ff2233";
  if (label === "Bearish") return "#ff5566";
  return "#ffc040";
}
function sentBgStyle(label: string): React.CSSProperties {
  if (label === "Strong Bull") return { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", color: "#22c55e" };
  if (label === "Bullish")     return { background: "rgba(74,222,128,0.10)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80" };
  if (label === "Strong Bear") return { background: "rgba(255,51,68,0.15)", border: "1px solid rgba(255,51,68,0.4)", color: "#ff3344" };
  if (label === "Bearish")     return { background: "rgba(255,85,102,0.10)", border: "1px solid rgba(255,85,102,0.3)", color: "#ff5566" };
  return { background: "rgba(255,192,64,0.10)", border: "1px solid rgba(255,192,64,0.3)", color: "#ffc040" };
}

function MarketSentimentBar({ ticks }: { ticks: Map<string, Tick> }) {
  const allTicks = Array.from(ticks.values());
  const [showModal, setShowModal] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const selectedTick = selectedSymbol ? (allTicks.find(t => t.symbol === selectedSymbol) ?? null) : null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allTicks.slice(0, 30);
    return allTicks.filter(t =>
      t.symbol.toLowerCase().includes(q) || (t.name || "").toLowerCase().includes(q)
    ).slice(0, 30);
  }, [allTicks, query]);

  const rows = useMemo(() => TIMEFRAMES.map(tf => {
    if (selectedTick) {
      return { tf, ...getSentimentForTick(selectedTick, tf), bull: 0, bear: 0, neut: 0, single: true };
    }
    let bull = 0, bear = 0, neut = 0;
    allTicks.forEach(t => {
      const s = getSentimentForTick(t, tf);
      if (s.score > 0) bull++; else if (s.score < 0) bear++; else neut++;
    });
    const total = bull + bear + neut || 1;
    const score = (bull - bear) / total;
    let label = "Neutral";
    if (score > 0.5) label = "Strong Bull";
    else if (score > 0.2) label = "Bullish";
    else if (score < -0.5) label = "Strong Bear";
    else if (score < -0.2) label = "Bearish";
    return { tf, label, score, bull, bear, neut, single: false };
  }), [selectedTick, allTicks]);

  const avgScore = rows.reduce((a, r) => a + r.score, 0) / rows.length;
  let verdict = "Neutral";
  if (avgScore > 0.5) verdict = "Strong Bull";
  else if (avgScore > 0.2) verdict = "Bullish";
  else if (avgScore < -0.5) verdict = "Strong Bear";
  else if (avgScore < -0.2) verdict = "Bearish";

  if (allTicks.length === 0) return null;

  const displayName = selectedTick ? `${selectedTick.symbol}` : "All Markets";

  return (
    <>
      {/* Modal overlay */}
      {showModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-start pt-20 pl-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={() => { setShowModal(false); setQuery(""); }}
        >
          <div
            className="w-72 rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: "#0d0a06", border: "1px solid rgba(255,192,64,0.3)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Search */}
            <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,192,64,0.12)" }}>
              <div className="text-[10px] font-mono mb-2" style={{ color: "rgba(255,192,64,0.5)" }}>SELECT PAIR OR COIN</div>
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search BTC, ETH, EUR/USD..."
                className="w-full rounded-lg px-3 py-2 text-xs font-mono outline-none"
                style={{ background: "#060402", border: "1px solid rgba(255,192,64,0.2)", color: "#fff8e8" }}
              />
            </div>

            {/* All Markets */}
            <button
              className="w-full text-left px-4 py-3 text-xs font-mono font-bold flex items-center gap-2 border-b"
              style={{
                borderColor: "rgba(255,192,64,0.08)",
                background: !selectedSymbol ? "rgba(255,192,64,0.08)" : "transparent",
                color: !selectedSymbol ? "#ffc040" : "rgba(255,192,64,0.5)"
              }}
              onClick={() => { setSelectedSymbol(null); setShowModal(false); setQuery(""); }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: "#ffc040", opacity: 0.5 }} />
              All Markets Overview
            </button>

            {/* Coin list */}
            <div style={{ maxHeight: "280px", overflowY: "auto" }}>
              {filtered.map(t => (
                <button
                  key={t.symbol}
                  className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-2"
                  style={{
                    background: selectedSymbol === t.symbol ? "rgba(255,192,64,0.08)" : "transparent",
                    color: selectedSymbol === t.symbol ? "#ffc040" : "rgba(255,248,232,0.75)",
                    borderBottom: "1px solid rgba(255,192,64,0.05)"
                  }}
                  onClick={() => { setSelectedSymbol(t.symbol); setShowModal(false); setQuery(""); }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold font-mono" style={{ color: "#ffc040" }}>{t.symbol}</span>
                    <span className="text-[10px] font-mono truncate" style={{ color: "rgba(255,192,64,0.35)" }}>{t.name}</span>
                  </div>
                  <span className="text-[10px] font-mono font-bold shrink-0" style={{ color: (t.changePercent ?? 0) >= 0 ? "#4ade80" : "#ff5566" }}>
                    {(t.changePercent ?? 0) >= 0 ? "+" : ""}{(t.changePercent ?? 0).toFixed(2)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bar */}
      <div style={{ background: "#060401", borderTop: "1px solid rgba(255,192,64,0.12)", borderBottom: "1px solid rgba(255,192,64,0.12)" }}>
        <div style={{ padding: "20px 16px 12px 16px", display:"flex", alignItems:"center", gap:12 }}>

          {/* Selector button */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#ffc040" }} />
            <span className="text-[9px] font-mono uppercase tracking-widest hidden sm:block" style={{ color: "rgba(255,192,64,0.45)" }}>Sentiment</span>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold"
              style={{ background: "#181410", border: "1px solid rgba(255,192,64,0.25)", color: "#ffc040" }}
            >
              {displayName}
              <ChevronDown className="w-3 h-3" style={{ color: "rgba(255,192,64,0.4)" }} />
            </button>
          </div>

          {/* Gauge row */}
          <div style={{ display:"flex", alignItems:"center", gap:8, overflowX:"auto", overflowY:"visible", flex:1, paddingBottom:4, paddingTop:4, paddingLeft:4 }}>
            {rows.map(({ tf, label, score, bull, bear, neut, single }) => {
              const pct = Math.round(((score + 1) / 2) * 100);
              const total = bull + bear + neut || 1;
              const displayPct = single ? pct : Math.round((bull / total) * 100);
              const color = sentColor(label);
              const short = label === "Strong Bull" ? "Strongly Bullish" : label === "Strong Bear" ? "Strongly Bearish" : label;
              return <SentGauge key={tf} tf={tf} pct={displayPct} label={short} color={color} size={130} />;
            })}
            {/* Divider */}
            <div style={{ width:1, height:80, background:"rgba(255,192,64,0.12)", flexShrink:0 }} />
            {/* Final */}
            {(() => {
              const pct = Math.round(((avgScore + 1) / 2) * 100);
              const color = sentColor(verdict);
              const short = verdict === "Strong Bull" ? "Strongly Bullish" : verdict === "Strong Bear" ? "Strongly Bearish" : verdict;
              return <SentGauge tf="FINAL" pct={pct} label={short} color={color} size={160} />;
            })()}
            {/* Live price */}
            {selectedTick && (
              <div className="ml-auto flex flex-col items-end justify-center shrink-0 self-center gap-1">
                <span className="text-lg font-bold font-mono" style={{ color: "#fff8e8" }}>
                  ${Number(selectedTick.price ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </span>
                <span className="text-xs font-mono font-bold" style={{ color: (selectedTick.changePercent ?? 0) >= 0 ? "#4ade80" : "#ff5566" }}>
                  {(selectedTick.changePercent ?? 0) >= 0 ? "▲" : "▼"}{Math.abs(selectedTick.changePercent ?? 0).toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}


function TickerTape({ allTicks }: { allTicks: Map<string, Tick> }) {
  // Pick top crypto by volume + all stocks + all futures + all oil
  const items = useMemo(() => {
    // Top 10 crypto by volume only
    return Array.from(allTicks.values())
      .filter(t => t.category === "crypto")
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 20);
  }, [allTicks]);

  if (items.length === 0) return null;

  // Duplicate 3x so scroll looks seamless at any screen width
  const tape = [...items, ...items, ...items];
  const duration = Math.max(20, items.length * 1.2); // ~1.2s per item, min 20s

  return (
    <div className="overflow-hidden border-b border-[#ffc040]/28 bg-black/50" style={{ height: "30px" }}>
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
              <span className={`font-semibold ${isUp ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
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
          <span className="text-[#ffc040]/78">Bull</span>
          <span className="font-mono text-[#ffc040] font-bold">{bullPct.toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          <span className="text-[#ffc040]/78">Bear</span>
          <span className="font-mono text-[#ff5566] font-bold">{bearPct.toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
          <span className="text-[#ffc040]/78">Neut</span>
          <span className="font-mono text-[#ffc040] font-bold">{neutPct.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}


// ─── Currency Strength Panel (Full FX Terminal) ───────────────────────────────
interface CurrencyStrength {
  currency: string;
  strength1h: number;
  strength4h: number;
  strength1d: number;
  strength1w: number;
  rank1h: number;
  rank4h: number;
  rank1d: number;
  rank1w: number;
  change1h: number;
  change1d: number;
  pairsCount: number;
  updatedAt: number;
}

interface ForexPairDetail {
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

interface DXYData {
  value: number;
  change1d: number;
  change1w: number;
  updatedAt: number;
}

const FLAGS: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵",
  CHF: "🇨🇭", AUD: "🇦🇺", CAD: "🇨🇦", NZD: "🇳🇿",
};

const CUR_COLORS: Record<string, string> = {
  USD: "#3b82f6", EUR: "#a78bfa", GBP: "#f59e0b", JPY: "#ef4444",
  CHF: "#10b981", AUD: "#f97316", CAD: "#ec4899", NZD: "#06b6d4",
};

function sColor(s: number) {
  if (s >= 72) return "#22c55e";
  if (s >= 55) return "#86efac";
  if (s >= 45) return "#eab308";
  if (s >= 28) return "#f97316";
  return "#ef4444";
}
function sLabel(s: number) {
  if (s >= 72) return "Very Strong";
  if (s >= 55) return "Strong";
  if (s >= 45) return "Neutral";
  if (s >= 28) return "Weak";
  return "Very Weak";
}

function StrengthBar({ value, currency }: { value: number; currency: string }) {
  const color = sColor(value);
  const accent = CUR_COLORS[currency] || color;
  return (
    <div className="relative h-3 w-full bg-[#221d13] rounded-full overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
        style={{ width: `${value}%`, background: `linear-gradient(90deg, ${accent}60, ${color})` }}
      />
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/15" />
    </div>
  );
}

function CurrencyStrengthPanel() {
  const [timeframe, setTimeframe] = useState<"1h" | "4h" | "1d" | "1w">("1d");
  const [view, setView] = useState<"strength" | "pairs" | "heatmap">("strength");
  const [selectedCur, setSelectedCur] = useState<string | null>(null);

  const { data: strengthData, isLoading } = useQuery<CurrencyStrength[]>({
    queryKey: ["/api/currency/strength"],
    refetchInterval: 60000,
  });

  const { data: pairsData } = useQuery<ForexPairDetail[]>({
    queryKey: ["/api/currency/pairs"],
    refetchInterval: 60000,
  });

  const { data: dxyData } = useQuery<DXYData>({
    queryKey: ["/api/currency/dxy"],
    refetchInterval: 120000,
  });

  const getStrength = (c: CurrencyStrength) => {
    if (timeframe === "1h") return c.strength1h;
    if (timeframe === "4h") return c.strength4h;
    if (timeframe === "1w") return c.strength1w;
    return c.strength1d;
  };
  const getRank = (c: CurrencyStrength) => {
    if (timeframe === "1h") return c.rank1h;
    if (timeframe === "4h") return c.rank4h;
    if (timeframe === "1w") return c.rank1w;
    return c.rank1d;
  };

  const sorted = strengthData ? [...strengthData].sort((a, b) => getStrength(b) - getStrength(a)) : [];

  const getPairChange = (p: ForexPairDetail) => {
    if (timeframe === "1h") return p.change1h;
    if (timeframe === "4h") return p.change4h;
    if (timeframe === "1w") return p.change1w;
    return p.change1d;
  };

  const filteredPairs = useMemo(() => {
    if (!pairsData) return [];
    const list = selectedCur ? pairsData.filter(p => p.base === selectedCur || p.quote === selectedCur) : pairsData;
    return [...list].sort((a, b) => Math.abs(getPairChange(b)) - Math.abs(getPairChange(a)));
  }, [pairsData, selectedCur, timeframe]);

  // Simple correlation: for each pair of currencies, find direct pair change
  const corrMatrix = useMemo(() => {
    if (!pairsData) return null;
    const curs = ["USD","EUR","GBP","JPY","CHF","AUD","CAD","NZD"];
    const m: Record<string, Record<string, number>> = {};
    for (const a of curs) {
      m[a] = {};
      for (const b of curs) {
        if (a === b) { m[a][b] = 1; continue; }
        const direct = pairsData.find(p => p.base === a && p.quote === b);
        const inverse = pairsData.find(p => p.base === b && p.quote === a);
        const chg = direct ? direct.change1d : inverse ? -inverse.change1d : 0;
        m[a][b] = parseFloat(Math.max(-1, Math.min(1, chg / 1.5)).toFixed(2));
      }
    }
    return m;
  }, [pairsData]);

  const fmtPx = (n: number, isJPY: boolean) => isJPY ? n.toFixed(3) : n.toFixed(5);
  const fmtChg = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)}%`;

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-[#ffc040]/45 font-mono text-sm">
      <div className="w-7 h-7 border-2 border-[#ffc040]/40 border-t-green-500 rounded-full animate-spin" />
      Loading FX data...
    </div>
  );

  if (!strengthData || strengthData.length === 0) return (
    <div className="flex items-center justify-center h-64 text-[#ffc040]/45 font-mono text-sm">
      Waiting for forex data...
    </div>
  );

  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  return (
    <div className="flex flex-col">

      {/* ── DXY Banner ── */}
      {dxyData && dxyData.value > 0 && (
        <div className="mx-4 mt-3 flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-500/8 border border-blue-500/20">
          <span className="text-blue-400 font-mono font-bold text-xs tracking-widest">DXY</span>
          <span className="text-white font-mono font-bold text-base">{dxyData.value.toFixed(2)}</span>
          <span className={`text-xs font-mono font-bold ${dxyData.change1d >= 0 ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
            {fmtChg(dxyData.change1d)}
          </span>
          <span className="text-[#ffc040]/30 text-[10px] font-mono ml-auto">US Dollar Index · 1D</span>
        </div>
      )}

      {/* ── View + Timeframe controls ── */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2 border-b border-[#ffc040]/10">
        <div className="flex gap-1">
          {(["strength", "pairs", "heatmap"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-colors ${
                view === v ? "bg-green-500 text-black" : "bg-[#221d13] text-[#ffc040]/58 hover:bg-[#2e2719]"
              }`}>
              {v === "strength" ? "Strength" : v === "pairs" ? "28 Pairs" : "Heatmap"}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["1h", "4h", "1d", "1w"] as const).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-colors ${
                timeframe === tf ? "bg-[#181410]/805 text-white" : "bg-white/4 text-[#ffc040]/45 hover:bg-[#2e2719]"
              }`}>
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ══ STRENGTH VIEW ══ */}
      {view === "strength" && (
        <div className="px-4 py-3 space-y-2">

          {/* Top Signal Card */}
          {strongest && weakest && strongest.currency !== weakest.currency && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg bg-[#ffc040]/8 border border-[#ffc040]/28 p-2.5">
                <div className="text-[9px] text-[#ffc040]/50 font-mono uppercase mb-1">Strongest</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{FLAGS[strongest.currency]}</span>
                  <span className="font-mono font-bold text-[#ffc040] text-sm">{strongest.currency}</span>
                </div>
                <div className="font-mono text-[10px] text-[#ffc040]/60 mt-0.5">{sLabel(getStrength(strongest))}</div>
              </div>
              <div className="rounded-lg bg-yellow-500/5 border border-[#ffc040]/28 p-2.5 flex flex-col justify-center">
                <div className="text-[9px] text-[#ffc040]/50 font-mono uppercase mb-1">Top Signal</div>
                <div className="font-mono text-white text-[11px] font-bold">
                  {strongest.currency}/{weakest.currency}
                </div>
                <div className="text-[9px] font-mono text-[#ffc040]/45 mt-0.5">
                  {getStrength(strongest) - getStrength(weakest)} pt spread
                </div>
              </div>
              <div className="rounded-lg bg-[#ff5566]/8 border border-[#ff5566]/28 p-2.5">
                <div className="text-[9px] text-[#ff5566]/50 font-mono uppercase mb-1">Weakest</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{FLAGS[weakest.currency]}</span>
                  <span className="font-mono font-bold text-[#ff5566] text-sm">{weakest.currency}</span>
                </div>
                <div className="font-mono text-[10px] text-[#ff5566]/60 mt-0.5">{sLabel(getStrength(weakest))}</div>
              </div>
            </div>
          )}

          {/* Strength bars for all 8 currencies */}
          {sorted.map(c => {
            const strength = getStrength(c);
            const rank = getRank(c);
            const color = sColor(strength);
            return (
              <div key={c.currency} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base w-6">{FLAGS[c.currency]}</span>
                    <span className="font-mono font-bold text-white text-xs w-8">{c.currency}</span>
                    <span className="text-[#ffc040]/30 font-mono text-[10px]">#{rank}</span>
                    <span className="font-mono text-[10px]" style={{ color }}>{sLabel(strength)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className={`text-[10px] font-mono mr-2 ${c.change1h >= 0 ? "text-[#ffc040]/60" : "text-[#ff5566]/60"}`}>
                        {fmtChg(c.change1h)} 1H
                      </span>
                      <span className={`text-[10px] font-mono ${c.change1d >= 0 ? "text-[#ffc040]/60" : "text-[#ff5566]/60"}`}>
                        {fmtChg(c.change1d)} 1D
                      </span>
                    </div>
                    <span className="font-mono font-bold text-sm w-7 text-right" style={{ color }}>
                      {strength}
                    </span>
                  </div>
                </div>
                <StrengthBar value={strength} currency={c.currency} />
              </div>
            );
          })}

          <div className="text-[#ffc040]/20 font-mono text-[9px] text-center pt-2">
            28 major forex pairs · {pairsData?.length ?? 0} loaded · refreshes every 60s
          </div>
        </div>
      )}

      {/* ══ PAIRS VIEW ══ */}
      {view === "pairs" && (
        <div className="flex flex-col">
          {/* Currency filter pills */}
          <div className="px-4 py-2 flex gap-1.5 flex-wrap border-b border-[#ffc040]/10">
            <button onClick={() => setSelectedCur(null)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                !selectedCur ? "bg-[#181410]/800 text-white" : "bg-[#221d13] text-[#ffc040]/45 hover:bg-[#2e2719]"
              }`}>ALL</button>
            {["USD","EUR","GBP","JPY","CHF","AUD","CAD","NZD"].map(cur => (
              <button key={cur} onClick={() => setSelectedCur(cur === selectedCur ? null : cur)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                  selectedCur === cur ? "text-black" : "bg-[#221d13] text-[#ffc040]/58 hover:bg-[#2e2719]"
                }`}
                style={selectedCur === cur ? { backgroundColor: CUR_COLORS[cur] } : {}}>
                {FLAGS[cur]} {cur}
              </button>
            ))}
          </div>

          {/* Pairs table */}
          <div className="px-2 py-1 overflow-x-auto">
            {!pairsData ? (
              <div className="text-[#ffc040]/45 font-mono text-xs text-center py-8">Loading pairs...</div>
            ) : (
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="text-[#ffc040]/38 text-[9px] uppercase border-b border-[#ffc040]/10">
                    <th className="text-left pl-2 py-2">Pair</th>
                    <th className="text-right py-2">Price</th>
                    <th className="text-right py-2">1H%</th>
                    <th className="text-right py-2">4H%</th>
                    <th className="text-right py-2">1D%</th>
                    <th className="text-right py-2">1W%</th>
                    <th className="text-right pr-2 py-2">Spread</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPairs.map(p => {
                    const isJPY = p.quote === "JPY" || p.base === "JPY";
                    const baseColor = CUR_COLORS[p.base] || "#fff";
                    return (
                      <tr key={p.symbol} className="border-b border-white/3 hover:bg-[#1e1a12] transition-colors">
                        <td className="pl-2 py-2">
                          <div className="flex items-center gap-1">
                            <span style={{ color: baseColor }} className="font-bold">{p.base}</span>
                            <span className="text-[#ffc040]/30">/</span>
                            <span className="text-[#ffc040]/78">{p.quote}</span>
                          </div>
                        </td>
                        <td className="text-right text-white/80">{fmtPx(p.price, isJPY)}</td>
                        <td className={`text-right ${p.change1h >= 0 ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
                          {fmtChg(p.change1h)}
                        </td>
                        <td className={`text-right ${p.change4h >= 0 ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
                          {fmtChg(p.change4h)}
                        </td>
                        <td className={`text-right ${p.change1d >= 0 ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
                          {fmtChg(p.change1d)}
                        </td>
                        <td className={`text-right ${p.change1w >= 0 ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
                          {fmtChg(p.change1w)}
                        </td>
                        <td className={`text-right pr-2 ${
                          p.spread < 1.5 ? "text-[#ffc040]/60" : p.spread < 4 ? "text-[#ffc040]/60" : "text-[#ff5566]/60"
                        }`}>{p.spread.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══ HEATMAP VIEW ══ */}
      {view === "heatmap" && (
        <div className="px-4 py-3">
          <div className="text-[#ffc040]/38 font-mono text-[10px] mb-3">
            Currency correlation matrix · green = positive · red = inverse
          </div>
          {!corrMatrix ? (
            <div className="text-[#ffc040]/45 font-mono text-xs text-center py-8">Loading...</div>
          ) : (() => {
            const curs = ["USD","EUR","GBP","JPY","CHF","AUD","CAD","NZD"];
            return (
              <div>
                <div className="overflow-x-auto">
                  <table className="font-mono border-collapse text-[10px]">
                    <thead>
                      <tr>
                        <th className="w-8 pb-1" />
                        {curs.map(c => (
                          <th key={c} className="text-center font-bold pb-1 px-1 text-[9px]"
                            style={{ color: CUR_COLORS[c] }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {curs.map(row => (
                        <tr key={row}>
                          <td className="font-bold pr-1 text-[9px] text-right py-0.5"
                            style={{ color: CUR_COLORS[row] }}>{row}</td>
                          {curs.map(col => {
                            const val = corrMatrix[row]?.[col] ?? 0;
                            const abs = Math.abs(val);
                            const bg = row === col
                              ? "rgba(255,255,255,0.08)"
                              : val > 0
                                ? `rgba(34,197,94,${abs * 0.65})`
                                : `rgba(239,68,68,${abs * 0.65})`;
                            return (
                              <td key={col} className="text-center px-1 py-0.5 rounded-sm"
                                style={{ backgroundColor: bg, minWidth: "32px" }}>
                                {row === col ? "—" : (val * 100).toFixed(0)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Rank grid below */}
                <div className="mt-5 grid grid-cols-4 gap-2">
                  {sorted.map((c, i) => {
                    const s = getStrength(c);
                    const col = sColor(s);
                    return (
                      <div key={c.currency} className="rounded-lg border p-2 text-center"
                        style={{ borderColor: col + "50" }}>
                        <div className="text-lg">{FLAGS[c.currency]}</div>
                        <div className="font-mono font-bold text-xs text-white">{c.currency}</div>
                        <div className="font-mono text-[10px] font-bold" style={{ color: col }}>
                          #{i+1} · {s}
                        </div>
                        <div className="font-mono text-[9px] text-[#ffc040]/45">{sLabel(s)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── G1 Preview Modal ─────────────────────────────────────────────────────────
function G1Modal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <div className="g1-screen p-4 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2 text-[#ffc040] text-xs font-mono">
            <Glasses className="w-3 h-3" />
            <span>G2 HUD PREVIEW</span>
          </div>
          <button onClick={onClose} className="text-[#ffc040]/60 hover:text-[#ffc040]"><X className="w-3 h-3" /></button>
        </div>
        <pre className="text-[11px] font-mono text-[#ffd060] leading-relaxed whitespace-pre-wrap">{text}</pre>
        <button
          className="mt-3 w-full text-center text-[10px] font-mono text-[#ffc040] border border-[#ffc040]/40 rounded py-1.5 hover:bg-[#ffc040]/10 transition-colors"
          onClick={() => { navigator.clipboard?.writeText(text); }}
        >
          COPY TO CLIPBOARD
        </button>
        <div className="mt-3 border-t border-[#ffc040]/28 pt-3 space-y-1">
          <div className="text-[9px] font-mono text-[#ffc040]/50 uppercase tracking-wider mb-1">G2 Gesture Guide</div>
          <div className="text-[9px] font-mono text-[#ffc040]/60">TAP LEFT &nbsp;&nbsp;&nbsp;= Scroll UP</div>
          <div className="text-[9px] font-mono text-[#ffc040]/60">TAP RIGHT &nbsp;&nbsp;= Scroll DOWN</div>
          <div className="text-[9px] font-mono text-[#ffc040]/60">DBL TAP LEFT = EXIT app</div>
        </div>
      </div>
    </div>
  );
}

// ─── Coin Detail Modal ────────────────────────────────────────────────────────
function CoinModal({ tick, onClose, favSet, toggleFav, onAddPosition }: { tick: Tick; onClose: () => void; favSet?: Set<string>; toggleFav?: (t: Tick) => void; onAddPosition?: (data: { symbol: string; name: string; category: string; entryPrice: number; quantity: number; targetPrice: number | null; stopLoss: number | null; notes: string }) => void }) {
  const [newsFilter, setNewsFilter] = useState<"all" | "bullish" | "bearish" | "neutral">("all");
  const [g1Text, setG1Text] = useState<string | null>(null);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderQty, setOrderQty] = useState("");
  const [orderEntry, setOrderEntry] = useState("");
  const [orderTarget, setOrderTarget] = useState("");
  const [orderStop, setOrderStop] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderSaved, setOrderSaved] = useState(false);
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#060402]/80" onClick={onClose}>
      <div
        className="bg-[#0d0b07] border border-[#ffc040]/20 rounded-t-2xl sm:rounded-xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#0d0b07] border-b border-[#ffc040]/10 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: cc + "22", color: cc }}
            >
              {sym.slice(0, 2)}
            </div>
            <div>
              <div className="text-sm font-bold text-white">{tick.name}</div>
              <div className="text-[10px] text-[#ffc040]/58 font-mono">{sym} · {tick.category.toUpperCase()}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {favSet && toggleFav && (() => {
              const isFav = favSet.has(tick.symbol);
              return (
                <button
                  onClick={() => toggleFav(tick)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all border ${
                    isFav
                      ? "bg-[#ffc040]/16 border-[#ffc040]/40 text-[#ffc040]"
                      : "bg-[#221d13] border-[#ffc040]/20 text-[#ffc040]/58 hover:bg-[#ffc040]/12 hover:border-[#ffc040]/40 hover:text-[#ffc040]"
                  }`}
                >
                  <Star className="w-3 h-3" fill={isFav ? "currentColor" : "none"} />
                  {isFav ? "Saved" : "Watchlist"}
                </button>
              );
            })()}
            {onAddPosition && (
              <button
                onClick={() => { setShowOrderForm(s => !s); if (!orderEntry) setOrderEntry(String(tick.price)); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all border ${
                  showOrderForm
                    ? "bg-[#ffc040]/18 border-[#ffc040]/50 text-[#ffd060]"
                    : "bg-[#221d13] border-[#ffc040]/20 text-[#ffc040]/58 hover:bg-[#ffc040]/10 hover:border-[#ffc040]/40 hover:text-[#ffc040]"
                }`}
              >
                <Target className="w-3 h-3" />
                {showOrderForm ? "Cancel" : "Set Order"}
              </button>
            )}
            <button onClick={onClose} className="text-[#ffc040]/58 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Limit Order Form */}
        {showOrderForm && onAddPosition && (
          <div className="border-b border-[#ffc040]/15 px-5 py-4 bg-[#131009]">
            <div className="text-[10px] font-mono text-[#ffc040] uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Target className="w-3 h-3" /> Set Limit Order — {sym}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[9px] font-mono text-[#ffc040]/52 uppercase mb-1 block">Entry Price *</label>
                <input
                  type="number" step="any"
                  value={orderEntry}
                  onChange={e => setOrderEntry(e.target.value)}
                  placeholder={String(tick.price)}
                  className="w-full bg-[#221d13] border border-[#ffc040]/22 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-green-500/50"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-[#ffc040]/52 uppercase mb-1 block">Quantity *</label>
                <input
                  type="number" step="any"
                  value={orderQty}
                  onChange={e => setOrderQty(e.target.value)}
                  placeholder="0.1"
                  className="w-full bg-[#221d13] border border-[#ffc040]/22 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-green-500/50"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[9px] font-mono text-[#ffc040]/60 uppercase mb-1 block">Take Profit</label>
                <input
                  type="number" step="any"
                  value={orderTarget}
                  onChange={e => setOrderTarget(e.target.value)}
                  placeholder="Target price"
                  className="w-full bg-[#221d13] border border-[#ffc040]/28 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-green-500/50"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono text-[#ff5566]/60 uppercase mb-1 block">Stop Loss</label>
                <input
                  type="number" step="any"
                  value={orderStop}
                  onChange={e => setOrderStop(e.target.value)}
                  placeholder="Stop price"
                  className="w-full bg-[#221d13] border border-[#ff5566]/28 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-[#ff5566]/45"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="text-[9px] font-mono text-[#ffc040]/52 uppercase mb-1 block">Notes</label>
              <input
                value={orderNotes}
                onChange={e => setOrderNotes(e.target.value)}
                placeholder="Reason for trade, strategy..."
                className="w-full bg-[#221d13] border border-[#ffc040]/22 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-green-500/50"
              />
            </div>
            {/* Current price hint */}
            <div className="flex items-center justify-between mb-3 text-[9px] font-mono text-[#ffc040]/38">
              <span>Current live price: <span className="text-[#ffc040]/68">${fmtPrice(tick.price)}</span></span>
              <button
                onClick={() => setOrderEntry(String(tick.price))}
                className="text-[#ffc040]/50 hover:text-[#ffc040] underline transition-colors"
              >
                Use current price
              </button>
            </div>
            <button
              onClick={async () => {
                if (!orderEntry || !orderQty) return;
                await onAddPosition({
                  symbol: sym,
                  name: tick.name,
                  category: tick.category,
                  entryPrice: parseFloat(orderEntry),
                  quantity: parseFloat(orderQty),
                  targetPrice: orderTarget ? parseFloat(orderTarget) : null,
                  stopLoss: orderStop ? parseFloat(orderStop) : null,
                  notes: orderNotes,
                });
                setOrderSaved(true);
                setTimeout(() => { setShowOrderForm(false); setOrderSaved(false); setOrderQty(""); setOrderEntry(""); setOrderTarget(""); setOrderStop(""); setOrderNotes(""); }, 1200);
              }}
              className={`w-full py-2.5 rounded-xl text-xs font-mono font-bold transition-all border ${
                orderSaved
                  ? "bg-[#ffc040]/22 border-green-500/50 text-[#ffd060]"
                  : "bg-[#ffc040]/14 border-[#ffc040]/40 text-[#ffc040] hover:bg-[#ffc040]/22"
              }`}
            >
              {orderSaved ? "✓ Saved to Positions" : `Add to Positions · ${sym}`}
            </button>
          </div>
        )}

        <div className="p-5 space-y-5">
          {/* Price + stats */}
          <div className={`rounded-xl border p-4 ${flash === "up" ? "bg-[#ffc040]/10 border-[#ffc040]/40" : flash === "down" ? "bg-[#ff5566]/10 border-[#ff5566]/38" : "bg-[#181410]/80 border-[#ffc040]/10"} transition-all duration-300`}>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-2xl font-bold text-white">${fmtPrice(tick.price)}</span>
              <span className={`font-mono text-sm font-semibold ${isUp ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
                {isUp ? "▲" : "▼"} {Math.abs(tick.changePercent).toFixed(2)}%
              </span>
              {tick.category === "crypto" || tick.category === "futures" ? (
                <span className="text-[10px] text-[#ffc040]/45 font-mono ml-auto">LIVE · {ago(tick.updatedAt)}</span>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <div className="text-[10px] text-[#ffc040]/45">24H HIGH</div>
                <div className="text-xs font-mono text-[#ffc040]">${fmtPrice(tick.high)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#ffc040]/45">24H LOW</div>
                <div className="text-xs font-mono text-[#ff5566]">${fmtPrice(tick.low)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#ffc040]/45">VOLUME</div>
                <div className="text-xs font-mono text-[#ffc040]/88">{fmtVol(tick.quoteVolume || tick.volume)}</div>
              </div>
            </div>
          </div>

          {/* Sentiment */}
          {sent && (
            <div className="rounded-xl border border-[#ffc040]/10 bg-[#181410]/80 p-4">
              <div className="text-[11px] text-[#ffc040]/58 font-mono uppercase tracking-wider mb-3">Market Sentiment</div>
              <SentimentDonut bull={sent.bullish} bear={sent.bearish} neut={sent.neutral} />
              {/* Buyer/Seller bars */}
              <div className="mt-4 space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] text-[#ffc040]/58 mb-1">
                    <span>BUYERS</span><span className="text-[#ffc040]">{sent.avgBuyerPressure}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#221d13]">
                    <div className="h-full rounded-full bg-green-500 transition-all duration-500" style={{ width: `${sent.avgBuyerPressure}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-[#ffc040]/58 mb-1">
                    <span>SELLERS</span><span className="text-[#ff5566]">{sent.avgSellerPressure}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#221d13]">
                    <div className="h-full rounded-full bg-red-500 transition-all duration-500" style={{ width: `${sent.avgSellerPressure}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* High-impact alerts */}
          {detail?.highImpact && detail.highImpact.length > 0 && (
            <div className="rounded-xl border border-[#ffc040]/28 bg-yellow-500/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-[#ffc040]" />
                <span className="text-[11px] text-[#ffc040] font-mono uppercase tracking-wider">High Impact Alerts</span>
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
              <div className="text-[11px] text-[#ffc040]/58 font-mono uppercase tracking-wider">Deep News Research</div>
              <div className="flex gap-1">
                {(["all","bullish","bearish","neutral"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setNewsFilter(f)}
                    className={`text-[10px] px-2 py-0.5 rounded font-mono border transition-colors ${
                      newsFilter === f ? sentimentBg(f === "all" ? "neutral" : f) : "border-[#ffc040]/20 text-[#ffc040]/45 hover:text-[#ffc040]/78"
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
              <div className="text-center text-[#ffc040]/45 text-xs py-6 font-mono">No news articles found for {sym}</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {filtered.slice(0, 20).map(n => (
                  <div key={n.id} className="rounded-lg border border-[#ffc040]/10 bg-[#181410]/80 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${sentimentBg(n.sentiment)}`}>
                            {n.sentiment.toUpperCase()}
                          </span>
                          {n.impactLevel === "high" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border border-[#ffc040]/38 bg-[#ffc040]/12 text-[#ffc040]">HIGH</span>
                          )}
                          <span className="text-[10px] text-[#ffc040]/58 font-mono">{n.source}</span>
                          <span className="text-[10px] text-[#ffc040]/30">·</span>
                          <span className="text-[10px] text-[#ffc040]/30 font-mono">{ago(n.publishedAt)}</span>
                        </div>
                        <a href={n.url} target="_blank" rel="noreferrer"
                          className="text-xs text-white/80 hover:text-white leading-snug line-clamp-2">
                          {n.title}
                        </a>
                        {n.summary && (
                          <p className="text-[10px] text-[#ffc040]/58 mt-1 line-clamp-2 leading-relaxed">{n.summary}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <a href={n.url} target="_blank" rel="noreferrer"
                          className="text-[#ffc040]/30 hover:text-[#ffc040]/78 transition-colors">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {n.g1Text && (
                          <button
                            className="text-green-500/40 hover:text-[#ffc040] transition-colors"
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
                      <div className="flex-1 h-1 rounded-full bg-[#221d13]">
                        <div className="h-full rounded-full bg-green-500/60" style={{ width: `${n.buyerPressure}%` }} />
                      </div>
                      <span className="text-[9px] text-[#ffc040]/30 font-mono w-8 text-right">B{n.buyerPressure}%</span>
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
            className="w-full text-[#ffc040] border-[#ffc040]/40 hover:bg-[#ffc040]/10 font-mono text-xs"
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

// ─── Favorites hook ─────────────────────────────────────────────────────────
interface FavoriteRecord { id: number; symbol: string; name: string; category: string; addedAt: string; }

// ─── Position Tracker ─────────────────────────────────────────────────────
interface Position {
  id: number;
  symbol: string;
  name: string;
  category: string;
  entryPrice: number;
  quantity: number;
  targetPrice: number | null;
  stopLoss: number | null;
  notes: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
  closePrice: number | null;
}

function usePositions() {
  const { data: positions = [], refetch } = useQuery<Position[]>({
    queryKey: ["/api/positions"],
    refetchInterval: false,
  });

  const add = async (data: Omit<Position, "id" | "status" | "createdAt" | "closedAt" | "closePrice">) => {
    await apiRequest("POST", "/api/positions", data);
    queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
  };

  const update = async (id: number, data: Partial<Position>) => {
    await apiRequest("PATCH", `/api/positions/${id}`, data);
    queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
  };

  const remove = async (id: number) => {
    await apiRequest("DELETE", `/api/positions/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
  };

  return { positions, add, update, remove, refetch };
}

function PositionsTab({ ticks }: { ticks: Map<string, Tick> }) {
  const { positions, add, update, remove } = usePositions();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  // Form state
  const [fSymbol, setFSymbol]   = useState("");
  const [fQty, setFQty]         = useState("");
  const [fEntry, setFEntry]     = useState("");
  const [fTarget, setFTarget]   = useState("");
  const [fStop, setFStop]       = useState("");
  const [fNotes, setFNotes]     = useState("");

  const resetForm = () => {
    setFSymbol(""); setFQty(""); setFEntry(""); setFTarget(""); setFStop(""); setFNotes("");
    setShowForm(false); setEditId(null);
  };

  const startEdit = (p: Position) => {
    setFSymbol(p.symbol); setFQty(String(p.quantity)); setFEntry(String(p.entryPrice));
    setFTarget(p.targetPrice != null ? String(p.targetPrice) : "");
    setFStop(p.stopLoss != null ? String(p.stopLoss) : "");
    setFNotes(p.notes); setEditId(p.id); setShowForm(true);
  };

  // Resolve live price for a position
  const livePrice = (p: Position): number | null => {
    const sym = p.symbol.replace("USDT","");
    const tick =
      ticks.get(`crypto:${sym}`) ??
      ticks.get(`crypto:${p.symbol}`) ??
      ticks.get(`futures:${p.symbol}USDT`) ??
      ticks.get(`stocks:${p.symbol}`) ??
      ticks.get(`oil:${p.symbol}`) ??
      null;
    return tick ? tick.price : null;
  };

  const submitForm = async () => {
    if (!fSymbol || !fEntry || !fQty) return;
    const data = {
      symbol: fSymbol.trim().toUpperCase(),
      name: fSymbol.trim().toUpperCase(),
      category: "crypto",
      entryPrice: parseFloat(fEntry),
      quantity: parseFloat(fQty),
      targetPrice: fTarget ? parseFloat(fTarget) : null,
      stopLoss: fStop ? parseFloat(fStop) : null,
      notes: fNotes,
    };
    if (editId !== null) {
      await update(editId, { targetPrice: data.targetPrice, stopLoss: data.stopLoss, quantity: data.quantity, notes: data.notes });
    } else {
      await add(data);
    }
    resetForm();
  };

  const openPositions = positions.filter(p => p.status === "open");
  const closedPositions = positions.filter(p => p.status === "closed");

  // Portfolio summary
  const summary = openPositions.reduce((acc, p) => {
    const live = livePrice(p);
    const cost = p.entryPrice * p.quantity;
    acc.totalCost += cost;
    if (live !== null) {
      const currentVal = live * p.quantity;
      acc.totalValue += currentVal;
      acc.totalPnl += currentVal - cost;
      acc.resolved++;
    }
    return acc;
  }, { totalCost: 0, totalValue: 0, totalPnl: 0, resolved: 0 });

  const pnlPct = summary.totalCost > 0 ? (summary.totalPnl / summary.totalCost) * 100 : 0;
  const pnlUp = summary.totalPnl >= 0;

  return (
    <div className="p-3 space-y-3">
      {/* Portfolio Summary Bar */}
      {openPositions.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-[#1e1a12] border border-[#ffc040]/15 rounded-xl p-3">
            <div className="text-[9px] font-mono text-[#ffc040]/45 uppercase mb-1">Total Invested</div>
            <div className="text-sm font-bold font-mono text-white">${fmtPrice(summary.totalCost)}</div>
          </div>
          <div className="bg-[#1e1a12] border border-[#ffc040]/15 rounded-xl p-3">
            <div className="text-[9px] font-mono text-[#ffc040]/45 uppercase mb-1">Current Value</div>
            <div className="text-sm font-bold font-mono text-white">${summary.resolved > 0 ? fmtPrice(summary.totalValue) : "—"}</div>
          </div>
          <div className={`border rounded-xl p-3 ${pnlUp ? "bg-[#ffc040]/8 border-[#ffc040]/28" : "bg-[#ff5566]/8 border-[#ff5566]/28"}`}>
            <div className="text-[9px] font-mono text-[#ffc040]/45 uppercase mb-1">Total P&L</div>
            <div className={`text-sm font-bold font-mono ${pnlUp ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
              {summary.resolved > 0 ? `${pnlUp ? "+" : ""}${fmtPrice(summary.totalPnl)} (${pnlPct.toFixed(2)}%)` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Form */}
      {showForm && (
        <div className="bg-[#131009] border border-[#ffc040]/22 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-white">{editId !== null ? "Edit Position" : "New Position"}</span>
            <button onClick={resetForm} className="text-[#ffc040]/45 hover:text-white"><X className="w-4 h-4" /></button>
          </div>

          {/* Symbol + Quantity row */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-mono text-[#ffc040]/58 uppercase mb-1 block">Coin / Symbol *</label>
              <input
                value={fSymbol}
                onChange={e => setFSymbol(e.target.value.toUpperCase())}
                disabled={editId !== null}
                placeholder="BTC, ETH, SOL..."
                className="w-full bg-[#221d13] border border-[#ffc040]/20 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-[#ffc040]/50 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-[#ffc040]/58 uppercase mb-1 block">Quantity *</label>
              <input
                type="number" step="any" value={fQty} onChange={e => setFQty(e.target.value)}
                placeholder="0.5"
                className="w-full bg-[#221d13] border border-[#ffc040]/20 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-[#ffc040]/50"
              />
            </div>
          </div>

          {/* Entry + Target + Stop row */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[9px] font-mono text-[#ffc040]/58 uppercase mb-1 block">Entry Price *</label>
              <input
                type="number" step="any" value={fEntry}
                onChange={e => setFEntry(e.target.value)}
                disabled={editId !== null}
                placeholder="42000"
                className="w-full bg-[#221d13] border border-[#ffc040]/20 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-[#ffc040]/50 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-[#ffc040]/60 uppercase mb-1 block">Take Profit</label>
              <input
                type="number" step="any" value={fTarget} onChange={e => setFTarget(e.target.value)}
                placeholder="50000"
                className="w-full bg-[#221d13] border border-[#ffc040]/22 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-[#ffc040]/50"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-[#ff5566]/60 uppercase mb-1 block">Stop Loss</label>
              <input
                type="number" step="any" value={fStop} onChange={e => setFStop(e.target.value)}
                placeholder="38000"
                className="w-full bg-[#221d13] border border-[#ff5566]/20 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-[#ff5566]/45"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[9px] font-mono text-[#ffc040]/58 uppercase mb-1 block">Notes (optional)</label>
            <input
              value={fNotes} onChange={e => setFNotes(e.target.value)}
              placeholder="Reason for entry, strategy..."
              className="w-full bg-[#221d13] border border-[#ffc040]/20 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-white/20 outline-none focus:border-[#ffc040]/50"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={submitForm}
              className="flex-1 bg-[#ffc040]/14 border border-[#ffc040]/40 text-[#ffc040] font-mono text-xs font-bold py-2 rounded-lg hover:bg-[#ffc040]/22 transition-colors"
            >
              {editId !== null ? "Save Changes" : "Add Position"}
            </button>
            <button onClick={resetForm} className="px-4 text-xs font-mono text-[#ffc040]/58 border border-[#ffc040]/20 rounded-lg hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Open Positions */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-[#ffc040]/58 uppercase tracking-wider">
          Open Positions ({openPositions.length})
        </span>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-[10px] font-mono text-[#ffc040] border border-[#ffc040]/35 px-2.5 py-1 rounded-lg hover:bg-[#ffc040]/10 transition-colors"
          >
            <PlusCircle className="w-3 h-3" />
            Add Position
          </button>
        )}
      </div>

      {openPositions.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-12 text-[#ffc040]/30 text-xs font-mono">
          <Target className="w-10 h-10 mb-3 opacity-20" />
          <div className="text-sm">No open positions</div>
          <div className="text-[10px] mt-1 text-[#ffc040]/20">Track your entries, targets, and stops</div>
        </div>
      ) : (
        <div className="space-y-2">
          {openPositions.map(p => {
            const live = livePrice(p);
            const cost = p.entryPrice * p.quantity;
            const currentVal = live !== null ? live * p.quantity : null;
            const pnl = currentVal !== null ? currentVal - cost : null;
            const pnlPct = pnl !== null ? (pnl / cost) * 100 : null;
            const isUp = pnl !== null ? pnl >= 0 : null;

            // Distance to target / stop
            const toTarget = p.targetPrice && live ? ((p.targetPrice - live) / live) * 100 : null;
            const toStop   = p.stopLoss   && live ? ((live - p.stopLoss)   / live) * 100 : null;

            // Hit detection
            const hitTarget = p.targetPrice && live && live >= p.targetPrice;
            const hitStop   = p.stopLoss   && live && live <= p.stopLoss;

            return (
              <div
                key={p.id}
                className={`relative rounded-xl border p-3 transition-all ${
                  hitTarget ? "border-green-400/50 bg-[#ffc040]/8 ring-1 ring-[#ffc040]/25" :
                  hitStop   ? "border-red-400/50 bg-[#ff5566]/8 ring-1 ring-red-500/20" :
                  "border-[#ffc040]/15 bg-[#181410]/80 hover:border-[#ffc040]/28"
                }`}
              >
                {/* Hit badge */}
                {hitTarget && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 text-[9px] font-mono font-bold text-[#ffc040] bg-[#ffc040]/14 border border-[#ffc040]/40 px-1.5 py-0.5 rounded animate-pulse">
                    <CheckCircle className="w-2.5 h-2.5" /> TARGET HIT
                  </div>
                )}
                {hitStop && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 text-[9px] font-mono font-bold text-[#ff5566] bg-[#ff5566]/14 border border-[#ff5566]/38 px-1.5 py-0.5 rounded animate-pulse">
                    <AlertTriangle className="w-2.5 h-2.5" /> STOP HIT
                  </div>
                )}

                {/* Top row: symbol + live price */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-[#ffc040]/14 flex items-center justify-center text-[9px] font-bold text-[#ffc040]">
                      {p.symbol.slice(0,2)}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">{p.symbol}</div>
                      <div className="text-[9px] font-mono text-[#ffc040]/45">{p.quantity} units · ${fmtPrice(cost)} in</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold font-mono text-white">{live !== null ? `$${fmtPrice(live)}` : "—"}</div>
                    <div className={`text-[9px] font-mono font-bold ${isUp === true ? "text-[#ffc040]" : isUp === false ? "text-[#ff5566]" : "text-[#ffc040]/45"}`}>
                      {pnl !== null ? `${isUp ? "+" : ""}$${fmtPrice(Math.abs(pnl))} (${pnlPct!.toFixed(2)}%)` : "Loading..."}
                    </div>
                  </div>
                </div>

                {/* Price levels bar */}
                {(p.stopLoss || p.targetPrice) && live && (
                  <div className="mb-2">
                    <div className="flex justify-between text-[8px] font-mono text-[#ffc040]/38 mb-0.5">
                      <span className="text-[#ff5566]/70">{p.stopLoss ? `SL $${fmtPrice(p.stopLoss)}` : ""}</span>
                      <span className="text-[#ffc040]/58">ENTRY ${fmtPrice(p.entryPrice)}</span>
                      <span className="text-[#ffc040]/70">{p.targetPrice ? `TP $${fmtPrice(p.targetPrice)}` : ""}</span>
                    </div>
                    {/* Visual range bar */}
                    {p.stopLoss && p.targetPrice && (() => {
                      const lo = Math.min(p.stopLoss, live * 0.95);
                      const hi = Math.max(p.targetPrice, live * 1.05);
                      const range = hi - lo;
                      const entryPct = ((p.entryPrice - lo) / range) * 100;
                      const livePct  = ((live - lo) / range) * 100;
                      const stopPct  = ((p.stopLoss - lo) / range) * 100;
                      const tgtPct   = ((p.targetPrice - lo) / range) * 100;
                      return (
                        <div className="relative h-1.5 bg-[#2a2318] rounded-full">
                          {/* Stop zone */}
                          <div className="absolute top-0 bottom-0 bg-red-500/25 rounded-l-full" style={{ left: 0, width: `${Math.max(stopPct,0)}%` }} />
                          {/* Target zone */}
                          <div className="absolute top-0 bottom-0 bg-[#ffc040]/22 rounded-r-full" style={{ left: `${Math.min(tgtPct,100)}%`, right: 0 }} />
                          {/* Entry marker */}
                          <div className="absolute top-0 bottom-0 w-0.5 bg-white/40 -translate-x-1/2" style={{ left: `${Math.min(Math.max(entryPct,0),100)}%` }} />
                          {/* Live price dot */}
                          <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full ring-1 ring-[#060502] ${isUp ? "bg-green-400" : "bg-red-400"}`}
                            style={{ left: `${Math.min(Math.max(livePct,0),100)}%` }} />
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Distance to target/stop */}
                {(toTarget !== null || toStop !== null) && (
                  <div className="flex gap-3 mb-2">
                    {toTarget !== null && (
                      <span className="text-[8px] font-mono text-[#ffc040]/60">
                        ↑ {Math.abs(toTarget).toFixed(2)}% to TP
                      </span>
                    )}
                    {toStop !== null && (
                      <span className="text-[8px] font-mono text-[#ff5566]/60">
                        ↓ {Math.abs(toStop).toFixed(2)}% to SL
                      </span>
                    )}
                  </div>
                )}

                {/* Notes */}
                {p.notes && (
                  <div className="text-[9px] font-mono text-[#ffc040]/38 italic mb-2 border-l-2 border-[#ffc040]/20 pl-2">{p.notes}</div>
                )}

                {/* Actions */}
                <div className="flex gap-1.5 pt-1 border-t border-[#ffc040]/10">
                  <button
                    onClick={() => startEdit(p)}
                    className="flex items-center gap-1 text-[9px] font-mono text-[#ffc040]/45 hover:text-[#ffc040]/88 px-2 py-1 rounded border border-[#ffc040]/15 hover:border-[#ffc040]/35 transition-colors"
                  >
                    <Edit3 className="w-2.5 h-2.5" /> Edit
                  </button>
                  {live && (
                    <button
                      onClick={() => update(p.id, { closePrice: live })}
                      className="flex items-center gap-1 text-[9px] font-mono text-[#ffc040]/60 hover:text-[#ffc040] px-2 py-1 rounded border border-[#ffc040]/20 hover:border-[#ffc040]/38 transition-colors"
                    >
                      <CheckCircle className="w-2.5 h-2.5" /> Close at ${fmtPrice(live)}
                    </button>
                  )}
                  <button
                    onClick={() => remove(p.id)}
                    className="flex items-center gap-1 text-[9px] font-mono text-[#ff5566]/40 hover:text-[#ff5566] px-2 py-1 rounded border border-[#ff5566]/15 hover:border-[#ff5566]/38 transition-colors ml-auto"
                  >
                    <Trash2 className="w-2.5 h-2.5" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Closed Positions */}
      {closedPositions.length > 0 && (
        <div>
          <button
            onClick={() => setShowClosed(s => !s)}
            className="flex items-center gap-1.5 text-[10px] font-mono text-[#ffc040]/45 hover:text-[#ffc040]/78 transition-colors mb-2"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showClosed ? "rotate-180" : ""}`} />
            Closed Positions ({closedPositions.length})
          </button>
          {showClosed && (
            <div className="space-y-1.5">
              {closedPositions.map(p => {
                const pnl = p.closePrice && p.closePrice > 0 ? (p.closePrice - p.entryPrice) * p.quantity : null;
                const pnlPct = pnl !== null ? (pnl / (p.entryPrice * p.quantity)) * 100 : null;
                const isUp = pnl !== null ? pnl >= 0 : null;
                return (
                  <div key={p.id} className="flex items-center justify-between bg-[#181410]/80 border border-[#ffc040]/10 rounded-lg px-3 py-2 opacity-60">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono text-[#ffc040]/68">{p.symbol}</span>
                      <span className="text-[9px] font-mono text-[#ffc040]/30">Entry ${fmtPrice(p.entryPrice)}</span>
                      <span className="text-[9px] font-mono text-[#ffc040]/30">→ Close ${p.closePrice ? fmtPrice(p.closePrice) : "—"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-mono font-bold ${isUp ? "text-[#ffc040]" : "text-[#ff5566]"}`}>
                        {pnl !== null ? `${isUp ? "+" : ""}$${fmtPrice(Math.abs(pnl))} (${pnlPct!.toFixed(2)}%)` : "—"}
                      </span>
                      <button onClick={() => remove(p.id)} className="text-[#ffc040]/20 hover:text-[#ff5566] transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Breaking News Alert Banner ───────────────────────────────────────────
function useNewsAlert() {
  const [alert, setAlert] = useState<NewsArticle | null>(null);
  const [visible, setVisible] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => setAlert(null), 400); // wait for slide-out
  };

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await apiRequest("GET", "/api/news?limit=10");
        const articles: NewsArticle[] = await r.json();
        // Pick first high-impact article not yet seen
        const fresh = articles.find(
          a => a.impactLevel === "high" && !seenIds.current.has(a.id)
        ) || articles.find(a => !seenIds.current.has(a.id));
        if (fresh) {
          seenIds.current.add(fresh.id);
          setAlert(fresh);
          setVisible(true);
          // Play subtle alert chime
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const playTone = (freq: number, startTime: number, duration: number, vol: number) => {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.type = "sine";
              osc.frequency.setValueAtTime(freq, startTime);
              gain.gain.setValueAtTime(0, startTime);
              gain.gain.linearRampToValueAtTime(vol, startTime + 0.02);
              gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
              osc.start(startTime);
              osc.stop(startTime + duration);
            };
            const t = ctx.currentTime;
            // High-impact = 3-note ascending chime; normal = 2-note soft ping
            const isHigh = fresh.impactLevel === "high";
            if (isHigh) {
              playTone(880, t,        0.18, 0.18);
              playTone(1100, t + 0.14, 0.16, 0.15);
              playTone(1320, t + 0.28, 0.22, 0.20);
            } else {
              playTone(660, t,        0.18, 0.12);
              playTone(880, t + 0.16, 0.22, 0.10);
            }
          } catch { /* AudioContext blocked — silent fallback */ }
          if (dismissTimer.current) clearTimeout(dismissTimer.current);
          dismissTimer.current = setTimeout(dismiss, 8000);
        }
      } catch { /* silent */ }
    };

    // Initial fetch after 3s delay (let dashboard load first)
    const init = setTimeout(poll, 3000);
    // Then poll every 2 minutes
    const interval = setInterval(poll, 2 * 60 * 1000);
    return () => { clearTimeout(init); clearInterval(interval); if (dismissTimer.current) clearTimeout(dismissTimer.current); };
  }, []);

  return { alert, visible, dismiss };
}

function NewsAlertBanner() {
  const { alert, visible, dismiss } = useNewsAlert();
  if (!alert) return null;

  const isHigh = alert.impactLevel === "high";
  const isBull = alert.sentiment === "bullish";
  const isBear = alert.sentiment === "bearish";

  const borderColor = isHigh
    ? "border-orange-500/50"
    : isBull ? "border-[#ffc040]/50"
    : isBear ? "border-[#ff5566]/45"
    : "border-[#ffc040]/28";

  const bgColor = isHigh
    ? "bg-[#0d0b07]"
    : isBull ? "bg-[#0d0b07]"
    : "bg-[#0d0b07]";

  const accentBar = isHigh
    ? "bg-orange-500"
    : isBull ? "bg-green-500"
    : isBear ? "bg-red-500"
    : "bg-[#181410]/800";

  return (
    <div
      className={`fixed right-4 z-[110] w-80 transition-all duration-500 ease-out ${
        visible ? "top-[calc(32px+68px)] opacity-100 translate-y-0" : "top-[calc(32px+40px)] opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <a
        href={alert.url || "#"}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => dismiss()}
        className={`relative rounded-xl border ${borderColor} ${bgColor} shadow-2xl overflow-hidden block cursor-pointer group hover:brightness-110 transition-all`}
      >
        {/* Accent left bar */}
        <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${accentBar}`} />

        {/* Progress bar — 8s timer */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#221d13]">
          <div
            className={`h-full ${accentBar} opacity-60`}
            style={{
              animation: visible ? "shrink-width 8s linear forwards" : "none",
              width: "100%",
            }}
          />
        </div>

        <div className="px-4 pt-3 pb-4">
          {/* Top row */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              {isHigh && <Flame className="w-3 h-3 text-[#ffaa40]" />}
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[#ffc040]/58">
                {isHigh ? "BREAKING" : "MARKET NEWS"} · {alert.source}
              </span>
            </div>
            <button onClick={e => { e.preventDefault(); e.stopPropagation(); dismiss(); }} className="text-[#ffc040]/38 hover:text-[#ffc040]/78 transition-colors ml-2">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Headline */}
          <div className="text-xs font-semibold text-white leading-snug mb-2 pr-1">
            {alert.title}
          </div>

          {/* Bottom row: sentiment + pressure + time */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                isBull ? "text-[#ffc040] border-[#ffc040]/35 bg-[#ffc040]/10"
                : isBear ? "text-[#ff5566] border-[#ff5566]/32 bg-[#ff5566]/10"
                : "text-[#ffc040]/52 border-[#ffc040]/20 bg-[#221d13]"
              }`}>
                {alert.sentiment}
              </span>
              {/* Mini pressure bar */}
              <div className="flex items-center gap-0.5">
                <div className="w-8 h-1 bg-[#2a2318] rounded-full overflow-hidden flex">
                  <div className="h-full bg-green-500/70" style={{ width: `${alert.buyerPressure}%` }} />
                  <div className="h-full bg-red-500/70" style={{ width: `${alert.sellerPressure}%` }} />
                </div>
                <span className="text-[9px] font-mono text-[#ffc040]">{alert.buyerPressure}%</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[#ffc040]/30 group-hover:text-[#ffc040]/60 transition-colors">
              <span className="text-[9px] font-mono">{ago(new Date(alert.publishedAt).getTime())}</span>
              <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </a>
    </div>
  );
}

// ─── NewsItem types ────────────────────────────────────────────────────────
interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number;
  impactLevel: "high" | "medium" | "low";
  buyerPressure: number;
  sellerPressure: number;
  category: string;
  tags: string[];
}

// ─── NewsPanel ─────────────────────────────────────────────────────────────
function NewsPanel({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState<"all" | "bullish" | "bearish" | "high">("all");
  const [inputVal, setInputVal] = useState("");
  const [deepSearch, setDeepSearch] = useState("");

  const params = new URLSearchParams({ limit: "60" });
  if (filter === "bullish") params.set("sentiment", "bullish");
  if (filter === "bearish") params.set("sentiment", "bearish");
  if (filter === "high")    params.set("sentiment", "high_impact");
  if (deepSearch)           params.set("search", deepSearch);

  const { data: articles = [], isLoading, refetch } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", filter, deepSearch],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/news?${params}`);
      return r.json();
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
  });

  const sentColor = (s: string) =>
    s === "bullish" ? "text-[#ffc040]" : s === "bearish" ? "text-[#ff5566]" : "text-[#ffc040]/58";
  const sentBg = (s: string) =>
    s === "bullish" ? "bg-[#ffc040]/10 border-[#ffc040]/28" : s === "bearish" ? "bg-[#ff5566]/10 border-[#ff5566]/28" : "bg-[#1e1a12] border-[#ffc040]/15";

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-[#030201]/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-sm bg-[#060502] border-l border-[#ffc040]/15 flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#ffc040]/15 bg-[#0d0b07]">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#ffc040]" />
            <span className="text-sm font-bold text-white">Market News</span>
            <span className="text-[9px] font-mono text-[#ffc040]/45 bg-[#221d13] px-1.5 py-0.5 rounded">{articles.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => refetch()}
              className="text-[#ffc040]/45 hover:text-[#ffc040]/88 p-1 rounded transition-colors"
              title="Refresh"
            >
              <Clock className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="text-[#ffc040]/45 hover:text-white p-1 rounded transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Deep Search */}
        <div className="px-3 pt-3 pb-2">
          <form
            onSubmit={e => { e.preventDefault(); setDeepSearch(inputVal); }}
            className="flex items-center gap-2"
          >
            <div className="flex-1 flex items-center gap-2 bg-[#221d13] border border-[#ffc040]/15 rounded-lg px-3 py-1.5">
              <Search className="w-3 h-3 text-[#ffc040]/45 flex-shrink-0" />
              <input
                type="text"
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                placeholder="Deep search news..."
                className="bg-transparent text-xs text-white placeholder-white/25 outline-none w-full"
              />
              {inputVal && (
                <button type="button" onClick={() => { setInputVal(""); setDeepSearch(""); }} className="text-[#ffc040]/45 hover:text-[#ffc040]/88">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="bg-[#ffc040]/14 border border-[#ffc040]/35 text-[#ffc040] text-[10px] font-mono px-2.5 py-1.5 rounded-lg hover:bg-[#ffc040]/22 transition-colors"
            >
              GO
            </button>
          </form>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 px-3 pb-3">
          {(["all","bullish","bearish","high"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-all ${
                filter === f
                  ? f === "bullish" ? "bg-[#ffc040]/14 border-[#ffc040]/40 text-[#ffc040]"
                  : f === "bearish" ? "bg-[#ff5566]/14 border-[#ff5566]/38 text-[#ff5566]"
                  : f === "high"    ? "bg-[#ff9020]/15 border-[#ff9020]/35 text-[#ffaa40]"
                  : "bg-[#2e2719] border-[#ffc040]/35 text-white"
                  : "bg-transparent border-[#ffc040]/15 text-[#ffc040]/52 hover:text-[#ffc040]/88 hover:border-[#ffc040]/35"
              }`}
            >
              {f === "all" ? "All" : f === "bullish" ? "🟢 Bull" : f === "bearish" ? "🔴 Bear" : "🔥 Impact"}
            </button>
          ))}
        </div>

        {/* Article List */}
        <div className="flex-1 overflow-y-auto px-3 space-y-2 pb-4">
          {isLoading ? (
            <div className="space-y-2 mt-1">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-20 bg-[#1e1a12] rounded-lg animate-pulse" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#ffc040]/38 text-xs font-mono">
              <Globe className="w-8 h-8 mb-2 opacity-30" />
              No news found
            </div>
          ) : (
            articles.map(article => (
              <a
                key={article.id}
                href={article.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className={`block rounded-lg border p-3 hover:border-[#ffc040]/35 transition-all group ${sentBg(article.sentiment)}`}
              >
                {/* Top row: source + time + sentiment */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-mono text-[#ffc040]/45 uppercase tracking-wider">{article.source}</span>
                  <div className="flex items-center gap-1.5">
                    {article.impactLevel === "high" && (
                      <span title="High Impact"><Flame className="w-3 h-3 text-[#ffaa40]" /></span>
                    )}
                    <span className={`text-[9px] font-mono font-bold uppercase ${sentColor(article.sentiment)}`}>
                      {article.sentiment}
                    </span>
                    <span className="text-[9px] font-mono text-[#ffc040]/30">{ago(new Date(article.publishedAt).getTime())}</span>
                  </div>
                </div>

                {/* Title */}
                <div className="text-xs font-semibold text-white leading-snug mb-1.5 group-hover:text-[#ffd060] transition-colors">
                  {article.title}
                </div>

                {/* Summary */}
                {article.summary && (
                  <div className="text-[10px] text-[#ffc040]/58 leading-snug line-clamp-2 mb-2">
                    {article.summary}
                  </div>
                )}

                {/* Buyer / Seller pressure bars */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex justify-between text-[9px] font-mono mb-0.5">
                      <span className="text-[#ffc040]">BUY {article.buyerPressure}%</span>
                      <span className="text-[#ff5566]">SELL {article.sellerPressure}%</span>
                    </div>
                    <div className="h-1 bg-[#2a2318] rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-green-500/70 rounded-l-full transition-all"
                        style={{ width: `${article.buyerPressure}%` }}
                      />
                      <div
                        className="h-full bg-red-500/70 rounded-r-full transition-all"
                        style={{ width: `${article.sellerPressure}%` }}
                      />
                    </div>
                  </div>
                  <ArrowUpRight className="w-3 h-3 text-[#ffc040]/20 group-hover:text-[#ffc040]/68 transition-colors flex-shrink-0" />
                </div>

                {/* Tags */}
                {article.tags && article.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {article.tags.slice(0, 4).map(tag => (
                      <span key={tag} className="text-[8px] font-mono px-1.5 py-0.5 bg-[#221d13] border border-[#ffc040]/15 text-[#ffc040]/38 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </a>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#ffc040]/15 px-4 py-2 flex items-center justify-between">
          <span className="text-[9px] font-mono text-[#ffc040]/30">Auto-refresh 90s · Deep search powered</span>
          <button
            onClick={() => refetch()}
            className="text-[9px] font-mono text-[#ffc040]/60 hover:text-[#ffc040] transition-colors flex items-center gap-1"
          >
            <Clock className="w-2.5 h-2.5" /> Refresh now
          </button>
        </div>
      </div>
    </div>
  );
}

function useFavorites() {
  const { data: favs = [], refetch } = useQuery<FavoriteRecord[]>({
    queryKey: ["/api/favorites"],
    refetchInterval: false,
  });

  const favSet = useMemo(() => new Set(favs.map(f => f.symbol)), [favs]);

  const toggle = async (tick: Tick) => {
    if (favSet.has(tick.symbol)) {
      await apiRequest("DELETE", `/api/favorites/${encodeURIComponent(tick.symbol)}`);
    } else {
      await apiRequest("POST", "/api/favorites", {
        symbol: tick.symbol,
        name: tick.name,
        category: tick.category,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
  };

  return { favs, favSet, toggle };
}

// ─── Star Button ─────────────────────────────────────────────────────────────
function StarBtn({ tick, favSet, toggle }: { tick: Tick; favSet: Set<string>; toggle: (t: Tick) => void }) {
  const isFav = favSet.has(tick.symbol);
  return (
    <button
      data-testid={`star-${tick.symbol}`}
      onClick={e => { e.stopPropagation(); toggle(tick); }}
      className={`absolute top-1 right-1 p-1 rounded-md transition-all z-10 ${
        isFav
          ? "text-[#ffc040] bg-[#ffc040]/12"
          : "text-[#ffc040]/45 hover:text-[#ffc040] hover:bg-[#ffc040]/12 bg-[#0d0a04]/40"
      }`}
      title={isFav ? "Remove from Watchlist" : "Add to Watchlist"}
    >
      <Star className="w-3 h-3" fill={isFav ? "currentColor" : "none"} />
    </button>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("crypto");
  const [search, setSearch] = useState("");
  const [selectedTick, setSelectedTick] = useState<Tick | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showNews, setShowNews] = useState(false);
  const { ticks, connected } = useLiveTicks();
  const { favs, favSet, toggle: toggleFav } = useFavorites();
  const { add: addPosition } = usePositions();

  // ATR data — refreshes every 4 hours (ATR is a slow-moving indicator)
  const { data: atrData } = useQuery<Record<string, { atr: number; atrPct: number }>>({ 
    queryKey: ["/api/atr"],
    refetchInterval: 4 * 60 * 60 * 1000,
    staleTime: 60 * 60 * 1000,
  });

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

  // Favorite ticks — matched from live tickStore so they get real-time prices
  // Key format in tickStore: crypto:BTC, futures:BTCUSDT, stocks:SPY, oil:CL=F
  const favoriteTicks = useMemo(() => {
    return favs
      .map(f => {
        // Try direct key first, then fallback variations
        return (
          ticks.get(`${f.category}:${f.symbol}`) ??
          ticks.get(`crypto:${f.symbol}`) ??
          ticks.get(`futures:${f.symbol}`) ??
          ticks.get(`stocks:${f.symbol}`) ??
          ticks.get(`oil:${f.symbol}`) ??
          null
        );
      })
      .filter((t): t is Tick => t !== null);
  }, [favs, ticks]);

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
    { id: "favorites", label: "Watchlist", icon: Star,        count: favs.length },
    { id: "crypto",    label: "Crypto",    icon: Bitcoin,     count: Math.min(20, cryptoTicks.length) },
    { id: "futures",   label: "Futures",   icon: BarChart2,   count: futuresTicks.length },
    { id: "stocks",    label: "Stocks",    icon: TrendingUp,  count: stockTicks.length },
    { id: "oil",       label: "Oil",       icon: Fuel,        count: oilTicks.length },
    { id: "currency",  label: "FX",        icon: Activity,    count: 8 },
    { id: "positions", label: "Positions",  icon: Target,      count: 0 },
  ];

  const currentTicks = useMemo(() => {
    const base =
      tab === "favorites" ? favoriteTicks :
      tab === "crypto"    ? cryptoTicks :
      tab === "futures"   ? futuresTicks :
      tab === "stocks"    ? stockTicks : oilTicks;

    // Crypto tab: show only top 20 by volume unless user is searching
    const pool = (tab === "crypto" && !search) ? base.slice(0, 20) : base;
    return filterTicks(pool);
  }, [tab, cryptoTicks, futuresTicks, stockTicks, oilTicks, favoriteTicks, search]);

  // Loading state (waiting for SSE snapshot)
  const isLoading = ticks.size === 0;

  return (
    <div className="min-h-screen text-white" style={{ background: "radial-gradient(ellipse 90% 50% at 0% 0%, rgba(255,192,64,0.06) 0%, transparent 55%), radial-gradient(ellipse 60% 30% at 100% 100%, rgba(255,192,64,0.04) 0%, transparent 50%), #060502", fontFamily: "'Satoshi', sans-serif" }} >
      {/* Ticker tape */}
      <TickerTape allTicks={ticks} />

      {/* Breaking News Alert Banner */}
      <NewsAlertBanner />

      {/* Header */}
      <header className="border-b border-[#ffc040]/30 px-4 py-3 flex items-center justify-between sticky top-8 z-30 bg-[#030201]/98 backdrop-blur-md shadow-[0_1px_0_rgba(255,192,64,0.15)]" style={{ top: "32px" }}>
        <div className="flex items-center gap-3">
          {/* Logo */}
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="Market Intel">
            <rect width="28" height="28" rx="6" fill="rgba(255,192,64,0.18)" />
            <path d="M8 14a6 6 0 1 1 6 6H8v-3h4a3 3 0 1 0-3-3H8v-3z" fill="#ffc040" />
            <rect x="18" y="8" width="2.5" height="12" rx="1.25" fill="#ffc040" />
          </svg>
          <div>
            <div className="text-sm font-bold text-[#fff8e8] leading-none tracking-wide">Market Intel</div>
            <div className="text-[10px] text-[#ffc040]/45 font-mono leading-none mt-0.5">
              {ticks.size.toLocaleString()} ticks live
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection indicator */}
          <div className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border ${
            connected
              ? "border-[#ffc040]/40 bg-[#ffc040]/10 text-[#ffc040]"
              : "border-[#ffc040]/38 bg-[#ffc040]/12 text-[#ffc040]"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-[#ffc040] animate-pulse shadow-[0_0_6px_rgba(255,192,64,0.8)]" : "bg-[#ff5566]"}`} />
            {connected ? "LIVE" : "CONNECTING"}
          </div>

          {/* Search button */}
          <button
            data-testid="open-search"
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 text-xs font-mono border border-[#ffc040]/20 px-3 py-1.5 rounded-lg text-[#ffc040]/68 hover:text-white hover:border-[#ffc040]/50 hover:bg-[#ffc040]/6 transition-all"
          >
            <Search className="w-3 h-3" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline text-[9px] border border-[#ffc040]/20 px-1 rounded text-[#ffc040]/38">⌘K</kbd>
          </button>

          {/* News Bell icon */}
          <button
            data-testid="open-news"
            onClick={() => setShowNews(n => !n)}
            className={`relative flex items-center gap-1.5 text-[10px] font-mono border px-2 py-1 rounded transition-all ${
              showNews
                ? "border-[#ffc040]/50 bg-[#ffc040]/10 text-[#ffc040]"
                : "border-[#ffc040]/20 text-[#ffc040]/58 hover:text-white hover:border-[#ffc040]/35"
            }`}
            title="Market News"
          >
            <Bell className="w-3 h-3" />
            <span className="hidden sm:inline">News</span>
          </button>

          {/* G2 Glasses icon */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono border border-[#ffc040]/20 px-2 py-1 rounded text-[#ffc040]/58">
            <Glasses className="w-3 h-3" />
            G2
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-[#ffc040]/20 sticky z-20 bg-[#040301]" style={{ top: "calc(32px + 57px)" }}>
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => { setTab(t.id); setSearch(""); }}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
                tab === t.id
                  ? "border-green-500 text-[#ffc040]"
                  : "border-transparent text-[#ffc040]/58 hover:text-[#ffc040]/88"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count > 0 && (
                <span className={`text-[9px] font-mono px-1 rounded ${tab === t.id ? "bg-[#ffc040]/18 text-[#ffc040]" : "bg-[#221d13] text-[#ffc040]/45"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Market Sentiment Bar */}
      <MarketSentimentBar ticks={ticks} />

      {/* Search bar */}
      {tab !== "currency" && <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <button
          onClick={() => setShowSearch(true)}
          className="flex items-center gap-2 flex-1 max-w-sm text-left text-xs font-mono border border-[#ffc040]/15 rounded-lg px-3 h-8 bg-[#181410]/80 text-[#ffc040]/38 hover:border-[#ffc040]/40 hover:bg-green-500/4 hover:text-[#ffc040]/68 transition-all"
          data-testid="search-bar-trigger"
        >
          <Search className="w-3 h-3 shrink-0" />
          <span>Search {tab}... any symbol or name</span>
          <kbd className="ml-auto text-[9px] border border-[#ffc040]/20 px-1 rounded text-[#ffc040]/30">⌘K</kbd>
        </button>
        <span className="text-[10px] text-[#ffc040]/30 font-mono shrink-0">
          {tab === 'positions' ? '' : `${currentTicks.length.toLocaleString()} coins`}
        </span>
      </div>}

      {/* Positions Panel */}
      {tab === "positions" && (
        <main className="pb-8">
          <PositionsTab ticks={ticks} />
        </main>
      )}

      {/* Currency Strength Panel */}
      {tab === "currency" && (
        <main className="px-4 pb-8 mt-2">
          <CurrencyStrengthPanel />
        </main>
      )}

      {/* Grid */}
      {tab !== "currency" && tab !== "positions" && <main className="px-4 pb-8">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 mt-2">
            {Array.from({ length: 24 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-lg bg-[#1e1a12]" />
            ))}
          </div>
        ) : currentTicks.length === 0 ? (
          tab === "favorites" ? (
            <div className="text-center py-20">
              <Star className="w-10 h-10 text-white/10 mx-auto mb-4" />
              <div className="text-[#ffc040]/45 text-sm font-mono mb-2">Your watchlist is empty</div>
              <div className="text-[#ffc040]/20 text-xs font-mono">Hover any coin card and click the ★ to add it here</div>
            </div>
          ) : (
            <div className="text-center text-[#ffc040]/45 text-sm py-16 font-mono">
              {search ? `No results for "${search}"` : `Waiting for ${tab} data...`}
            </div>
          )
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 mt-1">
            {currentTicks.map(tick => {
              const cat = tick.category;
              const base = tick.symbol.replace("USDT", "");
              // ATR lookup: try all key formats that the ATR service might use
              const atrKey = atrData
                ? (atrData[`crypto:${base}`]                                          // perp/crypto base
                  ?? atrData[`crypto:${tick.symbol}`]                                 // full USDT symbol
                  ?? atrData[`other:${tick.symbol}`]                                  // display name (WTI, BRENT, SPY...)
                  ?? atrData[`other:${base}`]                                         // base without USDT
                  ?? atrData[`other:${tick.symbol.replace("=F","F")}`]               // legacy =F→F
                  ?? atrData[`forex:${tick.symbol}`]                                  // forex pair
                  ?? null)
                : null;
              const starBtn = <StarBtn tick={tick} favSet={favSet} toggle={toggleFav} />;
              if (cat === "crypto") {
                return <CoinCard key={tick.symbol} tick={tick} onClick={() => setSelectedTick(tick)} atr={atrKey} starBtn={starBtn} />;
              } else if (cat === "futures") {
                return <FuturesCard key={tick.symbol} tick={tick} onClick={() => setSelectedTick(tick)} atr={atrKey} starBtn={starBtn} />;
              } else {
                return <StockCard key={tick.symbol} tick={tick} onClick={() => setSelectedTick(tick)} atr={atrKey} starBtn={starBtn} />;
              }
            })}
          </div>
        )}
      </main>}

      {/* News Panel */}
      {showNews && <NewsPanel onClose={() => setShowNews(false)} />}

      {/* Coin detail modal */}
      {selectedTick && (
        <CoinModal
          tick={selectedTick}
          onClose={() => setSelectedTick(null)}
          favSet={favSet}
          toggleFav={toggleFav}
          onAddPosition={async (data) => { await addPosition(data); }}
        />
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
