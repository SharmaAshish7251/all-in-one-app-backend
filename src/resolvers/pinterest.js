import { spawn } from 'child_process';

const PYTHON_COMMAND = process.platform === 'win32' ? 'python' : 'python3';
const RESOLVE_TIMEOUT_MS = 30_000;
const PAGE_METADATA_TIMEOUT_MS = 15_000;
const MAX_PAGE_METADATA_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['m4a', 'mp3', 'aac', 'opus', 'ogg', 'wav', 'webm', 'mp4']);
const AUDIO_MIME_TYPES = {
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  webm: 'audio/webm',
};
const FORMAT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const PINTEREST_DOMAINS = [
  'pinterest.com',
  'pinterest.co.uk',
  'pinterest.ca',
  'pinterest.de',
  'pinterest.fr',
  'pinterest.it',
  'pinterest.es',
  'pinterest.com.au',
  'pinterest.jp',
];

function isPinterestHost(hostname) {
  const host = hostname.toLowerCase();
  return host === 'pin.it' ||
    host.endsWith('.pin.it') ||
    PINTEREST_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function isPinterestUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !isPinterestHost(parsed.hostname)) return false;
    if (parsed.hostname === 'pin.it' || parsed.hostname.endsWith('.pin.it')) {
      return /^\/[a-zA-Z0-9_-]+\/?$/.test(parsed.pathname);
    }
    return /^\/pin\/\d+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function safeMediaUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeFilenamePart(value) {
  return String(value || 'pin')
    .replace(/[<>:"/\\|?*\x00-\x1F[\]{}|^`]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80) || 'pin';
}

function itemHeaders(info, fallbackInfo = {}) {
  return {
    ...(fallbackInfo.http_headers && typeof fallbackInfo.http_headers === 'object' ? fallbackInfo.http_headers : {}),
    ...(info.http_headers && typeof info.http_headers === 'object' ? info.http_headers : {}),
    Referer: 'https://www.pinterest.com/',
  };
}

function mediaEntries(info) {
  if (Array.isArray(info.entries) && info.entries.length > 0) {
    return info.entries.filter((entry) => entry && typeof entry === 'object');
  }
  return [info];
}

function pinterestImageUrl(url) {
  const safeUrl = safeMediaUrl(url);
  if (!safeUrl) return null;

  const parsed = new URL(safeUrl);
  if (parsed.hostname === 'i.pinimg.com') {
    parsed.pathname = parsed.pathname.replace(/^\/\d+x(?:\d+)?\//, '/originals/');
  }
  return parsed.toString();
}

function imageCandidates(entry, info) {
  const candidates = [];
  const addCandidate = (candidate, fallbackExt) => {
    if (!candidate || typeof candidate !== 'object') return;
    const url = pinterestImageUrl(candidate.url);
    if (!url) return;

    const urlExt = new URL(url).pathname.split('.').pop()?.toLowerCase();
    const ext = String(candidate.ext ?? fallbackExt ?? urlExt ?? '').toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return;

    candidates.push({
      url,
      ext,
      width: Number(candidate.width) || 0,
      height: Number(candidate.height) || 0,
      sizeBytes: candidate.filesize ?? candidate.filesize_approx ?? null,
    });
  };

  for (const format of Array.isArray(entry.formats) ? entry.formats : []) {
    addCandidate(format, format?.ext);
  }
  for (const thumbnail of [
    ...(Array.isArray(entry.thumbnails) ? entry.thumbnails : []),
    ...(Array.isArray(info.thumbnails) ? info.thumbnails : []),
  ]) {
    addCandidate(thumbnail);
  }
  addCandidate({ url: entry.url, ext: entry.ext });
  addCandidate({ url: entry.thumbnail });
  addCandidate({ url: info.thumbnail });

  return candidates.sort((a, b) => {
    const areaDifference = b.width * b.height - a.width * a.height;
    if (areaDifference !== 0) return areaDifference;
    const aOriginal = new URL(a.url).pathname.includes('/originals/');
    const bOriginal = new URL(b.url).pathname.includes('/originals/');
    if (aOriginal !== bOriginal) return Number(bOriginal) - Number(aOriginal);
    return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
  });
}

function makeVideoItems(entry, groupId, entryIndex, info) {
  const listedFormats = Array.isArray(entry.formats) ? [...entry.formats] : [];
  if (listedFormats.length === 0 && safeMediaUrl(entry.url)) {
    listedFormats.push(entry);
  }

  const candidates = listedFormats.filter((format) => (
    format &&
    (format.vcodec ? format.vcodec !== 'none' : VIDEO_EXTENSIONS.has(String(format.ext ?? '').toLowerCase())) &&
    !String(format.ext ?? '').toLowerCase().includes('m3u8') &&
    safeMediaUrl(format.url)
  ));
  const progressive = candidates.filter((format) => format.acodec !== 'none');
  const usableFormats = progressive.length > 0 ? progressive : candidates;
  const bestPerHeight = new Map();

  for (const format of usableFormats) {
    const height = Number.isFinite(format.height) ? format.height : 0;
    const current = bestPerHeight.get(height);
    const formatSize = format.filesize ?? format.filesize_approx ?? 0;
    const currentSize = current?.filesize ?? current?.filesize_approx ?? 0;
    if (!current || formatSize > currentSize) bestPerHeight.set(height, format);
  }

  return [...bestPerHeight.entries()]
    .sort(([heightA], [heightB]) => heightB - heightA)
    .slice(0, 5)
    .map(([height, format], qualityIndex) => {
      const mediaId = safeFilenamePart(entry.id ?? groupId);
      const title = safeFilenamePart(entry.title ?? info.title ?? mediaId);
      const ext = String(format.ext ?? 'mp4').toLowerCase();
      const outputExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'mp4';
      const quality = height ? `${height}p` : 'Best';

      return {
        id: `pin_${mediaId}_${entryIndex}_${quality}`,
        groupId,
        kind: 'video',
        url: safeMediaUrl(format.url),
        headers: itemHeaders(format, entry),
        filename: `${title}_${entryIndex + 1}_${quality}.${outputExt}`,
        mimeType: outputExt === 'webm' ? 'video/webm' : 'video/mp4',
        sizeBytes: format.filesize ?? format.filesize_approx ?? null,
        quality,
        thumbnail: entry.thumbnail ?? info.thumbnail ?? undefined,
        durationSeconds: entry.duration ?? undefined,
        recommended: qualityIndex === 0,
      };
    });
}

function makeAudioItems(entry, groupId, entryIndex, info) {
  const formats = Array.isArray(entry.formats) ? entry.formats : [];
  const audioFormats = formats
    .filter((format) => (
      format &&
      format.vcodec === 'none' &&
      FORMAT_ID_PATTERN.test(String(format.format_id ?? '')) &&
      (
        (format.acodec && format.acodec !== 'none') ||
        /audio/i.test(String(format.format_id ?? '')) ||
        AUDIO_EXTENSIONS.has(String(format.audio_ext ?? '').toLowerCase())
      ) &&
      AUDIO_EXTENSIONS.has(String(format.audio_ext ?? format.ext ?? '').toLowerCase()) &&
      safeMediaUrl(format.url)
    ))
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));

  if (audioFormats.length === 0) return [];

  const format = audioFormats[0];
  const mediaId = safeFilenamePart(entry.id ?? groupId);
  const title = safeFilenamePart(entry.title ?? info.title ?? mediaId);
  const ext = String(format.audio_ext ?? format.ext).toLowerCase();
  const downloadUrl = new URL('/api/pinterest/download', info.backendBaseUrl);
  downloadUrl.searchParams.set('url', info.sourceUrl);
  downloadUrl.searchParams.set('audioFormatId', format.format_id);
  downloadUrl.searchParams.set('filename', `${title}_${entryIndex + 1}_audio.m4a`);

  return [{
    id: `pin_${mediaId}_${entryIndex}_audio`,
    groupId,
    kind: 'audio',
    url: downloadUrl.toString(),
    headers: {},
    filename: `${title}_${entryIndex + 1}_audio.m4a`,
    mimeType: AUDIO_MIME_TYPES[ext] ?? 'audio/mp4',
    sizeBytes: null,
    quality: format.abr ? `${Math.round(format.abr)} kbps` : 'Audio',
    thumbnail: entry.thumbnail ?? info.thumbnail ?? undefined,
    durationSeconds: entry.duration ?? undefined,
    recommended: false,
  }];
}

function makeImageItem(entry, groupId, entryIndex, info) {
  const image = imageCandidates(entry, info)[0];
  if (!image) return null;

  const mediaId = safeFilenamePart(entry.id ?? groupId);
  const title = safeFilenamePart(entry.title ?? info.title ?? mediaId);
  const imagePath = new URL(image.url).pathname;
  const dimensions = image.width && image.height ? `${image.width}x${image.height}` : null;
  return {
    id: `pin_${mediaId}_${entryIndex}_image`,
    groupId,
    kind: 'image',
    url: image.url,
    headers: itemHeaders(entry, info),
    filename: `${title}_${entryIndex + 1}.${image.ext}`,
    mimeType: `image/${image.ext === 'jpg' ? 'jpeg' : image.ext}`,
    sizeBytes: image.sizeBytes,
    quality: imagePath.includes('/originals/') ? 'Original' : dimensions ?? 'High quality',
    thumbnail: image.url,
    recommended: true,
  };
}

function makeVideoThumbnailItem(entry, groupId, entryIndex, info) {
  const image = imageCandidates(entry, info)[0];
  if (!image) return null;

  const imagePath = new URL(image.url).pathname;
  const dimensions = image.width && image.height ? `${image.width}x${image.height}` : null;
  const mediaId = safeFilenamePart(entry.id ?? groupId);
  const title = safeFilenamePart(entry.title ?? info.title ?? mediaId);

  return {
    id: `pin_${mediaId}_${entryIndex}_cover_image`,
    groupId,
    kind: 'image',
    url: image.url,
    headers: itemHeaders(entry, info),
    filename: `${title}_${entryIndex + 1}_image.${image.ext}`,
    mimeType: `image/${image.ext === 'jpg' ? 'jpeg' : image.ext}`,
    sizeBytes: image.sizeBytes,
    quality: imagePath.includes('/originals/') ? 'Original' : dimensions ?? 'High quality',
    thumbnail: image.url,
    recommended: false,
  };
}

export function buildPinterestResponse(info, sourceUrl, backendBaseUrl = 'http://localhost:4000') {
  const groupId = safeFilenamePart(info.id ?? 'pin');
  const items = [];

  mediaEntries(info).forEach((entry, entryIndex) => {
    const formats = Array.isArray(entry.formats) ? entry.formats : [];
    const audioFormat = formats
      .filter((format) => (
        format &&
        format.vcodec === 'none' &&
        FORMAT_ID_PATTERN.test(String(format.format_id ?? '')) &&
        (
          (format.acodec && format.acodec !== 'none') ||
          /audio/i.test(String(format.format_id ?? '')) ||
          AUDIO_EXTENSIONS.has(String(format.audio_ext ?? '').toLowerCase())
        ) &&
        safeMediaUrl(format.url)
      ))
      .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0];
    const videoItems = makeVideoItems(entry, groupId, entryIndex, info);
    const audioItems = makeAudioItems(entry, groupId, entryIndex, {
      ...info,
      backendBaseUrl,
      sourceUrl,
    });
    if (videoItems.length > 0) {
      items.push(...videoItems.map((item) => {
        const videoFormat = formats.find((format) => safeMediaUrl(format?.url) === item.url);
        if (
          !audioFormat ||
          !FORMAT_ID_PATTERN.test(String(audioFormat.format_id ?? '')) ||
          !FORMAT_ID_PATTERN.test(String(videoFormat?.format_id ?? ''))
        ) {
          return item;
        }

        const downloadUrl = new URL('/api/pinterest/download', backendBaseUrl);
        downloadUrl.searchParams.set('url', sourceUrl);
        downloadUrl.searchParams.set('videoFormatId', videoFormat.format_id);
        downloadUrl.searchParams.set('audioFormatId', audioFormat.format_id);
        downloadUrl.searchParams.set('filename', item.filename.replace(/\.[^.]+$/, '.mp4'));
        return {
          ...item,
          url: downloadUrl.toString(),
          filename: item.filename.replace(/\.[^.]+$/, '.mp4'),
          mimeType: 'video/mp4',
          sizeBytes: null,
          headers: {},
        };
      }));
      items.push(...audioItems);
      const thumbnailItem = makeVideoThumbnailItem(entry, groupId, entryIndex, info);
      if (thumbnailItem) items.push(thumbnailItem);
      return;
    }
    if (audioItems.length > 0) {
      items.push(...audioItems);
      return;
    }
    const imageItem = makeImageItem(entry, groupId, entryIndex, info);
    if (imageItem) items.push(imageItem);
  });

  if (items.length === 0) {
    throw new Error('No downloadable media was found for this public Pinterest pin.');
  }

  return {
    platform: 'pinterest',
    sourceUrl,
    title: info.title ?? undefined,
    author: info.uploader ?? info.uploader_id ?? undefined,
    items,
  };
}

