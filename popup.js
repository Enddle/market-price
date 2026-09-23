document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const btnSaveKey = document.getElementById('btnSaveKey');
  const statusText = document.getElementById('statusText');
  const locateToggle = document.getElementById('locateToggle');
  const btnUp = document.getElementById('btnUp');
  const btnDown = document.getElementById('btnDown');
  const testStatus = document.getElementById('testStatus');

  // Load saved API key & status log
  chrome.storage.sync.get(['apiKey', 'locateActive'], (data) => {
    if (data.apiKey) apiKeyInput.value = data.apiKey;
    if (data.locateActive !== undefined) locateToggle.checked = data.locateActive;
  });

  chrome.storage.local.get(['statusLog'], (data) => {
    if (data.statusLog) {
      statusText.value = data.statusLog;
      statusText.scrollTop = statusText.scrollHeight;
    }
  });

  // Save API Key
  btnSaveKey.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    chrome.storage.sync.set({ apiKey: key }, () => {
      chrome.runtime.sendMessage({ action: 'saveApiKey', apiKey: key });
    });
  });

  // Listen for status log updates from background worker
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'statusUpdate' && request.logText) {
      statusText.value = request.logText;
      statusText.scrollTop = statusText.scrollHeight;
    }
  });

  // Send message to active tab helper
  async function sendMessageToTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      return chrome.tabs.sendMessage(tab.id, message);
    }
  }

  // Handle Locate Toggle
  locateToggle.addEventListener('change', () => {
    const isEnabled = locateToggle.checked;
    chrome.storage.sync.set({ locateActive: isEnabled });
    sendMessageToTab({ action: 'toggleLocate', enabled: isEnabled });
  });

  // Random percentage generator (0.01% - 0.1%)
  function getRandomPercentage() {
    return Math.random() * (0.1 - 0.01) + 0.01;
  }

  // Handle manual testing buttons
  function handleManualTest(direction) {
    if (locateToggle.checked) {
      locateToggle.checked = false;
      chrome.storage.sync.set({ locateActive: false });
    }

    const pct = getRandomPercentage();
    const isUp = direction === 'up';

    testStatus.textContent = `${isUp ? '+' : '-'}${pct.toFixed(3)}%`;
    testStatus.style.color = isUp ? '#16a34a' : '#dc2626';

    sendMessageToTab({
      action: 'adjustPrices',
      direction: direction,
      percentage: pct
    });
  }

  btnUp.addEventListener('click', () => handleManualTest('up'));
  btnDown.addEventListener('click', () => handleManualTest('down'));
});