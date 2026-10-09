import { spawn } from "child_process";

const PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";
const RESOLVE_TIMEOUT_MS = 30_000;
const SIZE_REQUEST_TIMEOUT_MS = 5_000;
const SUPPORTED_POST_PATH = /^\/(?:p|reel|reels|tv|share\/reel)\//i;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export function getInstagramCookieArgs(
  cookiesFile = process.env.INSTAGRAM_COOKIES_FILE,
) {
  const configuredCookiesFile = cookiesFile?.trim();
  return configuredCookiesFile ? ["--cookies", configuredCookiesFile] : [];
}

export function getInstagramYtDlpArgs(
  url,
  cookiesFile = process.env.INSTAGRAM_COOKIES_FILE,
) {
  return [
    "-m",
    "yt_dlp",
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    ...getInstagramCookieArgs(cookiesFile),
    url,
  ];
}

function isInstagramHost(hostname) {
  const host = hostname.toLowerCase();
  return ["instagram.com", "instagr.am"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/**
 * Accept Instagram post, reel, and video share URLs, but not profile or story URLs.
 */
export function isInstagramUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      isInstagramHost(parsed.hostname) &&
      SUPPORTED_POST_PATH.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function safeMediaUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeFilenamePart(value) {
  return (
    String(value || "media")
      .replace(/[<>:"/\\|?*\x00-\x1F[\]{}|^`]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 80) || "media"
  );
}

function mediaEntries(info) {
  if (Array.isArray(info.entries) && info.entries.length > 0) {
    return info.entries.filter((entry) => entry && typeof entry === "object");
  }
  return [info];
}

function itemHeaders(info, fallbackInfo = {}) {
  return {
    ...(fallbackInfo.http_headers &&
    typeof fallbackInfo.http_headers === "object"
      ? fallbackInfo.http_headers
      : {}),
    ...(info.http_headers && typeof info.http_headers === "object"
      ? info.http_headers
      : {}),
    Referer: "https://www.instagram.com/",
  };
}

function positiveSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

function sizeFromContentRange(value) {
  const match = typeof value === "string" && value.match(/\/(\d+)$/);
  return match ? positiveSize(match[1]) : null;
}

async function fetchWithTimeout(request, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIZE_REQUEST_TIMEOUT_MS);
  try {
    return await request(url, {
      ...options,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getRemoteFileSize(url, headers, request = fetch) {
  try {
    const headResponse = await fetchWithTimeout(request, url, {
      method: "HEAD",
      headers,
    });
    const headSize = positiveSize(headResponse.headers.get("content-length"));
    if (headResponse.ok && headSize) return headSize;
  } catch {
    // Some media CDNs reject HEAD but support a one-byte range request.
  }

  try {
    const rangeResponse = await fetchWithTimeout(request, url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" },
    });
    const rangeSize = sizeFromContentRange(
      rangeResponse.headers.get("content-range"),
    );
    const fullResponseSize =
      rangeResponse.status === 200
        ? positiveSize(rangeResponse.headers.get("content-length"))
        : null;
    await rangeResponse.body?.cancel();
    return rangeSize ?? fullResponseSize;
  } catch {
    return null;
  }
}

export async function addMissingMediaSizes(items, request = fetch) {
  await Promise.all(
    items.map(async (item) => {
      if (positiveSize(item.sizeBytes)) {
        item.sizeBytes = positiveSize(item.sizeBytes);
        return;
      }

      try {
        if (new URL(item.url).pathname.endsWith("/api/instagram/download"))
          return;
      } catch {
        return;
      }

      item.sizeBytes = await getRemoteFileSize(item.url, item.headers, request);
      if (!item.sizeBytes) {
        console.warn(
          `[Instagram] Media size unavailable for ${item.filename}; CDN did not provide a usable size.`,
        );
      }
    }),
  );
  return items;
}

function makeVideoItems(entry, groupId, entryIndex, sourceUrl, backendBaseUrl) {
  const listedFormats = Array.isArray(entry.formats) ? [...entry.formats] : [];
  if (
    listedFormats.length === 0 &&
    String(entry.ext ?? "").toLowerCase() === "mp4" &&
    safeMediaUrl(entry.url)
  ) {
    listedFormats.push({ ...entry, vcodec: entry.vcodec ?? "unknown" });
  } else if (listedFormats.length === 0) {
    listedFormats.push(entry);
  }

  const formats = listedFormats.filter(
    (format) =>
      format &&
      format.vcodec &&
      format.vcodec !== "none" &&
      safeMediaUrl(format.url),
  );

  if (formats.length === 0) return [];

  const progressive = formats.filter(
    (format) => !format.acodec || format.acodec !== "none",
  );
  const candidates = progressive.length > 0 ? progressive : formats;
  const bestPerHeight = new Map();

  for (const format of candidates) {
    const height = Number.isFinite(format.height) ? format.height : 0;
    const current = bestPerHeight.get(height);
    const formatSize = format.filesize ?? format.filesize_approx ?? 0;
    const currentSize = current?.filesize ?? current?.filesize_approx ?? 0;
    if (!current || formatSize > currentSize) bestPerHeight.set(height, format);
  }

  const sortedFormats = [...bestPerHeight.entries()]
    .sort(([heightA], [heightB]) => heightB - heightA)
    .map(([, format]) => format)
    .slice(0, 5);
  const mediaId = safeFilenamePart(entry.id ?? groupId);
  const title = safeFilenamePart(entry.title ?? mediaId);
  const audioFormat = listedFormats
    .filter(
      (format) =>
        format &&
        format.vcodec === "none" &&
        format.acodec &&
        format.acodec !== "none" &&
        /^[a-zA-Z0-9_-]{1,100}$/.test(String(format.format_id ?? "")),
    )
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0];

  return sortedFormats.map((format, qualityIndex) => {
    const quality = format.height ? `${format.height}p` : "Best";
    const ext = format.ext === "webm" ? "webm" : "mp4";
    const formatId = String(format.format_id ?? "");
    const canMuxAudio = audioFormat && /^[a-zA-Z0-9_-]{1,100}$/.test(formatId);
    const outputExt = canMuxAudio ? "mp4" : ext;
    let mediaUrl = safeMediaUrl(format.url);
    let headers = itemHeaders(format, entry);

    if (canMuxAudio) {
      const downloadUrl = new URL("/api/instagram/download", backendBaseUrl);
      downloadUrl.searchParams.set("url", sourceUrl);
      downloadUrl.searchParams.set("videoFormatId", formatId);
      downloadUrl.searchParams.set(
        "audioFormatId",
        String(audioFormat.format_id),
      );
      downloadUrl.searchParams.set(
        "filename",
        `${title}_${entryIndex + 1}_${quality}.${outputExt}`,
      );
      mediaUrl = downloadUrl.toString();
      headers = {};
    }

    return {
      id: `ig_${mediaId}_${entryIndex}_${quality}`,
      groupId,
      kind: "video",
      url: mediaUrl,
      headers,
      filename: `${title}_${entryIndex + 1}_${quality}.${outputExt}`,
      mimeType: outputExt === "webm" ? "video/webm" : "video/mp4",
      sizeBytes:
        (format.filesize ?? format.filesize_approx ?? 0) +
          (canMuxAudio
            ? (audioFormat.filesize ?? audioFormat.filesize_approx ?? 0)
            : 0) || null,
      quality,
      thumbnail: entry.thumbnail ?? undefined,
      durationSeconds: entry.duration ?? undefined,
      recommended: qualityIndex === 0,
    };
  });
}

function makeImageItem(entry, groupId, entryIndex) {
  const ext = String(entry.ext ?? "").toLowerCase();
  const imageFormat = (Array.isArray(entry.formats) ? entry.formats : []).find(
    (format) =>
      IMAGE_EXTENSIONS.has(String(format?.ext ?? "").toLowerCase()) &&
      safeMediaUrl(format.url),
  );
  const url = safeMediaUrl(imageFormat?.url ?? entry.url);
  const imageExt = String(imageFormat?.ext ?? ext).toLowerCase();

  if (!url || !IMAGE_EXTENSIONS.has(imageExt)) return null;

  const mediaId = safeFilenamePart(entry.id ?? groupId);
  const title = safeFilenamePart(entry.title ?? mediaId);
  const mimeExt = imageExt === "jpg" ? "jpeg" : imageExt;

  return {
    id: `ig_${mediaId}_${entryIndex}_image`,
    groupId,
    kind: "image",
    url,
    headers: itemHeaders(imageFormat ?? entry, entry),
    filename: `${title}_${entryIndex + 1}.${imageExt}`,
    mimeType: `image/${mimeExt}`,
    sizeBytes:
      imageFormat?.filesize ??
      imageFormat?.filesize_approx ??
      entry.filesize ??
      null,
    thumbnail: entry.thumbnail ?? undefined,
    recommended: true,
  };
}

/**
 * Convert yt-dlp metadata into the app's shared resolve response shape.
 * Exported separately so format and carousel mapping can be tested without network access.
 */
export function buildInstagramResponse(
  info,
  sourceUrl,
  backendBaseUrl = "http://localhost:4000",
) {
  const postId = safeFilenamePart(info.id ?? "post");
  const items = [];

  mediaEntries(info).forEach((entry, entryIndex) => {
    const videoItems = makeVideoItems(
      entry,
      postId,
      entryIndex,
      sourceUrl,
      backendBaseUrl,
    );
    if (videoItems.length > 0) {
      items.push(...videoItems);
      return;
    }

    const imageItem = makeImageItem(entry, postId, entryIndex);
    if (imageItem) items.push(imageItem);
  });

  if (items.length === 0) {
    throw new Error(
      "No public downloadable media was found. Private or login-gated Instagram posts are not supported.",
    );
  }

  return {
    platform: "instagram",
    sourceUrl,
    title: info.title ?? undefined,
    author: info.uploader ?? info.uploader_id ?? undefined,
    items,
  };
}

/**
 * Resolve public Instagram posts, reels, and video posts using yt-dlp.
 */
export async function resolveInstagram(url, options = {}) {
  if (!isInstagramUrl(url)) {
    throw new Error("Use a public Instagram post, reel, or video link.");
  }
  const request =
    typeof options === "function" ? options : (options.request ?? fetch);
  const backendBaseUrl =
    typeof options === "object"
      ? (options.backendBaseUrl ?? "http://localhost:4000")
      : "http://localhost:4000";

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_COMMAND, getInstagramYtDlpArgs(url));
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error("Instagram resolution timed out. Please try again."));
    }, RESOLVE_TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(`Could not start yt-dlp for Instagram: ${error.message}`),
      );
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        const details = stderr.trim().slice(0, 300);
        if (/\b429\b|too many requests/i.test(details)) {
          return reject(
            new Error(
              "Instagram is temporarily rate-limiting requests (HTTP 429). Wait before retrying, or configure INSTAGRAM_COOKIES_FILE with a valid cookies.txt file.",
            ),
          );
        }
        return reject(
          new Error(
            details
              ? `Could not resolve this Instagram post: ${details}`
              : `Instagram resolver exited with code ${code}.`,
          ),
        );
      }

      try {
        const response = buildInstagramResponse(
          JSON.parse(stdout),
          url,
          backendBaseUrl,
        );
        addMissingMediaSizes(response.items, request)
          .then(() => resolve(response))
          .catch(reject);
      } catch (error) {
        reject(
          error instanceof SyntaxError
            ? new Error("Instagram returned invalid media metadata.")
            : error,
        );
      }
    });
  });
}
