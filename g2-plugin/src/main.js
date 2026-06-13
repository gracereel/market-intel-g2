import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Production URL for the Market Intel server
const SERVER_URL = window.MARKET_SERVER_URL
  || 'https://g1-market-intel-6dny4XALTBK4o2tuYJD.PQ.pplx.app';

const SSE_URL    = `${SERVER_URL}/api/live/stream`;
const NEWS_URL   = `${SERVER_URL}/api/news/latest`;

// G2 display canvas is 576×288px — one text container fills it all
const CID_MAIN = 1;

// ─── STATE ─────────────────────────────────────────────────────────────────
let bridge       = null;
let initialized  = false;
let coins        = [];        // array of Tick objects (category==='crypto')
let newsQueue    = [];        // recent headlines from /api/news
let lastNewsId   = null;      // to detect truly NEW headlines
let currentPage  = 'prices'; // 'prices' | 'news' | 'alert'
let alertActive  = false;
let alertTimeout = null;
let scrollIdx    = 0;         // which coin is shown in prices view
let newsScrollIdx = 0;

// ─── DEBUG LOG ─────────────────────────────────────────────────────────────
function log(msg) {
  console.log('[G2]', msg);
  const el = document.getElementById('log');
  if (el) el.innerHTML = `<div>${new Date().toLocaleTimeString()} ${msg}</div>` + el.innerHTML;
}
function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
  log(msg);
}

