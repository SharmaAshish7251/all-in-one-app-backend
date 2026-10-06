# YouTube Cookies & Security Vault

This directory stores session cookies used to authenticate `yt-dlp` requests and bypass bot verification checks on cloud/datacenter IPs (Render, Railway, etc.).

## 🔒 Built-in Security Features

1. **AES-256-GCM Encryption at Rest**:
   - The cookie file `cookies/youtube.txt` is encrypted using AES-256-GCM.
   - The backend automatically decrypts the file at runtime into a protected, ephemeral memory/file sandbox.
   - Encryption does not make a cookie file safe to commit; keep plaintext and encrypted cookie files out of Git.

2. **File Permissions (0600)**:
   - On Linux/POSIX systems, files are restricted to `0600` (readable and writable only by the process owner).

3. **HTTP Access Blocked**:
   - The Express server explicitly blocks any web requests to `/cookies`, `*.txt`, `.env`, or `.git` paths with `403 Forbidden`.

4. **Strict Input Validation**:
   - Video IDs and filenames are regex-validated to prevent path traversal attempts.

## 🛠️ Management Commands

- **Encrypt cookies**:
  ```bash
  npm run encrypt-cookies
  ```
- **Decrypt cookies** (for manual editing or inspecting):
  ```bash
  npm run decrypt-cookies
  ```

Set `COOKIE_SECRET` to a unique, strong passphrase both when encrypting cookies and when running the backend. The built-in fallback is not suitable for protecting real cookies. Keep the secret in your environment and never commit it or cookie files.
