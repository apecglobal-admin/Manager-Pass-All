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

test('Supabase admin RLS patch allows admins to read and mutate app data', () => {
  const sql = readFileSync('sql/005_supabase_admin_data_rls.sql', 'utf8');

  for (const table of ['vaults', 'projects', 'entries']) {
    assert.match(sql, new RegExp(`create policy "${table} admin access" on public\\.${table}`, 'i'));
  }
  assert.match(sql, /using \(public\.current_app_user_is_admin\(\)\)/i);
  assert.match(sql, /with check \(public\.current_app_user_is_admin\(\)\)/i);
});

test('Supabase user preferences migration stores per-user UI settings', () => {
  const sql = readFileSync('sql/009_user_preferences.sql', 'utf8');

  assert.match(sql, /alter table public\.app_users/i);
  assert.match(sql, /add column if not exists preferences jsonb not null default '\{\}'::jsonb/i);
});

test('Supabase departments migration stores dynamic user departments', () => {
  const sql = readFileSync('sql/010_departments.sql', 'utf8');

  assert.match(sql, /create table if not exists public\.departments/i);
  assert.match(sql, /alter table public\.app_users/i);
  assert.match(sql, /add column if not exists department_id uuid/i);
  assert.match(sql, /departments admin access/i);
});
