/**
 * AIO Downloader — TeraBox Token Sync
 * Background service worker: reads HttpOnly ndus cookie and pushes it to the backend.
 */

const BACKEND_URL = 'http://localhost:4000';

/**
 * Read the ndus cookie from any terabox domain.
 * HttpOnly cookies are invisible to document.cookie — chrome.cookies is the only
 * client-side API that can read them.
 */
async function getNdusCookie() {
  const domains = [
    'terabox.com',
    '1024terabox.com',
    'terabox.app',
    'freeterabox.com',
    '4funbox.com',
    'mirrobox.com',
    'nephobox.com',
    'teraboxshare.com',
    'teraboxlink.com',
    'momerybox.com',
    'tibibox.com',
  ];

  for (const domain of domains) {
    try {
      const cookie = await chrome.cookies.get({
        url: `https://www.${domain}`,
        name: 'ndus',
      });
      if (cookie?.value) {
        return { domain, cookieValue: cookie.value };
      }
    } catch {
      // Domain not visited or no cookie — try next
    }
  }

  // Also check www. variants
  for (const domain of domains) {
    try {
      const cookie = await chrome.cookies.get({
        url: `https://${domain}`,
        name: 'ndus',
      });
      if (cookie?.value) {
        return { domain, cookieValue: cookie.value };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Push the ndus token to the backend config endpoint.
 */
async function syncToBackend(ndusValue) {
  const formatted = `lang=en; ndus=${ndusValue.trim()}`;

  const res = await fetch(`${BACKEND_URL}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie: formatted, mode: 'hybrid' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend responded ${res.status}: ${text}`);
  }

  return await res.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'captureNdus') {
    return;
  }

  (async () => {
    try {
      const found = await getNdusCookie();
      if (!found) {
        sendResponse({
          ok: false,
          status: 'not_found',
          message: 'No ndus cookie found. Make sure you are logged in to TeraBox in this browser.',
        });
        return;
      }

      const result = await syncToBackend(found.cookieValue);
      sendResponse({
        ok: true,
        status: 'captured',
        message: 'ndus token captured and synced to backend.',
        backend: result,
        source: found.domain,
      });
    } catch (err) {
      sendResponse({
        ok: false,
        status: 'error',
        message: err.message || 'Failed to capture cookie.',
      });
    }
  })();

  // Return true to indicate async response
  return true;
});
