import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getFfmpegPath } from '../resolvers/youtube.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory to store processed standard MP4 files
const CACHE_DIR = path.resolve(__dirname, '../../temp_media');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Map of in-progress downloads to prevent duplicate concurrent yt-dlp runs
const activeDownloads = new Map();

/**
 * Clean up cached media older than 6 hours.
 */
function cleanOldCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const now = Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000; // 6 hours

    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      const fullPath = path.join(CACHE_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          console.log(`[YouTube Cache] Cleaned up expired cache file: ${file}`);
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[YouTube Cache] Cleanup error:', err.message);
  }
}

// Run cleanup at startup and every hour
cleanOldCache();
setInterval(cleanOldCache, 60 * 60 * 1000);

/**
 * Handle streaming YouTube download and playback with standard seekable MP4 containers.
 * Generates and caches complete MP4 files with accurate duration (mvhd header) so
 * ExoPlayer, AVPlayer, and in-app media viewers can display total playtime and seek smoothly.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleYouTubeDownload(req, res) {
  const { id, format, filename = 'youtube_video.mp4', ext = 'mp4' } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing required query parameter: id' });
  }

  const cleanId = id.trim();
  const formatSelector = format || 'bv*+ba/b/best';
  const targetUrl = `https://www.youtube.com/watch?v=${cleanId}`;
  const safeFilename = filename.replace(/["\r\n]/g, '_');

  const isDownload = req.query.download === '1' || req.query.dl === '1';
  const outputExt = ext === 'm4a' || ext === 'mp3' ? ext : 'mp4';

  // Deterministic cache key based on video ID, format selector, and extension
  const formatHash = crypto.createHash('md5').update(formatSelector).digest('hex').slice(0, 10);
  const baseTemplate = path.join(CACHE_DIR, `${cleanId}_${formatHash}`);
  const cacheFilePath = `${baseTemplate}.${outputExt}`;

  // Helper to send the completed file with proper headers and range support
  const sendCompletedFile = (filePath) => {
    if (res.headersSent) return;

    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    }

    if (outputExt === 'm4a' || outputExt === 'mp3') {
      res.setHeader('Content-Type', outputExt === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
    } else {
      res.setHeader('Content-Type', 'video/mp4');
    }

    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        console.error(`[YouTube Stream] sendFile error for ${cleanId}:`, err.message);
      }
    });
  };

  // 1. If cache file already exists and is non-empty, serve it immediately
  if (fs.existsSync(cacheFilePath)) {
    try {
      const stat = fs.statSync(cacheFilePath);
      if (stat.size > 0) {
        console.log(`[YouTube Stream] Serving cached ${path.basename(cacheFilePath)} (${stat.size} bytes)`);
        return sendCompletedFile(cacheFilePath);
      }
    } catch {}
  }

  // 2. If a download for this exact video + format is already in progress, wait for it
  if (activeDownloads.has(cacheFilePath)) {
    console.log(`[YouTube Stream] Waiting for existing download job: ${path.basename(cacheFilePath)}`);
    try {
      await activeDownloads.get(cacheFilePath);
      if (fs.existsSync(cacheFilePath)) {
        return sendCompletedFile(cacheFilePath);
      }
    } catch (err) {
      if (!res.headersSent) {
        return res.status(500).json({ error: `Download failed: ${err.message}` });
      }
      return;
    }
  }

  // 3. Initiate download & merge via yt-dlp to create a standard seekable MP4 with duration
  console.log(`[YouTube Stream] Downloading & merging ${cleanId}, format: ${formatSelector}`);

  const ffmpegPath = await getFfmpegPath();
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  const downloadPromise = new Promise((resolve, reject) => {
    const args = [
      '-m', 'yt_dlp',
      '--ffmpeg-location', ffmpegPath,
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
      '-f', formatSelector,
      '--merge-output-format', outputExt,
      '--no-playlist',
      '--no-warnings',
      ...(process.env.YOUTUBE_COOKIES_FILE
        ? ['--cookies', process.env.YOUTUBE_COOKIES_FILE]
        : []),
      '-o', `${baseTemplate}.%(ext)s`,
      targetUrl,
    ];

    const proc = spawn(pythonCmd, args);
    let stderrLog = '';

    proc.stderr.on('data', (chunk) => {
      stderrLog += chunk.toString();
    });

    proc.on('close', (code) => {
      activeDownloads.delete(cacheFilePath);

      // Check if file with outputExt or similar exists
      let finalPath = cacheFilePath;
      if (!fs.existsSync(finalPath)) {
        // Fallback check if yt-dlp chose another extension
        const matches = fs.readdirSync(CACHE_DIR).filter((f) => f.startsWith(`${cleanId}_${formatHash}`));
        if (matches.length > 0) {
          finalPath = path.join(CACHE_DIR, matches[0]);
        }
      }

      if (code === 0 && fs.existsSync(finalPath)) {
        console.log(`[YouTube Stream] Successfully cached ${path.basename(finalPath)}`);
        resolve(finalPath);
      } else {
        console.error(`[YouTube Stream] yt-dlp error (${code}):`, stderrLog.slice(0, 300));
        reject(new Error(`yt-dlp exited with code ${code}: ${stderrLog.slice(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      activeDownloads.delete(cacheFilePath);
      console.error(`[YouTube Stream] Spawn error for ${cleanId}:`, err.message);
      reject(err);
    });
  });

  activeDownloads.set(cacheFilePath, downloadPromise);

  try {
    const readyFile = await downloadPromise;
    return sendCompletedFile(readyFile);
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: `Download failed: ${err.message}` });
    }
  }
}
