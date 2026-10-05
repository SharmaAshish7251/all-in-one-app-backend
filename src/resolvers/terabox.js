import axios from 'axios';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0';

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
 * Normalize cookie string to guarantee "lang=en; ndus=..." format.
 */
export function formatCookie(cookie = '') {
  if (!cookie) return '';
  const trimmed = cookie.trim();
  if (!trimmed) return '';
  if (trimmed.includes('ndus=')) {
    return trimmed.includes('lang=') ? trimmed : `lang=en; ${trimmed}`;
  }
  return `lang=en; ndus=${trimmed}`;
}

/**
 * Extract the substring between two markers.
 * Mirrors TeraboxDL's _find_between logic.
 */
function findBetween(s, start, end) {
  const startIndex = s.indexOf(start);
  if (startIndex === -1) return '';
  const contentStart = startIndex + start.length;
  const endIndex = s.indexOf(end, contentStart);
  if (endIndex === -1) return '';
  return s.substring(contentStart, endIndex);
}

/**
 * Extract tokens required by TeraBox's share/list API from the share page HTML.
 *
 * Returns { jsToken, dpLogid, bdstoken } — any field may be empty if the
 * page layout changed.
 */
function extractTokens(html) {
  // dp-logid value is followed by &amp; in the HTML source, so accept both.
  let dpLogid = findBetween(html, 'dp-logid=', '&');
  if (!dpLogid) {
    const ampIdx = html.indexOf('dp-logid=');
    if (ampIdx !== -1) {
      const segment = html.substring(ampIdx + 9, ampIdx + 80);
      const ampEnd = segment.indexOf('&amp;');
      if (ampEnd !== -1) {
        dpLogid = segment.substring(0, ampEnd);
      }
    }
  }

  return {
    jsToken: findBetween(html, 'fn%28%22', '%22%29'),
    dpLogid,
    bdstoken: findBetween(html, 'bdstoken":"', '"'),
  };
}

/**
 * Build the full set of query parameters TeraBox expects on share/list.
 */
function buildListParams(surl, tokens) {
  return {
    app_id: '250528',
    web: '1',
    channel: 'dubox',
    clienttype: '0',
    jsToken: tokens.jsToken || '',
    'dp-logid': tokens.dpLogid || '',
    page: '1',
    num: '20',
    by: 'name',
    order: 'asc',
    site_referer: `https://www.terabox.app/sharing/link?surl=${encodeURIComponent(surl)}`,
    shorturl: surl,
    root: '1,',
  };
}

/**
 * Test whether a given TeraBox cookie is valid and active.
 */
export function testTeraBoxCookie(cookie = '') {
  const start = Date.now();
  const formatted = formatCookie(cookie);

  if (!formatted) {
    return Promise.resolve({
      ok: false,
      status: 'missing',
      message: 'No cookie provided. Please provide an ndus token.',
      latencyMs: 0,
    });
  }

  // Test against TeraBox share/list API with a known shorturl and full params
  return axios
    .get('https://www.terabox.app/share/list', {
      params: {
        app_id: '250528',
        web: '1',
        channel: 'dubox',
        clienttype: '0',
        shorturl: '3jzq7oaclcdX9hd8-jS04w',
        root: '1,',
      },
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Cookie': formatted,
      },
      timeout: 10000,
    })
    .then((res) => {
      const latencyMs = Date.now() - start;
      const data = res.data || {};
      if (data.code === 460020 || data.errno === 460020 || data.errmsg === 'need verify') {
        return {
          ok: false,
          status: 'need_verify',
          message: 'Cookie requires CAPTCHA verification or has expired. Please refresh your ndus token.',
          latencyMs,
          code: 460020,
        };
      }
      if (data.code === 0 || data.errno === 0) {
        return {
          ok: true,
          status: 'active',
          message: 'TeraBox session cookie is valid and active.',
          latencyMs,
          code: 0,
        };
      }
      return {
        ok: false,
        status: 'error',
        message: data.errmsg || `TeraBox API returned code ${data.code || data.errno}`,
        latencyMs,
        code: data.code || data.errno,
      };
    })
    .catch((err) => {
      return {
        ok: false,
        status: 'network_error',
        message: err.message,
        latencyMs: Date.now() - start,
      };
    });
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
 * Extract surl identifier from URL string.
 */
