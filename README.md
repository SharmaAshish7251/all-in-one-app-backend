# All-in-One Downloader — Standalone Node.js Backend

A lightweight Node.js backend resolver and streaming proxy for **TeraBox**, **Twitter / X**, **YouTube**, public **Instagram** posts, and **Pinterest** pins.

---

## Features

- **Web Control Dashboard (`/` & `/dashboard`):** Modern interactive web interface for managing TeraBox credentials, toggling resolution modes, testing cookies, and previewing downloads.
- **Dual Resolution Engine (Auto + Custom + Hybrid):**
  - **Hybrid Mode (Default):** Attempts custom session credentials first; seamlessly falls back to automated parameter bypass if expired.
  - **Auto Mode:** Zero-configuration extraction without requiring manual cookies.
  - **Custom Mode:** Enforces personal `ndus` token for high-speed direct downloads.
- **Auto-Capture Login Flow:** Whenever the `ndus` cookie expires, the dashboard immediately alerts the admin and enables a 1-click Auto-Sync bookmarklet that extracts the key directly from the browser login session into the backend with zero manual copying.
- **Cookie Validator:** Real-time cookie testing and live latency checks.
- **TeraBox Resolver:** Supports all TeraBox domains (`terabox.com`, `1024terabox.com`, `terabox.app`, `freeterabox.com`, `4funbox.com`, etc.).
- **Streaming Proxy (`/api/download`):** Forwards file downloads while injecting required session cookies and headers (`Referer`, `Cookie`, `User-Agent`), so clients (React Native app, browsers, download managers) can download files directly without getting 403 Forbidden.
- **Range Header Support:** Enables resumable downloads and video streaming/seeking.
- **Twitter / X Resolver:** Built-in resolution for Twitter videos and photos.
- **Instagram Resolver:** Resolves public posts, reels, and video posts, including carousel media and available video qualities. Private or login-gated content is not supported.
- **Instagram Audio Merging:** Combines separate Instagram video and audio tracks into a single MP4 download through the backend.
- **Pinterest Resolver:** Resolves public Pinterest pins and short `pin.it` links into downloadable video qualities, cover images, or image Pins. Private or login-gated content is not supported.
- **Pinterest Audio Merging:** Combines separate Pinterest HLS video and audio tracks into MP4 downloads; an audio-only M4A option is offered when available.
- **YouTube Resolver:** Extracts video qualities and audio options with `yt-dlp`.
- **Client Agnostic:** Can be consumed directly by the React Native mobile app (`worker.ts`), browser, or cURL.

---

## Auto-Capturing the TeraBox `ndus` Key

Instead of manually inspecting cookies in DevTools:
1. Open the Dashboard at `http://localhost:4000/dashboard`.
2. Click **⚡ Auto-Capture** or the **Login & Auto-Capture Key** alert banner.
3. Drag the **⚡ Sync TeraBox to AIO** bookmarklet to your browser toolbar.
4. Log into your TeraBox account in a new tab.
5. Click the **⚡ Sync TeraBox to AIO** bookmarklet: it automatically extracts the `ndus` key and updates the backend instantly!

---

## Quick Start (Local Setup)

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env`:
```bash
PORT=4000
BASE_URL=http://localhost:4000
TERABOX_COOKIE=lang=en; ndus=YOUR_NDUS_COOKIE_HERE
```

#### Optional YouTube cookies

Some YouTube requests require authentication. Export your own YouTube cookies
in Netscape format and configure the backend to read them from a file:

```env
YOUTUBE_COOKIES_FILE=/path/to/youtube-cookies.txt
```

On Render, add the cookie file under **Secret Files** (for example,
`youtube-cookies.txt`) and set `YOUTUBE_COOKIES_FILE` to
`/etc/secrets/youtube-cookies.txt`. Do not commit or share this file; it grants
access to your YouTube session. The backend uses it for both resolving videos
and downloading them.

#### How to get your `ndus` TeraBox Cookie:
1. Open [https://www.terabox.com](https://www.terabox.com) in Chrome/Edge and log into your account.
2. Press `F12` to open Developer Tools.
3. Go to the **Application** (or **Storage**) tab > **Cookies** > `https://www.terabox.com`.
4. Find the cookie named `ndus` and copy its value.
5. In your `.env`, set:
   ```env
   TERABOX_COOKIE=lang=en; ndus=<pasted_ndus_value>
   ```

