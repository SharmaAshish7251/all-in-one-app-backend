import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encryptData, decryptData, isContentEncrypted, secureFilePermissions } from '../src/utils/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const cookieFile = path.join(rootDir, 'cookies', 'youtube.txt');

function main() {
  const action = process.argv[2] || 'encrypt';

  if (!fs.existsSync(cookieFile)) {
    console.error(`❌ Cookie file not found at: ${cookieFile}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(cookieFile, 'utf8').trim();

  if (action === 'decrypt') {
    if (!isContentEncrypted(raw)) {
      console.log('ℹ️  File is already in plaintext format.');
      return;
    }
    const decrypted = decryptData(raw);
    fs.writeFileSync(cookieFile, decrypted, 'utf8');
    secureFilePermissions(cookieFile);
    console.log(`✅ Decrypted ${cookieFile} successfully.`);
  } else {
    // Encrypt
    if (isContentEncrypted(raw)) {
      console.log('ℹ️  File is already encrypted with AES-256-GCM.');
      return;
    }
    const encrypted = encryptData(raw);
    fs.writeFileSync(cookieFile, encrypted, 'utf8');
    secureFilePermissions(cookieFile);
    console.log(`🔒 Encrypted ${cookieFile} successfully with AES-256-GCM!`);
    console.log('💡 Set COOKIE_SECRET to a unique, strong passphrase in the runtime environment.');
    console.log('   Never commit cookie files, whether encrypted or plaintext.');
  }
}

main();