function extractSurl(rawUrl, finalUrl = '') {
  let surl = null;
  if (finalUrl) {
    try {
      const parsed = new URL(finalUrl);
      surl = parsed.searchParams.get('surl');
    } catch {
      // ignore
    }
  }

  if (!surl) {
    try {
      const parsed = new URL(rawUrl);
      surl = parsed.searchParams.get('surl');
    } catch {
      // ignore
    }
  }

  if (!surl) {
    const surlMatch = rawUrl.match(/\/s\/([a-zA-Z0-9_-]+)/);
    if (surlMatch) {
      surl = surlMatch[1];
      if (surl.startsWith('1')) {
        surl = surl.substring(1);
      }
    }
  }

  return surl;
}

/**
 * Attempt to retrieve direct download link for a file from share/download
 */
async function fetchDirectDownloadLink(shareId, uk, fsId, cookie) {
  if (!shareId || !uk || !fsId) return null;

  try {
    const res = await axios.post(
      'https://www.terabox.app/share/download',
      new URLSearchParams({
        app_id: '250528',
        shareid: String(shareId),
        uk: String(uk),
        fid_list: JSON.stringify([String(fsId)]),
      }),
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(cookie ? { 'Cookie': cookie } : {}),
          'Referer': 'https://www.terabox.app/',
        },
        timeout: 10000,
      }
    );

    if (res.data && res.data.errno === 0 && res.data.dlink) {
      return res.data.dlink;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Resolve TeraBox share link with Auto, Custom, or Hybrid methods.
 *
 * @param {string} rawUrl - Target TeraBox URL
 * @param {string|object} optionsOrCookie - Cookie string OR options object { cookie, mode, backendBaseUrl }
 * @param {string} legacyBaseUrl - Base URL for proxy stream links
 */
export async function resolveTeraBox(rawUrl, optionsOrCookie = '', legacyBaseUrl = 'http://localhost:4000') {
  let cookie = '';
  let mode = 'hybrid'; // 'hybrid' | 'auto' | 'custom'
  let backendBaseUrl = legacyBaseUrl;

  if (typeof optionsOrCookie === 'object' && optionsOrCookie !== null) {
    cookie = optionsOrCookie.cookie || '';
    mode = optionsOrCookie.mode || 'hybrid';
    backendBaseUrl = optionsOrCookie.backendBaseUrl || legacyBaseUrl;
  } else if (typeof optionsOrCookie === 'string') {
    cookie = optionsOrCookie;
  }

  const formattedCookie = formatCookie(cookie);

  // If in custom-only mode and cookie is missing, warn right away
  if (mode === 'custom' && !formattedCookie) {
    throw new Error('Custom Mode requires a valid TERABOX_COOKIE (ndus token). Please configure it in the dashboard.');
  }

  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (formattedCookie && mode !== 'auto') {
    headers['Cookie'] = formattedCookie;
  }

  // 1. Initial request to resolve short-link redirects and grab page tokens
  let initialResponse;
  let tokens = { jsToken: '', dpLogid: '', bdstoken: '' };
  try {
    initialResponse = await axios.get(rawUrl, {
      headers,
      maxRedirects: 10,
      timeout: 15000,
    });

    // Extract jsToken, dp-logid, and bdstoken from the share page HTML.
    // These are required by the share/list API; without them TeraBox returns
    // "need verify" regardless of cookie.
    const html = initialResponse.data || '';
    if (typeof html === 'string' && html.length > 100) {
      tokens = extractTokens(html);
    }
  } catch (err) {
    throw new Error(`Failed to access TeraBox link: ${err.message}`);
  }

  const finalUrl = initialResponse.request?.res?.responseUrl || initialResponse.config?.url || rawUrl;
  const surl = extractSurl(rawUrl, finalUrl);

  if (!surl) {
    throw new Error('Could not extract short URL identifier (surl) from TeraBox link.');
  }

  // 2. Query TeraBox file list with the full parameter set the page expects
  const listParams = buildListParams(surl, tokens);

  const listHeaders = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
  };

  if (formattedCookie && mode !== 'auto') {
    listHeaders['Cookie'] = formattedCookie;
  }

  let listResponse;
  try {
    listResponse = await axios.get('https://www.terabox.app/share/list', {
      params: listParams,
      headers: listHeaders,
      timeout: 15000,
    });
  } catch (err) {
    // If request with cookie failed and we're in hybrid mode, retry anonymously in auto mode
    if (mode === 'hybrid' && formattedCookie) {
      try {
        listResponse = await axios.get('https://www.terabox.app/share/list', {
          params: listParams,
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });
      } catch (retryErr) {
        throw new Error(`Failed to query TeraBox API: ${retryErr.message}`);
      }
    } else {
      throw new Error(`Failed to query TeraBox API: ${err.message}`);
    }
  }

  let resData = listResponse?.data || {};

  // If cookie returned "need verify" and mode is hybrid, auto-fallback without cookie
  if ((resData.errno === 460020 || resData.errmsg === 'need verify') && mode === 'hybrid') {
    try {
      const autoRes = await axios.get('https://www.terabox.app/share/list', {
        params: listParams,
        headers: { 'User-Agent': USER_AGENT },
        timeout: 15000,
      });
      if (autoRes.data && autoRes.data.errno === 0) {
        resData = autoRes.data;
      }
    } catch {
      // ignore
    }
  }

  if (resData.errno === 460020 || resData.code === 460020 || resData.errmsg === 'need verify') {
    throw new Error(
      'TeraBox requires verification or an authenticated session. Please set an updated TERABOX_COOKIE (ndus token) in the backend dashboard or switch to Auto mode.',
    );
  }

  if (resData.errno && resData.errno !== 0) {
    throw new Error(resData.errmsg || `TeraBox API returned error code: ${resData.errno}`);
  }

  const fileList = resData.list || [];
  if (!Array.isArray(fileList) || fileList.length === 0) {
    throw new Error('No files found in this TeraBox link.');
  }

  const shareId = resData.share_id;
  const uk = resData.uk;

  // 3. Process items and build download URLs
  const items = await Promise.all(
    fileList.map(async (file, index) => {
      const filename = file.server_filename || `terabox_file_${index + 1}`;
      const sizeBytes = parseInt(file.size, 10) || null;
      const kind = getMediaKind(filename);
      let dlink = file.dlink || '';
      const thumbnail =
        file.thumbs?.url3 || file.thumbs?.url2 || file.thumbs?.url1 || file.thumbs?.icon || '';

      // If dlink is missing, try fetching it via share/download
      if (!dlink && (formattedCookie || mode === 'auto')) {
        const fetchedDlink = await fetchDirectDownloadLink(shareId, uk, file.fs_id, formattedCookie);
        if (fetchedDlink) {
          dlink = fetchedDlink;
        }
      }

      // If dlink is available, route it through backend proxy
      // If not, point to thumbnail or direct share URL with clear fallback
      const finalDownloadUrl = dlink
        ? `${backendBaseUrl}/api/download?dlink=${encodeURIComponent(dlink)}&filename=${encodeURIComponent(filename)}`
        : thumbnail || rawUrl;

      return {
        id: `tb_${surl}_${file.fs_id || index}`,
        groupId: surl,
        kind,
        url: finalDownloadUrl,
        originalDlink: dlink || null,
        filename,
        mimeType:
          kind === 'video' ? 'video/mp4' : kind === 'image' ? 'image/jpeg' : 'application/octet-stream',
        sizeBytes,
        thumbnail,
        width: file.width || undefined,
        height: file.height || undefined,
        durationSeconds: file.duration || undefined,
        recommended: index === 0,
        methodUsed: formattedCookie && mode !== 'auto' ? 'custom' : 'auto',
        headers: {
          Referer: 'https://www.terabox.com/',
        },
      };
    })
  );

  return {
    platform: 'terabox',
    sourceUrl: rawUrl,
    modeUsed: mode,
    shareTitle: resData.title || (items[0] ? items[0].filename : 'TeraBox File'),
    items,
  };
}
