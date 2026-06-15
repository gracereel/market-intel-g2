import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SERVER_URL = 'https://market-intel-g2-production.up.railway.app';
const SSE_URL    = `${SERVER_URL}/api/live/stream`;
const NEWS_URL   = `${SERVER_URL}/api/news?limit=15`;

const CID = 1; // single full-screen container ID

// ─── STATE ─────────────────────────────────────────────────────────────────
let bridge       = null;
let initialized  = false;
let coins        = [];
let newsQueue    = [];
let lastNewsId   = null;
let currentPage  = 'prices'; // 'prices' | 'news' | 'alert'
let alertActive  = false;
let alertTimeout = null;
let scrollIdx    = 0;
let newsScrollIdx = 0;

// ─── DEBUG (companion browser UI) ──────────────────────────────────────────
function log(msg) {
  console.log('[G2]', msg);
  const el = document.getElementById('log');
  if (el) el.innerHTML = `<div>${new Date().toLocaleTimeString()} ${msg}</div>` + el.innerHTML;
}
function setStatus(msg) {
  console.log('[STATUS]', msg);
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
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
function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '~' : s;
}
function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ─── PUSH TEXT TO G2 ───────────────────────────────────────────────────────
async function pushText(content) {
  if (!bridge || !initialized) return;
  // Cap at 1000 chars (SDK limit for textContainerUpgrade is 2000 but keep safe)
  const safe = content.slice(0, 900);
  try {
    await bridge.textContainerUpgrade({
      containerID:   CID,
      containerName: 'main',
      contentOffset: 0,
      contentLength: safe.length,
      content:       safe,
    });
  } catch (e) {
    log('pushText err: ' + e.message);
  }
}

// ─── RENDER PRICES ─────────────────────────────────────────────────────────
async function renderPrices() {
  if (!bridge || !initialized || currentPage !== 'prices') return;
  const coin = coins[scrollIdx];
  if (!coin) {
    await pushText('MARKET INTEL\nConnecting...\n\n' + timestamp());
    return;
  }
  const arrow = parseFloat(coin.changePercent) >= 0 ? 'UP' : 'DN';
  const l1 = pad(coin.symbol, 6) + ' ' + rpad(fmtPrice(coin.price), 12) + ' ' + arrow + ' ' + fmtChange(coin.changePercent);
  const l2 = 'Hi:' + fmtPrice(coin.high) + '  Lo:' + fmtPrice(coin.low);
  const l3 = 'Vol:' + rpad(String(Math.round(coin.volume || 0)), 10);
  const hl  = newsQueue.find(n => n.tags?.some(t => t.toUpperCase() === coin.symbol.toUpperCase()));
  const l4  = truncate(hl ? hl.title : 'No news', 40);
  const l5  = '[' + (scrollIdx+1) + '/' + coins.length + '] TAP=NEXT HOLD=NEWS DBL=EXIT';
  const l6  = 'MARKET INTEL  ' + timestamp() + '  LIVE';
  await pushText([l1,l2,l3,l4,l5,l6].join('\n'));
}

// ─── RENDER NEWS ───────────────────────────────────────────────────────────
async function renderNews() {
  if (!bridge || !initialized || currentPage !== 'news') return;
  const item = newsQueue[newsScrollIdx];
  if (!item) { currentPage = 'prices'; await renderPrices(); return; }
  const sent  = (item.sentiment || 'neutral').toUpperCase().slice(0, 4);
  const title = item.title || '';
  const l1 = '--NEWS [' + (newsScrollIdx+1) + '/' + newsQueue.length + '] ' + sent + '--';
  const l2 = truncate(title, 40);
  const l3 = title.length > 40 ? truncate(title.slice(40), 40) : '';
  const l4 = truncate(item.source || '', 20) + '  TAP=NEXT';
  const l5 = 'DBL=BACK TO PRICES';
  const l6 = 'MARKET INTEL  ' + timestamp();
  await pushText([l1,l2,l3,l4,l5,l6].join('\n'));
}

