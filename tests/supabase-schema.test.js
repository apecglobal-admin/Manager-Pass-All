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

test('Supabase auth RLS patch allows user-scoped access requests', () => {
  const sql = readFileSync('sql/004_supabase_auth_rls.sql', 'utf8');

  assert.match(sql, /create or replace function public\.has_no_app_users\(\)/i);
  assert.match(sql, /create policy "app users self access request insert"/i);
  assert.match(sql, /auth_user_id = auth\.uid\(\)/i);
  assert.match(sql, /lower\(username\) = lower\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)/i);
  assert.match(sql, /create policy "activity logs authenticated insert"/i);
});
