import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COOKIES_DIR = path.resolve(__dirname, '../../temp_media');
const YOUTUBE_COOKIES_PATH = path.join(COOKIES_DIR, 'youtube_cookies.txt');

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
 * Checks YOUTUBE_COOKIES_FILE, existing written cookies, or YOUTUBE_COOKIES env var.
 */
export function getYouTubeCookieFilePath() {
  if (process.env.YOUTUBE_COOKIES_FILE && fs.existsSync(process.env.YOUTUBE_COOKIES_FILE)) {
    return process.env.YOUTUBE_COOKIES_FILE;
  }
  if (fs.existsSync(YOUTUBE_COOKIES_PATH)) {
    try {
      if (fs.statSync(YOUTUBE_COOKIES_PATH).size > 0) {
        return YOUTUBE_COOKIES_PATH;
      }
    } catch {}
  }
  const envCookie = process.env.YOUTUBE_COOKIES;
  if (envCookie && envCookie.trim()) {
    try {
      if (!fs.existsSync(COOKIES_DIR)) {
        fs.mkdirSync(COOKIES_DIR, { recursive: true });
      }
      let content = envCookie.trim();
      // Decode base64 if user encoded raw Netscape cookie content
      if (content.startsWith('ey') || (!content.includes('\t') && content.length > 50 && /^[A-Za-z0-9+/=]+$/.test(content))) {
        try {
          const decoded = Buffer.from(content, 'base64').toString('utf8');
          if (decoded.includes('youtube.com') || decoded.includes('# Netscape')) {
            content = decoded;
          }
        } catch {}
      }
      fs.writeFileSync(YOUTUBE_COOKIES_PATH, content, 'utf8');
      return YOUTUBE_COOKIES_PATH;
    } catch (e) {
      console.warn('[YouTube] Failed to write cookie file from env:', e.message);
    }
  }
  return null;
}

/**
 * Save YouTube Netscape cookies directly from dashboard or API.
 */
export function saveYouTubeCookies(content) {
  if (!fs.existsSync(COOKIES_DIR)) {
    fs.mkdirSync(COOKIES_DIR, { recursive: true });
  }
  fs.writeFileSync(YOUTUBE_COOKIES_PATH, (content || '').trim(), 'utf8');
}

/**
 * Get recommended yt-dlp arguments to bypass bot detection on datacenter / cloud IPs.
 */
export function getYouTubeYtDlpArgs() {
  const args = [
    '--extractor-args',
    'youtube:player_client=mweb,android,web_safari,web',
  ];
  const cookiePath = getYouTubeCookieFilePath();
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
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
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
        let msg = stderrData || `Exit code ${code}`;
        if (msg.includes("confirm you're not a bot") || msg.includes('Sign in to confirm')) {
          msg = "YouTube bot detection triggered on server IP. Configure YouTube cookies in backend environment variables (YOUTUBE_COOKIES) or dashboard to authenticate.";
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
