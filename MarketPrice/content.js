const PRICE_REGEX = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g;
let observer = null;

let isLocateActive = false;
let isFollowingPrice = false;
let lastPrice = 0;

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
      span.dataset.originalText = matchText;
      span.dataset.currentText = matchText;

      if (!isNaN(numVal)) {
        span.dataset.currentPrice = numVal.toString();
        span.dataset.prefix = prefix;
        span.dataset.hasCommas = hasCommas ? 'true' : 'false';
      }

      if (isFollowingPrice && lastPrice != 0) {
        nodeSetPrice(span, lastPrice);
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

function setLocateMode(locate) {
  const highlights = document.querySelectorAll('.highlighted-price-ext');
  highlights.forEach(span => {
    if (locate) span.classList.add('locate-yellow');
    else span.classList.remove('locate-yellow');
  });
  isLocateActive = locate;
}

function setFollowPrice(follow) {
  console.log(`[Market Price] following price: ${follow}`);

  if (!isFollowingPrice && follow) {  // turning on
    const highlights = document.querySelectorAll('.highlighted-price-ext');
    highlights.forEach(span => {
      if (follow && lastPrice != 0) {  // isFollowingPrice not updated yet, use follow
        nodeSetPrice(span, lastPrice);
      } else {
        const text = span.dataset.currentText;
        if (text) span.textContent = text;
      }
    });
  } else if (isFollowingPrice && !follow) {  // turning off
    const highlights = document.querySelectorAll('.highlighted-price-ext');
    highlights.forEach(span => {

      const text = span.dataset.originalText;
      if (text) span.textContent = text;
      span.classList.remove('locate-yellow');
      span.classList.remove('flash-up', 'flash-down');
    });
  }
  isFollowingPrice = follow;  // update variable
}

function adjustPrices(pct, direction) {
  isLocateActive = false;

  const factor = direction === 'up' ? (1 + pct / 100) : (1 - pct / 100);
  const flashClass = direction === 'up' ? 'flash-up' : 'flash-down';

  const highlights = document.querySelectorAll('.highlighted-price-ext');

  highlights.forEach(span => {
    span.classList.remove('locate-yellow');

    let currentVal = parseFloat(span.dataset.currentPrice);

    if (isNaN(currentVal)) {  // if parse failed, retry parse
      const cleanNum = span.textContent.replace(/[^0-9.]/g, '');
      currentVal = parseFloat(cleanNum);
      span.dataset.prefix = span.textContent.match(/^\$\s*/)?.[0] || '$';
      span.dataset.hasCommas = span.textContent.includes(',') ? 'true' : 'false';
    }
    if (isNaN(currentVal)) return;  // still error

    const newVal = currentVal * factor;
    nodeSetPrice(span, newVal);
    nodeFlash(span, flashClass);
  });
}

function setPrices(price, direction) {
  isLocateActive = false;

  const flashClass = direction === 'up' ? 'flash-up' : 'flash-down';

  const highlights = document.querySelectorAll('.highlighted-price-ext');

  highlights.forEach(span => {
    span.classList.remove('locate-yellow');
    nodeSetPrice(span, price);
    nodeFlash(span, flashClass);
  });
}

function nodeSetPrice(span, price) {
  span.dataset.currentPrice = price.toString;

  const prefix = span.dataset.prefix || '$';
  const hasCommas = span.dataset.hasCommas === 'true';
  const formattedNum = hasCommas 
    ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toFixed(2);
  span.textContent = `${prefix}${formattedNum}`;
  span.dataset.currentText = `${prefix}${formattedNum}`;
}

function nodeFlash(span, flashClass) {

  span.classList.remove('flash-up', 'flash-down');
  void span.offsetWidth; // Repaint trigger

  span.classList.add(flashClass);

  setTimeout(() => {
    span.classList.remove(flashClass);
  }, 50);
}

function colorFilterSvg(matrix) {
  return `url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feColorMatrix type='matrix' values='${matrix}'/></filter></svg>#f\")`;
}

function flashPage(color) {
  if (color === 'up') {  // green
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.75 0 0 0 0 0.05 0.93 0.02 0 0 0 0 0.75 0 0 0 0 0 1 0'), 25);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.50 0 0 0 0 0.11 0.86 0.04 0 0 0 0 0.50 0 0 0 0 0 1 0'), 50);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.25 0 0 0 0 0.16 0.79 0.05 0 0 0 0 0.25 0 0 0 0 0 1 0'), 75);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.00 0 0 0 0 0.21 0.72 0.07 0 0 0 0 0.00 0 0 0 0 0 1 0'), 100);

    setTimeout(() => document.body.style.filter = colorFilterSvg('0.25 0 0 0 0 0.16 0.79 0.05 0 0 0 0 0.25 0 0 0 0 0 1 0'), 325);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.50 0 0 0 0 0.11 0.86 0.04 0 0 0 0 0.50 0 0 0 0 0 1 0'), 350);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.75 0 0 0 0 0.05 0.93 0.02 0 0 0 0 0.75 0 0 0 0 0 1 0'), 375);
    setTimeout(() => document.body.style.filter = '', 400);

  } else {  // red
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.80 0.18 0.02 0 0 0 0.75 0 0 0 0 0 0.75 0 0 0 0 0 1 0'), 25);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.61 0.36 0.04 0 0 0 0.50 0 0 0 0 0 0.50 0 0 0 0 0 1 0'), 50);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.41 0.54 0.05 0 0 0 0.25 0 0 0 0 0 0.25 0 0 0 0 0 1 0'), 75);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.21 0.72 0.07 0 0 0 0.00 0 0 0 0 0 0.00 0 0 0 0 0 1 0'), 100);

    setTimeout(() => document.body.style.filter = colorFilterSvg('0.41 0.54 0.05 0 0 0 0.25 0 0 0 0 0 0.25 0 0 0 0 0 1 0'), 325);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.61 0.36 0.04 0 0 0 0.50 0 0 0 0 0 0.50 0 0 0 0 0 1 0'), 350);
    setTimeout(() => document.body.style.filter = colorFilterSvg('0.80 0.18 0.02 0 0 0 0.75 0 0 0 0 0 0.75 0 0 0 0 0 1 0'), 375);
    setTimeout(() => document.body.style.filter = '', 400);
  }
}

