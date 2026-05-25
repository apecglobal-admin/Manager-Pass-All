# Detailed Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic account types and detailed user permissions by project, account type, field, and action.

**Architecture:** SQLite remains the local authorization source. `entry_types` normalizes account types, `entries.entry_type_id` relates credentials to a type, and `user_project_type_permissions` stores per-user access rules. Routes call repository helpers that filter and mask data server-side before the frontend renders it.

**Tech Stack:** Node.js ESM, `node:test`, SQLite via `node:sqlite`/`better-sqlite3`, vanilla HTML/CSS/JS.

---

## File Structure

- Modify `src/db.js`: migrate `entry_types`, `entries.entry_type_id`, and `user_project_type_permissions`.
- Modify `src/repositories.js`: add `entryTypes` repo, detailed permission helpers, filtered project/entry operations, and masked entry output.
- Modify `src/routes.js`: expose entry type and detailed permission APIs; enforce detailed permissions on project, entry, search, reveal, export, and write routes.
- Modify `public/app.js`: load dynamic account types, render filters/dropdowns from API data, and edit detailed permissions in the user dialog.
- Modify `public/index.html`: add placeholders for detailed permission matrix and account type management in the user modal.
- Modify `tests/repositories.test.js`: cover migration and repository-level permission behavior.
- Modify `tests/routes.test.js`: cover API enforcement for project/type/field/action permissions.
- Modify `tests/browser-storage-policy.test.js`: cover dynamic type and permission matrix frontend code policy.

## Task 1: Database And Repository Model

**Files:**
- Modify: `src/db.js`
- Modify: `src/repositories.js`
- Test: `tests/repositories.test.js`

- [ ] **Step 1: Write failing repository tests**

Add tests that assert default entry types exist, entries expose `typeId`, and non-admin users only see entries allowed by `user_project_type_permissions`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/repositories.test.js`

Expected: fail because `repos.entryTypes`, `entry_type_id`, and detailed permission helpers do not exist yet.

- [ ] **Step 3: Implement migration and repository helpers**

Create `entry_types`, backfill `entries.entry_type_id`, create permission table, expose `entryTypes` and `detailedPermissions` repos, and add helpers that return only authorized projects/entries.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/repositories.test.js`

Expected: repository tests pass.

## Task 2: Route Enforcement

**Files:**
- Modify: `src/routes.js`
- Test: `tests/routes.test.js`

- [ ] **Step 1: Write failing route tests**

Add tests for:
- user without detailed rules sees no projects;
- user with Web permission sees only Web entries in that project;
- username can be visible while password reveal is blocked;
- CMS password permission does not reveal Web password;
- create/delete require matching project/type action rights.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/routes.test.js`

Expected: fail because existing routes list all projects/entries and only check global permissions.

- [ ] **Step 3: Enforce detailed permission in routes**

Use repository scoped methods for project lists, entry lists, search, reveal, create, update, delete, and export. Keep Admin full access.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/routes.test.js`

Expected: route tests pass.

## Task 3: Dynamic Account Types API

**Files:**
- Modify: `src/routes.js`
- Modify: `src/repositories.js`
- Test: `tests/routes.test.js`

- [ ] **Step 1: Write failing type API tests**

Add tests for `GET /api/entry-types`, Admin create/update/deactivate entry type, and non-admin rejection for mutation.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/routes.test.js`

Expected: fail because `/api/entry-types` routes do not exist.

- [ ] **Step 3: Implement type routes**

Add list/create/update endpoints and return dynamic type objects with `id`, `name`, `slug`, `description`, `sortOrder`, and `isActive`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/routes.test.js`

Expected: route tests pass.

## Task 4: Frontend Dynamic Types And Permission Matrix

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Test: `tests/browser-storage-policy.test.js`

- [ ] **Step 1: Write failing frontend policy tests**

Assert the frontend fetches `/api/entry-types`, no longer depends on a hard-coded `TYPES` array for the source of truth, and includes detailed permission field names in the user permission payload.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- tests/browser-storage-policy.test.js`

Expected: fail because frontend still hard-codes types and only sends global permissions.

- [ ] **Step 3: Implement frontend changes**

Load entry types during app startup, render filters/dropdowns from `state.entryTypes`, and add a project/type permission matrix to the user modal that submits detailed permission rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- tests/browser-storage-policy.test.js`

Expected: frontend policy tests pass.

## Task 5: Full Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run full test suite**

Run: `npm.cmd test`

Expected: all tests pass.

- [ ] **Step 2: Run local server smoke test**

Run: `node src/server.js`

Expected: server starts on port 3000 and serves the app. Stop the server after confirming.

## Self-Review

The plan covers the approved spec: dynamic account types, `entries.entry_type_id`, per-user/project/type permission rows, field-level masking, action enforcement, type management API, frontend dynamic dropdowns, and tests. There are no placeholder implementation tasks; each task identifies exact files and verification commands. The repo has no `.git`, so commit steps are intentionally omitted.