// ─── FORMAT HELPERS ────────────────────────────────────────────────────────
function pad(s, n)  { s = String(s ?? ''); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function rpad(s, n) { s = String(s ?? ''); return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s; }

function fmtPrice(p) {
  const n = parseFloat(p);
  if (isNaN(n)) return '---';
  if (n >= 10000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1000)  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)     return '$' + n.toFixed(2);
  if (n >= 0.001) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function fmtChange(c) {
  const n = parseFloat(c);
  if (isNaN(n)) return '  --  ';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function sentLabel(s) {
  if (!s) return 'NEUT';
  const u = s.toUpperCase();
  if (u.includes('BULL') || u === 'POSITIVE') return 'BULL';
  if (u.includes('BEAR') || u === 'NEGATIVE') return 'BEAR';
  return 'NEUT';
}

function sentBar(buyers) {
  const pct    = Math.min(100, Math.max(0, parseInt(buyers) || 50));
  const filled = Math.round(pct / 5);
  return '[' + '█'.repeat(filled) + '░'.repeat(20 - filled) + '] ' + pct + '%';
}

function wrap(text, width) {
  // Split text into lines of max `width` chars
  const words = (text || '').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= width) {
      cur = (cur + ' ' + w).trim();
    } else {
      if (cur) lines.push(cur);
      cur = w.slice(0, width);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── RENDER PRICES PAGE ────────────────────────────────────────────────────
async function renderPricesPage() {
  if (!bridge || !initialized || currentPage !== 'prices') return;
  const coin = coins[scrollIdx];
  if (!coin) {
    await pushText('MARKET INTEL\nNo coins loaded yet.\nCheck connection.\n\n' + timestamp());
    return;
  }

  const sent = sentLabel(coin.sentiment);

  // Line 1: symbol padded + price right-aligned
  const symStr  = pad(coin.symbol, 7);
  const priceStr = rpad(fmtPrice(coin.price), 14);
  const chgStr   = rpad(fmtChange(coin.changePercent ?? coin.change), 9);
  const line1 = symStr + ' ' + priceStr + ' ' + chgStr;  // ~32 chars

  // Line 2: sentiment + buyer bar
  const line2 = pad(sent, 5) + ' ' + sentBar(coin.buyerPressure ?? 50);

  // Line 3: nav hint
  const line3 = '[' + (scrollIdx + 1) + '/' + coins.length + '] TAP=NEXT  HOLD=NEWS  DBL=EXIT';

  // Line 4: latest news headline snippet
  const coinHl = newsQueue.find(n =>
    n.tags && Array.isArray(n.tags) && n.tags.some(t => t.toUpperCase() === coin.symbol.toUpperCase())
  ) || newsQueue[0];
  const line4 = truncate(coinHl ? coinHl.title : 'No recent news', 40);

  // Line 5: time + LIVE indicator
  const line5 = 'MARKET INTEL  ' + rpad(timestamp(), 12) + '  LIVE';

  await pushText([line1, line2, line3, line4, line5].join('\n'));
  updateDebugPreview([line1, line2, line3, line4, line5], sent);
}

// ─── RENDER NEWS PAGE ──────────────────────────────────────────────────────
async function renderNewsPage() {
  if (!bridge || !initialized || currentPage !== 'news') return;
  const item = newsQueue[newsScrollIdx];
  if (!item) { currentPage = 'prices'; await renderPricesPage(); return; }

  const sent   = sentLabel(item.sentiment);
  const lines  = wrap(item.title || '', 40);
  const line1  = '── NEWS [' + (newsScrollIdx + 1) + '/' + newsQueue.length + '] ' + pad(sent, 4) + ' ──────────────';
  const line2  = pad(lines[0] || '', 40);
  const line3  = pad(lines[1] || '', 40);
  const src    = truncate(item.source || item.author || '', 16);
  const line4  = pad(src, 18) + '  TAP=NEXT  DBL=BACK';
  const line5  = truncate(item.url || '', 40);

  await pushText([line1, line2, line3, line4, line5].join('\n'));
  updateDebugPreview([line1, line2, line3, line4, line5], sent);
}

// ─── RENDER ALERT ──────────────────────────────────────────────────────────
async function renderAlert(item) {
  if (!bridge || !initialized) return;

  alertActive  = true;
  currentPage  = 'alert';

  const sent   = sentLabel(item.sentiment);
  const impact = sent === 'BULL' ? '▲ BULLISH ALERT' : sent === 'BEAR' ? '▼ BEARISH ALERT' : '◆ MARKET ALERT';
  const lines  = wrap(item.title || '', 40);
  const coin   = (item.tags && item.tags[0]) ? '[' + item.tags[0].toUpperCase() + ']' : '[MARKET]';

  const line1  = '⚡ BREAKING  ' + impact;
  const line2  = pad(lines[0] || '', 40);
  const line3  = pad(lines[1] || '', 40);
  const line4  = pad(coin, 10) + '  TAP=DISMISS';
  const line5  = 'AUTO-DISMISS 10s  ' + timestamp();

  await pushText([line1, line2, line3, line4, line5].join('\n'));
  updateDebugPreview([line1, line2, line3, line4, line5], sent);

  if (alertTimeout) clearTimeout(alertTimeout);
  alertTimeout = setTimeout(async () => {
    alertActive  = false;
    currentPage  = 'prices';
    await renderPricesPage();
  }, 10000);
}

// ─── PUSH TEXT TO G2 ───────────────────────────────────────────────────────
async function pushText(content) {
  try {
    await bridge.textContainerUpgrade({
      containerID:   CID_MAIN,
      containerName: 'main',
      contentOffset: 0,
      contentLength: content.length,
      content,
    });
  } catch (e) {
    log('pushText error: ' + e.message);
  }
}

// ─── DEBUG PREVIEW (browser only) ──────────────────────────────────────────
function updateDebugPreview(lines, sent) {
  const colors = { BULL: '#22c55e', BEAR: '#ef4444', NEUT: '#f59e0b' };
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById('line' + i);
    if (el) {
      el.textContent = lines[i] || '';
      el.style.color = i === 0 ? (colors[sent] || '#22c55e') : '#22c55e';
    }
  }
}

// ─── SSE PARSER ────────────────────────────────────────────────────────────
// Ticks are keyed: "crypto:BTC", "futures:BTCUSDT", "stocks:SPY", "oil:WTI"
function tickToState(tick) {
  return {
    symbol:       tick.symbol,
    name:         tick.name,
    category:     tick.category,
    price:        tick.price,
    change:       tick.change,
    changePercent: tick.changePercent,
    volume:       tick.volume,
    sentiment:    tick.sentiment,
    buyerPressure: tick.buyerPressure,
    updatedAt:    tick.updatedAt,
  };
}

function applySnapshot(ticks) {
  // ticks is an array of Tick objects
  coins = ticks
    .filter(t => t.category === 'crypto')
    .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));
  log('Snapshot: ' + coins.length + ' crypto coins');
  if (currentPage === 'prices') renderPricesPage();
}

function applyBatch(ticksMap) {
  // ticksMap is { "crypto:BTC": Tick, ... }
  let changed = false;
  for (const [key, tick] of Object.entries(ticksMap)) {
    if (!key.startsWith('crypto:')) continue;
    const idx = coins.findIndex(c => c.symbol === tick.symbol);
    if (idx >= 0) {
      Object.assign(coins[idx], tickToState(tick));
      if (idx === scrollIdx) changed = true;
    }
  }
  if (changed && currentPage === 'prices') renderPricesPage();
}