export function pinterestResolveError(stderr, exitCode) {
  if (/no video formats found|no downloadable formats|requested format is not available/i.test(stderr)) {
    return new Error(
      "Pinterest couldn't provide downloadable media for this Pin. It may be unavailable, image-only, or currently unsupported.",
    );
  }

  if (/private|sign in|login required|not authorized/i.test(stderr)) {
    return new Error('This Pinterest Pin is private or requires login and cannot be downloaded.');
  }

  if (/404|not found|does not exist/i.test(stderr)) {
    return new Error('This Pinterest Pin could not be found. Check that the link is still available.');
  }

  return new Error(`Could not resolve this Pinterest Pin (yt-dlp exit code ${exitCode}). Please try again later.`);
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function readMetaAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

export function buildPinterestImageFallback(html, sourceUrl, backendBaseUrl = 'http://localhost:4000') {
  let title;
  let imageUrl;
  let width;
  let height;

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = readMetaAttributes(tag);
    const name = (attributes.property ?? attributes.name ?? '').toLowerCase();
    if (name === 'og:image' || name === 'twitter:image' || name === 'twitter:image:src') {
      imageUrl ??= safeMediaUrl(attributes.content);
    } else if (name === 'og:title' || name === 'twitter:title') {
      title ??= attributes.content;
    } else if (name === 'og:image:width') {
      width = Number(attributes.content) || width;
    } else if (name === 'og:image:height') {
      height = Number(attributes.content) || height;
    }
  }

  if (!imageUrl) {
    const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleTag) title = decodeHtmlEntities(titleTag[1].replace(/<[^>]+>/g, '').trim());
    throw new Error('Pinterest did not expose an image for this Pin. It may be unavailable or private.');
  }

  const image = new URL(imageUrl);
  if (image.hostname !== 'i.pinimg.com') {
    throw new Error('Pinterest returned an unsupported image source for this Pin.');
  }

  return buildPinterestResponse({
    id: new URL(sourceUrl).pathname.match(/\/pin\/(?:[\w-]+--)?(\d+)/i)?.[1] ?? 'pin',
    title,
    thumbnails: [{ url: imageUrl, width, height }],
  }, sourceUrl, backendBaseUrl);
}

