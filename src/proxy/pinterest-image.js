import { Readable } from 'stream';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const MAX_REDIRECTS = 3;

export function isPinterestImageUrl(value) {
  try {
    const url = new URL(value);
    const extension = url.pathname.split('.').pop()?.toLowerCase();
    return url.protocol === 'https:' &&
      url.hostname === 'i.pinimg.com' &&
      Boolean(extension && IMAGE_EXTENSIONS.has(extension));
  } catch {
    return false;
  }
}

function getSafeParams(req) {
  const { url, filename = 'pinterest_image.jpg' } = req.query;
  if (!isPinterestImageUrl(url)) {
    return { error: 'Only Pinterest CDN image URLs are supported.' };
  }
  const parsedUrl = new URL(url);

  if (
    typeof filename !== 'string' ||
    filename.length > 180 ||
    !IMAGE_EXTENSIONS.has(filename.split('.').pop()?.toLowerCase())
  ) {
    return { error: 'A valid image filename is required.' };
  }

  return {
    url: parsedUrl,
    filename: filename.replace(/["\r\n/\\]/g, '_'),
  };
}

async function fetchPinterestImage(initialUrl) {
  let url = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AllInOneDownloader/1.0)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS) {
        await response.body?.cancel();
        throw new Error('Pinterest image redirected too many times.');
      }

      const nextUrl = new URL(location, url);
      if (
        nextUrl.protocol !== 'https:' ||
        nextUrl.hostname !== 'i.pinimg.com'
      ) {
        await response.body?.cancel();
        throw new Error('Pinterest image redirected to an unsupported host.');
      }
      await response.body?.cancel();
      url = nextUrl;
      continue;
    }

    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Pinterest image request failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!contentType?.startsWith('image/')) {
      await response.body.cancel();
      throw new Error('Pinterest returned a non-image response.');
    }

    return response;
  }

  throw new Error('Pinterest image request exceeded the redirect limit.');
}

export async function handlePinterestImageDownload(req, res) {
  const params = getSafeParams(req);
  if (params.error) return res.status(400).json({ error: params.error });

  try {
    const upstream = await fetchPinterestImage(params.url);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${params.filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    Readable.fromWeb(upstream.body).on('error', (error) => {
      console.error(`[Pinterest Image Download] Stream failed: ${error.message}`);
      if (!res.headersSent) res.status(502).json({ error: 'Could not stream the Pinterest image.' });
      else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    console.error(`[Pinterest Image Download] Request failed: ${error.message}`);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Could not download this Pinterest image.' });
    }
  }
}
