import axios from 'axios';

/**
 * Proxy and stream download requests with proper TeraBox authentication headers.
 * Supports Range headers for resumable downloads and video seeking.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} cookie - Configured TeraBox cookie
 */
export async function handleStreamDownload(req, res, cookie = '') {
  const { dlink, filename = 'downloaded_file' } = req.query;

  if (!dlink || typeof dlink !== 'string') {
    return res.status(400).json({ error: 'Missing required query parameter: dlink' });
  }

  // Normalize cookie format
  let formattedCookie = (cookie || '').trim();
  if (formattedCookie && !formattedCookie.includes('ndus=')) {
    formattedCookie = `lang=en; ndus=${formattedCookie}`;
  }

  // Build headers for upstream TeraBox request
  const upstreamHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Referer': 'https://www.terabox.com/',
    'Accept': '*/*',
    'Connection': 'keep-alive',
  };

  if (formattedCookie) {
    upstreamHeaders['Cookie'] = formattedCookie;
  }

  // Forward Range header if client requested a range (e.g. resume or media seek)
  if (req.headers.range) {
    upstreamHeaders['Range'] = req.headers.range;
  }

  try {
    const upstreamRes = await axios({
      method: 'GET',
      url: dlink,
      headers: upstreamHeaders,
      responseType: 'stream',
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // Pass through relevant headers
    res.status(upstreamRes.status);

    const safeFilename = filename.replace(/["\r\n]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);

    if (upstreamRes.headers['content-type']) {
      res.setHeader('Content-Type', upstreamRes.headers['content-type']);
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }

    if (upstreamRes.headers['content-length']) {
      res.setHeader('Content-Length', upstreamRes.headers['content-length']);
    }

    if (upstreamRes.headers['content-range']) {
      res.setHeader('Content-Range', upstreamRes.headers['content-range']);
    }

    if (upstreamRes.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', upstreamRes.headers['accept-ranges']);
    }

    // Clean up upstream connection if client aborts download
    req.on('close', () => {
      if (upstreamRes.data && !upstreamRes.data.destroyed) {
        upstreamRes.data.destroy();
      }
    });

    // Pipe stream directly to client
    upstreamRes.data.pipe(res);
  } catch (err) {
    console.error('[StreamProxy Error]:', err.message);
    if (!res.headersSent) {
      res.status(err.response?.status || 502).json({
        error: `Stream download failed: ${err.message}`,
      });
    }
  }
}
