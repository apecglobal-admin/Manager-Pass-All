# Multi Link Account Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store and display multiple account link rows, each with its own type, URL, username, and password.

**Architecture:** Reuse `entry_credentials` as the per-link credential table by adding `link_type` and `url`. Map those fields through Supabase repositories and route permission decorators, then update the browser form/detail UI to collect and render row-level links.

**Tech Stack:** Node.js test runner, Supabase JS repository layer, vanilla browser JS, SQL migrations.

---

### Task 1: Persist Row-Level Link Fields

**Files:**
- Modify: `sql/011_entry_credentials.sql`
- Modify: `src/supabase-repositories.js`
- Test: `tests/supabase-schema.test.js`
- Test: `tests/supabase-repositories.test.js`

- [ ] Write failing tests that require `link_type` and `url` columns and verify repository create/read preserves `linkType` and `url`.
- [ ] Run `npm test -- tests/supabase-schema.test.js tests/supabase-repositories.test.js` and confirm the new tests fail because fields are missing.
- [ ] Add SQL columns and repository mapping/sync support.
- [ ] Re-run the same tests and confirm they pass.

### Task 2: Expose Row-Level Link Fields Through API Permissions

**Files:**
- Modify: `src/routes.js`
- Test: `tests/routes.test.js`

- [ ] Write a failing route test showing an Admin receives all credential row URLs and can reveal another user's credential password.
- [ ] Run `npm test -- tests/routes.test.js` and confirm the new test fails because credential URL/type are not returned.
- [ ] Add `linkType` and permission-filtered `url` to credential payloads, keeping admin bypass intact.
- [ ] Re-run `npm test -- tests/routes.test.js` and confirm it passes.

### Task 3: Update Account Form and Detail UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `tests/browser-storage-policy.test.js`

- [ ] Write failing UI policy tests requiring row-level link type/URL inputs, filtering of empty rows, row-level open link actions, and no standalone single URL detail section.
- [ ] Run `npm test -- tests/browser-storage-policy.test.js` and confirm the new tests fail.
- [ ] Update the browser form/detail rendering and styles.
- [ ] Re-run `npm test -- tests/browser-storage-policy.test.js` and confirm it passes.

### Task 4: Full Verification

**Files:**
- Run all tests.

- [ ] Run `npm test`.
- [ ] Fix any regressions with a failing test first.
- [ ] Report changed files and verification output.
