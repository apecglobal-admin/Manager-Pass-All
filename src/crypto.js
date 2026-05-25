import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const HASH_ITERATIONS = 120000;
const HASH_LENGTH = 32;
const DIGEST = 'sha256';

export function encryptText(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', normalizeKey(key), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);

  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  });
}

export function decryptText(payload, key) {
  const parsed = JSON.parse(payload);
  const decipher = createDecipheriv('aes-256-gcm', normalizeKey(key), Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

export function hashPassword(password, salt = randomBytes(16).toString('base64')) {
  const hash = pbkdf2Sync(String(password), salt, HASH_ITERATIONS, HASH_LENGTH, DIGEST).toString('base64');
  return `pbkdf2$${HASH_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, encodedHash) {
  const [scheme, iterations, salt, expectedHash] = String(encodedHash).split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expectedHash) return false;

  const actual = pbkdf2Sync(String(password), salt, Number(iterations), HASH_LENGTH, DIGEST);
  const expected = Buffer.from(expectedHash, 'base64');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

function normalizeKey(key) {
  const buffer = Buffer.isBuffer(key) ? key : Buffer.from(String(key));
  if (buffer.length === 32) return buffer;
  return pbkdf2Sync(buffer, 'apecglobal-manager-key', 1, 32, DIGEST);
}
