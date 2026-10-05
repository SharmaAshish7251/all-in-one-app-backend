import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isTeraBoxUrl, resolveTeraBox, testTeraBoxCookie, formatCookie } from './resolvers/terabox.js';
import { isTwitterUrl, resolveTwitter } from './resolvers/twitter.js';
import { handleStreamDownload } from './proxy/stream.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, '..', 'public');
const envPath = path.join(__dirname, '..', '.env');

const app = express();
const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// In-memory dynamic configuration (can be updated from dashboard without restarting)
let runtimeConfig = {
  teraboxCookie: process.env.TERABOX_COOKIE || '',
  teraboxMode: process.env.TERABOX_MODE || 'hybrid', // 'hybrid' | 'auto' | 'custom'
};

// In-memory circular buffer for recent request logs (up to 30 items)
const recentLogs = [];

function addLogEntry(entry) {
  recentLogs.unshift({
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (recentLogs.length > 30) {
    recentLogs.pop();
  }
}

/**
 * Persist config changes to .env file
 */
function persistConfigToEnv(cookie, mode) {
  try {
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
    }

    if (cookie !== undefined) {
      if (content.includes('TERABOX_COOKIE=')) {
        content = content.replace(/TERABOX_COOKIE=.*/g, `TERABOX_COOKIE=${cookie}`);
      } else {
        content += `\nTERABOX_COOKIE=${cookie}`;
      }
    }

    if (mode !== undefined) {
      if (content.includes('TERABOX_MODE=')) {
        content = content.replace(/TERABOX_MODE=.*/g, `TERABOX_MODE=${mode}`);
      } else {
        content += `\nTERABOX_MODE=${mode}`;
      }
    }

    fs.writeFileSync(envPath, content.trim() + '\n', 'utf8');
  } catch (err) {
    console.warn('[Config] Failed to write .env file:', err.message);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${req.method}] ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Root Endpoint — Serves Dashboard for browsers, JSON for API tools
app.get('/', (req, res) => {
  const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
  if (acceptsHtml) {
    return res.sendFile(path.join(publicPath, 'index.html'));
  }

  res.json({
    name: 'All-in-One Downloader Backend',
    status: 'running',
    dashboardUrl: `${BASE_URL}/dashboard`,
    supportedPlatforms: ['terabox', 'twitter/x'],
    endpoints: {
      dashboard: 'GET /dashboard',
      health: 'GET /health',
      resolvePost: 'POST /resolve { url: "..." }',
      resolveGet: 'GET /api/resolve?url=...',
      streamDownload: 'GET /api/download?dlink=...&filename=...',
      configGet: 'GET /api/config',
      configPost: 'POST /api/config',
      testCookie: 'POST /api/test-cookie',
    },
    teraboxMode: runtimeConfig.teraboxMode,
    teraboxCookieConfigured: Boolean(runtimeConfig.teraboxCookie),
  });
});

// Explicit Dashboard route
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    uptime: process.uptime(),
    teraboxConfigured: Boolean(runtimeConfig.teraboxCookie),
    teraboxMode: runtimeConfig.teraboxMode,
    timestamp: new Date().toISOString(),
  });
});

// Configuration API
app.get('/api/config', (req, res) => {
  const cookie = runtimeConfig.teraboxCookie || '';
  let maskedCookie = '';
  if (cookie) {
    maskedCookie = cookie.length > 12 ? `${cookie.slice(0, 4)}...${cookie.slice(-4)}` : '••••••••';
  }

  res.json({
    mode: runtimeConfig.teraboxMode,
    hasCookie: Boolean(cookie),
    maskedCookie,
  });
});

app.post('/api/config', (req, res) => {
  const { cookie, mode } = req.body || {};

  if (mode && ['hybrid', 'auto', 'custom'].includes(mode)) {
    runtimeConfig.teraboxMode = mode;
  }

  if (typeof cookie === 'string') {
    runtimeConfig.teraboxCookie = cookie.trim();
  }

  // Persist to .env
  persistConfigToEnv(runtimeConfig.teraboxCookie, runtimeConfig.teraboxMode);

  res.json({
    ok: true,
    message: 'Configuration updated successfully.',
    mode: runtimeConfig.teraboxMode,
    hasCookie: Boolean(runtimeConfig.teraboxCookie),
  });
});

