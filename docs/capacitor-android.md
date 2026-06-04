# Capacitor Android

This project packages the existing `public/` web UI into an Android app with Capacitor.

## Local Commands

```powershell
npm.cmd run android:sync
npm.cmd run android:open
npm.cmd run android:run
```

`android:sync` copies `public/` into the Android project. Run it after changing frontend assets or `public/config.js`.

## API Backend

The Android app does not embed the Node.js server from `src/server.js`. Before building a mobile release, point the bundled web app at a deployed backend by editing `public/config.js`:

```js
window.APECGLOBAL_CONFIG = window.APECGLOBAL_CONFIG || {
  supabaseUrl: 'https://your-project.supabase.co',
  supabaseAnonKey: 'your-anon-key',
  apiBaseUrl: 'https://your-api.example.com'
};
```

Then run:

```powershell
npm.cmd run android:sync
```

On the backend deployment, allow the Android WebView origin:

```env
APP_ALLOWED_ORIGINS=http://127.0.0.1:3000,https://localhost,capacitor://localhost,https://your-vercel-app.vercel.app
```

The server also uses the public HTTPS origin in `APP_ALLOWED_ORIGINS` as the default API URL exposed by `/config.js`.
