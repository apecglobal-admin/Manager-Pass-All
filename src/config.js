import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadDotEnv();

export const APP_PORT = Number(process.env.PORT || 3000);
export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const APP_URL = process.env.APP_URL || `http://127.0.0.1:${APP_PORT}`;
export const APP_DOWNLOAD_URL = process.env.APP_DOWNLOAD_URL || 'https://github.com/apecglobal-admin/Manager-Pass-All/releases/latest';

export function getEncryptionKey() {
  const raw = process.env.APP_SECRET || 'apecglobal-manager-local-development-secret';
  return cryptoKeyFromSecret(raw);
}

export function cryptoKeyFromSecret(secret) {
  return Buffer.from(secret.padEnd(32, '0').slice(0, 32));
}

export function getPublicSupabaseConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    apiBaseUrl: resolvePublicApiBaseUrl()
  };
}

export function getSupabaseAdminConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

function resolvePublicApiBaseUrl() {
  for (const origin of String(process.env.APP_ALLOWED_ORIGINS || '').split(',')) {
    const normalized = normalizeOrigin(origin);
    if (isPublicHttpOrigin(normalized)) return normalized;
  }
  return '';
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

function isPublicHttpOrigin(origin) {
  if (!/^https?:\/\//i.test(origin)) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname);
  } catch {
    return false;
  }
}

function loadDotEnv() {
  loadEnvFile(join(process.cwd(), '.env'));
  loadEnvFile(join(__dirname, '..', 'desktop', 'public.env'));
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
