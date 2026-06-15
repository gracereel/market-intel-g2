import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import cookieParser from "cookie-parser";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Password Protection ──────────────────────────────────────────────────────
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_COOKIE = 'market_intel_auth';

// Login page HTML
const loginPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1">
  <title>Market Intel — Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #05080f;
      background-image: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(59,139,246,0.18) 0%, transparent 60%);
      color: #f0f4ff;
      font-family: 'Inter', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 16px;
    }
    .card {
      width: 100%;
      max-width: 380px;
      background: rgba(13,17,32,0.95);
      border: 1px solid rgba(59,139,246,0.25);
      border-radius: 16px;
      padding: 36px 28px 28px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 40px rgba(59,139,246,0.08);
    }
    .logo-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .logo-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(59,139,246,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .logo-icon svg { display: block; }
    .logo-text h1 {
      font-size: 17px;
      font-weight: 700;
      color: #f0f4ff;
      letter-spacing: 0.01em;
      line-height: 1;
    }
    .logo-text p {
      font-size: 11px;
      color: rgba(59,139,246,0.55);
      margin-top: 3px;
      letter-spacing: 0.02em;
    }
    .live-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      background: #00ff88;
      border-radius: 50%;
      margin-right: 5px;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: rgba(59,139,246,0.6);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    input[type="password"] {
      width: 100%;
      background: rgba(59,139,246,0.06);
      border: 1px solid rgba(59,139,246,0.28);
      border-radius: 10px;
      color: #f0f4ff;
      padding: 12px 14px;
      font-size: 15px;
      font-family: 'Inter', sans-serif;
      margin-bottom: 14px;
      outline: none;
      transition: border-color 0.2s;
      -webkit-appearance: none;
    }
    input[type="password"]:focus {
      border-color: rgba(59,139,246,0.7);
      background: rgba(59,139,246,0.09);
    }
    input[type="password"]::placeholder {
      color: rgba(240,244,255,0.22);
    }
    button[type="submit"] {
      width: 100%;
      background: #3b8bf6;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 13px;
      font-size: 14px;
      font-weight: 700;
      font-family: 'Inter', sans-serif;
      cursor: pointer;
      letter-spacing: 0.04em;
      transition: background 0.15s, transform 0.1s;
      -webkit-appearance: none;
    }
    button[type="submit"]:hover { background: #5599f8; }
    button[type="submit"]:active { transform: scale(0.98); }
    .error {
      color: #ff5566;
      font-size: 12px;
      margin-bottom: 12px;
      display: none;
      background: rgba(255,85,102,0.08);
      border: 1px solid rgba(255,85,102,0.25);
      border-radius: 8px;
      padding: 8px 12px;
    }
    .footer {
      margin-top: 20px;
      text-align: center;
      font-size: 11px;
      color: rgba(59,139,246,0.25);
    }
    .home-btn {
      display: block;
      width: 100%;
      margin-top: 10px;
      background: transparent;
      border: 1px solid rgba(59,139,246,0.25);
      border-radius: 10px;
      color: rgba(240,244,255,0.55);
      padding: 11px;
      font-size: 13px;
      font-weight: 600;
      font-family: 'Inter', sans-serif;
      cursor: pointer;
      letter-spacing: 0.02em;
      text-align: center;
      text-decoration: none;
      transition: border-color 0.2s, color 0.2s, background 0.2s;
      -webkit-appearance: none;
    }
    .home-btn:hover {
      border-color: rgba(59,139,246,0.55);
      color: #f0f4ff;
      background: rgba(59,139,246,0.07);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-row">
      <div class="logo-icon">
        <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
          <path d="M8 14a6 6 0 1 1 6 6H8v-3h4a3 3 0 1 0-3-3H8v-3z" fill="#3b8bf6"/>
          <rect x="18" y="8" width="2.5" height="12" rx="1.25" fill="#3b8bf6"/>
        </svg>
      </div>
      <div class="logo-text">
        <h1>Market Intel</h1>
        <p><span class="live-dot"></span>Institutional-grade market data</p>
      </div>
    </div>
    <div class="error" id="err">Incorrect password. Please try again.</div>
    <form method="POST" action="/auth/login">
      <label>Access Password</label>
      <input type="password" name="password" placeholder="Enter your password" autofocus autocomplete="current-password" />
      <button type="submit">Access Dashboard &rarr;</button>
    </form>
    <a href="/" class="home-btn">&larr; Back to Home</a>
    <div class="footer">Secure · Private · Real-time</div>
  </div>
  <script>
    const u = new URLSearchParams(window.location.search);
    if (u.get('error')) document.getElementById('err').style.display = 'block';
  </script>
</body>
</html>`;

// Auth routes — must be before the auth middleware
app.post('/auth/login', (req: Request, res: Response) => {
  const body = req.body || {};
  const password = (body.password || '').trim();
  const expected = (APP_PASSWORD || '').trim();
  console.log('[auth] login attempt, password length:', password.length);
  // Accept master password OR any active invite password
  const isMaster = expected && password === expected;
  const isInvite = !isMaster && storage.checkInvitePassword(password);
  if (isMaster || isInvite) {
    res.cookie(AUTH_COOKIE, 'ok', { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect('/#/dashboard');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/login', (_req: Request, res: Response) => {
  res.send(loginPage);
});

app.get('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie(AUTH_COOKIE);
  res.redirect('/login');
});

// Auth middleware — protects all routes except /login, /auth, /api, root / (landing page), and static assets
app.use((req: Request, res: Response, next: NextFunction) => {
  const isPublic =
    req.path.startsWith('/auth') ||
    req.path.startsWith('/assets') ||
    req.path === '/login' ||
    req.path === '/favicon.ico' ||
    req.path === '/' ||
    req.path === '/index.html';
  if (isPublic) return next();

  const cookie = req.cookies?.[AUTH_COOKIE];
  const authed = cookie === 'ok';

  // API routes: return 401 JSON (not redirect) so frontend can handle it
  if (req.path.startsWith('/api')) {
    // /api/me is the session check — always allow but return authed status
    if (req.path === '/api/me') {
      res.json({ authed });
      return;
    }
    if (!authed) {
      res.status(401).json({ error: 'Unauthorized', redirect: '/login' });
      return;
    }
    return next();
  }

  // All other routes (/, /#/dashboard etc) — redirect to login if not authed
  if (!authed) {
    res.redirect('/login');
    return;
  }
  return next();
});

// ── Global CORS — required for Even Hub G2 WebView and any cross-origin client
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
