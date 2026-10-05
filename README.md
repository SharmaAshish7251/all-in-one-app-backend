# All-in-One Downloader — Standalone Node.js Backend

A lightweight, dedicated Node.js backend resolver and streaming proxy for **TeraBox** and **Twitter / X**.

---

## Features

- **TeraBox Resolver:** Supports all TeraBox domains (`terabox.com`, `1024terabox.com`, `terabox.app`, `freeterabox.com`, `4funbox.com`, etc.).
- **Streaming Proxy (`/api/download`):** Forwards file downloads while injecting required session cookies and headers (`Referer`, `Cookie`, `User-Agent`), so clients (React Native app, browsers, download managers) can download files directly without getting 403 Forbidden.
- **Range Header Support:** Enables resumable downloads and video streaming/seeking.
- **Twitter / X Resolver:** Built-in resolution for Twitter videos and photos.
- **Client Agnostic:** Can be consumed directly by the React Native mobile app (`worker.ts`), browser, or cURL.

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
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. In **Environment Variables**, add:
   - `BASE_URL`: `https://your-app-name.onrender.com`
   - `TERABOX_COOKIE`: `lang=en; ndus=YOUR_NDUS_VALUE`
6. Click **Deploy**.
7. In your React Native app's `.env`, update:
   ```env
   EXPO_PUBLIC_WORKER_URL=https://your-app-name.onrender.com
   ```
