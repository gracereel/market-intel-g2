import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  Zap, Bell, Star, Shield,
  ArrowRight, ChevronDown, BarChart2, Activity,
  Target, Newspaper, Smartphone, Monitor
} from "lucide-react";

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      let start = 0;
      const step = to / 60;
      const t = setInterval(() => {
        start = Math.min(start + step, to);
        setVal(Math.floor(start));
        if (start >= to) clearInterval(t);
      }, 16);
    });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to]);
  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}

// ── Ticker tape ───────────────────────────────────────────────────────────────
const TICKERS = [
  { sym: "BTC", price: "$104,231", change: "+2.4%", up: true },
  { sym: "ETH", price: "$3,842",   change: "-1.1%", up: false },
  { sym: "SOL", price: "$178",     change: "+5.8%", up: true },
  { sym: "BNB", price: "$712",     change: "+0.9%", up: true },
  { sym: "XRP", price: "$2.34",    change: "-0.4%", up: false },
  { sym: "DOGE",price: "$0.387",   change: "+12.3%",up: true },
  { sym: "ADA", price: "$0.952",   change: "+3.1%", up: true },
  { sym: "AVAX",price: "$38.74",   change: "-0.8%", up: false },
  { sym: "SPY", price: "$594",     change: "+0.6%", up: true },
  { sym: "NVDA",price: "$137",     change: "+1.9%", up: true },
  { sym: "GC=F",price: "$3,312",   change: "+0.3%", up: true },
  { sym: "WTI", price: "$78.4",    change: "-1.2%", up: false },
];

