import test from 'node:test';
import assert from 'node:assert/strict';
import { mapEntryToSupabaseRow } from '../src/supabase-mapper.js';

test('mapEntryToSupabaseRow never maps plaintext password to Supabase', () => {
  const row = mapEntryToSupabaseRow({
    id: 'entry-1',
    vaultId: 'vault-1',
    projectId: 'project-1',
    name: 'Portal Admin',
    type: 'Admin',
    environment: 'Production',
    url: 'https://portal.example.com',
    username: 'cto@example.com',
    password: 'plaintext-password',
    passwordCipher: { v: 1, data: 'encrypted' },
    notes: 'secret note',
    secretNotesCipher: { v: 1, data: 'encrypted-note' },
    tags: ['portal'],
    status: 'Active'
  });

  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes('plaintext-password'), false);
  assert.equal(serialized.includes('secret note'), false);
  assert.deepEqual(row.password_cipher, { v: 1, data: 'encrypted' });
  assert.deepEqual(row.secret_notes_cipher, { v: 1, data: 'encrypted-note' });
});