async function readResponseTextLimited(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > MAX_PAGE_METADATA_BYTES) {
    throw new Error('Pinterest Pin page metadata exceeded the allowed size.');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PAGE_METADATA_BYTES) {
        await reader.cancel();
        throw new Error('Pinterest Pin page metadata exceeded the allowed size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function resolvePinterestImagePage(url, backendBaseUrl, request = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_METADATA_TIMEOUT_MS);
  try {
    const response = await request(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AllInOneDownloader/1.0)' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok || !isPinterestUrl(response.url)) {
      throw new Error(`Pinterest Pin page returned HTTP ${response.status}.`);
    }
    const html = await readResponseTextLimited(response);
    return buildPinterestImageFallback(html, response.url, backendBaseUrl);
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolvePinterest(url, options = {}) {
  if (!isPinterestUrl(url)) {
    throw new Error('Use a Pinterest pin link or pin.it share link.');
  }
  const backendBaseUrl = options.backendBaseUrl ?? 'http://localhost:4000';
  const request = options.request ?? fetch;

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_COMMAND, [
      '-m',
      'yt_dlp',
      '--dump-single-json',
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
      url,
    ]);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error('Pinterest resolution timed out. Please try again.'));
    }, RESOLVE_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Could not start yt-dlp for Pinterest: ${error.message}`));
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        const details = stderr.trim().slice(0, 300);
        if (details) console.warn(`[Pinterest] yt-dlp resolution failed: ${details}`);
        if (/no video formats found|no downloadable formats|requested format is not available/i.test(details)) {
          resolvePinterestImagePage(url, backendBaseUrl, request)
            .then(resolve)
            .catch((error) => {
              console.warn(`[Pinterest] Image metadata fallback failed: ${error.message}`);
              reject(pinterestResolveError(details, code));
            });
          return;
        }
        return reject(pinterestResolveError(details, code));
      }

      try {
        resolve(buildPinterestResponse(JSON.parse(stdout), url, backendBaseUrl));
      } catch (error) {
        reject(error instanceof SyntaxError
          ? new Error('Pinterest returned invalid media metadata.')
          : error);
      }
    });
  });
}
