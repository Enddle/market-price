let socket = null;
let lastGooglPrice = null;
let statusLogs = [];

// Dynamic Icon Generator using OffscreenCanvas
function setExtensionIcon(color, tabId) {
  try {
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext('2d');

    const colorMap = {
      'grey': '#6b7280',
      'blue': '#2563eb',
      'green': '#22c55e'
    };

    // Outer circle
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, 2 * Math.PI);
    ctx.fillStyle = colorMap[color] || colorMap['grey'];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Dollar sign
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

// Helper to log and sync status to popup & storage
function logStatus(message) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${message}`;
  statusLogs.push(entry);
  if (statusLogs.length > 30) statusLogs.shift();

  const fullLog = statusLogs.join('\n');
  chrome.storage.local.set({ statusLog: fullLog, latestStatus: entry });

  // Broadcast to popup if open
  chrome.runtime.sendMessage({ action: 'statusUpdate', logText: fullLog }).catch(() => {});
}

// Check Finnhub Market Status & Connect WebSocket
async function checkMarketAndConnect(tabId) {
  // Default icon to Grey at page start
  setExtensionIcon('grey', tabId);

  const { apiKey } = await chrome.storage.sync.get(['apiKey']);
  if (!apiKey) {
    logStatus('⚠️ No Finnhub API key found. Enter key in Settings.');
    return;
  }

  logStatus('🔍 Checking US market status via Finnhub API...');

  try {
    // Fixed Endpoint: /stock/market-status
    const res = await fetch(`https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${apiKey}`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Invalid response or key.`);
    }

    const data = await res.json();

    if (data && data.isOpen) {
      logStatus('🔵 Market is OPEN! Icon set to Blue.');
      setExtensionIcon('blue', tabId);
      connectWebSocket(apiKey, tabId);
    } else {
      const session = data?.session ? ` (${data.session})` : '';
      logStatus(`⚪ Market is CLOSED${session}. Icon remains Grey.`);
      setExtensionIcon('grey', tabId);
      closeWebSocket();
    }
  } catch (err) {
    logStatus(`❌ Market status API error: ${err.message}`);
    setExtensionIcon('grey', tabId);
  }
}

// Connect Finnhub WebSocket for GOOGL
function connectWebSocket(apiKey, activeTabId) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return; // Already connected
  }

  logStatus('🌐 Connecting to Finnhub WebSocket...');
  socket = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);

  socket.onopen = () => {
    logStatus('✅ Connected to WebSocket. Subscribing to GOOGL...');
    socket.send(JSON.stringify({ type: 'subscribe', symbol: 'GOOGL' }));
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'trade' && Array.isArray(msg.data)) {
        msg.data.forEach(trade => {
          if (trade.s === 'GOOGL') {
            const newPrice = trade.p;

            // Change icon to Green on WebSocket trade response
            setExtensionIcon('green', activeTabId);

            if (lastGooglPrice === null) {
              lastGooglPrice = newPrice;
              logStatus(`🟢 [WS GOOGL] Baseline Trade Received: $${newPrice.toFixed(2)}`);
            } else if (newPrice !== lastGooglPrice) {
              const diff = newPrice - lastGooglPrice;
              const pct = Math.abs((diff / lastGooglPrice) * 100);
              const direction = diff > 0 ? 'up' : 'down';

              logStatus(`🟢 [WS GOOGL] $${newPrice.toFixed(2)} (${direction === 'up' ? '+' : '-'}${pct.toFixed(4)}%)`);

              lastGooglPrice = newPrice;

              // Broadcast percentage adjustment to active page
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
    logStatus('⚠️ WebSocket encountered an error.');
  };

  socket.onclose = () => {
    logStatus('🔌 WebSocket disconnected.');
  };
}

function closeWebSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
  lastGooglPrice = null;
}

// Listen for content script & popup events
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'pageStarted') {
    const tabId = sender.tab ? sender.tab.id : null;
    checkMarketAndConnect(tabId);
    sendResponse({ status: 'started' });
  } else if (request.action === 'saveApiKey') {
    logStatus('🔑 API Key updated. Re-checking market status...');
    closeWebSocket();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0]?.id;
      checkMarketAndConnect(activeTabId);
    });
    sendResponse({ status: 'ok' });
  }
});