import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptText, decryptText, hashPassword, verifyPassword } from '../src/crypto.js';

test('encryptText returns ciphertext that decrypts to original text', () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptText('secret-pass', key);

  assert.notEqual(encrypted, 'secret-pass');
  assert.equal(decryptText(encrypted, key), 'secret-pass');
});

test('verifyPassword accepts the original password and rejects a wrong password', () => {
  const hash = hashPassword('local-admin-pass', 'fixed-salt');

  assert.equal(verifyPassword('local-admin-pass', hash), true);
  assert.equal(verifyPassword('wrong-pass', hash), false);
});
