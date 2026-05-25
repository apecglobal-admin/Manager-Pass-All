import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVaultKey, encryptVaultText, decryptVaultText } from '../src/vault-crypto.js';

test('vault encryption decrypts with the same master password', async () => {
  const salt = Buffer.alloc(16, 2).toString('base64');
  const key = await deriveVaultKey('correct horse battery staple', salt);
  const encrypted = await encryptVaultText('secret-api-token', key, salt);

  assert.equal(encrypted.alg, 'AES-256-GCM');
  assert.equal(JSON.stringify(encrypted).includes('secret-api-token'), false);
  assert.equal(await decryptVaultText(encrypted, key), 'secret-api-token');
});

test('vault decryption fails with the wrong master password', async () => {
  const salt = Buffer.alloc(16, 3).toString('base64');
  const goodKey = await deriveVaultKey('right-password', salt);
  const badKey = await deriveVaultKey('wrong-password', salt);
  const encrypted = await encryptVaultText('never-plaintext', goodKey, salt);

  await assert.rejects(() => decryptVaultText(encrypted, badKey));
});