// ─── RENDER ALERT ──────────────────────────────────────────────────────────
async function renderAlert(item) {
  if (!bridge || !initialized) return;
  alertActive = true;
  currentPage = 'alert';
  const sent  = (item.sentiment || 'neutral').toUpperCase();
  const arrow = sent.includes('BULL') ? 'UP' : sent.includes('BEAR') ? 'DN' : '--';
  const l1 = '!! BREAKING ' + arrow + ' ' + sent + ' ALERT !!';
  const l2 = truncate(item.title || '', 40);
  const l3 = item.title && item.title.length > 40 ? truncate(item.title.slice(40), 40) : '';
  const coin = item.tags?.[0] ? '[' + item.tags[0].toUpperCase() + ']' : '[MARKET]';
  const l4 = coin + '  TAP=DISMISS';
  const l5 = 'AUTO 10s  ' + timestamp();
  const l6 = 'MARKET INTEL LIVE';
  await pushText([l1,l2,l3,l4,l5,l6].join('\n'));
  if (alertTimeout) clearTimeout(alertTimeout);
  alertTimeout = setTimeout(async () => {
    alertActive = false;
    currentPage = 'prices';
    await renderPrices();
  }, 10000);
}

// ─── SSE LIVE FEED ─────────────────────────────────────────────────────────
function connectSSE() {
  log('Connecting SSE...');
  const es = new EventSource(SSE_URL);
  es.onopen = () => { log('SSE connected'); setStatus('Live'); };
  es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'snapshot' && Array.isArray(d.ticks)) {
        coins = d.ticks
          .filter(t => t.category === 'crypto' || t.category === 'futures')
          .sort((a,b) => (b.quoteVolume||0) - (a.quoteVolume||0));
        log('Snapshot: ' + coins.length + ' ticks');
        if (initialized && currentPage === 'prices') renderPrices();
      } else if (d.type === 'batch' && d.ticks) {
        for (const [key, tick] of Object.entries(d.ticks)) {
          const idx = coins.findIndex(c => c.symbol === tick.symbol);
          if (idx >= 0) Object.assign(coins[idx], tick);
        }
        if (initialized && currentPage === 'prices') renderPrices();
      }
    } catch (_) {}
  };
  es.onerror = () => {
    setStatus('Reconnecting...');
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

// ─── NEWS POLL ─────────────────────────────────────────────────────────────
async function loadNews() {
  try {
    const res = await fetch(NEWS_URL);
    if (!res.ok) return;
    const items = await res.json();
    if (Array.isArray(items) && items.length) {
      newsQueue = items;
      lastNewsId = items[0]?.id || items[0]?.title;
      log('News loaded: ' + items.length);
    }
  } catch (e) { log('News err: ' + e.message); }
}

async function pollBreakingNews() {
  try {
    const res = await fetch(SERVER_URL + '/api/news/latest');
    if (!res.ok) return;
    const item = await res.json();
    if (!item) return;
    const id = item.id || item.title;
    if (id && id !== lastNewsId) {
      if (lastNewsId !== null) {
        newsQueue.unshift(item);
        if (newsQueue.length > 20) newsQueue.pop();
        if (!alertActive) await renderAlert(item);
      } else {
        newsQueue.unshift(item);
      }
      lastNewsId = id;
    }
  } catch (_) {}
}

// ─── EVENT HANDLER ─────────────────────────────────────────────────────────
// Per SDK: eventType is a Protobuf NUMBER. CLICK_EVENT=0 arrives as undefined → coalesce ?? 0
// Glasses tap → sysEvent. R1 ring scroll → textEvent.
async function handleEvent(event) {
  log('Evt: ' + JSON.stringify(event).slice(0, 100));

  if (event.sysEvent) {
    const t = event.sysEvent.eventType ?? 0;

    // Single tap → next / dismiss
    if (t === OsEventTypeList.CLICK_EVENT || t === OsEventTypeList.SINGLE_CLICK_EVENT) {
      if (currentPage === 'alert') {
        alertActive = false; currentPage = 'prices';
        clearTimeout(alertTimeout); await renderPrices();
      } else if (currentPage === 'news') {
        newsScrollIdx = (newsScrollIdx + 1) % Math.max(1, newsQueue.length);
        await renderNews();
      } else {
        scrollIdx = (scrollIdx + 1) % Math.max(1, coins.length);
        await renderPrices();
      }
      return;
    }

    // Double tap → exit / back
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      if (currentPage === 'alert') {
        alertActive = false; currentPage = 'prices';
        clearTimeout(alertTimeout); await renderPrices();
      } else if (currentPage === 'news') {
        currentPage = 'prices'; await renderPrices();
      } else {
        await bridge.shutDownPageContainer(1);
      }
      return;
    }

    // Long press → toggle news
    if (t === OsEventTypeList.LONG_PRESS_EVENT) {
      if (currentPage !== 'news') {
        currentPage = 'news'; newsScrollIdx = 0; await renderNews();
      } else {
        currentPage = 'prices'; await renderPrices();
      }
      return;
    }

    if (t === OsEventTypeList.SYSTEM_EXIT_EVENT || t === OsEventTypeList.ABNORMAL_EXIT_EVENT) return;
  }

  if (event.textEvent) {
    const t = event.textEvent.eventType ?? 0;

    // R1 ring swipe up → prev
    if (t === OsEventTypeList.SCROLL_UP_EVENT || t === OsEventTypeList.SWIPE_UP_EVENT) {
      if (currentPage === 'news') {
        newsScrollIdx = (newsScrollIdx - 1 + Math.max(1, newsQueue.length)) % Math.max(1, newsQueue.length);
        await renderNews();
      } else {
        scrollIdx = (scrollIdx - 1 + Math.max(1, coins.length)) % Math.max(1, coins.length);
        await renderPrices();
      }
      return;
    }

    // R1 ring swipe down → next
    if (t === OsEventTypeList.SCROLL_DOWN_EVENT || t === OsEventTypeList.SWIPE_DOWN_EVENT) {
      if (currentPage === 'news') {
        newsScrollIdx = (newsScrollIdx + 1) % Math.max(1, newsQueue.length);
        await renderNews();
      } else {
        scrollIdx = (scrollIdx + 1) % Math.max(1, coins.length);
        await renderPrices();
      }
      return;
    }

    // Tap on text container
    if (t === OsEventTypeList.CLICK_EVENT || t === OsEventTypeList.SINGLE_CLICK_EVENT) {
      if (currentPage === 'alert') {
        alertActive = false; currentPage = 'prices';
        clearTimeout(alertTimeout); await renderPrices();
      } else if (currentPage === 'news') {
        newsScrollIdx = (newsScrollIdx + 1) % Math.max(1, newsQueue.length);
        await renderNews();
      } else {
        scrollIdx = (scrollIdx + 1) % Math.max(1, coins.length);
        await renderPrices();
      }
      return;
    }

    // Double tap via text event
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      if (currentPage === 'news') {
        currentPage = 'prices'; await renderPrices();
      } else {
        await bridge.shutDownPageContainer(1);
      }
      return;
    }
  }

  // List item tap
  if (event.listEvent) {
    const idx = coins.findIndex(c => c.symbol === event.listEvent.currentSelectItemName);
    if (idx >= 0) { scrollIdx = idx; currentPage = 'prices'; await renderPrices(); }
  }
}

