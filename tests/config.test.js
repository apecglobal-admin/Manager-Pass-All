import test from 'node:test';
import assert from 'node:assert/strict';

test('public config uses Vercel env names and derives API URL from allowed origins', async () => {
  const previousEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    APP_ALLOWED_ORIGINS: process.env.APP_ALLOWED_ORIGINS
  };

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ignored.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'ignored-key';
  process.env.APP_ALLOWED_ORIGINS = 'https://localhost,capacitor://localhost,https://manager.vercel.app';

  try {
    const moduleUrl = `../src/config.js?case=${Date.now()}`;
    const { getPublicSupabaseConfig } = await import(moduleUrl);

    assert.deepEqual(getPublicSupabaseConfig(), {
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'anon-key',
      apiBaseUrl: 'https://manager.vercel.app'
    });
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
