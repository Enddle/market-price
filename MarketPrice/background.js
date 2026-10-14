let socket = null;
let currentSymbol = null;
let lastStockPrice = null;
let statusLogs = [];

importScripts('domainMap.js');

const ICON_SETS = {
  grey: {
    16:  'icons/icon_16.png',
    32:  'icons/icon_32.png',
    48:  'icons/icon_48.png',
    128: 'icons/icon_128.png'
  },
  blue: {
    16:  'icons/icon-blue_16.png',
    32:  'icons/icon-blue_32.png',
    48:  'icons/icon-blue_48.png',
    128: 'icons/icon-blue_128.png'
  },
  green: {
    16:  'icons/icon-green_16.png',
    32:  'icons/icon-green_32.png',
    48:  'icons/icon-green_48.png',
    128: 'icons/icon-green_128.png'
  },
  red: {
    16:  'icons/icon-red_16.png',
    32:  'icons/icon-red_32.png',
    48:  'icons/icon-red_48.png',
    128: 'icons/icon-red_128.png'
  }
};

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

async function setExtensionIcon(color, tabId) {
  const icons = ICON_SETS[color];
  if (!icons) return;
  if (!tabId) return;

  await chrome.action.setIcon({
    tabId: tabId,
    path: icons
  }).catch(() => {});
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
  const displaySymbol = symbol || '–––';
  chrome.storage.local.set({ trackedSymbol: displaySymbol });
  chrome.runtime.sendMessage({ action: 'symbolUpdate', symbol: displaySymbol }).catch(() => {});
}

function emptyPrices() {
  chrome.storage.local.set({ lastPrice: 0, lastPct: 0, lastDirection: 'neutral' });
  chrome.runtime.sendMessage({ action: 'displayUpdate', price: 0, pct: 0, direction: 'neutral' }).catch(() => {});
}

async function searchStockSymbol(domain, apiKey) {
  if (!domain) return null;

  const queryKeyword = DOMAIN_OVERRIDE_MAP[domain.toLowerCase()] || domain;
  if (queryKeyword.toLowerCase() !== domain.toLowerCase()) {
    logStatus(`Domain '${domain}' mapped to parent company '${queryKeyword}'`);
  }

  logStatus(`Searching stock symbol for '${queryKeyword}'...`);

  try {
    const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(queryKeyword)}&exchange=US&token=${apiKey}`);
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

async function checkMarket(apiKey, tabId) {
  logStatus('Checking US market status...');
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${apiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (data && data.isOpen) {
      logStatus('Market is OPEN. Icon set to Blue.');
      setExtensionIcon('blue', tabId);
      setMarketState('open');

      return true;

    } else {
      const session = data?.session ? ` (${data.session})` : '';
      logStatus(`Market is CLOSED${session}. Icon remains Grey.`);
      setExtensionIcon('grey', tabId);
      setMarketState('closed');
      closeWebSocket();

      return false;
    }
  } catch (err) {
    logStatus(`Market status API error: ${err.message}`);
    setExtensionIcon('grey', tabId);
    setMarketState('closed');
    setWsState('disconnected');

    return false;
  }
}

async function checkPriceOnce(apiKey, activeTabId, symbol) {
  logStatus('Checking current stock price: ' + symbol);
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (data && data.c) {
      const direction = 'up';
      const price = data.c;

      lastStockPrice = price;
      logStatus(`Current price for ${symbol}: $${price}`);

      chrome.storage.local.set({ lastPrice: price, lastPct: 0, lastDirection: direction });
      chrome.runtime.sendMessage({ action: 'displayUpdate', price: price, pct: 0, direction: direction }).catch(() => {});

      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { action: 'setPrices', direction: direction, price: price }).catch(() => {});
      }
      return price;

    } else if (data.c == 0) {
      logStatus(`Stock price returned 0, wrong or not supported symbol`);

      return 0;
    } else {
      logStatus(`Stock price API error, data: ${ JSON.stringify(data) }`);
      setExtensionIcon('red', tabId);
      return false;
    }
  } catch (err) {
    logStatus(`Stock price API error: ${err.message}`);
    setExtensionIcon('red', tabId);
    return false;
  }
}

async function processPageStart(tabId, pageUrl) {
  if (!tabId) return;

  const { apiKey } = await chrome.storage.sync.get(['apiKey']);
  if (!apiKey) {
    logStatus('No Finnhub API key found. Enter key in Settings.');
    setTrackedSymbol('–––');
    setMarketState('closed');
    setWsState('disconnected');
    setExtensionIcon('red', tabId);
    return;
  }

  const domain = getRootDomainName(pageUrl);
  let symbol = null;
  let price = 0;

  if (domain) {
    symbol = await searchStockSymbol(domain, apiKey);
  } else {
    logStatus('Standard domain name not detected.');
  }

  if (symbol) {
    price = await checkPriceOnce(apiKey, tabId, symbol);
  } else {
    logStatus(`No valid symbol for domain: ${domain}`);
  }

  if (!price) {
    const { defaultSymbol } = await chrome.storage.sync.get(['defaultSymbol']);
    
    if (defaultSymbol) {
      logStatus(`Default symbol found: ${defaultSymbol}`);
      symbol = defaultSymbol;
      price = await checkPriceOnce(apiKey, tabId, symbol);
    }
  }

  setTrackedSymbol(symbol);

  if (!price) {
    setExtensionIcon('grey', tabId);
    setWsState('disconnected');
    emptyPrices();
    return;
  }

  if (await checkMarket(apiKey, tabId)) {
    connectWebSocket(apiKey, tabId, foundSymbol);
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

              chrome.storage.local.set({ lastPrice: newPrice, lastPct: pct, lastDirection: direction });
              chrome.runtime.sendMessage({ action: 'displayUpdate', price: newPrice, pct: pct, direction: direction }).catch(() => {});

              if (activeTabId) {
                // chrome.tabs.sendMessage(activeTabId, { action: 'adjustPrices', direction: direction, percentage: pct }).catch(() => {});
                chrome.tabs.sendMessage(activeTabId, { action: 'setPrices', direction: direction, price: newPrice }).catch(() => {});
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
    // logStatus(`[Debug] Initialized from tab: ${sender.tab.url} (${sender.tab.id})`);

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