// ─── INIT BRIDGE ───────────────────────────────────────────────────────────
async function initBridge() {
  setStatus('Waiting for bridge...');
  try {
    bridge = await waitForEvenAppBridge();
    setStatus('Bridge ready');
    log('Bridge connected');

    bridge.onDeviceStatusChanged(s => log('Device: ' + s.connectType + ' bat=' + s.batteryLevel));

    // createStartUpPageContainer — called ONCE, plain object is fine per SDK docs
    const result = await bridge.createStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [{
        containerID:   CID,
        containerName: 'main',
        xPosition:     0,
        yPosition:     0,
        width:         576,
        height:        288,
        borderWidth:   0,
        paddingLength: 4,
        content:       'MARKET INTEL\nConnecting...',
        isEventCapture: 1,
      }],
    });

    log('createStartUpPageContainer result: ' + result);

    if (result === 0) {
      initialized = true;
      setStatus('G2 display active');
      bridge.onEvenHubEvent(handleEvent);
      // Render immediately if we already have coins
      if (coins.length > 0) await renderPrices();
      else await pushText('MARKET INTEL\nLoading live data...\n\n' + timestamp());
    } else {
      setStatus('Container init failed: ' + result);
      log('Container create failed, result=' + result);
    }
  } catch (e) {
    setStatus('No bridge (browser mode)');
    log('Bridge error: ' + e.message);
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
(async () => {
  log('Plugin starting...');

  // 1. Start live price feed
  connectSSE();

  // 2. Load news
  await loadNews();

  // 3. Init G2 bridge
  await initBridge();

  // 4. Poll breaking news every 30s
  setInterval(pollBreakingNews, 30000);

  // 5. Refresh display every 3s
  setInterval(async () => {
    if (!initialized || alertActive) return;
    if (currentPage === 'prices') await renderPrices();
  }, 3000);

  log('Plugin ready. Server: ' + SERVER_URL);
})();

// Visibility API — refresh when app comes back from background
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && bridge && initialized) {
    log('Resumed from background');
    if (currentPage === 'news') await renderNews();
    else await renderPrices();
  }
});
