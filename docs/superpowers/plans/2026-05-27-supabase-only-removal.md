# Supabase-Only Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove SQLite from runtime and make Supabase the only persistence layer.

**Architecture:** Replace SQLite-backed repositories with a Supabase-backed repository module while keeping the current REST API shape. Server startup requires Supabase config, routes use injected repositories, and JSON backup becomes a Supabase export response.

**Tech Stack:** Node.js ESM, `node:http`, `@supabase/supabase-js`, Supabase SQL/RLS, `node:test`.

---

## File Structure

- Create `sql/001_supabase_only_core.sql`: core Supabase tables and seed entry types.
- Create `sql/002_supabase_only_permissions.sql`: membership and detailed permission tables.
- Create `sql/003_supabase_only_rls.sql`: indexes and RLS policies.
- Create `src/supabase-repositories.js`: Supabase repository implementation for users, projects, entry types, entries, permissions, memberships, activity, settings, and export.
- Modify `src/server.js`: stop opening SQLite and wire Supabase repositories into routes.
- Modify `src/routes.js`: remove SQLite `db`, local login, local backup writer, and numeric-id assumptions.
- Modify `src/config.js`: remove `DB_PATH` and SQLite data-dir legacy behavior.
- Modify `package.json` and `package-lock.json`: remove `better-sqlite3` and `backup` script.
- Delete `src/db.js`, `src/backup.js`, and `scripts/save-backup.js`.
- Replace SQLite tests with Supabase-only tests in `tests/supabase-repositories.test.js` and adjusted `tests/routes.test.js`.
- Delete `tests/repositories.test.js` and `tests/backup.test.js`.

## Task 1: Add SQL Schema Files

**Files:**
- Create: `sql/001_supabase_only_core.sql`
- Create: `sql/002_supabase_only_permissions.sql`
- Create: `sql/003_supabase_only_rls.sql`

- [ ] **Step 1: Create core SQL**

Add `app_users`, `entry_types`, and `app_settings`; keep existing vault/project/entry tables compatible.

- [ ] **Step 2: Create permission SQL**

Add `project_memberships` and `detailed_permissions` keyed by UUIDs.

- [ ] **Step 3: Create RLS SQL**

Enable RLS and policies for app tables. Admin/service-role use remains server-side.

- [ ] **Step 4: Verify no SQLite references**

Run: `rg -n "sqlite|better-sqlite|node:sqlite" sql`

Expected: no output.

## Task 2: Write Supabase Repository Tests First

**Files:**
- Create: `tests/supabase-repositories.test.js`
- Modify: `tests/supabase-data-store.test.js` if fake query helpers need reuse.

- [ ] **Step 1: Write failing tests**

Cover:

- `users.activateForGoogleLogin()` resolves active `app_users` by verified email.
- `entryTypes.list()` returns seeded types.
- `backup.exportJson()` returns projects, entries, users, settings, and counts without file paths.
- `entries.revealPassword()` decrypts Supabase ciphertext.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/supabase-repositories.test.js`

Expected: fail because `src/supabase-repositories.js` does not exist.

## Task 3: Implement Supabase Repositories

**Files:**
- Create: `src/supabase-repositories.js`
- Modify: `src/repositories.js`

- [ ] **Step 1: Implement minimal repository API**

Export `createSupabaseRepositories()` and `hasPermission()`.

- [ ] **Step 2: Preserve route-facing shapes**

Return current frontend payload names: `displayName`, `typeId`, `projectId`, `passwordMasked`, `permissions`, `createdAt`, `updatedAt`.

- [ ] **Step 3: Run repository tests**

Run: `npm test -- tests/supabase-repositories.test.js`

Expected: pass.

## Task 4: Remove SQLite Server Wiring

**Files:**
- Modify: `src/server.js`
- Modify: `src/routes.js`
- Modify: `src/config.js`

- [ ] **Step 1: Write failing route test**

Change route test setup to inject fake Supabase repositories and assert `createApp()` no longer accepts/needs `dbPath`.

- [ ] **Step 2: Run route test and verify RED**

Run: `npm test -- tests/routes.test.js`

Expected: fail on old SQLite setup or missing Supabase-only wiring.

- [ ] **Step 3: Update server wiring**

Remove `createDatabase()`, `DB_PATH`, and `db.close()`. Build repositories from Supabase config or injected `repos`.

- [ ] **Step 4: Update routes**

Remove `writeBackupFiles(db, backupDir)`. Change `/api/backups/save-json` to call Supabase export. Return `{ exportedAt, counts, users, projects, entries, settings }`.

- [ ] **Step 5: Run route tests**

Run: `npm test -- tests/routes.test.js`

Expected: pass after tests are adjusted to Supabase-only fake repos.

## Task 5: Remove SQLite Files And Dependencies

**Files:**
- Delete: `src/db.js`
- Delete: `src/backup.js`
- Delete: `scripts/save-backup.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Remove package dependency**

Run: `npm uninstall better-sqlite3`

Expected: `package.json` and `package-lock.json` no longer include `better-sqlite3`.

- [ ] **Step 2: Remove backup script**

Delete `scripts.backup` from `package.json`.

- [ ] **Step 3: Delete SQLite-only files**

Remove DB/backup modules and script.

- [ ] **Step 4: Verify references**

Run: `rg -n "sqlite|better-sqlite|node:sqlite|createDatabase|DB_PATH|writeBackupFiles" src tests scripts package.json`

Expected: no output except intentional docs/spec references outside runtime.

## Task 6: Clean Tests And Final Verification

**Files:**
- Delete: `tests/repositories.test.js`
- Delete: `tests/backup.test.js`
- Modify: remaining tests as needed.

- [ ] **Step 1: Remove SQLite-only tests**

Delete repository and backup tests that test removed SQLite behavior.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run runtime reference scan**

Run: `rg -n "sqlite|better-sqlite|node:sqlite|createDatabase|DB_PATH|writeBackupFiles" src tests scripts package.json package-lock.json`

Expected: no output.

- [ ] **Step 4: Report dirty files and caveats**

Run: `git status --short`

Expected: changes are limited to Supabase-only removal plus pre-existing dirty files.
