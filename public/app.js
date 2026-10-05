/**
 * AIO Backend Control Center — Frontend Controller
 */

// State
let currentConfig = {
  mode: 'hybrid',
  hasCookie: false,
  maskedCookie: '',
};

let lastResolvedData = null;

// DOM Elements
const serverStatusPill = document.getElementById('server-status-pill');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
const metricUptime = document.getElementById('metric-uptime');
const btnRefreshHealth = document.getElementById('btn-refresh-health');
const refreshIcon = document.getElementById('refresh-icon');

// Mode & Cookie
const activeModeBadge = document.getElementById('active-mode-badge');
const radioHybrid = document.getElementById('radio-mode-hybrid');
const radioAuto = document.getElementById('radio-mode-auto');
const radioCustom = document.getElementById('radio-mode-custom');
const customCookieInput = document.getElementById('custom-cookie-input');
const btnToggleVisibility = document.getElementById('btn-toggle-cookie-visibility');
const toggleEyeIcon = document.getElementById('toggle-eye-icon');
const cookieStatusIndicator = document.getElementById('cookie-status-indicator');
const btnTestCookie = document.getElementById('btn-test-cookie');
const btnTestCookieText = document.getElementById('btn-test-cookie-text');
const btnSaveConfig = document.getElementById('btn-save-config');
const btnSaveConfigText = document.getElementById('btn-save-config-text');
const cookieTestBanner = document.getElementById('cookie-test-banner');
const bannerIcon = document.getElementById('banner-icon');
const bannerMessage = document.getElementById('banner-message');
const bannerLatency = document.getElementById('banner-latency');

// Guide Accordion
const btnGuideToggle = document.getElementById('btn-guide-toggle');
const guideContent = document.getElementById('guide-content');

// Expiry Alert Banner & Auto-Capture Modal
const expiryWarningBanner = document.getElementById('expiry-warning-banner');
const btnBannerLoginCapture = document.getElementById('btn-banner-login-capture');
const btnOpenAutoCapture = document.getElementById('btn-open-auto-capture');
const modalAutoCapture = document.getElementById('modal-auto-capture');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnModalDone = document.getElementById('btn-modal-done');
const modalBodySteps = document.getElementById('modal-body-steps');
const modalBodySuccess = document.getElementById('modal-body-success');
const capturedTokenPreview = document.getElementById('captured-token-preview');
const syncBookmarkletLink = document.getElementById('sync-bookmarklet-link');
const btnOpenTeraboxTab = document.getElementById('btn-open-terabox-tab');

let capturePollInterval = null;
let lastKnownMaskedCookie = '';

// Telemetry
const telemetryTbody = document.getElementById('telemetry-tbody');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Resolver Sandbox
const resolveForm = document.getElementById('resolve-form');
const resolveInputUrl = document.getElementById('resolve-input-url');
const btnResolve = document.getElementById('btn-resolve');
const btnResolveText = document.getElementById('btn-resolve-text');
const btnResolveIcon = document.getElementById('btn-resolve-icon');
const sampleTbBtn = document.getElementById('sample-tb-btn');
const sampleTwBtn = document.getElementById('sample-tw-btn');

const resolveResultBox = document.getElementById('resolve-result-box');
const resolveSkeleton = document.getElementById('resolve-skeleton');
const resolveErrorCard = document.getElementById('resolve-error-card');
const errorTitle = document.getElementById('error-title');
const errorDesc = document.getElementById('error-desc');
const resolveSuccessCard = document.getElementById('resolve-success-card');

const resultPlatformBadge = document.getElementById('result-platform-badge');
const resultMethodBadge = document.getElementById('result-method-badge');
const resultItemsCount = document.getElementById('result-items-count');
const mediaThumbImg = document.getElementById('media-thumb-img');
const mediaKindBadge = document.getElementById('media-kind-badge');
const mediaFilename = document.getElementById('media-filename');
const mediaSizeTag = document.getElementById('media-size-tag');
const mediaTypeTag = document.getElementById('media-type-tag');
const mediaDurationTag = document.getElementById('media-duration-tag');
const btnDownloadFile = document.getElementById('btn-download-file');
const btnStreamPreview = document.getElementById('btn-stream-preview');
const btnCopyStreamUrl = document.getElementById('btn-copy-stream-url');
const btnToggleJson = document.getElementById('btn-toggle-json');
const rawJsonContainer = document.getElementById('raw-json-container');
const rawJsonCode = document.getElementById('raw-json-code');
const btnCopyJson = document.getElementById('btn-copy-json');

