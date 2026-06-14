import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Trash2, Plus, Eye, EyeOff, Copy, Check, Shield, Users, Key } from "lucide-react";

// ── Auth gate ─────────────────────────────────────────────────────────────────
function useAdminAuth() {
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  const login = () => {
    setToken(input);
    setError(false);
  };

  const logout = () => {
    setToken("");
    setInput("");
  };

  return { token, input, setInput, login, logout, error, setError };
}

// ── Invite password row ───────────────────────────────────────────────────────
function InviteRow({ inv, token, onDelete }: { inv: any; token: string; onDelete: () => void }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(inv.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const deleteMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/invites/${inv.id}`, undefined, {
      Authorization: `Bearer ${token}`,
    }),
    onSuccess: onDelete,
  });

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#3b8bf6]/15 bg-[#0d1120] hover:border-[#3b8bf6]/30 transition-all group">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-[#f0f4ff] mb-0.5">{inv.label || <span className="text-[#3b8bf6]/30 italic">No label</span>}</div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[#3b8bf6]/60">{show ? inv.password : "•".repeat(Math.min(inv.password.length, 16))}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={() => setShow(s => !s)} className="p-1.5 rounded-lg text-[#3b8bf6]/40 hover:text-[#3b8bf6] hover:bg-[#3b8bf6]/10 transition-all">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <button onClick={copy} className="p-1.5 rounded-lg text-[#3b8bf6]/40 hover:text-[#3b8bf6] hover:bg-[#3b8bf6]/10 transition-all">
          {copied ? <Check className="w-3.5 h-3.5 text-[#3b8bf6]" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => deleteMut.mutate()}
          disabled={deleteMut.isPending}
          className="p-1.5 rounded-lg text-[#ff5566]/40 hover:text-[#ff5566] hover:bg-[#ff5566]/10 transition-all disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="text-[9px] font-mono text-[#3b8bf6]/25 shrink-0 hidden sm:block">{inv.createdAt?.slice(0, 10)}</div>
    </div>
  );
}

// ── Add invite form ───────────────────────────────────────────────────────────
function AddInviteForm({ token, onAdded }: { token: string; onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const addMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/invites", { label, password }, {
      Authorization: `Bearer ${token}`,
    }),
    onSuccess: async (res) => {
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Error"); return; }
      setLabel(""); setPassword(""); setErr("");
      onAdded();
    },
    onError: () => setErr("Something went wrong"),
  });

  const generate = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    setPassword(Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""));
  };

  return (
    <div className="rounded-xl border border-[#3b8bf6]/20 bg-[#080e1c] p-4 space-y-3">
      <div className="text-xs font-bold text-[#f0f4ff] mb-1">Add Invite Password</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-1 block">Label (who is this for?)</label>
          <input
            value={label} onChange={e => setLabel(e.target.value)}
            placeholder="e.g. John Smith"
            className="w-full bg-[#060c18] border border-[#3b8bf6]/20 rounded-lg px-3 py-2.5 text-xs text-[#f0f4ff] placeholder-[#3b8bf6]/20 outline-none focus:border-[#3b8bf6]/40 transition-all"
          />
        </div>
        <div>
          <label className="text-[9px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-1 block">Password *</label>
          <div className="flex gap-2">
            <input
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="min 4 characters"
              className="flex-1 bg-[#060c18] border border-[#3b8bf6]/20 rounded-lg px-3 py-2.5 text-xs text-[#f0f4ff] placeholder-[#3b8bf6]/20 outline-none focus:border-[#3b8bf6]/40 transition-all font-mono"
            />
            <button
              type="button" onClick={generate}
              className="px-3 py-2.5 rounded-lg bg-[#3b8bf6]/10 border border-[#3b8bf6]/20 text-[#3b8bf6] text-[9px] font-mono hover:bg-[#3b8bf6]/20 transition-all whitespace-nowrap"
            >
              Generate
            </button>
          </div>
        </div>
      </div>
      {err && <div className="text-xs font-mono text-[#ff5566] px-3 py-2 rounded-lg bg-[#ff5566]/10 border border-[#ff5566]/20">{err}</div>}
      <button
        onClick={() => addMut.mutate()}
        disabled={addMut.isPending || !password}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#3b8bf6] text-[#050810] font-bold text-xs hover:bg-[#60a5fa] transition-all disabled:opacity-50 shadow-[0_2px_20px_rgba(59,139,246,0.25)]"
      >
        <Plus className="w-3.5 h-3.5" />
        {addMut.isPending ? "Adding..." : "Add Password"}
      </button>
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────
export default function Admin() {
  const auth = useAdminAuth();

  const invitesQ = useQuery<any[]>({
    queryKey: ["/api/invites", auth.token],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/invites", undefined, { Authorization: `Bearer ${auth.token}` });
      if (r.status === 401) { auth.setError(true); return []; }
      return r.json();
    },
    enabled: !!auth.token,
    retry: false,
  });

  const waitlistQ = useQuery<any[]>({
    queryKey: ["/api/waitlist", auth.token],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/waitlist", undefined, { Authorization: `Bearer ${auth.token}` });
      if (r.status === 401) return [];
      return r.json();
    },
    enabled: !!auth.token,
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/invites"] });
  };

  // Login screen
  if (!auth.token || invitesQ.isError || auth.error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#05080f" }}>
        <div className="w-full max-w-sm mx-4">
          <div className="rounded-2xl border border-[#3b8bf6]/20 bg-[#080e1c] p-8">
            <div className="flex items-center gap-2 mb-6">
              <Shield className="w-5 h-5 text-[#3b8bf6]" />
              <span className="font-bold text-[#f0f4ff]">Admin Access</span>
            </div>
            {auth.error && (
              <div className="text-xs font-mono text-[#ff5566] mb-4 px-3 py-2 rounded-lg bg-[#ff5566]/10 border border-[#ff5566]/20">
                Wrong master password
              </div>
            )}
            <label className="text-[9px] font-mono text-[#3b8bf6]/50 uppercase tracking-widest mb-1.5 block">Master Password</label>
            <input
              type="password"
              value={auth.input}
              onChange={e => auth.setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && auth.login()}
              placeholder="Enter master password"
              className="w-full bg-[#060c18] border border-[#3b8bf6]/20 rounded-xl px-4 py-3 text-sm text-[#f0f4ff] placeholder-[#3b8bf6]/20 outline-none focus:border-[#3b8bf6]/40 transition-all mb-4 font-mono"
            />
            <button
              onClick={auth.login}
              className="w-full py-3 rounded-xl bg-[#3b8bf6] text-[#050810] font-bold text-sm hover:bg-[#60a5fa] transition-all shadow-[0_2px_20px_rgba(59,139,246,0.25)]"
            >
              Enter Admin
            </button>
          </div>
        </div>
      </div>
    );
  }

  const invites: any[] = invitesQ.data || [];
  const waitlist: any[] = waitlistQ.data || [];

  return (
    <div className="min-h-screen" style={{ background: "radial-gradient(ellipse 80% 40% at 10% 0%, rgba(59,139,246,0.05) 0%, transparent 55%), #05080f" }}>
      {/* Header */}
      <div className="border-b border-[#3b8bf6]/15 px-6 py-4 flex items-center justify-between bg-[#030609]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <Shield className="w-5 h-5 text-[#3b8bf6]" />
          <span className="font-bold text-[#f0f4ff]">Admin Panel</span>
          <span className="text-[9px] font-mono text-[#3b8bf6]/30 border border-[#3b8bf6]/20 px-2 py-0.5 rounded-full">Market Intel</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-xs font-mono text-[#3b8bf6]/40 hover:text-[#3b8bf6] transition-all">← Landing</a>
          <a href="/dashboard" className="text-xs font-mono text-[#3b8bf6]/40 hover:text-[#3b8bf6] transition-all">Dashboard</a>
          <button onClick={auth.logout} className="text-xs font-mono text-[#ff5566]/60 hover:text-[#ff5566] transition-all">Sign out</button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { icon: Key, label: "Invite Passwords", value: invites.length },
            { icon: Users, label: "Waitlist", value: waitlist.length },
            { icon: Shield, label: "Master Password", value: "Active" },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-xl border border-[#3b8bf6]/15 bg-[#0d1120] p-4 flex items-center gap-3">
              <Icon className="w-4 h-4 text-[#3b8bf6]/60 shrink-0" />
              <div>
                <div className="text-lg font-bold text-[#3b8bf6] font-mono leading-none">{value}</div>
                <div className="text-[9px] font-mono text-[#3b8bf6]/40 uppercase tracking-widest mt-0.5">{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Invite passwords section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-bold text-[#f0f4ff]">Invite Passwords</div>
              <div className="text-[10px] font-mono text-[#3b8bf6]/40 mt-0.5">Each password gives one person access to the dashboard</div>
            </div>
          </div>

          <AddInviteForm token={auth.token} onAdded={refresh} />

          <div className="mt-4 space-y-2">
            {invitesQ.isLoading && (
              <div className="text-xs font-mono text-[#3b8bf6]/40 text-center py-6">Loading...</div>
            )}
            {!invitesQ.isLoading && invites.length === 0 && (
              <div className="text-xs font-mono text-[#3b8bf6]/30 text-center py-8 border border-dashed border-[#3b8bf6]/10 rounded-xl">
                No invite passwords yet. Add one above.
              </div>
            )}
            {invites.map(inv => (
              <InviteRow key={inv.id} inv={inv} token={auth.token} onDelete={refresh} />
            ))}
          </div>
        </div>

        {/* Waitlist section */}
        <div>
          <div className="text-sm font-bold text-[#f0f4ff] mb-1">Waitlist</div>
          <div className="text-[10px] font-mono text-[#3b8bf6]/40 mb-4">People who signed up for early access</div>
          <div className="space-y-2">
            {waitlist.length === 0 && (
              <div className="text-xs font-mono text-[#3b8bf6]/30 text-center py-8 border border-dashed border-[#3b8bf6]/10 rounded-xl">
                No signups yet.
              </div>
            )}
            {waitlist.map((w: any) => (
              <div key={w.id} className="flex items-start gap-3 px-4 py-3 rounded-xl border border-[#3b8bf6]/10 bg-[#0d1120]">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[#f0f4ff]">{w.name || "—"}</div>
                  <div className="text-xs font-mono text-[#3b8bf6]/60">{w.email}</div>
                  {w.reason && <div className="text-[10px] text-[#3b8bf6]/35 mt-1 truncate">{w.reason}</div>}
                </div>
                <div className="text-[9px] font-mono text-[#3b8bf6]/25 shrink-0">{w.joinedAt?.slice(0, 10)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