function scrollPage(pct, direction) {
  const height = document.documentElement.scrollHeight;
  const distance = height * pct / 100;

  const delta = direction === 'down' ? distance : -distance;
  const top = (window.scrollY === 0) && (delta < 0);
  const bottom = (window.innerHeight + window.scrollY >= height - 1) && (delta > 0);
  
  if (top || bottom) {  // if top / bottom scroll beyond page
    const scrollPromise = (top) => new Promise((resolve) => {
      window.addEventListener('scrollend', resolve, { once: true });
      window.scrollBy({ top, behavior: 'smooth' });
    });
    
    scrollPromise(-delta).then(() => window.scrollBy({ top: delta, behavior: 'smooth' }));
  } else {
    window.scrollBy({ top: delta, behavior: 'smooth' });
  }
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
    if (!isLocateActive && request.locate) ensurePricesWrapped();
    setLocateMode(request.locate);
    sendResponse({ status: 'done' });

  } else if (request.action === 'toggleFollow') {
    if (!isFollowingPrice && request.follow) ensurePricesWrapped();
    setFollowPrice(request.follow);
    sendResponse({ status: 'done' });

  } else if (request.action === 'adjustPrices') {
    if (request.pct) {
      adjustPrices(request.pct, request.direction);
      flashPage(request.direction);
      scrollPage(request.pct, request.direction);
    }
    sendResponse({ status: 'done' });

  } else if (request.action === 'setPrices') {
    lastPrice = request.price;
    console.log(`[Market Price] price received: ${lastPrice} (${request.direction} ${request.pct})`);
    if (isFollowingPrice && request.price) {
      setPrices(request.price, request.direction);
    }
    // if (request.pct || (isFollowingPrice && request.price)) {
    if (request.pct) {
      flashPage(request.direction);
      scrollPage(request.pct, request.direction);
    }
    sendResponse({ status: 'done' });
  }
});

// Restore locate state if saved
chrome.storage.sync.get(['alwaysFollow'], (data) => {
  if (data.alwaysFollow) {
    ensurePricesWrapped();
    observeDynamicContent();
  }
  setFollowPrice(data.alwaysFollow);
});