// Auto-Capture Cookie Endpoint (called by bookmarklet or redirect from TeraBox)
app.get('/api/capture-cookie', (req, res) => {
  const { ndus } = req.query;
  if (!ndus || typeof ndus !== 'string') {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <body style="background:#080c16;color:#f43f5e;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;text-align:center;">
          <h2>❌ Missing ndus token</h2>
          <p style="color:#94a3b8;">No cookie was detected to capture.</p>
        </body>
      </html>
    `);
  }

  const cleanCookie = ndus.trim();
  runtimeConfig.teraboxCookie = cleanCookie;
  persistConfigToEnv(runtimeConfig.teraboxCookie, runtimeConfig.teraboxMode);

  addLogEntry({
    method: 'GET',
    url: '/api/capture-cookie',
    platform: 'terabox-auth',
    status: 200,
    latencyMs: 1,
  });

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>TeraBox Token Auto-Captured!</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style="background:#080c16;color:#10b981;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;margin:0;padding:20px;text-align:center;">
        <div style="background:rgba(14,21,37,0.9);border:1px solid rgba(16,185,129,0.3);padding:32px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,0.5);max-width:400px;">
          <div style="font-size:48px;margin-bottom:12px;">🎉</div>
          <h2 style="margin:0 0 8px 0;color:#34d399;">Session Key Auto-Captured!</h2>
          <p style="color:#94a3b8;font-size:14px;line-height:1.5;">Your <code>ndus</code> token has been saved to the AIO Downloader backend automatically.</p>
          <div style="margin-top:20px;font-size:12px;color:#64748b;">Closing in <span id="sec">2</span>s...</div>
        </div>
        <script>
          let s = 2;
          const timer = setInterval(() => {
            s--;
            const el = document.getElementById('sec');
            if (el) el.textContent = s;
            if (s <= 0) {
              clearInterval(timer);
              window.close();
            }
          }, 1000);
        </script>
      </body>
    </html>
  `);
});

// Test TeraBox Cookie API
app.post('/api/test-cookie', async (req, res) => {
  const candidate = typeof req.body?.cookie === 'string' && req.body.cookie.trim()
    ? req.body.cookie.trim()
    : runtimeConfig.teraboxCookie;

  const result = await testTeraBoxCookie(candidate);
  res.json(result);
});

// Logs API
app.get('/api/logs', (req, res) => {
  res.json(recentLogs);
});

/**
 * Common resolver logic used by both POST /resolve and GET /api/resolve
 */
async function handleResolve(url, res, method = 'POST') {
  const start = Date.now();

  if (!url || typeof url !== 'string') {
    addLogEntry({ method, url: '(none)', platform: 'unknown', status: 400, latencyMs: 0 });
    return res.status(400).json({
      error: { code: 'INVALID_URL', message: 'Missing or invalid "url" parameter.' },
    });
  }

  const cleanUrl = url.trim();

  try {
    // 1. TeraBox check
    if (isTeraBoxUrl(cleanUrl)) {
      const result = await resolveTeraBox(cleanUrl, {
        cookie: runtimeConfig.teraboxCookie,
        mode: runtimeConfig.teraboxMode,
        backendBaseUrl: BASE_URL,
      });

      const latencyMs = Date.now() - start;
      addLogEntry({ method, url: cleanUrl, platform: 'terabox', status: 200, latencyMs });
      return res.json(result);
    }

    // 2. Twitter / X check
    if (isTwitterUrl(cleanUrl)) {
      const result = await resolveTwitter(cleanUrl);
      const latencyMs = Date.now() - start;
      addLogEntry({ method, url: cleanUrl, platform: 'twitter', status: 200, latencyMs });
      return res.json(result);
    }

    // 3. Unsupported
    const latencyMs = Date.now() - start;
    addLogEntry({ method, url: cleanUrl, platform: 'unsupported', status: 422, latencyMs });
    return res.status(422).json({
      error: {
        code: 'UNSUPPORTED_URL',
        message: `URL not currently supported by backend: ${cleanUrl}`,
      },
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    console.error(`[Resolve Error] ${cleanUrl}:`, err.message);
    addLogEntry({ method, url: cleanUrl, platform: isTeraBoxUrl(cleanUrl) ? 'terabox' : 'unknown', status: 400, latencyMs, error: err.message });
    return res.status(400).json({
      error: {
        code: 'RESOLVE_FAILED',
        message: err.message,
      },
    });
  }
}

// POST /resolve — matches mobile app contract
app.post('/resolve', async (req, res) => {
  const { url } = req.body || {};
  await handleResolve(url, res, 'POST');
});

// GET /api/resolve — convenient for testing via browser
app.get('/api/resolve', async (req, res) => {
  const { url } = req.query;
  await handleResolve(url, res, 'GET');
});

// GET /api/download — direct streaming proxy for TeraBox files
app.get('/api/download', async (req, res) => {
  await handleStreamDownload(req, res, runtimeConfig.teraboxCookie);
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log('----------------------------------------------------');
  console.log(`🚀 All-in-One Downloader Backend running on port ${PORT}`);
  console.log(`🔗 Local URL: ${BASE_URL}`);
  console.log(`📊 Admin Dashboard: ${BASE_URL}/dashboard`);
  console.log(`⚙️  TeraBox Mode: ${runtimeConfig.teraboxMode.toUpperCase()}`);
  console.log(`🍪 TeraBox Cookie configured: ${runtimeConfig.teraboxCookie ? 'YES' : 'NO'}`);
  console.log('----------------------------------------------------');
});
