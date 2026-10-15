document.addEventListener('DOMContentLoaded', () => {
  const symbolDisplay = document.getElementById('symbolDisplay');
  const marketDot = document.getElementById('marketDot');
  const wsDot = document.getElementById('wsDot');
  const priceDisplay = document.getElementById('priceDisplay');
  const priceFollowBtn = document.getElementById('priceFollowBtn');
  const pctDisplay = document.getElementById('pctDisplay');

  const settingsSection = document.getElementById('settingsSection');
  const alwaysFollowToggle = document.getElementById('alwaysFollowToggle');
  const defaultSymbolInput = document.getElementById('defaultSymbolInput');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const apiKeyNotice = document.getElementById('apiKeyNotice');
  const btnToggleVisibility = document.getElementById('btnToggleVisibility');
  const eyeIcon = document.getElementById('eyeIcon');
  const btnSaveKey = document.getElementById('btnSaveKey');
  const statusText = document.getElementById('statusText');
  const btnRise = document.getElementById('btnRise');
  const btnLocate = document.getElementById('btnLocate');
  const btnFall = document.getElementById('btnFall');

  const finnhubLink = document.getElementById('finnhubLink');
  const githubLink = document.getElementById('githubLink');
  const instagramLink = document.getElementById('instagramLink');
  const finnhubLinkUrl = 'https://finnhub.io/';
  const githubLinkUrl = 'https://github.com/Enddle/market-price';
  const instagramLinkUrl = 'https://instagram.com/enddle.work';

  let isFollowingPrice = false;
  let isLocateActive = false;
  let lastPrice = 0;

  const eyeSvg = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
  const eyeOffSvg = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;

  // Load saved state (symbol, market, websocket, logs, percentage)
  chrome.storage.local.get(
    ['trackedSymbol', 'marketState', 'wsState', 'statusLog', 'lastPrice', 'lastPct', 'lastDirection'],
    (data) => {
      updateSymbolDisplay(data.trackedSymbol);
      updateMarketDot(data.marketState);
      updateWsDot(data.wsState);
      updateDisplays(data.lastPrice, data.lastPct, data.lastDirection);
      updateStatusLog(data.statusLog);
    }
  );

  // Load saved API key & set default section folding state
  chrome.storage.sync.get(['apiKey', 'alwaysFollow', 'defaultSymbol'], (data) => {
    updateApiKey(data.apiKey);
    updateAlwaysFollow(data.alwaysFollow);
    updateDefaultSymbol(data.defaultSymbol);
  });

  function updateSymbolDisplay(symbol) {
    if (!symbol || symbol === 'NONE' || symbol === '–––') {
      symbolDisplay.textContent = '–––';
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
      wsDot.setAttribute('data-tooltip', 'WebSocket: Active');
    } else if (state === 'subscribed') {
      wsDot.classList.add('blue');
      wsDot.setAttribute('data-tooltip', 'WebSocket: Subscribed');
    } else {
      wsDot.classList.add('grey');
      wsDot.setAttribute('data-tooltip', 'WebSocket: Inactive');
    }
  }

  function updateDisplays(price, pct, direction) {
    pctDisplay.classList.remove('up', 'down', 'neutral');
    priceFollowBtn.classList.remove('up', 'down', 'neutral');

    if (!price) {  // undefined, null, and 0
      priceDisplay.textContent = '$--.--';
    } else {
      priceDisplay.textContent = '$' + parseFloat(price).toFixed(2);
      lastPrice = price;
    }

    if (!pct || direction === 'neutral') {
      pctDisplay.textContent = '0.000%';
      pctDisplay.classList.add('neutral');
      priceFollowBtn.classList.add('neutral');
    } else {
      const sign = direction === 'up' ? '+' : '-';
      pctDisplay.textContent = `${sign}${parseFloat(pct).toFixed(3)}%`;
      pctDisplay.classList.add(direction);
      priceFollowBtn.classList.add(direction);
    }
  }

  function toggleFollowPrice(follow) {
    isFollowingPrice = follow;

    setLocateState(false);

    sendMessageToTab({ action: 'toggleFollow', follow: follow });
    
    if (follow) priceFollowBtn.classList.add("following");
    else priceFollowBtn.classList.remove("following");
  }

  priceFollowBtn.addEventListener('click', function () {
    toggleFollowPrice(!isFollowingPrice);
  });

  function updateAlwaysFollow(alwaysFollow) {
    const follow = alwaysFollow ?? false;  // read undefined / null as false
    
    alwaysFollowToggle.checked = follow;

    toggleFollowPrice(follow);
  }

  alwaysFollowToggle.addEventListener('change', (e) => {
    const isChecked = e.target.checked;

    toggleFollowPrice(isChecked);

    // set to blue color before data is saved
    alwaysFollowToggle.classList.add('loading');

    chrome.storage.sync.set({ alwaysFollow: isChecked }, () => {
      alwaysFollowToggle.classList.remove('loading');
    });
  });

  defaultSymbolInput.addEventListener('input', (e) => {
    defaultSymbolInput.classList.remove('saved');
    const symbol = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
    e.target.value = symbol;
  });

  defaultSymbolInput.addEventListener('focusout', (e) => {
    const symbol = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
    e.target.value = symbol;

    chrome.storage.sync.set({ defaultSymbol: symbol }, () => {
      defaultSymbolInput.classList.add('saved');
    });
  });

  function updateDefaultSymbol(defaultSymbol) {
    if (defaultSymbol) {
      defaultSymbolInput.value = defaultSymbol;
    }
  }

  function updateApiKey(apiKey) {
    if (apiKey) {
      apiKeyInput.value = apiKey;
      apiKeyNotice.style.display = 'none';
      settingsSection.open = false; // Folded by default when key exists
    } else {
      apiKeyNotice.style.display = 'block';
      settingsSection.open = true; // Auto-open when key is missing
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

  // Hide notice dynamically when typing
  apiKeyInput.addEventListener('input', () => {
    if (apiKeyInput.value.trim().length > 0) {
      apiKeyNotice.style.display = 'none';
    } else {
      apiKeyNotice.style.display = 'block';
    }
  });

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

  function updateStatusLog(statusLog) {
    if (statusLog) {
      statusText.value = statusLog;
      statusText.scrollTop = statusText.scrollHeight;
    }
  }

  function setLocateState(active) {
    isLocateActive = active ?? false;
    if (isLocateActive) {
      btnLocate.classList.add('active');
    } else {
      btnLocate.classList.remove('active');
    }
  }

  // Locate Button Toggle
  btnLocate.addEventListener('click', () => {
    const newState = !isLocateActive;
    setLocateState(newState);
    sendMessageToTab({ action: 'toggleLocate', locate: newState });
  });

  function getRandomPercentage() {
    return Math.random() * (0.1 - 0.01) + 0.01;
  }

  function handleManualTest(direction) {
    if (isLocateActive) {
      setLocateState(false);
    }

    if (!isFollowingPrice) toggleFollowPrice(true);

    const pct = getRandomPercentage();

    updateDisplays(0, pct, direction);
    chrome.storage.local.set({ lastPct: pct, lastDirection: direction });

    sendMessageToTab({ action: 'adjustPrices', direction: direction, pct: pct });
  }

  btnRise.addEventListener('click', () => handleManualTest('up'));
  btnFall.addEventListener('click', () => handleManualTest('down'));

  // display version number
  const versionEl = document.getElementById('versionNumber');
  if (versionEl) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  // Helper to open links safely in extension popups
  function setupExternalLink(element, url) {
    if (element) {
      element.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url });
      });
    }
  }

  setupExternalLink(finnhubLink, finnhubLinkUrl);
  setupExternalLink(githubLink, githubLinkUrl);
  setupExternalLink(instagramLink, instagramLinkUrl);

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
    if (request.action === 'displayUpdate') {
      updateDisplays(request.price, request.pct, request.direction);
    }
  });

  async function sendMessageToTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      return chrome.tabs.sendMessage(tab.id, message);
    }
  }
});