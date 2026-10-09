import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { isInstagramUrl } from '../resolvers/instagram.js';
import { getFfmpegPath } from '../resolvers/youtube.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../temp_media');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const activeDownloads = new Map();
const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

function cleanExpiredCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const now = Date.now();
    for (const name of fs.readdirSync(CACHE_DIR)) {
      if (!name.startsWith('instagram_') || !name.endsWith('.mp4')) continue;
      const filePath = path.join(CACHE_DIR, name);
      try {
        if (now - fs.statSync(filePath).mtimeMs > CACHE_MAX_AGE_MS) fs.unlinkSync(filePath);
      } catch (error) {
        console.warn(`[Instagram Download] Could not clean cache file ${name}: ${error.message}`);
      }
    }
  } catch (error) {
    console.warn(`[Instagram Download] Cache cleanup failed: ${error.message}`);
  }
}

function getSafeParams(req) {
  const { url, videoFormatId, audioFormatId, filename = 'instagram_video.mp4' } = req.query;
  const validFormatId = (value) =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

  if (typeof url !== 'string' || !isInstagramUrl(url)) {
    return { error: 'A valid public Instagram post or reel URL is required.' };
  }
  if (!validFormatId(videoFormatId) || !validFormatId(audioFormatId)) {
    return { error: 'Valid video and audio formats are required.' };
  }
  if (typeof filename !== 'string' || !filename.toLowerCase().endsWith('.mp4')) {
    return { error: 'A valid MP4 filename is required.' };
  }

  return {
    url,
    videoFormatId,
    audioFormatId,
    filename: filename.replace(/["\r\n/\\]/g, '_').slice(0, 160),
  };
}

async function prepareMergedVideo(cachePath, sourceUrl, videoFormatId, audioFormatId) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const ffmpegPath = await getFfmpegPath();

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCommand, [
      '-m',
      'yt_dlp',
      '--no-playlist',
      '--no-warnings',
      '--force-overwrites',
      '--ffmpeg-location',
      ffmpegPath,
      '--format',
      `${videoFormatId}+${audioFormatId}`,
      '--merge-output-format',
      'mp4',
      '--output',
      cachePath,
      sourceUrl,
    ]);
    proc.on('error', (error) => {
      reject(new Error(`Could not start the Instagram media downloader: ${error.message}`));
    });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
        return resolve(cachePath);
      }
      if (fs.existsSync(cachePath)) {
        try {
          fs.unlinkSync(cachePath);
        } catch (error) {
          console.warn(`[Instagram Download] Could not remove incomplete file: ${error.message}`);
        }
      }
      console.error(`[Instagram Download] yt-dlp failed with exit code ${code}.`);
      reject(new Error(`Could not combine Instagram video and audio (downloader exit code ${code}).`));
    });
  });
}

export async function handleInstagramDownload(req, res) {
  const params = getSafeParams(req);
  if (params.error) return res.status(400).json({ error: params.error });

  const cacheKey = crypto
    .createHash('sha256')
    .update(`${params.url}\n${params.videoFormatId}\n${params.audioFormatId}`)
    .digest('hex');
  const cachePath = path.join(CACHE_DIR, `instagram_${cacheKey}.mp4`);
  cleanExpiredCache();

  try {
    if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size === 0) {
      if (!activeDownloads.has(cachePath)) {
        const task = prepareMergedVideo(
          cachePath,
          params.url,
          params.videoFormatId,
          params.audioFormatId,
        ).finally(() => activeDownloads.delete(cachePath));
        activeDownloads.set(cachePath, task);
      }
      await activeDownloads.get(cachePath);
    }

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${params.filename}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.sendFile(cachePath, (error) => {
        if (error && !res.headersSent) {
          console.error(`[Instagram Download] Could not send cached video: ${error.message}`);
          res.status(500).json({ error: 'Could not send the prepared Instagram video.' });
        }
      });
    }
  } catch (error) {
    console.error(`[Instagram Download] Request failed: ${error.message}`);
    if (!res.headersSent) {
      res.status(502).json({ error: error.message });
    }
  }
}
