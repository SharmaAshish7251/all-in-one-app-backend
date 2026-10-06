import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { isPinterestUrl } from '../resolvers/pinterest.js';
import { getFfmpegPath } from '../resolvers/youtube.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../temp_media');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const activeDownloads = new Map();
const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

function getSafeParams(req) {
  const { url, videoFormatId, audioFormatId, filename = 'pinterest_video.mp4' } = req.query;
  const validFormatId = (value) =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

  if (typeof url !== 'string' || !isPinterestUrl(url)) {
    return { error: 'A valid public Pinterest Pin URL is required.' };
  }
  if (videoFormatId !== undefined && !validFormatId(videoFormatId)) {
    return { error: 'The selected video format is invalid.' };
  }
  if (audioFormatId !== undefined && !validFormatId(audioFormatId)) {
    return { error: 'The selected audio format is invalid.' };
  }
  if ((videoFormatId && !audioFormatId) || (!videoFormatId && !audioFormatId)) {
    return { error: 'Select a valid video and audio format.' };
  }
  if (typeof filename !== 'string' || !/\.(mp4|m4a)$/i.test(filename)) {
    return { error: 'A valid MP4 or M4A filename is required.' };
  }

  const outputExt = videoFormatId ? 'mp4' : 'm4a';
  return {
    url,
    videoFormatId,
    audioFormatId,
    outputExt,
    filename: filename.replace(/["\r\n/\\]/g, '_').slice(0, 160),
  };
}

function cleanExpiredCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const now = Date.now();
    for (const name of fs.readdirSync(CACHE_DIR)) {
      if (!name.startsWith('pinterest_') || !/\.(mp4|m4a)$/.test(name)) continue;
      const filePath = path.join(CACHE_DIR, name);
      try {
        if (now - fs.statSync(filePath).mtimeMs > CACHE_MAX_AGE_MS) fs.unlinkSync(filePath);
      } catch (error) {
        console.warn(`[Pinterest Download] Could not clean cache file ${name}: ${error.message}`);
      }
    }
  } catch (error) {
    console.warn(`[Pinterest Download] Cache cleanup failed: ${error.message}`);
  }
}

async function prepareMedia(cachePath, params) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const ffmpegPath = await getFfmpegPath();
  const isVideo = Boolean(params.videoFormatId);
  const format = isVideo
    ? `${params.videoFormatId}+${params.audioFormatId}`
    : params.audioFormatId;
  const args = [
    '-m',
    'yt_dlp',
    '--no-playlist',
    '--no-warnings',
    '--force-overwrites',
    '--ffmpeg-location',
    ffmpegPath,
    '--format',
    format,
    '--output',
    cachePath,
    ...(isVideo ? ['--merge-output-format', 'mp4'] : ['--extract-audio', '--audio-format', 'm4a']),
    params.url,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCommand, args);
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error('Pinterest media preparation timed out.'));
    }, DOWNLOAD_TIMEOUT_MS);

    proc.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2_000);
    });
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Could not start the Pinterest media downloader: ${error.message}`));
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code === 0 && fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
        return resolve(cachePath);
      }

      if (fs.existsSync(cachePath)) {
        try {
          fs.unlinkSync(cachePath);
        } catch (error) {
          console.warn(`[Pinterest Download] Could not remove incomplete file: ${error.message}`);
        }
      }
      console.error(`[Pinterest Download] yt-dlp failed (${code}): ${stderr.trim().slice(-500)}`);
      reject(new Error(`Could not prepare the Pinterest media (downloader exit code ${code}).`));
    });
  });
}

export async function handlePinterestDownload(req, res) {
  const params = getSafeParams(req);
  if (params.error) return res.status(400).json({ error: params.error });

  const cacheKey = crypto
    .createHash('sha256')
    .update(`${params.url}\n${params.videoFormatId ?? ''}\n${params.audioFormatId}`)
    .digest('hex');
  const cachePath = path.join(CACHE_DIR, `pinterest_${cacheKey}.${params.outputExt}`);
  cleanExpiredCache();

  try {
    if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size === 0) {
      if (!activeDownloads.has(cachePath)) {
        const task = prepareMedia(cachePath, params)
          .finally(() => activeDownloads.delete(cachePath));
        activeDownloads.set(cachePath, task);
      }
      await activeDownloads.get(cachePath);
    }

    if (!res.headersSent) {
      res.setHeader('Content-Type', params.outputExt === 'mp4' ? 'video/mp4' : 'audio/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${params.filename}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.sendFile(cachePath, (error) => {
        if (error && !res.headersSent) {
          console.error(`[Pinterest Download] Could not send cached file: ${error.message}`);
          res.status(500).json({ error: 'Could not send the prepared Pinterest media.' });
        }
      });
    }
  } catch (error) {
    console.error(`[Pinterest Download] Request failed: ${error.message}`);
    if (!res.headersSent) {
      res.status(502).json({ error: error.message });
    }
  }
}
