import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  Zap, Bell, Star, Shield,
  ArrowRight, ChevronDown, BarChart2, Activity,
  Target, Newspaper, Smartphone, Monitor,
  TrendingUp, AlertTriangle, BookOpen, Search, ListChecks
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
    <div className="overflow-hidden border-b border-[#3b8bf6]/20 bg-[#020100] h-8 flex items-center">
      <div className="flex gap-0 animate-[ticker_40s_linear_infinite] whitespace-nowrap">
        {items.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-2 px-4 border-r border-[#3b8bf6]/10">
            <span className="text-[10px] font-mono text-[#3b8bf6]/70 font-bold">{t.sym}</span>
            <span className="text-[10px] font-mono text-[#f0f4ff]">{t.price}</span>
            <span className={`text-[10px] font-mono font-bold ${t.up ? "text-[#3b8bf6]" : "text-[#ff5566]"}`}>{t.change}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Feature card ─────────────────────────────────────────────────────────────
function FeatureCard({ icon: Icon, title, desc, color }: { icon: any; title: string; desc: string; color: string }) {
  return (
    <div className="group relative rounded-2xl border border-[#3b8bf6]/15 bg-[#0d1120] p-6 hover:border-[#3b8bf6]/40 hover:bg-[#111009] transition-all duration-300 hover:shadow-[0_0_30px_rgba(59,139,246,0.08)]">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: color + "18", border: `1px solid ${color}30` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div className="text-sm font-bold text-[#f0f4ff] mb-2">{title}</div>
      <div className="text-xs text-[#3b8bf6]/55 leading-relaxed">{desc}</div>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ value, label, suffix }: { value: number; label: string; suffix?: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-bold text-[#3b8bf6] font-mono mb-1">
        <Counter to={value} suffix={suffix} />
      </div>
      <div className="text-xs text-[#3b8bf6]/50 uppercase tracking-widest font-mono">{label}</div>
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
        <div className="w-16 h-16 rounded-full bg-[#3b8bf6]/15 border border-[#3b8bf6]/30 flex items-center justify-center mx-auto mb-4">
          <Star className="w-8 h-8 text-[#3b8bf6]" fill="currentColor" />
        </div>
        <div className="text-xl font-bold text-[#f0f4ff] mb-2">You're on the list</div>
        <div className="text-sm text-[#3b8bf6]/60">{msg}</div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-1.5 block">Your Name</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Your full name"
            className="w-full bg-[#0d1120] border border-[#3b8bf6]/20 rounded-xl px-4 py-3 text-sm text-[#f0f4ff] placeholder-[#3b8bf6]/25 outline-none focus:border-[#3b8bf6]/50 focus:shadow-[0_0_15px_rgba(59,139,246,0.08)] transition-all"
          />
        </div>
        <div>
          <label className="text-[9px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-1.5 block">Email Address *</label>
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-[#0d1120] border border-[#3b8bf6]/20 rounded-xl px-4 py-3 text-sm text-[#f0f4ff] placeholder-[#3b8bf6]/25 outline-none focus:border-[#3b8bf6]/50 focus:shadow-[0_0_15px_rgba(59,139,246,0.08)] transition-all"
          />
        </div>
      </div>
      <div>
        <label className="text-[9px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-1.5 block">Why do you want access? (optional)</label>
        <input
          value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Crypto trader, portfolio tracking, market research..."
          className="w-full bg-[#0d1120] border border-[#3b8bf6]/20 rounded-xl px-4 py-3 text-sm text-[#f0f4ff] placeholder-[#3b8bf6]/25 outline-none focus:border-[#3b8bf6]/50 focus:shadow-[0_0_15px_rgba(59,139,246,0.08)] transition-all"
        />
      </div>
      {(state === "exists" || state === "error") && (
        <div className={`text-xs font-mono px-3 py-2 rounded-lg border ${state === "exists" ? "text-[#3b8bf6] border-[#3b8bf6]/25 bg-[#3b8bf6]/8" : "text-[#ff5566] border-[#ff5566]/25 bg-[#ff5566]/8"}`}>
          {msg}
        </div>
      )}
      <button
        type="submit" disabled={state === "loading"}
        className="w-full py-4 rounded-xl bg-[#3b8bf6] text-[#060401] font-bold text-sm tracking-wide hover:bg-[#60a5fa] active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-[0_4px_30px_rgba(59,139,246,0.3)]"
      >
        {state === "loading" ? (
          <span className="animate-pulse">Joining...</span>
        ) : (
          <><span>Request Early Access</span><ArrowRight className="w-4 h-4" /></>
        )}
      </button>
      <p className="text-center text-[9px] font-mono text-[#3b8bf6]/30">No spam. Early access invites sent in order of sign-up.</p>
    </form>
  );
}

// ── Main Landing Page ─────────────────────────────────────────────────────────
export default function Landing() {
  const formRef = useRef<HTMLDivElement>(null);
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="min-h-screen text-white" style={{
      background: "radial-gradient(ellipse 80% 50% at 10% 0%, rgba(59,139,246,0.07) 0%, transparent 55%), radial-gradient(ellipse 60% 30% at 90% 100%, rgba(59,139,246,0.04) 0%, transparent 50%), #05080f",
      fontFamily: "'Satoshi', 'Inter', sans-serif"
    }}>

      {/* Ticker tape */}
      <TickerTape />

      {/* Nav */}
      <nav className="border-b border-[#3b8bf6]/15 px-6 py-4 flex items-center justify-between bg-[#030201]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="rgba(59,139,246,0.18)" />
            <path d="M8 14a6 6 0 1 1 6 6H8v-3h4a3 3 0 1 0-3-3H8v-3z" fill="#3b8bf6" />
            <rect x="18" y="8" width="2.5" height="12" rx="1.25" fill="#3b8bf6" />
          </svg>
          <span className="font-bold text-[#f0f4ff] tracking-wide">Market Intel G2</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/login"
            className="text-xs font-mono text-[#3b8bf6]/50 hover:text-[#3b8bf6] transition-all"
          >
            Sign In
          </a>
          <button
            onClick={scrollToForm}
            className="text-xs font-mono font-bold px-4 py-2 rounded-lg bg-[#3b8bf6]/10 border border-[#3b8bf6]/30 text-[#3b8bf6] hover:bg-[#3b8bf6]/18 transition-all"
          >
            Get Early Access
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-16 max-w-5xl mx-auto text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#3b8bf6]/25 bg-[#3b8bf6]/8 text-[10px] font-mono text-[#3b8bf6] uppercase tracking-widest mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3b8bf6] animate-pulse" />
          Live Market Intelligence · Web & Mobile
        </div>

        <h1 className="text-5xl sm:text-6xl font-bold text-[#f0f4ff] leading-tight mb-6" style={{ fontFamily: "'Playfair Display', serif", letterSpacing: "-0.02em" }}>
          Your Market Terminal,<br />
          <span style={{ background: "linear-gradient(135deg, #3b8bf6, #ffd970)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Anywhere You Trade
          </span>
        </h1>

        <p className="text-base text-[#3b8bf6]/65 max-w-2xl mx-auto leading-relaxed mb-10">
          Real-time crypto, stocks, futures and forex — streamed live with zero delay on web and mobile.
          Deep news search, AI sentiment, position tracking, and breaking sound alerts. Built for serious traders.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={scrollToForm}
            className="px-8 py-4 rounded-xl bg-[#3b8bf6] text-[#060401] font-bold text-sm tracking-wide hover:bg-[#60a5fa] transition-all shadow-[0_4px_40px_rgba(59,139,246,0.35)] flex items-center gap-2"
          >
            Request Early Access <ArrowRight className="w-4 h-4" />
          </button>
          <div className="text-xs font-mono text-[#3b8bf6]/40">Free during beta · Invite only</div>
        </div>

        {/* Scroll cue */}
        <div className="mt-16 flex justify-center">
          <ChevronDown className="w-5 h-5 text-[#3b8bf6]/30 animate-bounce" />
        </div>
      </section>

      {/* Dashboard preview mockup */}
      <section className="px-6 pb-20 max-w-5xl mx-auto">
        <div className="rounded-2xl border border-[#3b8bf6]/20 bg-[#080603] overflow-hidden shadow-[0_0_80px_rgba(59,139,246,0.08)]">
          {/* Mock header */}
          <div className="border-b border-[#3b8bf6]/15 px-4 py-3 flex items-center justify-between bg-[#040301]">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#3b8bf6] animate-pulse shadow-[0_0_6px_rgba(59,139,246,0.8)]" />
              <span className="text-[10px] font-mono text-[#3b8bf6]/60">LIVE · 1,247 ticks streaming</span>
            </div>
            <div className="flex gap-1.5">
              {["Crypto","Futures","Stocks","Oil","FX","Positions"].map(t => (
                <span key={t} className={`text-[9px] font-mono px-2 py-0.5 rounded border ${t === "Crypto" ? "border-[#3b8bf6]/40 bg-[#3b8bf6]/10 text-[#3b8bf6]" : "border-[#3b8bf6]/10 text-[#3b8bf6]/30"}`}>{t}</span>
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
              <div key={c.sym} className="rounded-lg border border-[#3b8bf6]/18 bg-[#111827] p-3" style={{ borderLeftWidth: "3px", borderLeftColor: c.up ? "#3b8bf6" : "#ff5566" }}>
                <div className="text-[9px] font-bold text-[#3b8bf6]/80 mb-1">{c.sym}</div>
                <div className="text-xs font-bold font-mono text-[#f0f4ff] leading-tight">{c.price}</div>
                <div className={`text-[9px] font-mono font-bold mt-1 ${c.up ? "text-[#3b8bf6]" : "text-[#ff5566]"}`}>{c.chg}</div>
              </div>
            ))}
          </div>
          {/* Mock alert banner */}
          <div className="mx-4 mb-4 rounded-xl border border-[#60a5fa]/40 bg-[#0d1120] p-3 flex items-center gap-3">
            <Bell className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" />
            <div className="text-[10px] font-mono text-[#f0f4ff] flex-1">🔥 <span className="text-[#60a5fa] font-bold">BREAKING</span> · Fed signals rate pause — crypto markets surge on risk-on sentiment</div>
            <span className="text-[8px] font-mono text-[#3b8bf6]/30 shrink-0">2m ago</span>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="px-6 py-16 border-y border-[#3b8bf6]/10 bg-[#040301]/60">
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
          <div className="text-[10px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-3">Everything you need</div>
          <h2 className="text-3xl font-bold text-[#f0f4ff]" style={{ fontFamily: "'Playfair Display', serif" }}>Built for serious traders</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard icon={Zap}        color="#3b8bf6" title="Live Streaming Prices"  desc="WebSocket feeds from Binance for crypto and futures. Zero delay. Prices flash on every tick in real time." />
          <FeatureCard icon={Newspaper}  color="#ff9040" title="Deep News Search"       desc="AI-powered market news with sentiment scoring, buyer/seller pressure bars, and high-impact ratings." />
          <FeatureCard icon={Bell}       color="#ffcc60" title="Breaking Sound Alerts"  desc="High-impact news triggers an audio chime and a clickable banner that takes you straight to the article." />
          <FeatureCard icon={Target}     color="#3b8bf6" title="Position Tracker"       desc="Log entry price, quantity, take profit and stop loss. Track live P&L with animated visual range bars." />
          <FeatureCard icon={Activity}   color="#ff8040" title="Currency Strength (FX)" desc="28 forex pairs across 1H / 4H / 1D / 1W. Strength rankings and DXY index — all live." />
          <FeatureCard icon={Smartphone} color="#60a5fa" title="Mobile Ready"           desc="Fully responsive. Open on your phone and get the same live dashboard, news, and alerts on the go." />
          <FeatureCard icon={BarChart2}  color="#3b8bf6" title="ATR on Every Asset"     desc="ATR-14 on every instrument — crypto, futures, stocks, oil, and all 28 forex pairs." />
          <FeatureCard icon={Star}       color="#3b8bf6" title="Watchlist & Favorites"  desc="Star any asset across any category. Your watchlist syncs live so your picks are always front and centre." />
          <FeatureCard icon={Monitor}    color="#3b8bf6" title="Web Dashboard"          desc="A full-screen professional terminal in your browser. No downloads, no installs — just open and trade." />
        </div>
      </section>

      {/* How to Use It */}
      <section className="px-6 py-20 max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <div className="text-[10px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-3">Your edge</div>
          <h2 className="text-3xl font-bold text-[#f0f4ff] mb-4" style={{ fontFamily: "'Playfair Display', serif" }}>How to Trade With It</h2>
          <p className="text-sm text-[#3b8bf6]/55 max-w-xl mx-auto leading-relaxed">Five signals built into the app — each one gives you a real edge when you know how to read them.</p>
        </div>

        <div className="space-y-4">
          {[
            {
              num: "01",
              icon: Activity,
              color: "#60a5fa",
              title: "Currency Strength (FX)",
              howto: "Check 1H first to see what's moving right now. Cross-reference with 4H and 1D to confirm it's not noise.",
              edge: "Trade the strongest currency against the weakest. If USD is top and JPY is bottom — look at USD/JPY long.",
            },
            {
              num: "02",
              icon: BarChart2,
              color: "#3b8bf6",
              title: "ATR — Know Your Risk",
              howto: "ATR tells you how much that asset moves on average per candle. Find it on any coin, pair, or stock.",
              edge: "Use ATR to set your stop loss. If BTC ATR is $2,000, a $500 stop will get you shaken out every time.",
            },
            {
              num: "03",
              icon: Bell,
              color: "#ff9040",
              title: "Breaking News Alerts",
              howto: "When an alert pops, check the sentiment tag — Bullish or Bearish — and the impact level.",
              edge: "High-impact bullish news on BTC = potential fast long. Act in the first few minutes before the market fully absorbs it.",
            },
            {
              num: "04",
              icon: Target,
              color: "#3b8bf6",
              title: "Position Tracker",
              howto: "Log every trade with entry price, target, and stop loss the moment you enter.",
              edge: "Live P&L updates automatically — no mental math, no spreadsheets. Review closed trades to track your real win rate.",
            },
            {
              num: "05",
              icon: Star,
              color: "#3b8bf6",
              title: "Watchlist",
              howto: "Star your best setups before bed. Open the app in the morning — your picks are front and center.",
              edge: "You stop reacting to random coins and start trading only what you already studied. Discipline by design.",
            },
          ].map(({ num, icon: Icon, color, title, howto, edge }) => (
            <div key={num} className="group rounded-2xl border border-[#3b8bf6]/15 bg-[#0d1120] p-6 hover:border-[#3b8bf6]/35 hover:bg-[#111009] transition-all duration-300 hover:shadow-[0_0_30px_rgba(59,139,246,0.06)]">
              <div className="flex flex-col sm:flex-row gap-6">
                {/* Number + icon */}
                <div className="flex items-start gap-4 shrink-0">
                  <span className="text-3xl font-black font-mono text-[#3b8bf6]/15 leading-none w-10">{num}</span>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: color + "18", border: `1px solid ${color}30` }}>
                    <Icon className="w-5 h-5" style={{ color }} />
                  </div>
                </div>
                {/* Content */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-bold text-[#f0f4ff] mb-2">{title}</div>
                    <div className="text-[10px] font-mono text-[#3b8bf6]/40 uppercase tracking-widest mb-1.5">How to read it</div>
                    <p className="text-xs text-[#3b8bf6]/60 leading-relaxed">{howto}</p>
                  </div>
                  <div className="sm:border-l sm:border-[#3b8bf6]/10 sm:pl-4">
                    <div className="text-[10px] font-mono text-[#3b8bf6]/40 uppercase tracking-widest mb-1.5">Your edge</div>
                    <p className="text-xs text-[#f0f4ff]/80 leading-relaxed">{edge}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Waitlist form section */}
      <section ref={formRef} className="px-6 py-20 max-w-2xl mx-auto">
        <div className="rounded-2xl border border-[#3b8bf6]/25 bg-[#0a0804] p-8 sm:p-10 shadow-[0_0_60px_rgba(59,139,246,0.07)]">
          <div className="text-center mb-8">
            <div className="text-[10px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-3">Limited early access</div>
            <h2 className="text-2xl font-bold text-[#f0f4ff] mb-3" style={{ fontFamily: "'Playfair Display', serif" }}>
              Get on the list
            </h2>
            <p className="text-sm text-[#3b8bf6]/55 leading-relaxed">
              Market Intel is currently invite-only. Join the waitlist and we'll reach out when your spot is ready.
            </p>
          </div>
          <WaitlistForm />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#3b8bf6]/10 px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="rgba(59,139,246,0.15)" />
            <path d="M8 14a6 6 0 1 1 6 6H8v-3h4a3 3 0 1 0-3-3H8v-3z" fill="#3b8bf6" />
            <rect x="18" y="8" width="2.5" height="12" rx="1.25" fill="#3b8bf6" />
          </svg>
          <span className="text-xs font-mono text-[#3b8bf6]/40">Market Intel · Web & Mobile Trading Terminal</span>
        </div>
        <p className="text-[10px] font-mono text-[#3b8bf6]/25">© 2026 · Invite-only beta</p>
      </footer>
    </div>
  );
}