### 3. Start the Server
```bash
# Start in production mode
npm start

# Or start in development mode with auto-reload
npm run dev
```

---

## API Endpoints

### 1. Health Check
```http
GET /health
```
**Response:**
```json
{
  "ok": true,
  "status": "healthy",
  "uptime": 12.4,
  "teraboxConfigured": true,
  "timestamp": "2026-10-05T14:30:00.000Z"
}
```

---

### 2. Resolve URL (`POST /resolve`)
Matches the mobile app's resolver contract.

```http
POST /resolve
Content-Type: application/json

{
  "url": "https://1024terabox.com/s/13jzq7oaclcdX9hd8-jS04w"
}
```

**Response:**
```json
{
  "platform": "terabox",
  "sourceUrl": "https://1024terabox.com/s/13jzq7oaclcdX9hd8-jS04w",
  "items": [
    {
      "id": "tb_3jzq7oaclcdX9hd8-jS04w_12345678",
      "groupId": "3jzq7oaclcdX9hd8-jS04w",
      "kind": "video",
      "url": "http://localhost:4000/api/download?dlink=...&filename=sample.mp4",
      "originalDlink": "https://d.terabox.com/...",
      "filename": "sample.mp4",
      "mimeType": "video/mp4",
      "sizeBytes": 15420912,
      "thumbnail": "https://...",
      "recommended": true
    }
  ]
}
```

> **Note:** The `url` field in each item is a direct download link routed through `/api/download`, allowing the mobile app or browser to download the file directly with no cookie errors!

Instagram post and reel URLs use the same `POST /resolve` endpoint. Resolution uses the backend's existing `yt-dlp` installation and returns public media items, including carousel entries and available video qualities. When Instagram exposes audio separately from video, downloads are merged into a single MP4 by `GET /api/instagram/download`. Private posts, stories, and login-gated content are not supported.

Pinterest Pin URLs use the same `POST /resolve` endpoint. When Pinterest exposes separate HLS video and audio streams, video qualities are merged by `GET /api/pinterest/download`; an audio-only M4A option is also provided. Pins for which yt-dlp exposes no downloadable formats cannot be resolved.

---

### 3. Direct Streaming Download (`GET /api/download`)
Streams the file directly to the client with `Content-Disposition: attachment`.

```http
GET /api/download?dlink=<encoded_dlink>&filename=sample.mp4
```

---

## Free Cloud Deployment

### Deploy to Render.com (Recommended)
1. Push your `backend` folder to GitHub (as its own repo or monorepo subfolder).
2. Go to [Render.com](https://render.com) > **New Web Service**.
3. Select your repository.
4. Set:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && python3 -m pip install --upgrade "yt-dlp[default]"`
   - **Start Command:** `npm start`
5. In **Environment Variables**, add:
   - `BASE_URL`: `https://your-app-name.onrender.com`
   - `TERABOX_COOKIE`: `lang=en; ndus=YOUR_NDUS_VALUE`
6. If YouTube requires authentication, add your Netscape-format cookies file
   under **Secret Files** as `youtube-cookies.txt`, then add
   `YOUTUBE_COOKIES_FILE=/etc/secrets/youtube-cookies.txt` under **Environment
   Variables**.
7. Click **Deploy**.
8. In your React Native app's `.env`, update:
   ```env
   EXPO_PUBLIC_WORKER_URL=https://your-app-name.onrender.com
   ```