function TickerTape() {
  const items = [...TICKERS, ...TICKERS];
  return (
    <div className="overflow-hidden border-b border-[#ffc040]/20 bg-[#020100] h-8 flex items-center">
      <div className="flex gap-0 animate-[ticker_40s_linear_infinite] whitespace-nowrap">
        {items.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-2 px-4 border-r border-[#ffc040]/10">
            <span className="text-[10px] font-mono text-[#ffc040]/70 font-bold">{t.sym}</span>
            <span className="text-[10px] font-mono text-[#fff8e8]">{t.price}</span>
            <span className={`text-[10px] font-mono font-bold ${t.up ? "text-[#ffc040]" : "text-[#ff5566]"}`}>{t.change}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({ icon: Icon, title, desc, color }: { icon: any; title: string; desc: string; color: string }) {
  return (
    <div className="group relative rounded-2xl border border-[#ffc040]/15 bg-[#0d0a06] p-6 hover:border-[#ffc040]/40 hover:bg-[#111009] transition-all duration-300 hover:shadow-[0_0_30px_rgba(255,192,64,0.08)]">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: color + "18", border: `1px solid ${color}30` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div className="text-sm font-bold text-[#fff8e8] mb-2">{title}</div>
      <div className="text-xs text-[#ffc040]/55 leading-relaxed">{desc}</div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ value, label, suffix }: { value: number; label: string; suffix?: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-bold text-[#ffc040] font-mono mb-1">
        <Counter to={value} suffix={suffix} />
      </div>
      <div className="text-xs text-[#ffc040]/50 uppercase tracking-widest font-mono">{label}</div>
    </div>
  );
}

// ── Waitlist form ─────────────────────────────────────────────────────────────
function WaitlistForm() {
  const [name, setName]     = useState("");
  const [email, setEmail]   = useState("");
  const [reason, setReason] = useState("");
  const [state, setState]   = useState<"idle" | "loading" | "success" | "exists" | "error">("idle");
  const [msg, setMsg]       = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setState("loading");
    try {
      const r = await apiRequest("POST", "/api/waitlist", { email, name, reason });
      const data = await r.json();
      if (r.status === 409) { setState("exists"); setMsg(data.message); return; }
      if (!r.ok) throw new Error(data.error);
      setState("success"); setMsg(data.message);
    } catch {
      setState("error"); setMsg("Something went wrong. Please try again.");
    }
  };

  if (state === "success") {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-full bg-[#ffc040]/15 border border-[#ffc040]/30 flex items-center justify-center mx-auto mb-4">
          <Star className="w-8 h-8 text-[#ffc040]" fill="currentColor" />
        </div>
        <div className="text-xl font-bold text-[#fff8e8] mb-2">You're on the list</div>
        <div className="text-sm text-[#ffc040]/60">{msg}</div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] font-mono text-[#ffc040]/50 uppercase tracking-widest mb-1.5 block">Your Name</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Grace Reel"
            className="w-full bg-[#0d0a06] border border-[#ffc040]/20 rounded-xl px-4 py-3 text-sm text-[#fff8e8] placeholder-[#ffc040]/25 outline-none focus:border-[#ffc040]/50 focus:shadow-[0_0_15px_rgba(255,192,64,0.08)] transition-all"
          />
        </div>
        <div>
          <label className="text-[9px] font-mono text-[#ffc040]/50 uppercase tracking-widest mb-1.5 block">Email Address *</label>
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-[#0d0a06] border border-[#ffc040]/20 rounded-xl px-4 py-3 text-sm text-[#fff8e8] placeholder-[#ffc040]/25 outline-none focus:border-[#ffc040]/50 focus:shadow-[0_0_15px_rgba(255,192,64,0.08)] transition-all"
          />
        </div>
      </div>
      <div>
        <label className="text-[9px] font-mono text-[#ffc040]/50 uppercase tracking-widest mb-1.5 block">Why do you want access? (optional)</label>
        <input
          value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Crypto trader, portfolio tracking, market research..."
          className="w-full bg-[#0d0a06] border border-[#ffc040]/20 rounded-xl px-4 py-3 text-sm text-[#fff8e8] placeholder-[#ffc040]/25 outline-none focus:border-[#ffc040]/50 focus:shadow-[0_0_15px_rgba(255,192,64,0.08)] transition-all"
        />
      </div>
      {(state === "exists" || state === "error") && (
        <div className={`text-xs font-mono px-3 py-2 rounded-lg border ${state === "exists" ? "text-[#ffc040] border-[#ffc040]/25 bg-[#ffc040]/8" : "text-[#ff5566] border-[#ff5566]/25 bg-[#ff5566]/8"}`}>
          {msg}
        </div>
      )}
      <button
        type="submit" disabled={state === "loading"}
        className="w-full py-4 rounded-xl bg-[#ffc040] text-[#060401] font-bold text-sm tracking-wide hover:bg-[#ffd060] active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-[0_4px_30px_rgba(255,192,64,0.3)]"
      >
        {state === "loading" ? (
          <span className="animate-pulse">Joining...</span>
        ) : (
          <><span>Request Early Access</span><ArrowRight className="w-4 h-4" /></>
        )}
      </button>
      <p className="text-center text-[9px] font-mono text-[#ffc040]/30">No spam. Early access invites sent in order of sign-up.</p>
    </form>
  );
}

// ── Main Landing Page ─────────────────────────────────────────────────────────
export default function Landing() {
  const formRef = useRef<HTMLDivElement>(null);
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="min-h-screen text-white" style={{
      background: "radial-gradient(ellipse 80% 50% at 10% 0%, rgba(255,192,64,0.07) 0%, transparent 55%), radial-gradient(ellipse 60% 30% at 90% 100%, rgba(255,192,64,0.04) 0%, transparent 50%), #060502",
      fontFamily: "'Satoshi', 'Inter', sans-serif"
    }}>

      {/* Ticker tape */}
      <TickerTape />

      {/* Nav */}
      <nav className="border-b border-[#ffc040]/15 px-6 py-4 flex items-center justify-between bg-[#030201]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="rgba(255,192,64,0.18)" />
            <path d="M8 14a6 6 0 1 1 6 6H8v-3h4a3 3 0 1 0-3-3H8v-3z" fill="#ffc040" />
            <rect x="18" y="8" width="2.5" height="12" rx="1.25" fill="#ffc040" />
          </svg>
          <span className="font-bold text-[#fff8e8] tracking-wide">Market Intel G2</span>
        </div>
        <button
          onClick={scrollToForm}
          className="text-xs font-mono font-bold px-4 py-2 rounded-lg bg-[#ffc040]/10 border border-[#ffc040]/30 text-[#ffc040] hover:bg-[#ffc040]/18 transition-all"
        >
          Get Early Access
        </button>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-16 max-w-5xl mx-auto text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#ffc040]/25 bg-[#ffc040]/8 text-[10px] font-mono text-[#ffc040] uppercase tracking-widest mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-[#ffc040] animate-pulse" />
          Live Market Intelligence · Web & Mobile
        </div>

        <h1 className="text-5xl sm:text-6xl font-bold text-[#fff8e8] leading-tight mb-6" style={{ fontFamily: "'Playfair Display', serif", letterSpacing: "-0.02em" }}>
          Your Market Terminal,<br />
          <span style={{ background: "linear-gradient(135deg, #ffc040, #ffd970)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Anywhere You Trade
          </span>
        </h1>

        <p className="text-base text-[#ffc040]/65 max-w-2xl mx-auto leading-relaxed mb-10">
          Real-time crypto, stocks, futures and forex — streamed live with zero delay on web and mobile.
          Deep news search, AI sentiment, position tracking, and breaking sound alerts. Built for serious traders.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={scrollToForm}
            className="px-8 py-4 rounded-xl bg-[#ffc040] text-[#060401] font-bold text-sm tracking-wide hover:bg-[#ffd060] transition-all shadow-[0_4px_40px_rgba(255,192,64,0.35)] flex items-center gap-2"
          >
            Request Early Access <ArrowRight className="w-4 h-4" />
          </button>
          <div className="text-xs font-mono text-[#ffc040]/40">Free during beta · Invite only</div>
        </div>

        {/* Scroll cue */}
        <div className="mt-16 flex justify-center">
          <ChevronDown className="w-5 h-5 text-[#ffc040]/30 animate-bounce" />
        </div>
      </section>

      {/* Dashboard preview mockup */}
      <section className="px-6 pb-20 max-w-5xl mx-auto">
        <div className="rounded-2xl border border-[#ffc040]/20 bg-[#080603] overflow-hidden shadow-[0_0_80px_rgba(255,192,64,0.08)]">
          {/* Mock header */}
          <div className="border-b border-[#ffc040]/15 px-4 py-3 flex items-center justify-between bg-[#040301]">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#ffc040] animate-pulse shadow-[0_0_6px_rgba(255,192,64,0.8)]" />
              <span className="text-[10px] font-mono text-[#ffc040]/60">LIVE · 1,247 ticks streaming</span>
            </div>
            <div className="flex gap-1.5">
              {["Crypto","Futures","Stocks","Oil","FX","Positions"].map(t => (
                <span key={t} className={`text-[9px] font-mono px-2 py-0.5 rounded border ${t === "Crypto" ? "border-[#ffc040]/40 bg-[#ffc040]/10 text-[#ffc040]" : "border-[#ffc040]/10 text-[#ffc040]/30"}`}>{t}</span>
              ))}
            </div>
          </div>
          {/* Mock cards grid */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 p-4">
            {[
              { sym:"BTC", price:"$104,231", chg:"+2.4%", up:true },
              { sym:"ETH", price:"$3,842",   chg:"-1.1%", up:false },
              { sym:"SOL", price:"$178",     chg:"+5.8%", up:true },
              { sym:"BNB", price:"$712",     chg:"+0.9%", up:true },
              { sym:"XRP", price:"$2.34",    chg:"-0.4%", up:false },
              { sym:"DOGE",price:"$0.387",   chg:"+12.3%",up:true },
            ].map(c => (
              <div key={c.sym} className="rounded-lg border border-[#ffc040]/18 bg-[#181410] p-3" style={{ borderLeftWidth: "3px", borderLeftColor: c.up ? "#ffc040" : "#ff5566" }}>
                <div className="text-[9px] font-bold text-[#ffc040]/80 mb-1">{c.sym}</div>
                <div className="text-xs font-bold font-mono text-[#fff8e8] leading-tight">{c.price}</div>
                <div className={`text-[9px] font-mono font-bold mt-1 ${c.up ? "text-[#ffc040]" : "text-[#ff5566]"}`}>{c.chg}</div>
              </div>
            ))}
          </div>
          {/* Mock alert banner */}
          <div className="mx-4 mb-4 rounded-xl border border-[#ffaa40]/40 bg-[#0d0a06] p-3 flex items-center gap-3">
            <Bell className="w-3.5 h-3.5 text-[#ffaa40] shrink-0" />
            <div className="text-[10px] font-mono text-[#fff8e8] flex-1">🔥 <span className="text-[#ffaa40] font-bold">BREAKING</span> · Fed signals rate pause — crypto markets surge on risk-on sentiment</div>
            <span className="text-[8px] font-mono text-[#ffc040]/30 shrink-0">2m ago</span>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="px-6 py-16 border-y border-[#ffc040]/10 bg-[#040301]/60">
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-8">
          <StatCard value={1200} label="Live Ticks" suffix="+" />
          <StatCard value={28}   label="Forex Pairs" />
          <StatCard value={100}  label="Crypto Coins" suffix="+" />
          <StatCard value={90}   label="News Refresh" suffix="s" />
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <div className="text-[10px] font-mono text-[#ffc040]/50 uppercase tracking-widest mb-3">Everything you need</div>
          <h2 className="text-3xl font-bold text-[#fff8e8]" style={{ fontFamily: "'Playfair Display', serif" }}>Built for serious traders</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard icon={Zap}        color="#ffc040" title="Live Streaming Prices"  desc="WebSocket feeds from Binance for crypto and futures. Zero delay. Prices flash on every tick in real time." />
          <FeatureCard icon={Newspaper}  color="#ff9040" title="Deep News Search"       desc="AI-powered market news with sentiment scoring, buyer/seller pressure bars, and high-impact ratings." />
          <FeatureCard icon={Bell}       color="#ffcc60" title="Breaking Sound Alerts"  desc="High-impact news triggers an audio chime and a clickable banner that takes you straight to the article." />
          <FeatureCard icon={Target}     color="#ffc040" title="Position Tracker"       desc="Log entry price, quantity, take profit and stop loss. Track live P&L with animated visual range bars." />
          <FeatureCard icon={Activity}   color="#ff8040" title="Currency Strength (FX)" desc="28 forex pairs across 1H / 4H / 1D / 1W. Strength rankings and DXY index — all live." />
          <FeatureCard icon={Smartphone} color="#ffd060" title="Mobile Ready"           desc="Fully responsive. Open on your phone and get the same live dashboard, news, and alerts on the go." />
          <FeatureCard icon={BarChart2}  color="#ffc040" title="ATR on Every Asset"     desc="ATR-14 on every instrument — crypto, futures, stocks, oil, and all 28 forex pairs." />
          <FeatureCard icon={Star}       color="#ffb030" title="Watchlist & Favorites"  desc="Star any asset across any category. Your watchlist syncs live so your picks are always front and centre." />
          <FeatureCard icon={Monitor}    color="#ffc040" title="Web Dashboard"          desc="A full-screen professional terminal in your browser. No downloads, no installs — just open and trade." />
        </div>
      </section>

      {/* Waitlist form section */}
      <section ref={formRef} className="px-6 py-20 max-w-2xl mx-auto">
        <div className="rounded-2xl border border-[#ffc040]/25 bg-[#0a0804] p-8 sm:p-10 shadow-[0_0_60px_rgba(255,192,64,0.07)]">
          <div className="text-center mb-8">
            <div className="text-[10px] font-mono text-[#ffc040]/50 uppercase tracking-widest mb-3">Limited early access</div>
            <h2 className="text-2xl font-bold text-[#fff8e8] mb-3" style={{ fontFamily: "'Playfair Display', serif" }}>
              Get on the list
            </h2>
            <p className="text-sm text-[#ffc040]/55 leading-relaxed">
              Market Intel is currently invite-only. Join the waitlist and we'll reach out when your spot is ready.
            </p>
          </div>
          <WaitlistForm />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#ffc040]/10 px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="rgba(255,192,64,0.15)" />
            <path d="M8 14a6 6 0 1 1 6 6H8v-3h4a3 3 0 1 0-3-3H8v-3z" fill="#ffc040" />
            <rect x="18" y="8" width="2.5" height="12" rx="1.25" fill="#ffc040" />
          </svg>
          <span className="text-xs font-mono text-[#ffc040]/40">Market Intel · Web & Mobile Trading Terminal</span>
        </div>
        <p className="text-[10px] font-mono text-[#ffc040]/25">© 2026 · Invite-only beta</p>
      </footer>
    </div>
  );
}
