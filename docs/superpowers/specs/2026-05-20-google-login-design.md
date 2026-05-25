# Google Login Email Mapping Design

## Goal

Add Google login as an identity verification option while keeping local SQLite users, roles, permissions, and app sessions as the source of authorization.

## User Flow

The login screen keeps the current username/password form and adds a "Dang nhap bang Google" button. When clicked, the browser starts Supabase Google OAuth. After Google redirects back to the app, the frontend reads the Supabase session and sends the Supabase access token to the local backend.

The backend verifies the token with Supabase Auth, extracts the verified email, and looks up a local user whose `username` matches that email case-insensitively. If the local user exists and is active, the backend creates the same `session` cookie used by password login and returns the local user object. If the email is not provisioned or the user is inactive, login is denied.

## Architecture

Supabase Auth is used only to prove the Google email identity. SQLite remains the app authority for user records, roles, permissions, and local sessions. The frontend never assigns permissions from the Supabase user object.

## Backend Design

`src/routes.js` gets a new `POST /api/auth/google` route. It accepts `{ accessToken }`, calls an injected Supabase auth verifier, maps the verified email to `repos.users.findActiveByUsername(email)`, and creates the existing cookie session on success.

`src/repositories.js` gets a local-user lookup that does not require a password and still enforces `status === 'Active'`.

`src/server.js` creates a Supabase server client only when public Supabase config is present, then injects a verifier into `createRouter`. Tests can inject a fake verifier without calling the network.

## Frontend Design

`public/index.html` adds a secondary Google login button. `public/app.js` initializes Supabase when configured, starts OAuth with `provider: 'google'`, handles redirect callback sessions on load, calls `/api/auth/google`, and signs out of Supabase on local logout.

If Supabase is not configured, the Google button is hidden or disabled and the current password login continues to work unchanged.

## Error Handling

Missing Supabase config hides Google login. Missing access token, failed token verification, unverified/no email, inactive local user, and unprovisioned email return clear errors without creating a local session.

## Testing

Route tests cover successful Google token mapping, unprovisioned Google email rejection, inactive user rejection through the repository lookup, and no regression to existing password login tests. Frontend behavior is kept simple and verified by app tests where available plus server route coverage.
