import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { isTeraBoxUrl, resolveTeraBox } from './resolvers/terabox.js';
import { isTwitterUrl, resolveTwitter } from './resolvers/twitter.js';
import { handleStreamDownload } from './proxy/stream.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TERABOX_COOKIE = process.env.TERABOX_COOKIE || '';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging in development
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${req.method}] ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Root & Health Endpoints
app.get('/', (req, res) => {
  res.json({
    name: 'All-in-One Downloader Backend',
    status: 'running',
    supportedPlatforms: ['terabox', 'twitter/x'],
    endpoints: {
      health: 'GET /health',
      resolvePost: 'POST /resolve { url: "..." }',
      resolveGet: 'GET /api/resolve?url=...',
      streamDownload: 'GET /api/download?dlink=...&filename=...',
    },
    teraboxCookieConfigured: Boolean(TERABOX_COOKIE),
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    uptime: process.uptime(),
    teraboxConfigured: Boolean(TERABOX_COOKIE),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Common resolver logic used by both POST /resolve and GET /api/resolve
 */
async function handleResolve(url, res) {
  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: { code: 'INVALID_URL', message: 'Missing or invalid "url" parameter.' },
    });
  }

  const cleanUrl = url.trim();

  try {
    // 1. TeraBox check
    if (isTeraBoxUrl(cleanUrl)) {
      const result = await resolveTeraBox(cleanUrl, TERABOX_COOKIE, BASE_URL);
      return res.json(result);
    }

    // 2. Twitter / X check
    if (isTwitterUrl(cleanUrl)) {
      const result = await resolveTwitter(cleanUrl);
      return res.json(result);
    }

    // 3. Unsupported
    return res.status(422).json({
      error: {
        code: 'UNSUPPORTED_URL',
        message: `URL not currently supported by backend: ${cleanUrl}`,
      },
    });
  } catch (err) {
    console.error(`[Resolve Error] ${cleanUrl}:`, err.message);
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
  await handleResolve(url, res);
});

// GET /api/resolve — convenient for testing via browser
app.get('/api/resolve', async (req, res) => {
  const { url } = req.query;
  await handleResolve(url, res);
});

// GET /api/download — direct streaming proxy for TeraBox files
app.get('/api/download', async (req, res) => {
  await handleStreamDownload(req, res, TERABOX_COOKIE);
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
  console.log(`🍪 TeraBox Cookie configured: ${TERABOX_COOKIE ? 'YES' : 'NO (Add in backend/.env)'}`);
  console.log('----------------------------------------------------');
});
