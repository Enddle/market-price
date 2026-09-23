let socket = null;
let currentSymbol = null;
let lastStockPrice = null;
let statusLogs = [];

importScripts('domainMap.js');

function getRootDomainName(urlStr) {
  if (!urlStr) return '';
  if (urlStr.startsWith('chrome://') || urlStr.startsWith('chrome-extension://')) {
    return 'chrome';
  }
  try {
    const url = new URL(urlStr);
    let host = url.hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.');
    if (parts.length === 1) return parts[0];

    const commonSlds = ['co', 'com', 'org', 'net', 'gov', 'edu'];
    if (parts.length >= 3 && commonSlds.includes(parts[parts.length - 2])) {
      return parts[parts.length - 3];
    }
    return parts[parts.length - 2];
  } catch (e) {
    return '';
  }
}

function setExtensionIcon(color, tabId) {
  try {
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext('2d');

    const colorMap = {
      'grey': '#6b7280',
      'blue': '#2563eb',
      'green': '#22c55e'
    };

    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, 2 * Math.PI);
    ctx.fillStyle = colorMap[color] || colorMap['grey'];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 16, 17);

    const imageData = ctx.getImageData(0, 0, 32, 32);
    const options = { imageData: imageData };
    if (tabId) options.tabId = tabId;

    chrome.action.setIcon(options);
  } catch (e) {
    console.error('Error rendering icon:', e);
  }
}

