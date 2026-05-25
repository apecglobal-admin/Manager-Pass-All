# Supabase EXE Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure Supabase sync, client-side vault encryption, and Windows `.exe` packaging to ApecGlobal Manager.

**Architecture:** Keep the current local Node app working while introducing a sync-ready domain layer. Sensitive fields are encrypted locally before Supabase writes. The web client and Electron desktop shell use the same frontend and Supabase-backed repository.

**Tech Stack:** Node.js 24, Web Crypto compatible AES-GCM/PBKDF2, Supabase JS client, Supabase SQL migrations, Electron, existing vanilla HTML/CSS/JS frontend.

---

## File Structure

- Create `supabase/migrations/202605180001_initial_vault_schema.sql`: Supabase schema, indexes, RLS policies.
- Create `.env.example`: documented environment variables.
- Create `src/vault-crypto.js`: browser/server-compatible vault encryption helpers.
- Create `tests/vault-crypto.test.js`: encryption and wrong-key tests.
- Create `src/supabase-mapper.js`: maps local project/entry objects to Supabase rows without plaintext secrets.
- Create `tests/supabase-mapper.test.js`: proves password plaintext is not mapped to Supabase.
- Create `public/supabase-client.js`: frontend Supabase client wrapper loaded when config exists.
- Modify `public/index.html`: add Supabase login and vault unlock views.
- Modify `public/app.js`: add auth state, vault unlock state, and repository selection.
- Create `desktop/main.cjs`: Electron main process.
- Create `desktop/preload.cjs`: safe preload bridge.
- Modify `package.json`: add Supabase/Electron dependencies and packaging scripts.

## Task 1: Vault Encryption Module

**Files:**
- Create: `src/vault-crypto.js`
- Test: `tests/vault-crypto.test.js`

- [ ] **Step 1: Write failing encryption tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveVaultKey, encryptVaultText, decryptVaultText } from '../src/vault-crypto.js';

test('vault encryption decrypts with the same master password', async () => {
  const salt = Buffer.alloc(16, 2).toString('base64');
  const key = await deriveVaultKey('correct horse battery staple', salt);
  const encrypted = await encryptVaultText('secret-api-token', key, salt);

  assert.equal(encrypted.alg, 'AES-256-GCM');
  assert.equal(JSON.stringify(encrypted).includes('secret-api-token'), false);
  assert.equal(await decryptVaultText(encrypted, key), 'secret-api-token');
});

