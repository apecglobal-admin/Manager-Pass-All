# Supabase-Only Removal Design

## Goal

Remove SQLite from the application runtime and make Supabase the only persistence layer for authentication-backed app data, authorization metadata, vault data, settings, activity, and exports.

## Scope

- Remove local SQLite database creation, migration, backup, and repository usage.
- Remove `better-sqlite3` and direct `node:sqlite` runtime dependencies.
- Replace local users, roles, permissions, entry types, settings, projects, entries, and activity storage with Supabase tables.
- Keep the existing REST API and frontend behavior as stable as practical.
- Convert "save JSON backup" into a Supabase JSON export instead of writing SQLite dump files.
- Provide SQL files under `sql/` so the schema can be applied manually in Supabase SQL Editor.

## Supabase Schema

The existing vault schema already covers `profiles`, `vaults`, `projects`, `entries`, `devices`, and `activity_logs`. Supabase-only mode adds the missing app-management tables:

- `app_users`: app-facing user profile, role, status, permissions, invite/approval timestamps, linked to Supabase Auth by email and optional `auth_user_id`.
- `entry_types`: editable entry type catalog.
- `project_memberships`: user-to-project membership.
- `detailed_permissions`: per-user, per-project, per-entry-type field/action permissions.
- `app_settings`: key/value app settings.

SQL will be split into ordered files:

- `sql/001_supabase_only_core.sql`
- `sql/002_supabase_only_permissions.sql`
- `sql/003_supabase_only_rls.sql`

## Backend Architecture

`src/server.js` will stop opening SQLite. It will create Supabase services from environment config and pass those services into the router.

`src/repositories.js` will no longer wrap SQLite. A Supabase-backed repository module will provide the same broad API shape needed by routes:

- `users`
- `projects`
- `entryTypes`
- `entries`
- `detailedPermissions`
- `projectMemberships`
- `activity`
- `settings`
- `export`

Google/Supabase Auth becomes the supported login path. The local username/password login endpoint will return a clear unsupported response unless a Supabase password-auth flow is implemented through Supabase Auth.

## API Behavior

The existing API surface should remain usable:

- `/api/session`
- `/api/auth/google`
- `/api/auth/logout`
- `/api/users`
- `/api/entry-types`
- `/api/projects`
- `/api/projects/:id/members`
- `/api/projects/:id/entries`
- `/api/entries`
- `/api/entries/search`
- `/api/entries/:id/reveal-password`
- `/api/export/json`
- `/api/export/csv`
- `/api/backups/save-json`
- `/api/activity`
- `/api/settings`

`/api/backups/save-json` will return the same data shape as JSON export plus backup metadata, sourced from Supabase. It will not write a local `.sqlite`-derived backup.

## Data Flow

1. Browser signs in through Supabase and sends an access token to the backend.
2. Backend verifies the token with Supabase Auth.
3. Backend resolves the matching `app_users` row by email or `auth_user_id`.
4. Backend stores a local in-memory HTTP session containing the app user and Supabase token.
5. Routes use Supabase repositories for all reads and writes.
6. Passwords and notes remain encrypted before being stored in Supabase.

## Error Handling

- Missing Supabase config returns startup/API errors instead of silently falling back to SQLite.
- Missing SQL schema returns clear table/configuration errors.
- Users not provisioned or not active are denied login.
- Permission failures remain 403 responses.
- Not found rows remain 404 where routes already distinguish them.

## Testing

- Remove SQLite repository and backup tests.
- Add tests for Supabase-only server wiring and route behavior using fake Supabase repositories/clients.
- Keep mapper, crypto, browser policy, and route tests that do not depend on SQLite.
- Update package tests so no test imports `node:sqlite` or `better-sqlite3`.

## Non-Goals

- No automatic migration from existing SQLite data to Supabase in this change.
- No direct execution against the real Supabase project unless credentials and network approval are explicitly provided.
- No new frontend redesign.
