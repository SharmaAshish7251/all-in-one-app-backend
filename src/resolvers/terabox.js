import axios from 'axios';

/**
 * Check if the given URL belongs to a known TeraBox domain/alias.
 */
export function isTeraBoxUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const domains = [
      'terabox.com',
      '1024terabox.com',
      'terabox.app',
      'freeterabox.com',
      '4funbox.com',
      'mirrobox.com',
      'nephobox.com',
      'teraboxshare.com',
      'teraboxlink.com',
      'momerybox.com',
      'tibibox.com',
    ];
    return domains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Helper to extract substring between two markers.
 */
function findBetween(str, start, end) {
  const startIndex = str.indexOf(start);
  if (startIndex === -1) return '';
  const fromIndex = startIndex + start.length;
  const endIndex = str.indexOf(end, fromIndex);
  if (endIndex === -1) return '';
  return str.substring(fromIndex, endIndex);
}

/**
 * Determine media kind based on file extension.
 */
function getMediaKind(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', '3gp'];
  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
  const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'opus'];

  if (videoExts.includes(ext)) return 'video';
  if (imageExts.includes(ext)) return 'image';
  if (audioExts.includes(ext)) return 'audio';
  return 'file';
}

/**
 * Resolve TeraBox share link and return file metadata and download items.
 *
 * @param {string} rawUrl - Target TeraBox URL
 * @param {string} cookie - User cookie string (e.g. "lang=en; ndus=...")
 * @param {string} backendBaseUrl - Base URL of this backend (for direct proxy download link)
 */
export async function resolveTeraBox(rawUrl, cookie = '', backendBaseUrl = 'http://localhost:4000') {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

  // Normalize cookie format: if user only pasted raw token value, wrap it
  let formattedCookie = cookie.trim();
  if (formattedCookie && !formattedCookie.includes('ndus=')) {
    formattedCookie = `lang=en; ndus=${formattedCookie}`;
  }

  const defaultHeaders = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (formattedCookie) {
    defaultHeaders['Cookie'] = formattedCookie;
  }

  // 1. Initial request to resolve short-link redirects and fetch page HTML
  let initialResponse;
  try {
    initialResponse = await axios.get(rawUrl, {
      headers: defaultHeaders,
      maxRedirects: 10,
      timeout: 15000,
    });
  } catch (err) {
    throw new Error(`Failed to access TeraBox link: ${err.message}`);
  }

  const finalUrl = initialResponse.request?.res?.responseUrl || initialResponse.config?.url || rawUrl;
  const html = initialResponse.data;

  // 2. Extract surl from final URL query params or original URL
  let surl = null;
  try {
    const parsedFinal = new URL(finalUrl);
    surl = parsedFinal.searchParams.get('surl');
  } catch {
    // ignore
  }

  if (!surl) {
    const surlMatch = rawUrl.match(/\/s\/([a-zA-Z0-9_-]+)/);
    if (surlMatch) {
      // If surl starts with '1', TeraBox often accepts either the full or stripped value
      surl = surlMatch[1];
      if (surl.startsWith('1')) {
        surl = surl.substring(1);
      }
    }
  }

  if (!surl) {
    throw new Error('Could not extract short URL identifier (surl) from TeraBox link.');
  }

  // 3. Extract tokens required by TeraBox list API
  const jsToken = findBetween(html, 'fn%28%22', '%22%29');
  const logid = findBetween(html, 'dp-logid=', '&');
  const bdstoken = findBetween(html, 'bdstoken":"', '"');

  // 4. Request file list from TeraBox API
  const apiParams = {
    app_id: '250528',
    web: '1',
    channel: 'dubox',
    clienttype: '0',
    jsToken: jsToken || '',
    'dp-logid': logid || '',
    page: '1',
    num: '20',
    by: 'name',
    order: 'asc',
    site_referer: finalUrl,
    shorturl: surl,
    root: '1,',
  };

  const apiHeaders = {
    'User-Agent': userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Host': 'www.terabox.app',
    'Referer': finalUrl,
  };

  if (formattedCookie) {
    apiHeaders['Cookie'] = formattedCookie;
  }

  let listResponse;
  try {
    listResponse = await axios.get('https://www.terabox.app/share/list', {
      params: apiParams,
      headers: apiHeaders,
      timeout: 15000,
    });
  } catch (err) {
    throw new Error(`Failed to query TeraBox API: ${err.message}`);
  }

  const resData = listResponse.data;

  // Handle TeraBox verification / cookie error
  if (resData.errno === 460020 || resData.errmsg === 'need verify') {
    throw new Error(
      'TeraBox requires verification or an authenticated session. Please set a valid TERABOX_COOKIE (ndus token) in backend/.env.',
    );
  }

  if (resData.errno && resData.errno !== 0) {
    throw new Error(resData.errmsg || `TeraBox API returned error code: ${resData.errno}`);
  }

  if (!resData.list || !Array.isArray(resData.list) || resData.list.length === 0) {
    throw new Error('No files found in this TeraBox link.');
  }

  // 5. Build resolved items
  const items = resData.list.map((file, index) => {
    const filename = file.server_filename || `terabox_file_${index + 1}`;
    const sizeBytes = parseInt(file.size, 10) || null;
    const kind = getMediaKind(filename);
    const dlink = file.dlink || '';
    const thumbnail = file.thumbs?.url3 || file.thumbs?.url2 || file.thumbs?.url1 || '';

    // The proxy download link allows mobile/browser clients to download without TeraBox cookies
    const proxyDownloadUrl = `${backendBaseUrl}/api/download?dlink=${encodeURIComponent(dlink)}&filename=${encodeURIComponent(filename)}`;

    return {
      id: `tb_${surl}_${file.fs_id || index}`,
      groupId: surl,
      kind,
      url: proxyDownloadUrl, // direct stream download URL through our backend
      originalDlink: dlink,
      filename,
      mimeType: kind === 'video' ? 'video/mp4' : kind === 'image' ? 'image/jpeg' : 'application/octet-stream',
      sizeBytes,
      thumbnail,
      recommended: index === 0,
      headers: {
        Referer: 'https://www.terabox.com/',
      },
    };
  });

  return {
    platform: 'terabox',
    sourceUrl: rawUrl,
    items,
  };
}
