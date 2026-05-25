import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KDF_ITERATIONS = 210000;

export async function deriveVaultKey(masterPassword, saltBase64) {
  const baseKey = await subtle.importKey(
    'raw',
    encoder.encode(String(masterPassword)),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(saltBase64),
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptVaultText(value, key, saltBase64) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(String(value))
  );

  return {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    iv: toBase64(iv),
    salt: saltBase64,
    data: toBase64(new Uint8Array(encrypted))
  };
}

export async function decryptVaultText(payload, key) {
  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.data)
  );
  return decoder.decode(decrypted);
}

export function createVaultSalt() {
  return toBase64(webcrypto.getRandomValues(new Uint8Array(16)));
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value) {
  return Buffer.from(value, 'base64');
}
