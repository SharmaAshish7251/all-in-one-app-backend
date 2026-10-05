/**
 * AIO Downloader — TeraBox Token Sync popup
 */

const btnCapture = document.getElementById('btnCapture');
const statusBox = document.getElementById('status');
const hintBox = document.getElementById('hint');

function setStatus(message, type = 'info') {
  statusBox.textContent = message;
  statusBox.className = `status ${type} visible`;
}

function setLoading(loading) {
  btnCapture.disabled = loading;
  btnCapture.innerHTML = loading
    ? '<div class="spinner"></div> Capturing…'
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg> Capture ndus Token`;
}

btnCapture.addEventListener('click', async () => {
  setLoading(true);
  setStatus('Reading ndus cookie from Chrome…', 'info');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'captureNdus' });

    if (response.ok) {
      setStatus(`✅ ${response.message} (from ${response.source})`, 'success');
      hintBox.style.display = 'none';
    } else {
      const type =
        response.status === 'not_found' ? 'warning' : 'error';
      setStatus(`❌ ${response.message}`, type);
    }
  } catch (err) {
    setStatus(`❌ Extension error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
});
