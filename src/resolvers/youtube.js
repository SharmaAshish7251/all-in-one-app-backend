import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decryptData, isContentEncrypted, secureFilePermissions } from '../utils/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const COOKIES_DIR = path.join(ROOT_DIR, 'cookies');
const PRIMARY_COOKIE_FILE = path.join(COOKIES_DIR, 'youtube.txt');
const TEMP_COOKIES_DIR = path.join(ROOT_DIR, 'temp_media');
const TEMP_YOUTUBE_COOKIES_PATH = path.join(TEMP_COOKIES_DIR, 'youtube_cookies.txt');
const RUNTIME_DECRYPTED_COOKIE_PATH = path.join(TEMP_COOKIES_DIR, '.runtime_decrypted_cookies.txt');

// Known or detected ffmpeg binary
let cachedFfmpegPath = null;

const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

export async function getFfmpegPath() {
  if (cachedFfmpegPath) return cachedFfmpegPath;

  return new Promise((resolve) => {
    const proc = spawn(pythonCmd, [
      '-c',
      'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())',
    ]);
    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        cachedFfmpegPath = stdout.trim();
        return resolve(cachedFfmpegPath);
      }
      // Fallback
      cachedFfmpegPath = 'ffmpeg';
      resolve('ffmpeg');
    });
    proc.on('error', () => {
      resolve('ffmpeg');
    });
  });
}

/**
 * Check if the given URL belongs to YouTube.
 */
export function isYouTubeUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const domains = [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
    ];
    return domains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Extract YouTube video ID from various URL patterns.
 */
export function extractYouTubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace(/^\//, '').split(/[?#&]/)[0];
    }
    if (parsed.pathname.includes('/shorts/')) {
      const match = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
    if (parsed.pathname.includes('/embed/')) {
      const match = parsed.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
    const v = parsed.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
      return v;
    }
  } catch {
    // regex fallback
  }

  const fallbackMatch = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]{11})/);
  return fallbackMatch ? fallbackMatch[1] : null;
}

/**
 * Sanitize filename for safe saving.
 */