// Snippet Host placeholders
const curlHost1 = document.getElementById('curl-host-1');
const btnCopyPostCurl = document.getElementById('btn-copy-post-curl');
const btnCopyGetCurl = document.getElementById('btn-copy-get-curl');

// Toast Container
const toastContainer = document.getElementById('toast-container');

// ============================================================================
// Helpers
// ============================================================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon =
    type === 'success'
      ? 'fa-circle-check'
      : type === 'error'
      ? 'fa-circle-xmark'
      : type === 'warning'
      ? 'fa-triangle-exclamation'
      : 'fa-circle-info';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
  if (!seconds) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast(successMsg, 'success'));
  } else {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast(successMsg, 'success');
  }
}

// ============================================================================
// Health & Config Fetchers
// ============================================================================

async function fetchHealth() {
  refreshIcon.classList.add('fa-spin');
  try {
    const res = await fetch('/health');
    const data = await res.json();

    if (data.ok) {
      serverStatusPill.className = 'status-pill';
      statusLabel.textContent = 'Server Online';
      metricUptime.textContent = formatUptime(data.uptime);
    } else {
      serverStatusPill.className = 'status-pill warning';
      statusLabel.textContent = 'Degraded';
    }
  } catch (err) {
    serverStatusPill.className = 'status-pill danger';
    statusLabel.textContent = 'Disconnected';
    metricUptime.textContent = 'Offline';
  } finally {
    setTimeout(() => refreshIcon.classList.remove('fa-spin'), 400);
  }
}

async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    currentConfig = data;

    // Update active mode radio & badge
    applyModeUI(data.mode || 'hybrid');

    // Update cookie status indicator
    if (data.hasCookie) {
      cookieStatusIndicator.className = 'cookie-status-text active';
      cookieStatusIndicator.innerHTML = `<i class="fa-solid fa-circle-check"></i> Configured (${data.maskedCookie || 'ndus'})`;
      if (!customCookieInput.value) {
        customCookieInput.placeholder = `Current token: ${data.maskedCookie || 'Configured'}`;
      }
    } else {
      cookieStatusIndicator.className = 'cookie-status-text warning';
      cookieStatusIndicator.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> No cookie configured`;
    }
  } catch (err) {
    console.warn('Failed to fetch config:', err);
  }
}

async function fetchLogs() {
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    renderLogs(logs);
  } catch {
    // ignore
  }
}

function renderLogs(logs = []) {
  if (!logs || logs.length === 0) {
    telemetryTbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">No recent requests recorded. Test a link below!</td>
      </tr>
    `;
    return;
  }

  telemetryTbody.innerHTML = logs
    .slice(0, 10)
    .map((log) => {
      const isOk = log.status >= 200 && log.status < 400;
      const statusClass = isOk ? 'tag-status-ok' : 'tag-status-err';
      const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      return `
        <tr>
          <td>${timeStr}</td>
          <td><code>${log.method || 'POST'}</code></td>
          <td><strong>${log.platform || 'api'}</strong></td>
          <td class="${statusClass}">${log.status}</td>
          <td>${log.latencyMs ? log.latencyMs + 'ms' : '--'}</td>
        </tr>
      `;
    })
    .join('');
}

function applyModeUI(mode) {
  activeModeBadge.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);

  if (mode === 'auto') {
    radioAuto.checked = true;
    activeModeBadge.style.color = '#38bdf8';
  } else if (mode === 'custom') {
    radioCustom.checked = true;
    activeModeBadge.style.color = '#a5b4fc';
  } else {
    radioHybrid.checked = true;
    activeModeBadge.style.color = '#fbbf24';
  }
}

// ============================================================================
// Event Listeners: Mode, Cookie, and Guide
// ============================================================================

// Radio mode change
document.querySelectorAll('input[name="tb-mode"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    applyModeUI(e.target.value);
  });
});

// Toggle cookie password visibility
btnToggleVisibility.addEventListener('click', () => {
  if (customCookieInput.type === 'password') {
    customCookieInput.type = 'text';
    toggleEyeIcon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    customCookieInput.type = 'password';
    toggleEyeIcon.classList.replace('fa-eye-slash', 'fa-eye');
  }
});