test('vault decryption fails with the wrong master password', async () => {
  const salt = Buffer.alloc(16, 3).toString('base64');
  const goodKey = await deriveVaultKey('right-password', salt);
  const badKey = await deriveVaultKey('wrong-password', salt);
  const encrypted = await encryptVaultText('never-plaintext', goodKey, salt);

  await assert.rejects(() => decryptVaultText(encrypted, badKey));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/vault-crypto.test.js`

Expected: FAIL because `src/vault-crypto.js` does not exist.

- [ ] **Step 3: Implement vault crypto**

Implement PBKDF2-SHA256 key derivation and AES-256-GCM encryption using `node:crypto.webcrypto.subtle`. The encrypted payload must use `{ v, alg, kdf, iv, salt, data }` and must not include plaintext.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/vault-crypto.test.js`

Expected: PASS.

## Task 2: Supabase SQL Schema

**Files:**
- Create: `supabase/migrations/202605180001_initial_vault_schema.sql`
- Create: `tests/supabase-schema.test.js`

- [ ] **Step 1: Write failing schema test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/supabase-schema.test.js`

Expected: FAIL because migration file does not exist.

- [ ] **Step 3: Write migration SQL**

Create tables `profiles`, `vaults`, `projects`, `entries`, `devices`, `activity_logs`. Enable RLS on all tables. Add owner-only policies using `auth.uid()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/supabase-schema.test.js`

Expected: PASS.

## Task 3: Supabase Mapping Without Plaintext Secrets

**Files:**
- Create: `src/supabase-mapper.js`
- Test: `tests/supabase-mapper.test.js`

- [ ] **Step 1: Write failing mapper test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/supabase-mapper.test.js`

Expected: FAIL because mapper does not exist.

- [ ] **Step 3: Implement mapper**

Map non-sensitive searchable fields and encrypted payload fields. Do not include `password`, `notes`, `secret`, `token`, or plaintext-only fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/supabase-mapper.test.js`

Expected: PASS.

## Task 4: Environment And Supabase Client Skeleton

**Files:**
- Create: `.env.example`
- Create: `public/supabase-client.js`
- Modify: `public/index.html`

- [ ] **Step 1: Add environment template**

Create `.env.example` with:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
APP_SECRET=replace-with-local-development-secret
```

- [ ] **Step 2: Add frontend Supabase wrapper**

Create `public/supabase-client.js` that reads `window.APECGLOBAL_CONFIG`, initializes Supabase only when `supabaseUrl` and `supabaseAnonKey` are present, and exposes a null-safe client getter.

- [ ] **Step 3: Add config script tag**

Modify `public/index.html` to load `/config.js` before `/supabase-client.js` and `/app.js`. The server will later serve `/config.js` from environment.

- [ ] **Step 4: Verify static assets**

Run: `Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing`

Expected: HTTP 200.

## Task 5: Server Config Endpoint

**Files:**
- Modify: `src/server.js`
- Test: `tests/routes.test.js`

- [ ] **Step 1: Add failing route test**

Add a test asserting `GET /config.js` returns JavaScript containing `supabaseUrl` and not containing service role secrets.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/routes.test.js`

Expected: FAIL because `/config.js` is not implemented.

- [ ] **Step 3: Implement `/config.js`**

Serve:

```js
window.APECGLOBAL_CONFIG = {
  supabaseUrl: "...",
  supabaseAnonKey: "..."
};
```

Only expose `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/routes.test.js`

Expected: PASS.

## Task 6: Electron Desktop Shell

**Files:**
- Create: `desktop/main.cjs`
- Create: `desktop/preload.cjs`
- Modify: `package.json`

- [ ] **Step 1: Add scripts and dependencies**

Add dependencies:

```json
"devDependencies": {
  "electron": "^33.0.0",
  "electron-builder": "^25.0.0"
}
```

Add scripts:

```json
"desktop": "electron .",
"package:win": "electron-builder --win portable"
```

- [ ] **Step 2: Create Electron main process**

Create a `BrowserWindow` that loads `http://localhost:3000` if a local dev server is running, otherwise loads the packaged app URL or local server started by the desktop wrapper.

- [ ] **Step 3: Create preload**

Expose safe metadata only:

```js
contextBridge.exposeInMainWorld('apecDesktop', {
  platform: process.platform,
  version: appVersion
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm.cmd install`

Expected: installs Electron packages. This requires network access.

- [ ] **Step 5: Package Windows executable**

Run: `npm.cmd run package:win`

Expected: creates a Windows executable under `dist/`.

## Task 7: Verification

**Files:**
- Modify as needed based on failures.

- [ ] **Step 1: Run all automated tests**

Run: `node --test`

Expected: all tests PASS.

- [ ] **Step 2: Run local web app**

Run: `npm.cmd run dev`

Expected: server prints `ApecGlobal Manager running at http://localhost:3000`.

- [ ] **Step 3: Verify Supabase migration safety**

Open `supabase/migrations/202605180001_initial_vault_schema.sql` and confirm:

- RLS is enabled.
- Policies use `auth.uid()`.
- `entries` has `password_cipher jsonb`.
- No plaintext password column exists.

- [ ] **Step 4: Verify EXE artifact**

Run: `Get-ChildItem dist -Recurse -Filter *.exe`

Expected: at least one `.exe` exists after packaging.
