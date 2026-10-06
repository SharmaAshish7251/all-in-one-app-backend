import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DEFAULT_SALT = 'aio-downloader-cookie-vault-salt-2026';

/**
 * Derive a 32-byte key from secret passphrase.
 */
function deriveKey(secret) {
  const passphrase = secret || process.env.COOKIE_SECRET || 'aio-backend-default-secret-key';
  return crypto.scryptSync(passphrase, DEFAULT_SALT, 32);
}

/**
 * Encrypt a text string using AES-256-GCM.
 * Output format: "ENC:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
export function encryptData(plainText, secret) {
  if (!plainText) return '';
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plainText, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `ENC:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * If data is not encrypted (does not start with ENC:), returns raw data as-is.
 */
export function decryptData(data, secret) {
  if (!data || typeof data !== 'string') return '';
  const trimmed = data.trim();
  if (!trimmed.startsWith('ENC:')) {
    return trimmed;
  }

  const parts = trimmed.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted cookie format.');
  }

  const [, ivHex, tagHex, cipherHex] = parts;
  const key = deriveKey(secret);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Check if a file content is encrypted.
 */
export function isContentEncrypted(content) {
  return typeof content === 'string' && content.trim().startsWith('ENC:');
}

/**
 * Set strict file permissions (owner read/write only, 0600) on POSIX systems.
 */
export function secureFilePermissions(filePath) {
  try {
    if (fs.existsSync(filePath) && process.platform !== 'win32') {
      fs.chmodSync(filePath, 0o600);
    }
  } catch (err) {
    // Non-fatal if filesystem doesn't support chmod (e.g. FAT32/Windows)
  }
}
