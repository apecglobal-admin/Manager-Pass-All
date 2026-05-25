import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadDotEnv();

export const APP_PORT = Number(process.env.PORT || 3000);
export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
export const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'apecglobal-manager.sqlite');
export const BACKUP_DIR = process.env.BACKUP_DIR || join(DATA_DIR, 'backups');
export const DEFAULT_ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
export const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const APP_URL = process.env.APP_URL || `http://localhost:${APP_PORT}`;

mkdirSync(DATA_DIR, { recursive: true });

export function getEncryptionKey() {
  const raw = process.env.APP_SECRET || 'apecglobal-manager-local-development-secret';
  return cryptoKeyFromSecret(raw);
}

export function cryptoKeyFromSecret(secret) {
  return Buffer.from(secret.padEnd(32, '0').slice(0, 32));
}

export function getPublicSupabaseConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
  };
}

export function getSupabaseAdminConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
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
