import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Supabase migration creates encrypted vault tables with RLS', () => {
  const sql = readFileSync('supabase/migrations/202605180001_initial_vault_schema.sql', 'utf8');

  assert.match(sql, /create table if not exists public\.vaults/i);
  assert.match(sql, /password_cipher jsonb/i);
  assert.match(sql, /secret_notes_cipher jsonb/i);
  assert.match(sql, /alter table public\.entries enable row level security/i);
  assert.match(sql, /auth\.uid\(\)/i);
});