// Guide accordion
btnGuideToggle.addEventListener('click', () => {
  const isExpanded = btnGuideToggle.getAttribute('aria-expanded') === 'true';
  btnGuideToggle.setAttribute('aria-expanded', !isExpanded);
  guideContent.classList.toggle('hidden', isExpanded);
});

// Test Cookie button
btnTestCookie.addEventListener('click', async () => {
  const cookieValue = customCookieInput.value.trim();

  btnTestCookie.disabled = true;
  btnTestCookieText.textContent = 'Testing...';
  cookieTestBanner.className = 'test-banner hidden';

  try {
    const res = await fetch('/api/test-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookieValue }),
    });
    const result = await res.json();

    cookieTestBanner.classList.remove('hidden');
    bannerLatency.textContent = `${result.latencyMs || 0}ms`;

    if (result.ok) {
      cookieTestBanner.className = 'test-banner active';
      bannerIcon.className = 'fa-solid fa-circle-check banner-icon';
      bannerMessage.textContent = 'Cookie is active and verified by TeraBox!';
      showToast('TeraBox session is active!', 'success');
    } else if (result.status === 'need_verify') {
      cookieTestBanner.className = 'test-banner warning';
      bannerIcon.className = 'fa-solid fa-triangle-exclamation banner-icon';
      bannerMessage.textContent = 'Cookie requires verification / expired. Please grab a fresh ndus token.';
      showToast('Cookie expired or requires verification', 'warning');
    } else {
      cookieTestBanner.className = 'test-banner error';
      bannerIcon.className = 'fa-solid fa-circle-xmark banner-icon';
      bannerMessage.textContent = result.message || 'Cookie test failed';
      showToast(result.message || 'Cookie test failed', 'error');
    }
  } catch (err) {
    cookieTestBanner.className = 'test-banner error';
    bannerIcon.className = 'fa-solid fa-circle-xmark banner-icon';
    bannerMessage.textContent = 'Network error testing cookie: ' + err.message;
    showToast('Failed to reach backend test endpoint', 'error');
  } finally {
    btnTestCookie.disabled = false;
    btnTestCookieText.textContent = 'Test Cookie';
  }
});

// Save & Apply Config
btnSaveConfig.addEventListener('click', async () => {
  const selectedMode = document.querySelector('input[name="tb-mode"]:checked')?.value || 'hybrid';
  const cookieValue = customCookieInput.value.trim();

  btnSaveConfig.disabled = true;
  btnSaveConfigText.textContent = 'Saving...';

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: selectedMode,
        cookie: cookieValue || undefined,
      }),
    });
    const data = await res.json();

    if (data.ok) {
      showToast(`Saved! Active mode: ${selectedMode.toUpperCase()}`, 'success');
      await fetchConfig();
      if (cookieValue) {
        customCookieInput.value = '';
      }
    } else {
      showToast(data.error?.message || 'Failed to save configuration', 'error');
    }
  } catch (err) {
    showToast('Network error saving configuration', 'error');
  } finally {
    btnSaveConfig.disabled = false;
    btnSaveConfigText.textContent = 'Save & Apply Config';
  }
});

// Clear Logs
btnClearLogs.addEventListener('click', () => {
  renderLogs([]);
});

// Refresh Health
btnRefreshHealth.addEventListener('click', () => {
  fetchHealth();
  fetchConfig();
  fetchLogs();
});

// ============================================================================
// Sandbox & Resolver
// ============================================================================

sampleTbBtn.addEventListener('click', () => {
  resolveInputUrl.value = 'https://1024terabox.com/s/13jzq7oaclcdX9hd8-jS04w';
});

sampleTwBtn.addEventListener('click', () => {
  resolveInputUrl.value = 'https://x.com/jack/status/20';
});

resolveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = resolveInputUrl.value.trim();
  if (!url) return;

  // UI loading state
  btnResolve.disabled = true;
  btnResolveText.textContent = 'Resolving...';
  btnResolveIcon.className = 'fa-solid fa-spinner fa-spin';

  resolveResultBox.classList.remove('hidden');
  resolveSkeleton.classList.remove('hidden');
  resolveErrorCard.classList.add('hidden');
  resolveSuccessCard.classList.add('hidden');
  rawJsonContainer.classList.add('hidden');

  try {
    const res = await fetch('/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();
    lastResolvedData = data;

    resolveSkeleton.classList.add('hidden');

    if (!res.ok || data.error) {
      resolveErrorCard.classList.remove('hidden');
      errorTitle.textContent = data.error?.code || 'Resolution Error';
      errorDesc.textContent = data.error?.message || 'Failed to resolve URL with current parameters.';
      showToast(data.error?.message || 'Resolution failed', 'error');
    } else {
      resolveSuccessCard.classList.remove('hidden');
      renderSuccessResult(data);
      showToast('Media resolved successfully!', 'success');
    }
  } catch (err) {
    resolveSkeleton.classList.add('hidden');
    resolveErrorCard.classList.remove('hidden');
    errorTitle.textContent = 'Network Error';
    errorDesc.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    btnResolve.disabled = false;
    btnResolveText.textContent = 'Resolve Link';
    btnResolveIcon.className = 'fa-solid fa-magnifying-glass';
    // refresh telemetry
    setTimeout(fetchLogs, 500);
  }
});