function sanitizeFilename(name) {
  return (name || 'video')
    .replace(/[<>:"/\\|?*\x00-\x1F[\]{}|^`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}


/**
 * Get the path to YouTube cookies if available.
 * Checks YOUTUBE_COOKIES_FILE, permanent files in cookies/, root, or YOUTUBE_COOKIES env var.
 * If the cookie file is encrypted with AES-256-GCM, it decrypts it securely to a protected runtime path.
 */
export function getYouTubeCookieFilePath() {
  const sameDir = __dirname;
  const srcDir = path.resolve(__dirname, '../');
  const cwdDir = process.cwd();
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const browserCookieNames = [
    'www.youtube.com_cookies.txt',
    'youtube.com_cookies.txt',
    'youtube_cookies.txt',
    'youtube.txt',
    'cookies.txt',
  ];
  const browserCookiePaths = homeDir
    ? browserCookieNames.flatMap((name) => [
        path.join(homeDir, 'Downloads', name),
        path.join(homeDir, 'downloads', name),
        path.join(homeDir, name),
      ])
    : [];

  const candidates = [
    process.env.YOUTUBE_COOKIES_FILE,
    ...browserCookiePaths,
    // Same folder as this file (src/resolvers/)
    path.join(sameDir, 'youtube.txt'),
    path.join(sameDir, 'cookies.txt'),
    path.join(sameDir, 'youtube_cookies.txt'),
    path.join(sameDir, 'youtube.enc'),
    // src/ folder
    path.join(srcDir, 'youtube.txt'),
    path.join(srcDir, 'cookies.txt'),
    path.join(srcDir, 'youtube_cookies.txt'),
    // cookies/ folder
    PRIMARY_COOKIE_FILE,
    path.join(COOKIES_DIR, 'youtube.enc'),
    path.join(COOKIES_DIR, 'youtube_cookies.txt'),
    path.join(COOKIES_DIR, 'cookies.txt'),
    // Project root / working directory
    path.join(ROOT_DIR, 'youtube.txt'),
    path.join(ROOT_DIR, 'cookies.txt'),
    path.join(ROOT_DIR, 'youtube_cookies.txt'),
    path.join(cwdDir, 'youtube.txt'),
    path.join(cwdDir, 'cookies.txt'),
    path.join(cwdDir, 'youtube_cookies.txt'),
    path.join(cwdDir, 'cookies', 'youtube.txt'),
    TEMP_YOUTUBE_COOKIES_PATH,
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.size > 10) {
          const raw = fs.readFileSync(candidate, 'utf8').trim();

          // Check if encrypted with AES-256-GCM
          if (isContentEncrypted(raw)) {
            const decrypted = decryptData(raw);
            if (!fs.existsSync(TEMP_COOKIES_DIR)) {
              fs.mkdirSync(TEMP_COOKIES_DIR, { recursive: true });
            }
            fs.writeFileSync(RUNTIME_DECRYPTED_COOKIE_PATH, decrypted, 'utf8');
            secureFilePermissions(RUNTIME_DECRYPTED_COOKIE_PATH);

            if (!decrypted.includes('LOGIN_INFO')) {
              console.warn(`[YouTube Auth] Cookie file loaded (${candidate}), but LOGIN_INFO is missing. For datacenter IPs, make sure you are signed into youtube.com when exporting.`);
            } else {
              console.log(`[YouTube Auth] Authenticated session cookie loaded successfully from: ${candidate}`);
            }

            return RUNTIME_DECRYPTED_COOKIE_PATH;
          }

          // Plaintext file - enforce owner-only permissions
          secureFilePermissions(candidate);
          if (!raw.includes('LOGIN_INFO')) {
            console.warn(`[YouTube Auth] Cookie file loaded (${candidate}), but LOGIN_INFO is missing. For datacenter IPs, make sure you are signed into youtube.com when exporting.`);
          } else {
            console.log(`[YouTube Auth] Authenticated session cookie loaded successfully from: ${candidate}`);
          }
          return candidate;
        }
      } catch (err) {
        console.warn(`[YouTube] Error reading cookie file ${candidate}:`, err.message);
      }
    }
  }

  const envCookie = process.env.YOUTUBE_COOKIES;
  if (envCookie && envCookie.trim()) {
    try {
      if (!fs.existsSync(COOKIES_DIR)) {
        fs.mkdirSync(COOKIES_DIR, { recursive: true });
      }
      let content = envCookie.trim();
      // Check if encrypted
      if (isContentEncrypted(content)) {
        content = decryptData(content);
      } else if (content.startsWith('ey') || (!content.includes('\t') && content.length > 50 && /^[A-Za-z0-9+/=]+$/.test(content))) {
        try {
          const decoded = Buffer.from(content, 'base64').toString('utf8');
          if (decoded.includes('youtube.com') || decoded.includes('# Netscape')) {
            content = decoded;
          }
        } catch {}
      }
      fs.writeFileSync(PRIMARY_COOKIE_FILE, content, 'utf8');
      secureFilePermissions(PRIMARY_COOKIE_FILE);
      return PRIMARY_COOKIE_FILE;
    } catch (e) {
      console.warn('[YouTube] Failed to write cookie file from env:', e.message);
    }
  }

  return null;
}

/**
 * Save YouTube Netscape cookies directly from dashboard or API.
 * Saves to permanent cookies directory so it persists across runs and deploys.
 */
export function saveYouTubeCookies(content) {
  const cleanContent = (content || '').trim();
  if (!cleanContent) return;

  // 1. Save to permanent cookies/ folder
  try {
    if (!fs.existsSync(COOKIES_DIR)) {
      fs.mkdirSync(COOKIES_DIR, { recursive: true });
    }
    fs.writeFileSync(PRIMARY_COOKIE_FILE, cleanContent, 'utf8');
    secureFilePermissions(PRIMARY_COOKIE_FILE);
  } catch (e) {
    console.warn('[YouTube] Failed to write to permanent cookies folder:', e.message);
  }

  // 2. Also save to temp_media folder for backward compatibility
  try {
    if (!fs.existsSync(TEMP_COOKIES_DIR)) {
      fs.mkdirSync(TEMP_COOKIES_DIR, { recursive: true });
    }
    fs.writeFileSync(TEMP_YOUTUBE_COOKIES_PATH, cleanContent, 'utf8');
    secureFilePermissions(TEMP_YOUTUBE_COOKIES_PATH);
  } catch {}
}

/**
 * Find the node executable path for yt-dlp's JavaScript challenge solver.
 */
