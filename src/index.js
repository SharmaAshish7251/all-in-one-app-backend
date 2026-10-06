import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isTeraBoxUrl, resolveTeraBox, testTeraBoxCookie, formatCookie } from './resolvers/terabox.js';
import { isTwitterUrl, resolveTwitter } from './resolvers/twitter.js';
import { isInstagramUrl, resolveInstagram } from './resolvers/instagram.js';
import { isPinterestUrl, resolvePinterest } from './resolvers/pinterest.js';
import { isYouTubeUrl, resolveYouTube, getYouTubeCookieFilePath, saveYouTubeCookies } from './resolvers/youtube.js';
import { handleStreamDownload } from './proxy/stream.js';
import { handleYouTubeDownload } from './proxy/youtube.js';
import { handleInstagramDownload } from './proxy/instagram.js';
import { handlePinterestDownload } from './proxy/pinterest.js';

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
  teraboxMode: process.env.TERABOX_MODE || 'hybrid', // 'hybrid' | 'auto' | 'custom' | 'rapidapi'
  rapidApiKey: process.env.RAPIDAPI_KEY || '',
  rapidApiHost: process.env.RAPIDAPI_HOST || 'terabox-downloader-api5.p.rapidapi.com',
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
function persistConfigToEnv(cookie, mode, rapidApiKey) {
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

    if (rapidApiKey !== undefined) {
      if (content.includes('RAPIDAPI_KEY=')) {
        content = content.replace(/RAPIDAPI_KEY=.*/g, `RAPIDAPI_KEY=${rapidApiKey}`);
      } else {
        content += `\nRAPIDAPI_KEY=${rapidApiKey}`;
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
    supportedPlatforms: ['terabox', 'twitter/x', 'youtube', 'instagram', 'pinterest'],
    endpoints: {
      dashboard: 'GET /dashboard',
      health: 'GET /health',
      resolvePost: 'POST /resolve { url: "..." }',
      resolveGet: 'GET /api/resolve?url=...',
      streamDownload: 'GET /api/download?dlink=...&filename=...',
      youtubeDownload: 'GET /api/youtube/download?id=...&format=...&filename=...',
      pinterestDownload: 'GET /api/pinterest/download?url=...&videoFormatId=...&audioFormatId=...',
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
    rapidApiConfigured: Boolean(runtimeConfig.rapidApiKey),
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

  const apiKey = runtimeConfig.rapidApiKey || '';
  let maskedRapidApiKey = '';
  if (apiKey) {
    maskedRapidApiKey = apiKey.length > 12 ? `${apiKey.slice(0, 5)}...${apiKey.slice(-4)}` : '••••••••';
  }

  const hasYouTubeCookie = Boolean(getYouTubeCookieFilePath());

  res.json({
    mode: runtimeConfig.teraboxMode,
    hasCookie: Boolean(cookie),
    maskedCookie,
    hasRapidApi: Boolean(apiKey),
    maskedRapidApiKey,
    hasYouTubeCookie,
  });
});

app.post('/api/config', (req, res) => {
  const { cookie, mode, rapidApiKey, youtubeCookie } = req.body || {};

  if (mode && ['hybrid', 'auto', 'custom', 'rapidapi'].includes(mode)) {
    runtimeConfig.teraboxMode = mode;
  }

  if (typeof cookie === 'string') {
    runtimeConfig.teraboxCookie = cookie.trim();
  }

  if (typeof rapidApiKey === 'string') {
    runtimeConfig.rapidApiKey = rapidApiKey.trim();
  }

  if (typeof youtubeCookie === 'string' && youtubeCookie.trim()) {
    saveYouTubeCookies(youtubeCookie);
  }

  // Persist to .env
  persistConfigToEnv(runtimeConfig.teraboxCookie, runtimeConfig.teraboxMode, runtimeConfig.rapidApiKey);

  res.json({
    ok: true,
    message: 'Configuration updated successfully.',
    mode: runtimeConfig.teraboxMode,
    hasCookie: Boolean(runtimeConfig.teraboxCookie),
    hasRapidApi: Boolean(runtimeConfig.rapidApiKey),
    hasYouTubeCookie: Boolean(getYouTubeCookieFilePath()),
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
async function handleResolve(req, res, method = 'POST') {
  const start = Date.now();
  const url = method === 'POST' ? req.body?.url : req.query?.url;

  if (!url || typeof url !== 'string') {
    addLogEntry({ method, url: '(none)', platform: 'unknown', status: 400, latencyMs: 0 });
    return res.status(400).json({
      error: { code: 'INVALID_URL', message: 'Missing or invalid "url" parameter.' },
    });
  }

  const cleanUrl = url.trim();
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.get('host') || `localhost:${PORT}`;
  const effectiveBaseUrl = `${protocol}://${host}`;

  try {
    // 1. TeraBox check
    if (isTeraBoxUrl(cleanUrl)) {
      const result = await resolveTeraBox(cleanUrl, {
        cookie: runtimeConfig.teraboxCookie,
        mode: runtimeConfig.teraboxMode,
        rapidApiKey: runtimeConfig.rapidApiKey,
        backendBaseUrl: effectiveBaseUrl,
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

    // 3. Instagram check
    if (isInstagramUrl(cleanUrl)) {
      const result = await resolveInstagram(cleanUrl, { backendBaseUrl: effectiveBaseUrl });
      const latencyMs = Date.now() - start;
      addLogEntry({ method, url: cleanUrl, platform: 'instagram', status: 200, latencyMs });
      return res.json(result);
    }

    // 4. Pinterest check
    if (isPinterestUrl(cleanUrl)) {
      const result = await resolvePinterest(cleanUrl, { backendBaseUrl: effectiveBaseUrl });
      const latencyMs = Date.now() - start;
      addLogEntry({ method, url: cleanUrl, platform: 'pinterest', status: 200, latencyMs });
      return res.json(result);
    }

    // 5. YouTube check
    if (isYouTubeUrl(cleanUrl)) {
      const result = await resolveYouTube(cleanUrl, {
        backendBaseUrl: effectiveBaseUrl,
      });
      const latencyMs = Date.now() - start;
      addLogEntry({ method, url: cleanUrl, platform: 'youtube', status: 200, latencyMs });
      return res.json(result);
    }

    // 6. Unsupported
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
    const failedPlatform = isTeraBoxUrl(cleanUrl)
      ? 'terabox'
      : isTwitterUrl(cleanUrl)
        ? 'twitter'
        : isInstagramUrl(cleanUrl)
          ? 'instagram'
          : isPinterestUrl(cleanUrl)
            ? 'pinterest'
            : isYouTubeUrl(cleanUrl)
              ? 'youtube'
              : 'unknown';
    addLogEntry({ method, url: cleanUrl, platform: failedPlatform, status: 400, latencyMs, error: err.message });
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
  await handleResolve(req, res, 'POST');
});

// GET /api/resolve — convenient for testing via browser
app.get('/api/resolve', async (req, res) => {
  await handleResolve(req, res, 'GET');
});

// GET /api/download — direct streaming proxy for TeraBox files
app.get('/api/download', async (req, res) => {
  await handleStreamDownload(req, res, runtimeConfig.teraboxCookie);
});

// GET /api/youtube/download — streaming proxy for YouTube media
app.get('/api/youtube/download', async (req, res) => {
  await handleYouTubeDownload(req, res);
});

// GET /api/instagram/download — merge a selected video quality with its audio track
app.get('/api/instagram/download', async (req, res) => {
  await handleInstagramDownload(req, res);
});

// GET /api/pinterest/download — merge separate Pin video/audio streams
app.get('/api/pinterest/download', async (req, res) => {
  await handlePinterestDownload(req, res);
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