function renderSuccessResult(data) {
  const items = data.items || [];
  const firstItem = items[0] || {};

  resultPlatformBadge.textContent = data.platform?.toUpperCase() || 'TERABOX';
  resultMethodBadge.textContent = (data.modeUsed || firstItem.methodUsed || 'Hybrid').toUpperCase();
  resultItemsCount.textContent = `${items.length} ${items.length === 1 ? 'file' : 'files'}`;

  // Thumbnail
  if (firstItem.thumbnail) {
    mediaThumbImg.src = firstItem.thumbnail;
    mediaThumbImg.style.display = 'block';
  } else {
    mediaThumbImg.style.display = 'none';
  }

  // Media Kind Badge
  const kind = firstItem.kind || 'file';
  const kindIcon =
    kind === 'video'
      ? 'fa-video'
      : kind === 'image'
      ? 'fa-image'
      : kind === 'audio'
      ? 'fa-music'
      : 'fa-file';
  mediaKindBadge.innerHTML = `<i class="fa-solid ${kindIcon}"></i>`;

  // Details
  mediaFilename.textContent = firstItem.filename || data.shareTitle || 'Media File';
  mediaFilename.title = mediaFilename.textContent;

  mediaSizeTag.innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${formatBytes(firstItem.sizeBytes)}`;
  mediaTypeTag.innerHTML = `<i class="fa-solid fa-file"></i> ${firstItem.mimeType || 'binary'}`;

  if (firstItem.durationSeconds) {
    const mins = Math.floor(firstItem.durationSeconds / 60);
    const secs = firstItem.durationSeconds % 60;
    mediaDurationTag.classList.remove('hidden');
    mediaDurationTag.innerHTML = `<i class="fa-regular fa-clock"></i> ${mins}m ${secs}s`;
  } else {
    mediaDurationTag.classList.add('hidden');
  }

  // Buttons
  const downloadUrl = firstItem.url || data.sourceUrl || '#';
  btnDownloadFile.href = downloadUrl;
  btnDownloadFile.setAttribute('download', firstItem.filename || 'download');

  btnDownloadFile.onclick = (e) => {
    if (!firstItem.originalDlink && !firstItem.url.includes('/api/download')) {
      e.preventDefault();
      showToast('Opening original link for direct download...', 'info');
      window.open(data.sourceUrl, '_blank');
      return;
    }
    showToast('Download started for ' + (firstItem.filename || 'media'), 'success');
  };

  btnStreamPreview.href = downloadUrl;
  btnCopyStreamUrl.onclick = () => {
    copyToClipboard(downloadUrl, 'Download stream link copied!');
  };

  // JSON Preview
  rawJsonCode.textContent = JSON.stringify(data, null, 2);
}

// Toggle JSON view
btnToggleJson.addEventListener('click', () => {
  rawJsonContainer.classList.toggle('hidden');
});

btnCopyJson.addEventListener('click', () => {
  if (lastResolvedData) {
    copyToClipboard(JSON.stringify(lastResolvedData, null, 2), 'JSON copied to clipboard!');
  }
});

// Copy cURL snippets
btnCopyPostCurl.addEventListener('click', () => {
  const host = window.location.origin;
  const curlCmd = `curl -X POST ${host}/resolve \\\n  -H "Content-Type: application/json" \\\n  -d '{"url": "https://1024terabox.com/s/13jzq7oaclcdX9hd8-jS04w"}'`;
  copyToClipboard(curlCmd, 'POST cURL copied!');
});

btnCopyGetCurl.addEventListener('click', () => {
  const host = window.location.origin;
  copyToClipboard(`${host}/api/download?dlink=...&filename=...`, 'Download URL format copied!');
});

// ============================================================================
// Auto-Capture Modal & Expiry Alert Controller
// ============================================================================

function setupBookmarklet() {
  const host = window.location.origin;
  // Bookmarklet code that extracts ndus cookie from terabox.com and posts to our backend
  const bookmarkletCode = `javascript:(function(){try{const m=document.cookie.match(/(?:^|;\\s*)ndus=([^;]+)/);if(!m){alert('⚠️ No active TeraBox session found. Please log in to terabox.com first!');return;}const t=m[1];fetch('${host}/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookie:t,mode:'hybrid'})}).then(r=>r.json()).then(d=>{alert('🎉 Success! TeraBox session key (ndus) auto-captured and saved to AIO Downloader!');}).catch(e=>{window.open('${host}/api/capture-cookie?ndus='+encodeURIComponent(t),'_blank');});}catch(err){alert('Error: '+err.message);}})();`;

  if (syncBookmarkletLink) {
    syncBookmarkletLink.href = bookmarkletCode;
  }
}

async function checkCookieHealth() {
  try {
    const res = await fetch('/api/test-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();

    if (!data.ok || data.status === 'need_verify') {
      expiryWarningBanner.classList.remove('hidden');
    } else {
      expiryWarningBanner.classList.add('hidden');
    }
  } catch {
    // ignore
  }
}

function openAutoCaptureModal() {
  modalAutoCapture.classList.remove('hidden');
  modalBodySteps.classList.remove('hidden');
  modalBodySuccess.classList.add('hidden');

  // Start polling to detect if the token was captured
  if (capturePollInterval) clearInterval(capturePollInterval);

  lastKnownMaskedCookie = currentConfig.maskedCookie || '';

  capturePollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();

      // If a new cookie has been set or updated
      if (data.hasCookie && data.maskedCookie && data.maskedCookie !== lastKnownMaskedCookie) {
        clearInterval(capturePollInterval);
        capturePollInterval = null;
        currentConfig = data;

        // Transition modal to success view
        modalBodySteps.classList.add('hidden');
        modalBodySuccess.classList.remove('hidden');
        capturedTokenPreview.textContent = `ndus=${data.maskedCookie}`;

        // Hide expiry alert
        expiryWarningBanner.classList.add('hidden');
        showToast('TeraBox session key auto-captured!', 'success');

        fetchConfig();
        fetchLogs();
      }
    } catch {
      // ignore
    }
  }, 2000);
}

function closeAutoCaptureModal() {
  modalAutoCapture.classList.add('hidden');
  if (capturePollInterval) {
    clearInterval(capturePollInterval);
    capturePollInterval = null;
  }
}

// Modal Event Listeners
btnOpenAutoCapture.addEventListener('click', openAutoCaptureModal);
btnBannerLoginCapture.addEventListener('click', openAutoCaptureModal);
btnCloseModal.addEventListener('click', closeAutoCaptureModal);
btnModalDone.addEventListener('click', closeAutoCaptureModal);

// Close modal when clicking outside dialog
modalAutoCapture.addEventListener('click', (e) => {
  if (e.target === modalAutoCapture) {
    closeAutoCaptureModal();
  }
});

// ============================================================================
// Initialization
// ============================================================================

window.addEventListener('DOMContentLoaded', () => {
  // Update host in curl snippet
  if (curlHost1) {
    curlHost1.textContent = window.location.origin;
  }

  setupBookmarklet();
  fetchHealth();
  fetchConfig();
  fetchLogs();
  checkCookieHealth();

  // Polling for health, logs, and cookie health every 25s
  setInterval(() => {
    fetchHealth();
    fetchLogs();
    checkCookieHealth();
  }, 25000);
});
