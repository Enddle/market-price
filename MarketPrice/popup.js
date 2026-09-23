document.addEventListener('DOMContentLoaded', () => {
  const symbolDisplay = document.getElementById('symbolDisplay');
  const marketDot = document.getElementById('marketDot');
  const wsDot = document.getElementById('wsDot');
  const percentageDisplay = document.getElementById('percentageDisplay');
  const settingsSection = document.getElementById('settingsSection');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const apiKeyNotice = document.getElementById('apiKeyNotice');
  const finnhubLink = document.getElementById('finnhubLink');
  const githubLink = document.getElementById('githubLink');
  const instagramLink = document.getElementById('instagramLink');
  const btnToggleVisibility = document.getElementById('btnToggleVisibility');
  const eyeIcon = document.getElementById('eyeIcon');
  const btnSaveKey = document.getElementById('btnSaveKey');
  const statusText = document.getElementById('statusText');
  const btnRise = document.getElementById('btnRise');
  const btnLocate = document.getElementById('btnLocate');
  const btnFall = document.getElementById('btnFall');

  let isLocateActive = false;

  const eyeSvg = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
  const eyeOffSvg = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;

  // Load saved API key & set default section folding state
  chrome.storage.sync.get(['apiKey', 'locateActive'], (data) => {
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
      apiKeyNotice.style.display = 'none';
      settingsSection.open = false; // Folded by default when key exists
    } else {
      apiKeyNotice.style.display = 'block';
      settingsSection.open = true; // Auto-open when key is missing
    }

    if (data.locateActive !== undefined) {
      setLocateState(data.locateActive);
    }
  });

  // Load saved state (symbol, market, websocket, logs, percentage)
  chrome.storage.local.get(
    ['trackedSymbol', 'marketState', 'wsState', 'statusLog', 'lastPct', 'lastDirection'],
    (data) => {
      updateSymbolDisplay(data.trackedSymbol);
      updateMarketDot(data.marketState);
      updateWsDot(data.wsState);
      updatePercentageDisplay(data.lastPct, data.lastDirection);

      if (data.statusLog) {
        statusText.value = data.statusLog;
        statusText.scrollTop = statusText.scrollHeight;
      }
    }
  );

  function updateSymbolDisplay(symbol) {
    if (!symbol || symbol === 'NONE' || symbol === '––') {
      symbolDisplay.textContent = '––';
    } else {
      symbolDisplay.textContent = symbol;
    }
  }

  function updateMarketDot(state) {
    marketDot.classList.remove('grey', 'green');
    if (state === 'open') {
      marketDot.classList.add('green');
      marketDot.setAttribute('data-tooltip', 'Market: Open');
    } else {
      marketDot.classList.add('grey');
      marketDot.setAttribute('data-tooltip', 'Market: Closed');
    }
  }

  function updateWsDot(state) {
    wsDot.classList.remove('grey', 'blue', 'green');
    if (state === 'active') {
      wsDot.classList.add('green');
      wsDot.setAttribute('data-tooltip', 'WebSocket: Message Received');
    } else if (state === 'subscribed') {
      wsDot.classList.add('blue');
      wsDot.setAttribute('data-tooltip', 'WebSocket: Subscribed');
    } else {
      wsDot.classList.add('grey');
      wsDot.setAttribute('data-tooltip', 'WebSocket: Not Subscribed');
    }
  }

  function updatePercentageDisplay(pct, direction) {
    percentageDisplay.classList.remove('up', 'down', 'neutral');

    if (pct === undefined || pct === null || direction === 'neutral') {
      percentageDisplay.textContent = '0.000%';
      percentageDisplay.classList.add('neutral');
    } else {
      const sign = direction === 'up' ? '+' : '-';
      percentageDisplay.textContent = `${sign}${parseFloat(pct).toFixed(3)}%`;
      percentageDisplay.classList.add(direction);
    }
  }

  function setLocateState(active) {
    isLocateActive = active;
    if (isLocateActive) {
      btnLocate.classList.add('active');
    } else {
      btnLocate.classList.remove('active');
    }
  }

  // Toggle API key visibility & change SVG icon
  btnToggleVisibility.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      eyeIcon.innerHTML = eyeSvg;
    } else {
      apiKeyInput.type = 'password';
      eyeIcon.innerHTML = eyeOffSvg;
    }
  });

  // Helper to open links safely in extension popups
  function setupExternalLink(element, url) {
    if (element) {
      element.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url });
      });
    }
  }

  setupExternalLink(finnhubLink, 'https://finnhub.io/');
  setupExternalLink(githubLink, 'https://github.com');
  setupExternalLink(instagramLink, 'https://instagram.com');

  // Save API key & Reload
  btnSaveKey.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      apiKeyNotice.style.display = 'none';
    } else {
      apiKeyNotice.style.display = 'block';
    }

    chrome.storage.sync.set({ apiKey: key }, () => {
      chrome.runtime.sendMessage({ action: 'saveApiKey', apiKey: key });
    });
  });

  // Hide notice dynamically when typing
  apiKeyInput.addEventListener('input', () => {
    if (apiKeyInput.value.trim().length > 0) {
      apiKeyNotice.style.display = 'none';
    } else {
      apiKeyNotice.style.display = 'block';
    }
  });

  // Listen for real-time messages from background script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'statusUpdate' && request.logText) {
      statusText.value = request.logText;
      statusText.scrollTop = statusText.scrollHeight;
    }
    if (request.action === 'symbolUpdate') {
      updateSymbolDisplay(request.symbol);
    }
    if (request.action === 'marketStateUpdate') {
      updateMarketDot(request.state);
    }
    if (request.action === 'wsStateUpdate') {
      updateWsDot(request.state);
    }
    if (request.action === 'pctUpdate') {
      updatePercentageDisplay(request.pct, request.direction);
    }
  });

  async function sendMessageToTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      return chrome.tabs.sendMessage(tab.id, message);
    }
  }

  // Locate Button Toggle
  btnLocate.addEventListener('click', () => {
    const newState = !isLocateActive;
    setLocateState(newState);
    chrome.storage.sync.set({ locateActive: newState });
    sendMessageToTab({ action: 'toggleLocate', enabled: newState });
  });

  function getRandomPercentage() {
    return Math.random() * (0.1 - 0.01) + 0.01;
  }

  function handleManualTest(direction) {
    if (isLocateActive) {
      setLocateState(false);
      chrome.storage.sync.set({ locateActive: false });
      sendMessageToTab({ action: 'toggleLocate', enabled: false });
    }

    const pct = getRandomPercentage();

    updatePercentageDisplay(pct, direction);
    chrome.storage.local.set({ lastPct: pct, lastDirection: direction });

    sendMessageToTab({
      action: 'adjustPrices',
      direction: direction,
      percentage: pct
    });
  }

  btnRise.addEventListener('click', () => handleManualTest('up'));
  btnFall.addEventListener('click', () => handleManualTest('down'));

  function displayVersionNumber() {
    const versionEl = document.getElementById('versionNumber');
    if (versionEl) {
      versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
    }
  }

  // Call it inside DOMContentLoaded
  displayVersionNumber();
});