function getNodePath() {
  try {
    const nodeDir = path.dirname(process.execPath);
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    const candidate = path.join(nodeDir, nodeName);
    if (fs.existsSync(candidate)) return candidate;
  } catch {}

  for (const candidate of ['/usr/bin/node', '/usr/local/bin/node', '/opt/render/project/.nvm/versions/node/current/bin/node']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'node';
}

/**
 * Get recommended yt-dlp arguments to bypass bot detection on datacenter / cloud IPs.
 *
 * Key points (yt-dlp >= 2025):
 *  - `--js-runtimes node` is REQUIRED to solve YouTube's n-challenge (sig decryption).
 *    Without it, even valid cookies produce "The page needs to be reloaded." errors.
 *  - The `android` client silently skips cookies, so it must NOT be used when auth is needed.
 *  - `web_embedded` + `web` clients support cookies and work with the node JS solver.
 */
export function getYouTubeYtDlpArgs() {
  const cookiePath = getYouTubeCookieFilePath();
  const nodePath = getNodePath();
  const args = [
    // node JS runtime solves YouTube's n-challenge (signature decryption).
    // Required for private/age-gated videos and for web client format URLs.
    '--js-runtimes', `node:${nodePath}`,
    // Do NOT force a specific player_client:
    //  - `web`         → triggers SABR-only streaming on some videos (no direct stream URLs)
    //  - `web_embedded`→ only combined low-res formats (no separate video+audio for HD)
    //  - `android/ios` → silently skip cookies
    // yt-dlp's default selection (visionos HLS fallback) gives 40+ formats on all public
    // videos without SABR issues. Cookies are used automatically when present for private video.
    '--sleep-requests', '1',
  ];

  if (cookiePath) {
    args.push('--cookies', cookiePath);
  }

  return args;
}

/**
 * Resolve YouTube video details and formats via yt-dlp.
 */
export async function resolveYouTube(url, options = {}) {
  const backendBaseUrl = options.backendBaseUrl || 'http://localhost:4000';
  const videoId = extractYouTubeId(url);
  const targetUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;

  return new Promise((resolve, reject) => {
    const args = [
      '-m', 'yt_dlp',
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      ...getYouTubeYtDlpArgs(),
      targetUrl,
    ];

    const proc = spawn(pythonCmd, args);
    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });

    proc.stderr.on('data', (chunk) => {
      stderrData += chunk;
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[YouTube yt-dlp stderr (${code})]:`, stderrData.slice(0, 800));
        let msg = stderrData || `Exit code ${code}`;

        const isExpiredCookies =
          msg.includes('no longer valid') ||
          msg.includes('cookies are no longer valid') ||
          msg.includes('have been rotated');

        const isBotDetection =
          msg.includes("confirm you're not a bot") ||
          msg.includes('Sign in to confirm') ||
          msg.includes('Sign in to view') ||
          msg.includes('This video is only available to Music Premium members') ||
          msg.includes('This video requires payment');

        if (isExpiredCookies) {
          msg = 'YouTube cookies have expired (browser rotated them). Please re-export fresh cookies from youtube.com using the "Get cookies.txt LOCALLY" extension and update cookies/youtube.txt.';
        } else if (isBotDetection) {
          msg = 'YouTube bot detection triggered on server IP. Ensure active YouTube cookies (with LOGIN_INFO from youtube.com) are configured in cookies/youtube.txt or dashboard.';
        }
        return reject(
          new Error(`Failed to extract YouTube video: ${msg}`)
        );
      }

      try {
        const data = JSON.parse(stdoutData);
        const resolvedId = data.id || videoId || 'unknown';
        const title = data.title || 'YouTube Video';
        const author = data.uploader || data.channel || 'YouTube Creator';
        const duration = data.duration || 0;
        const thumbnail =
          data.thumbnail ||
          `https://i.ytimg.com/vi/${resolvedId}/hqdefault.jpg`;

        const formats = data.formats || [];
        const availableHeights = new Set();
        formats.forEach((f) => {
          if (f.height) availableHeights.add(f.height);
        });

        const safeTitle = sanitizeFilename(title);
        const items = [];

        // Quality presets to check
        const qualityPresets = [
          {
            quality: '1080p',
            height: 1080,
            label: '1080p (Full HD)',
            formatSelector: 'bv*[height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/best',
            ext: 'mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            recommended: true,
          },
          {
            quality: '720p',
            height: 720,
            label: '720p (HD)',
            formatSelector: 'bv*[height<=720]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/best',
            ext: 'mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            recommended: false,
          },
          {
            quality: '480p',
            height: 480,
            label: '480p (SD)',
            formatSelector: 'bv*[height<=480]+ba[ext=m4a]/bv*[height<=480]+ba/b[height<=480]/best',
            ext: 'mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            recommended: false,
          },
          {
            quality: '360p',
            height: 360,
            label: '360p (Medium)',
            formatSelector: 'bv*[height<=360]+ba[ext=m4a]/bv*[height<=360]+ba/b[height<=360]/best',
            ext: 'mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            recommended: false,
          },
        ];

        // Add 240p preset if video is lower resolution (e.g. vintage or music videos)
        if (Array.from(availableHeights).some((h) => h <= 240 && h > 0)) {
          qualityPresets.push({
            quality: '240p',
            height: 240,
            label: '240p (Standard)',
            formatSelector: 'bv*[height<=240]+ba[ext=m4a]/bv*[height<=240]+ba/b[height<=240]/best',
            ext: 'mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            recommended: false,
          });
        }

        // Filter presets by available formats
        const validPresets = qualityPresets.filter((p) => {
          if (availableHeights.size === 0) return p.quality === '720p' || p.quality === '360p';
          return Array.from(availableHeights).some((h) => h >= p.height - 30);
        });

        // Ensure at least one video quality preset exists
        const chosenPresets = validPresets.length > 0 ? validPresets : [
          {
            quality: 'Best Available',
            height: 720,
            label: 'Best Available',
            formatSelector: 'bv*+ba[ext=m4a]/bv*+ba/b/best',
            ext: 'mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            recommended: true,
          },
        ];

        // Adjust recommended flag to top quality
        chosenPresets.forEach((p, idx) => {
          p.recommended = idx === 0;
        });

        // Estimate size if possible
        for (const preset of chosenPresets) {
          // Find matching format for approximate filesize
          const matchingFormat = formats.find(
            (f) => f.height && Math.abs(f.height - preset.height) <= 30 && f.vcodec !== 'none'
          );
          const estSize = matchingFormat?.filesize || matchingFormat?.filesize_approx || null;

          const filename = `${safeTitle} (${preset.quality}).${preset.ext}`;
          const downloadUrl = `${backendBaseUrl}/api/youtube/download?id=${resolvedId}&format=${encodeURIComponent(
            preset.formatSelector
          )}&filename=${encodeURIComponent(filename)}&ext=${preset.ext}`;

          items.push({
            id: `yt_${resolvedId}_${preset.quality}`,
            groupId: resolvedId,
            kind: preset.kind,
            url: downloadUrl,
            headers: {},
            filename,
            mimeType: preset.mimeType,
            quality: preset.quality,
            thumbnail,
            sizeBytes: estSize,
            durationSeconds: duration,
            recommended: preset.recommended,
          });
        }

        // Add Audio-only option (M4A / MP3)
        const audioFormat = formats.find((f) => f.vcodec === 'none' && f.acodec !== 'none');
        const audioSize = audioFormat?.filesize || audioFormat?.filesize_approx || null;
        const audioFilename = `${safeTitle} (Audio).m4a`;
        const audioDownloadUrl = `${backendBaseUrl}/api/youtube/download?id=${resolvedId}&format=${encodeURIComponent(
          'ba[ext=m4a]/ba/best'
        )}&filename=${encodeURIComponent(audioFilename)}&ext=m4a`;

        items.push({
          id: `yt_${resolvedId}_audio`,
          groupId: resolvedId,
          kind: 'audio',
          url: audioDownloadUrl,
          headers: {},
          filename: audioFilename,
          mimeType: 'audio/mp4',
          quality: 'Audio M4A',
          thumbnail,
          sizeBytes: audioSize,
          durationSeconds: duration,
          recommended: false,
        });

        resolve({
          platform: 'youtube',
          sourceUrl: targetUrl,
          title,
          author,
          thumbnail,
          duration,
          items,
        });
      } catch (err) {
        reject(new Error(`Failed to parse YouTube resolution: ${err.message}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp process error: ${err.message}`));
    });
  });
}
