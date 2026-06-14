import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "@/pages/Dashboard";
import Landing from "@/pages/Landing";
import Admin from "@/pages/Admin";
import NotFound from "@/pages/not-found";

// ── Auth Guard ────────────────────────────────────────────────────────────────
// Checks session cookie via /api/me on every page load.
// If not authed, hard-redirects to the server login page.
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/me"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/me");
      return r.json() as Promise<{ authed: boolean }>;
    },
    staleTime: 60000,   // re-check every 60s
    retry: false,
  });

  if (isLoading) {
    // Minimal loading state — avoid flash
    return (
      <div style={{
        background: "#05080f", minHeight: "100dvh",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
        <div style={{ color: "#3b8bf6", fontFamily: "monospace", fontSize: 12, letterSpacing: 2 }}>
          AUTHENTICATING...
        </div>
      </div>
    );
  }

  if (!data?.authed) {
    // Not authed — send to server login page
    window.location.href = "/login";
    return null;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGuard>
        <Router hook={useHashLocation}>
          <Switch>
            <Route path="/" component={Landing} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/admin" component={Admin} />
            <Route component={NotFound} />
          </Switch>
        </Router>
      </AuthGuard>
      <Toaster />
    </QueryClientProvider>
  );
}