function logStatus(message) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${message}`;
  statusLogs.push(entry);
  if (statusLogs.length > 30) statusLogs.shift();

  const fullLog = statusLogs.join('\n');
  chrome.storage.local.set({ statusLog: fullLog });

  chrome.runtime.sendMessage({ action: 'statusUpdate', logText: fullLog }).catch(() => {});
}

function setMarketState(state) {
  chrome.storage.local.set({ marketState: state });
  chrome.runtime.sendMessage({ action: 'marketStateUpdate', state: state }).catch(() => {});
}

function setWsState(state) {
  chrome.storage.local.set({ wsState: state });
  chrome.runtime.sendMessage({ action: 'wsStateUpdate', state: state }).catch(() => {});
}

function setTrackedSymbol(symbol) {
  currentSymbol = symbol;
  lastStockPrice = null;
  const displaySymbol = symbol || '––';
  chrome.storage.local.set({ trackedSymbol: displaySymbol, lastPct: 0, lastDirection: 'neutral' });
  chrome.runtime.sendMessage({ action: 'symbolUpdate', symbol: displaySymbol }).catch(() => {});
  chrome.runtime.sendMessage({ action: 'pctUpdate', pct: 0, direction: 'neutral' }).catch(() => {});
}

async function searchStockSymbol(domain, apiKey) {
  if (!domain) return null;

  const queryKeyword = DOMAIN_OVERRIDE_MAP[domain.toLowerCase()] || domain;
  if (queryKeyword.toLowerCase() !== domain.toLowerCase()) {
    logStatus(`Domain '${domain}' mapped to parent company '${queryKeyword}'`);
  }

  logStatus(`Searching stock symbol for '${queryKeyword}'...`);

  try {
    const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(queryKeyword)}&token=${apiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data && Array.isArray(data.result) && data.result.length > 0) {
      const commonStock = data.result.find(item => item.type === 'Common Stock' && !item.symbol.includes('.'));
      const match = commonStock || data.result[0];
      if (match && match.symbol) {
        logStatus(`Found symbol '${match.symbol}' (${match.description || queryKeyword})`);
        return match.symbol;
      }
    }
    logStatus(`No stock symbol found for '${queryKeyword}'`);
    return null;
  } catch (err) {
    logStatus(`Symbol search error: ${err.message}`);
    return null;
  }
}

async function processPageStart(tabId, pageUrl) {
  setExtensionIcon('grey', tabId);

  const { apiKey } = await chrome.storage.sync.get(['apiKey']);
  if (!apiKey) {
    logStatus('No Finnhub API key found. Enter key in Settings.');
    setTrackedSymbol('––');
    setMarketState('closed');
    setWsState('disconnected');
    return;
  }

  const domain = getRootDomainName(pageUrl);
  let foundSymbol = null;

  if (domain) {
    foundSymbol = await searchStockSymbol(domain, apiKey);
  } else {
    logStatus('Standard domain name not detected.');
  }

  setTrackedSymbol(foundSymbol);

  logStatus('Checking US market status...');
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${apiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (data && data.isOpen) {
      logStatus('Market is OPEN. Icon set to Blue.');
      setExtensionIcon('blue', tabId);
      setMarketState('open');

      if (foundSymbol) {
        connectWebSocket(apiKey, tabId, foundSymbol);
      } else {
        logStatus('Skipping WebSocket subscription: No valid symbol tracked.');
        setWsState('disconnected');
      }
    } else {
      const session = data?.session ? ` (${data.session})` : '';
      logStatus(`Market is CLOSED${session}. Icon remains Grey.`);
      setExtensionIcon('grey', tabId);
      setMarketState('closed');
      closeWebSocket();
    }
  } catch (err) {
    logStatus(`Market status API error: ${err.message}`);
    setExtensionIcon('grey', tabId);
    setMarketState('closed');
    setWsState('disconnected');
  }
}

function connectWebSocket(apiKey, activeTabId, symbol) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    logStatus(`Subscribing to trade stream for '${symbol}'...`);
    socket.send(JSON.stringify({ type: 'subscribe', symbol: symbol }));
    setWsState('subscribed');
    return;
  }

  logStatus('Connecting to Finnhub WebSocket...');
  socket = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);

  socket.onopen = () => {
    logStatus(`WebSocket Connected. Subscribing to '${symbol}'...`);
    socket.send(JSON.stringify({ type: 'subscribe', symbol: symbol }));
    setWsState('subscribed');
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'trade' && Array.isArray(msg.data)) {
        msg.data.forEach(trade => {
          if (trade.s === currentSymbol) {
            const newPrice = trade.p;

            setExtensionIcon('green', activeTabId);
            setWsState('active'); // Message received state

            if (lastStockPrice === null) {
              lastStockPrice = newPrice;
              logStatus(`[WS ${currentSymbol}] Baseline Price: $${newPrice.toFixed(2)}`);
            } else if (newPrice !== lastStockPrice) {
              const diff = newPrice - lastStockPrice;
              const pct = Math.abs((diff / lastStockPrice) * 100);
              const direction = diff > 0 ? 'up' : 'down';

              logStatus(`[WS ${currentSymbol}] $${newPrice.toFixed(2)} (${direction === 'up' ? '+' : '-'}${pct.toFixed(4)}%)`);

              lastStockPrice = newPrice;

              chrome.storage.local.set({ lastPct: pct, lastDirection: direction });
              chrome.runtime.sendMessage({ action: 'pctUpdate', pct: pct, direction: direction }).catch(() => {});

              if (activeTabId) {
                chrome.tabs.sendMessage(activeTabId, {
                  action: 'adjustPrices',
                  direction: direction,
                  percentage: pct
                }).catch(() => {});
              }
            }
          }
        });
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  socket.onerror = () => {
    logStatus('WebSocket encountered an error.');
    setWsState('disconnected');
  };

  socket.onclose = () => {
    logStatus('WebSocket disconnected.');
    setWsState('disconnected');
  };
}

function closeWebSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
  lastStockPrice = null;
  setWsState('disconnected');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'pageStarted') {
    const tabId = sender.tab ? sender.tab.id : null;
    const pageUrl = sender.tab ? sender.tab.url : '';
    processPageStart(tabId, pageUrl);
    sendResponse({ status: 'started' });
  } else if (request.action === 'saveApiKey') {
    logStatus('API Key updated. Re-checking active tab...');
    closeWebSocket();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab) {
        processPageStart(activeTab.id, activeTab.url);
      }
    });
    sendResponse({ status: 'ok' });
  }
});