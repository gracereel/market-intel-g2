import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import cookieParser from "cookie-parser";

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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Market Intel — Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; color: #22c55e; font-family: 'Courier New', monospace;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .box { border: 1px solid #22c55e; padding: 40px; width: 340px; }
    h1 { font-size: 18px; margin-bottom: 8px; letter-spacing: 2px; }
    p { font-size: 12px; color: #166534; margin-bottom: 28px; }
    input { width: 100%; background: #000; border: 1px solid #22c55e; color: #22c55e;
            padding: 10px 14px; font-family: monospace; font-size: 14px; margin-bottom: 16px; outline: none; }
    button { width: 100%; background: #22c55e; color: #000; border: none; padding: 10px;
             font-family: monospace; font-size: 14px; font-weight: bold; cursor: pointer; letter-spacing: 1px; }
    button:hover { background: #16a34a; }
    .error { color: #ef4444; font-size: 12px; margin-bottom: 12px; display: none; }
  </style>
</head>
<body>
  <div class="box">
    <h1>MARKET INTEL</h1>
    <p>Live crypto & market news for G2</p>
    <div class="error" id="err">Incorrect password. Try again.</div>
    <form method="POST" action="/auth/login">
      <input type="password" name="password" placeholder="Enter password" autofocus />
      <button type="submit">ACCESS &rarr;</button>
    </form>
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
  console.log('[auth] login attempt, password length:', password.length, 'expected length:', expected.length);
  if (expected && password === expected) {
    res.cookie(AUTH_COOKIE, 'ok', { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect('/');
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

// Auth middleware — protects all routes except /login and /auth and /api (for G2 plugin)
app.use((req: Request, res: Response, next: NextFunction) => {
  const isPublic = req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path === '/login';
  if (isPublic) return next();
  const cookie = req.cookies?.[AUTH_COOKIE];
  if (cookie === 'ok') return next();
  res.redirect('/login');
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
