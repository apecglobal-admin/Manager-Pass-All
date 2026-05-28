# ApecGlobal Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web dashboard for managing ApecGlobal project links, accounts, encrypted passwords, import/export, and auto-lock.

**Architecture:** A dependency-light Node.js app serves a REST API and a static dashboard. Current implementation uses Supabase as the persistence layer. The frontend is vanilla HTML/CSS/JS for fast delivery and low setup risk on this machine.

**Tech Stack:** Node.js, `node:http`, Supabase, `node:test`, AES-256-GCM crypto, vanilla browser UI.

---

## File Structure

- `package.json`: npm scripts and project metadata.
- `src/config.js`: app paths, crypto/session constants, defaults.
- `src/crypto.js`: password hashing, encryption, decryption, token helpers.
- `src/supabase-repositories.js`: focused Supabase functions for users, projects, entries, settings, and activity logs.
- `src/http-utils.js`: request parsing, JSON responses, static file serving helpers.
- `src/routes.js`: REST route handlers.
- `src/server.js`: HTTP server bootstrap.
- `public/index.html`: authenticated app shell.
- `public/styles.css`: dashboard styling.
- `public/app.js`: frontend behavior.
- `tests/crypto.test.js`: crypto tests.
- `tests/supabase-repositories.test.js`: Supabase behavior tests.
- `tests/routes.test.js`: API behavior tests.

## Task 1: Project Bootstrap And Crypto

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Create: `src/crypto.js`
- Test: `tests/crypto.test.js`

- [ ] **Step 1: Write failing crypto tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptText, decryptText, hashPassword, verifyPassword } from '../src/crypto.js';

test('encryptText returns ciphertext that decrypts to original text', () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptText('secret-pass', key);

  assert.notEqual(encrypted, 'secret-pass');
  assert.equal(decryptText(encrypted, key), 'secret-pass');
});

test('verifyPassword accepts the original password and rejects a wrong password', () => {
  const hash = hashPassword('local-admin-pass', 'fixed-salt');

  assert.equal(verifyPassword('local-admin-pass', hash), true);
  assert.equal(verifyPassword('wrong-pass', hash), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/crypto.test.js`
Expected: FAIL because `src/crypto.js` does not exist.

- [ ] **Step 3: Implement minimal bootstrap and crypto modules**

Create CommonJS-free ES modules. `encryptText` stores JSON with `iv`, `tag`, and `data`. `hashPassword` uses PBKDF2 with SHA-256.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/crypto.test.js`
Expected: PASS.

## Task 2: Supabase Schema And Repositories

**Files:**
- Create: `src/supabase-repositories.js`
- Test: `tests/supabase-repositories.test.js`

- [ ] **Step 1: Write failing repository tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseRepositories } from '../src/supabase-repositories.js';

test('creates a project with encrypted entry credentials', async () => {
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(),
    encryptionKey: Buffer.alloc(32, 3)
  });

  const project = await repos.projects.create({ name: 'Apec CRM', description: 'Main CRM', status: 'Active' });
  const entry = await repos.entries.create({
    projectId: project.id,
    name: 'CRM Admin',
    type: 'Admin',
    environment: 'Production',
    url: 'https://crm.local',
    username: 'cto',
    password: 'very-secret',
    notes: 'Primary admin',
    tags: ['crm', 'admin'],
    status: 'Active'
  });

  const rows = await repos.entries.listByProject(project.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'CRM Admin');
  assert.equal(rows[0].passwordMasked, true);
  assert.equal(rows[0].password, undefined);
  assert.equal(await repos.entries.revealPassword(entry.id), 'very-secret');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/supabase-repositories.test.js`
Expected: FAIL because `src/supabase-repositories.js` does not exist.

- [ ] **Step 3: Implement Supabase repositories**

Use Supabase tables from the SQL files, including `app_users`, `projects`, `entries`, `entry_types`, `activity_logs`, and `app_settings`. Encrypt entry passwords before insert/update.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repositories.test.js`
Expected: PASS.

## Task 3: HTTP API

**Files:**
- Create: `src/http-utils.js`
- Create: `src/routes.js`
- Create: `src/server.js`
- Test: `tests/routes.test.js`

- [ ] **Step 1: Write failing API tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

test('login, create project, create entry, and reveal password through API', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 5) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const projectRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Apec Portal', description: '', status: 'Active' })
    });
    const project = await projectRes.json();
    assert.equal(project.name, 'Apec Portal');

    const entryRes = await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        projectId: project.id,
        name: 'Portal Admin',
        type: 'Admin',
        environment: 'Production',
        url: 'https://portal.local',
        username: 'cto',
        password: 'portal-secret',
        notes: '',
        tags: ['portal'],
        status: 'Active'
      })
    });
    const entry = await entryRes.json();

    const reveal = await fetch(`${base}/api/entries/${entry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie }
    });
    assert.equal((await reveal.json()).password, 'portal-secret');
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/routes.test.js`
Expected: FAIL because `src/server.js` does not exist.

- [ ] **Step 3: Implement routes**

Implement session cookies, auth guard, CRUD endpoints, reveal endpoint, import preview/commit, export JSON/CSV, settings, and activity.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/routes.test.js`
Expected: PASS.

## Task 4: Dashboard UI

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

- [ ] **Step 1: Add UI shell**

Create a login view and dashboard view with sidebar projects, global search, type filters, entry table, edit modal, import/export controls, and lock button.

- [ ] **Step 2: Wire frontend API calls**

Implement login, session check, project loading, entry loading, create/update/delete, reveal/copy password, import preview/commit, export JSON/CSV, settings, and auto-lock timer.

- [ ] **Step 3: Run manual UI check**

Run: `node src/server.js`
Open: `http://localhost:3000`
Expected: Login screen appears. Login with `admin` / `admin123456`. Dashboard loads.

## Task 5: Full Verification

**Files:**
- Modify as needed based on verification failures.

- [ ] **Step 1: Run automated tests**

Run: `node --test`
Expected: all tests PASS.

- [ ] **Step 2: Run local server**

Run: `node src/server.js`
Expected: server prints `ApecGlobal Manager running at http://localhost:3000`.

- [ ] **Step 3: Manual smoke test**

Open `http://localhost:3000`, log in, create project, create entry, reveal/copy password, export JSON, export CSV, lock app.

- [ ] **Step 4: Inspect SQLite plaintext risk**

Search the database file for a known password string.
Expected: known plaintext password is not present.
