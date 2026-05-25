# Google Login Email Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google login that verifies a Supabase Google email and maps it to an existing local SQLite user for permissions.

**Architecture:** Supabase Auth verifies identity only. The backend exchanges a verified Supabase access token for the existing local session cookie after matching the Google email to a local active user. SQLite remains the authorization source.

**Tech Stack:** Node.js native test runner, local HTTP server, SQLite repositories, Supabase JS browser/server client, vanilla HTML/CSS/JS frontend.

---

## File Structure

- Modify `tests/routes.test.js` to add route-level coverage with an injected fake Google token verifier.
- Modify `src/repositories.js` to expose `findActiveByUsername(username)` for passwordless local user mapping.
- Modify `src/routes.js` to add `POST /api/auth/google`, validate token, verify email, map local user, and create the existing session cookie.
- Modify `src/server.js` to inject a Supabase token verifier when Supabase config exists.
- Modify `public/index.html`, `public/app.js`, and `public/styles.css` to add and wire the Google login button.

### Task 1: Backend Mapping API

**Files:**
- Modify: `tests/routes.test.js`
- Modify: `src/repositories.js`
- Modify: `src/routes.js`
- Modify: `src/server.js`

- [ ] **Step 1: Write failing route tests**

Add tests for `POST /api/auth/google` in `tests/routes.test.js`: success with `admin` email, rejection for unknown email, and repository lookup behavior for inactive users.

- [ ] **Step 2: Run tests to verify red**

Run: `npm test tests/routes.test.js`

Expected: at least one failure because `/api/auth/google` is not implemented.

- [ ] **Step 3: Implement repository lookup**

Add `findActiveByUsername(username)` under `usersRepo(db)`. It should trim input, compare `lower(username) = lower(?)`, return mapped user only when `status === 'Active'`, and throw `User is inactive` for inactive local users.

- [ ] **Step 4: Implement Google route**

In `createRouter`, accept `options.verifyGoogleAccessToken`. Add `POST /api/auth/google` before the API auth guard. Read `{ accessToken }`, call the verifier, require a returned email, map to the local active user, create `session` cookie using the current session map, and return `{ user }`.

- [ ] **Step 5: Wire server verifier**

In `src/server.js`, create a Supabase client from public config when configured and inject a verifier that calls `supabase.auth.getUser(accessToken)`.

- [ ] **Step 6: Run backend tests**

Run: `npm test tests/routes.test.js`

Expected: route tests pass.

### Task 2: Frontend Google Login

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add UI hook**

Add a secondary Google login button with `id="googleLoginBtn"` below the password login button.

- [ ] **Step 2: Wire OAuth**

In `public/app.js`, initialize Supabase in `checkSession`, hide/disable the Google button if unconfigured, call `signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`, and after redirect call `/api/auth/google` with the Supabase access token.

- [ ] **Step 3: Keep logout consistent**

Update `logout()` to call `state.supabase.auth.signOut()` when a Supabase client exists, then clear local state.

- [ ] **Step 4: Add button styling**

Add `.google-auth` styling in `public/styles.css` as a secondary button consistent with the login panel.

- [ ] **Step 5: Run full tests**

Run: `npm test`

Expected: all Node tests pass.

## Self-Review

The plan covers the spec requirements: OAuth start, callback mapping, local permission source, backend token verification, unprovisioned email denial, inactive user denial, logout cleanup, and tests. There are no placeholder tasks; each task points to exact files and verification commands.
