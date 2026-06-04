# Vercel Deploy

This project deploys the existing `public/` web UI as static assets and routes API requests to `api/index.js`.

## Required Vercel Environment Variables

Set these in Vercel Project Settings:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
APP_SECRET=replace-with-a-long-random-secret
APP_ALLOWED_ORIGINS=http://127.0.0.1:3000,https://localhost,capacitor://localhost,https://your-vercel-app.vercel.app
```

`SUPABASE_SERVICE_ROLE_KEY` is expected for the serverless API backend so requests do not depend on per-instance in-memory Supabase user tokens.
The public API URL exposed by `/config.js` is derived from the public HTTPS origin in `APP_ALLOWED_ORIGINS`.

## Build Settings

The repository includes `vercel.json`, so Vercel should use:

```text
Build Command: npm run vercel:build
Output Directory: public
Node.js: 22.x
```

The `api/index.js` function is initialized lazily so Vercel can build the project without creating the Supabase server client at module import time.

## Capacitor API URL

After Vercel deploy succeeds, copy the deployment URL into `public/config.js`:

```js
window.APECGLOBAL_CONFIG = window.APECGLOBAL_CONFIG || {
  supabaseUrl: 'https://your-project.supabase.co',
  supabaseAnonKey: 'your-anon-key',
  apiBaseUrl: 'https://your-vercel-app.vercel.app'
};
```

Then run:

```powershell
npm.cmd run android:sync
```