function connectSSE() {
  log('SSE → ' + SSE_URL);
  const es = new EventSource(SSE_URL);
  es.onopen = () => setStatus('Live feed connected');
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'snapshot' && Array.isArray(data.ticks)) {
        applySnapshot(data.ticks);
      } else if (data.type === 'batch' && data.ticks) {
        applyBatch(data.ticks);
      }
    } catch (_) {}
  };
  es.onerror = () => {
    setStatus('Feed disconnected — reconnecting...');
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

// ─── BREAKING NEWS POLL ────────────────────────────────────────────────────
async function pollBreakingNews() {
  try {
    const res = await fetch(NEWS_URL);
    if (!res.ok) return;
    const item = await res.json();
    if (!item) return;

    const id = item.id || item.title;
    if (id && id !== lastNewsId) {
      if (lastNewsId !== null) {
        // This is a genuinely NEW headline — alert the glasses
        log('BREAKING: ' + item.title);
        newsQueue.unshift(item);
        if (newsQueue.length > 20) newsQueue.pop();
        if (!alertActive) await renderAlert(item);
      } else {
        // First load — just store it quietly
        newsQueue.unshift(item);
      }
      lastNewsId = id;
    }
  } catch (e) {
    log('News poll error: ' + e.message);
  }
}

// Also load a batch of news for the news page
async function loadNewsQueue() {
  try {
    const res = await fetch(`${SERVER_URL}/api/news?limit=15`);
    if (!res.ok) return;
    const items = await res.json();
    if (Array.isArray(items) && items.length > 0) {
      newsQueue = items;
      if (!lastNewsId) lastNewsId = items[0]?.id || items[0]?.title;
      log('Loaded ' + items.length + ' news items');
    }
  } catch (e) {
    log('News load error: ' + e.message);
  }
}

// ─── GESTURE HANDLER ───────────────────────────────────────────────────────
async function handleGesture(event) {
  log('Event: ' + JSON.stringify(event).slice(0, 80));

  // LIST: user tapped a coin in a list
  if (event.listEvent) {
    const idx = coins.findIndex(c => c.symbol === event.listEvent.currentSelectItemName);
    if (idx >= 0) { scrollIdx = idx; currentPage = 'prices'; await renderPricesPage(); }
    return;
  }

  if (event.sysEvent) {
    const t = (event.sysEvent.eventType || '').toString().toUpperCase();

    // TAP / SINGLE_TAP → next item or dismiss alert
    if (t.includes('TAP') && !t.includes('DOUBLE') && !t.includes('LONG')) {
      if (currentPage === 'alert') {
        alertActive = false; currentPage = 'prices';
        if (alertTimeout) clearTimeout(alertTimeout);
        await renderPricesPage();
      } else if (currentPage === 'news') {
        newsScrollIdx = (newsScrollIdx + 1) % Math.max(1, newsQueue.length);
        await renderNewsPage();
      } else {
        scrollIdx = (scrollIdx + 1) % Math.max(1, coins.length);
        await renderPricesPage();
      }
      return;
    }

    // DOUBLE TAP → exit or go back
    if (t.includes('DOUBLE') || t.includes('SYSTEM_EXIT')) {
      if (currentPage === 'alert') {
        alertActive = false; currentPage = 'prices';
        if (alertTimeout) clearTimeout(alertTimeout);
        await renderPricesPage();
      } else if (currentPage === 'news') {
        currentPage = 'prices'; await renderPricesPage();
      } else {
        await bridge.shutDownPageContainer(1); // mode 1 = system exit dialog (required by EvenHub review)
      }
      return;
    }

    // LONG PRESS / HOLD → toggle news
    if (t.includes('LONG') || t.includes('HOLD') || t.includes('PRESS')) {
      if (currentPage !== 'news') {
        currentPage = 'news'; newsScrollIdx = 0; await renderNewsPage();
      } else {
        currentPage = 'prices'; await renderPricesPage();
      }
      return;
    }

    // SCROLL UP (ring swipe up) → prev coin
    if (t.includes('SCROLL_UP') || t.includes('SWIPE_UP')) {
      if (currentPage === 'news') {
        newsScrollIdx = (newsScrollIdx - 1 + Math.max(1, newsQueue.length)) % Math.max(1, newsQueue.length);
        await renderNewsPage();
      } else {
        scrollIdx = (scrollIdx - 1 + Math.max(1, coins.length)) % Math.max(1, coins.length);
        await renderPricesPage();
      }
      return;
    }

    // SCROLL DOWN (ring swipe down) → next coin
    if (t.includes('SCROLL_DOWN') || t.includes('SWIPE_DOWN')) {
      if (currentPage === 'news') {
        newsScrollIdx = (newsScrollIdx + 1) % Math.max(1, newsQueue.length);
        await renderNewsPage();
      } else {
        scrollIdx = (scrollIdx + 1) % Math.max(1, coins.length);
        await renderPricesPage();
      }
      return;
    }
  }

  // TEXT EVENT fallback — tap on text container
  if (event.textEvent) {
    if (currentPage === 'prices') {
      scrollIdx = (scrollIdx + 1) % Math.max(1, coins.length);
      await renderPricesPage();
    } else if (currentPage === 'news') {
      newsScrollIdx = (newsScrollIdx + 1) % Math.max(1, newsQueue.length);
      await renderNewsPage();
    }
  }
}

// ─── INIT G2 BRIDGE ────────────────────────────────────────────────────────
async function initBridge() {
  setStatus('Waiting for Even App bridge...');
  try {
    bridge = await waitForEvenAppBridge();
    setStatus('Bridge ready — initializing G2 display...');

    bridge.onDeviceStatusChanged(s => log('Device: ' + s.connectType + ' bat=' + s.batteryLevel));

    // Create single full-screen text container
    const result = await bridge.createStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [{
        containerID:    CID_MAIN,
        containerName:  'main',
        xPosition:      0,
        yPosition:      0,
        width:          576,
        height:         288,
        borderWidth:    0,
        paddingLength:  6,
        content:        'MARKET INTEL\nConnecting to live feed...\n\n\nLoading...',
        isEventCapture: 1,
      }],
    });

    if (result === 0) {
      initialized = true;
      setStatus('G2 display active');
      bridge.onEvenHubEvent(handleGesture);
      if (coins.length > 0) await renderPricesPage();
    } else {
      setStatus('G2 init result: ' + result);
    }
  } catch (e) {
    setStatus('Browser mode (no G2 connected)');
    log('No bridge: ' + e.message);
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
(async () => {
  // 1. Connect SSE for live prices
  connectSSE();

  // 2. Restore previous state (survives phone lock / background)
  restoreState();

  // 3. Load news batch and set baseline headline ID
  await loadNewsQueue();

  // 4. Initialize G2 bridge
  await initBridge();

  // 4. Start polling for breaking news every 20 seconds
  setInterval(pollBreakingNews, 20000);

  // 5. Refresh prices display every 2s (catches SSE updates that don't trigger re-render)
  setInterval(async () => {
    if (!initialized || alertActive || currentPage !== 'prices') return;
    await renderPricesPage();
  }, 2000);

  log('Plugin started. Server: ' + SERVER_URL);
})();

// ─── BACKGROUND / LIFECYCLE SURVIVAL ───────────────────────────────────────
// Even Hub requirement: app must survive phone lock for 5+ minutes.
// Persist state to localStorage eagerly; rebuild on relaunch.
// Note: Even Hub WebView supports localStorage (not blocked like our main app).

function saveState() {
  try {
    localStorage.setItem('mkt_scrollIdx',    String(scrollIdx));
    localStorage.setItem('mkt_newsScrollIdx', String(newsScrollIdx));
    localStorage.setItem('mkt_page',         currentPage === 'alert' ? 'prices' : currentPage);
    localStorage.setItem('mkt_ts',           String(Date.now()));
  } catch (_) {}
}

function restoreState() {
  try {
    const saved = localStorage.getItem('mkt_scrollIdx');
    const savedTs = parseInt(localStorage.getItem('mkt_ts') || '0');
    // Only restore if saved within last 30 minutes (stale state = bad UX)
    if (saved && (Date.now() - savedTs) < 1800000) {
      scrollIdx     = parseInt(saved) || 0;
      newsScrollIdx = parseInt(localStorage.getItem('mkt_newsScrollIdx') || '0');
      currentPage   = localStorage.getItem('mkt_page') || 'prices';
      log('State restored from localStorage (scrollIdx=' + scrollIdx + ')');
      return true;
    }
  } catch (_) {}
  return false;
}

// Save state every 5 seconds and on page change
setInterval(saveState, 5000);

// Visibility API — reinit display if app comes back from background
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    log('App resumed from background');
    saveState();
    if (bridge && initialized) {
      // Re-render current page to ensure glasses display is fresh
      if (currentPage === 'news') await renderNewsPage();
      else await renderPricesPage();
    } else if (!bridge) {
      // Bridge lost — re-init
      await initBridge();
    }
  } else {
    saveState();
  }
});
