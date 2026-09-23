const PRICE_REGEX = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g;
let observer = null;
let locateActive = false;

// Notify background service worker when page starts
chrome.runtime.sendMessage({ action: 'pageStarted' }).catch(() => {});

function ensurePricesWrapped(rootNode = document.body) {
  const walker = document.createTreeWalker(
    rootNode,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tag = parent.tagName ? parent.tagName.toLowerCase() : '';
        if (['script', 'style', 'textarea', 'input', 'noscript', 'option'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.isContentEditable || parent.classList.contains('highlighted-price-ext')) {
          return NodeFilter.FILTER_REJECT;
        }

        if (PRICE_REGEX.test(node.nodeValue)) {
          PRICE_REGEX.lastIndex = 0;
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  const nodesToReplace = [];
  while (walker.nextNode()) {
    nodesToReplace.push(walker.currentNode);
  }

  nodesToReplace.forEach(node => {
    const text = node.nodeValue;
    const matches = [...text.matchAll(PRICE_REGEX)];
    if (!matches.length) return;

    const parent = node.parentNode;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    matches.forEach(match => {
      const matchStart = match.index;
      const matchText = match[0];

      if (matchStart > lastIndex) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchStart)));
      }

      const cleanNumStr = matchText.replace(/[^0-9.]/g, '');
      const numVal = parseFloat(cleanNumStr);
      const prefix = matchText.match(/^\$\s*/)?.[0] || '$';
      const hasCommas = matchText.includes(',');

      const span = document.createElement('span');
      span.className = 'highlighted-price-ext';
      span.textContent = matchText;

      if (!isNaN(numVal)) {
        span.dataset.currentPrice = numVal.toString();
        span.dataset.prefix = prefix;
        span.dataset.hasCommas = hasCommas ? 'true' : 'false';
      }

      if (locateActive) {
        span.classList.add('locate-yellow');
      }

      fragment.appendChild(span);
      lastIndex = matchStart + matchText.length;
    });

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
    }

    if (parent) {
      parent.replaceChild(fragment, node);
    }
  });
}

function setLocateMode(enabled) {
  locateActive = enabled;
  ensurePricesWrapped();

  const highlights = document.querySelectorAll('.highlighted-price-ext');
  highlights.forEach(span => {
    if (enabled) {
      span.classList.add('locate-yellow');
    } else {
      span.classList.remove('locate-yellow');
    }
  });

  observeDynamicContent();
}

function adjustPrices(direction, percentage) {
  locateActive = false;
  ensurePricesWrapped();

  const factor = direction === 'up' ? (1 + percentage / 100) : (1 - percentage / 100);
  const flashClass = direction === 'up' ? 'flash-up' : 'flash-down';

  const highlights = document.querySelectorAll('.highlighted-price-ext');

  highlights.forEach(span => {
    span.classList.remove('locate-yellow');

    let currentVal = parseFloat(span.dataset.currentPrice);
    if (isNaN(currentVal)) {
      const cleanNum = span.textContent.replace(/[^0-9.]/g, '');
      currentVal = parseFloat(cleanNum);
      span.dataset.prefix = span.textContent.match(/^\$\s*/)?.[0] || '$';
      span.dataset.hasCommas = span.textContent.includes(',') ? 'true' : 'false';
    }

    if (!isNaN(currentVal)) {
      const newVal = currentVal * factor;
      span.dataset.currentPrice = newVal.toString();

      const prefix = span.dataset.prefix || '$';
      const hasCommas = span.dataset.hasCommas === 'true';

      const formattedNum = hasCommas 
        ? newVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : newVal.toFixed(2);

      span.textContent = `${prefix}${formattedNum}`;
    }

    // Trigger green/red flash and fade out transition
    span.classList.remove('flash-up', 'flash-down');
    void span.offsetWidth; // Repaint trigger

    span.classList.add(flashClass);

    setTimeout(() => {
      span.classList.remove(flashClass);
    }, 50);
  });
}

function observeDynamicContent() {
  if (observer) observer.disconnect();
  observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          ensurePricesWrapped(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Listen for popup & background messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleLocate') {
    setLocateMode(request.enabled);
    sendResponse({ status: 'done' });
  } else if (request.action === 'adjustPrices') {
    adjustPrices(request.direction, request.percentage);
    sendResponse({ status: 'done' });
  }
});

// Restore locate state if saved
chrome.storage.sync.get(['locateActive'], (result) => {
  if (result.locateActive) {
    setLocateMode(true);
  }
});