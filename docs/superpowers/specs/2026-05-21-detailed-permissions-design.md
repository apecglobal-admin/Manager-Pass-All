# Detailed Project Account Permissions Design

## Goal

Replace the current global-only permission model with detailed access control by user, project, account type, field, and action. Admins must be able to decide exactly which user can see or operate on which account types inside each project.

## Current State

The app currently stores account type as text in `entries.type`. User permissions are global strings such as `projects.write`, `entries.write`, `entries.delete`, and `passwords.reveal`. Backend checks these permissions for write/reveal routes, but listing projects, listing project entries, and search are not scoped by user/project/type.

This means the current system can block a Viewer from revealing passwords or creating entries, but it cannot express rules such as "User A can see Web passwords for Project X, while User B can see CMS passwords for Project X only."

## Data Model

Add a normalized account type table:

```text
entry_types
- id INTEGER PRIMARY KEY AUTOINCREMENT
- name TEXT NOT NULL UNIQUE
- slug TEXT NOT NULL UNIQUE
- description TEXT NOT NULL DEFAULT ''
- sort_order INTEGER NOT NULL DEFAULT 0
- is_active INTEGER NOT NULL DEFAULT 1
- created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Migrate `entries` from free text type to a relationship:

```text
entries
- entry_type_id INTEGER NOT NULL REFERENCES entry_types(id)
```

The existing `entries.type` values will be migrated into `entry_types`, then each entry will be mapped to the matching `entry_type_id`. Existing default types are seeded from the current app list: `Web`, `Admin`, `Mobile`, `Desktop`, `API`, `Hosting`, `Domain`, `Database`, `Server`, and `Other`. Admins can add more types later, such as `CMS`, without code changes.

Add detailed permission rules:

```text
user_project_type_permissions
- id INTEGER PRIMARY KEY AUTOINCREMENT
- user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
- project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE
- entry_type_id INTEGER NOT NULL REFERENCES entry_types(id) ON DELETE CASCADE
- can_view_entry INTEGER NOT NULL DEFAULT 0
- can_view_url INTEGER NOT NULL DEFAULT 0
- can_view_username INTEGER NOT NULL DEFAULT 0
- can_reveal_password INTEGER NOT NULL DEFAULT 0
- can_view_notes INTEGER NOT NULL DEFAULT 0
- can_create INTEGER NOT NULL DEFAULT 0
- can_edit INTEGER NOT NULL DEFAULT 0
- can_delete INTEGER NOT NULL DEFAULT 0
- created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Add a unique constraint on `(user_id, project_id, entry_type_id)` so each user has at most one rule per project/type pair.

## Permission Semantics

Admin users keep full access to every project, account type, field, and action.

Non-admin users only access data through explicit `user_project_type_permissions` rows:

- No rule means no visibility and no action rights for that project/type.
- `can_view_entry` allows the entry to appear in lists/search, but sensitive fields are still controlled separately.
- `can_view_url`, `can_view_username`, and `can_view_notes` control whether those fields are returned by the API.
- `can_reveal_password` controls password reveal and copy log endpoints.
- `can_create`, `can_edit`, and `can_delete` control write actions for that project/type.

Backend authorization is authoritative. Frontend controls only improve usability; they are not trusted for security.

## API Behavior

`GET /api/entry-types` returns active account types for dropdowns and permission screens. Admin-only endpoints allow create, update, reorder, activate, and deactivate account types.

`GET /api/projects` returns:

- all projects for Admin;
- only projects where the user has at least one permission rule for non-admin users.

`GET /api/projects/:id/entries` returns only entries where the user has `can_view_entry` for that entry's `project_id` and `entry_type_id`. Fields without permission are masked or omitted:

- no URL permission: `url` becomes empty;
- no username permission: `username` becomes empty;
- no notes permission: `notes` becomes empty;
- password is never returned in list responses.

`GET /api/entries/search` applies the same visibility and field masking rules.

`POST /api/entries/:id/reveal-password` requires `can_reveal_password` on the entry's project/type.

`POST /api/entries` requires `can_create` on the submitted project/type. `PATCH /api/entries/:id` requires `can_edit` on the current entry and, if project/type changes, on the target project/type too. `DELETE /api/entries/:id` requires `can_delete`.

Export with passwords requires both the existing export permission and per-entry `can_reveal_password`. Export without passwords still filters to entries the user can view.

## Frontend Design

Replace hard-coded account types in `public/app.js` with data loaded from `/api/entry-types`. The create/edit account dialog uses these dynamic types.

Add account type management for Admins:

- list account types;
- add a type;
- rename/update description;
- deactivate a type when it should no longer be used for new entries;
- keep old entries related to deactivated types.

Enhance the user management screen with a permission matrix:

- choose user;
- choose project;
- show rows for account types;
- columns: view entry, URL, username, password, notes, create, edit, delete;
- quick actions: full project, read-only project, password-only for selected type, clear project.

The account detail panel reads permission flags returned by the backend and only renders allowed fields/actions.

## Migration Plan

1. Create `entry_types`.
2. Seed default type rows.
3. Add `entry_type_id` to `entries`.
4. Backfill `entry_type_id` from existing `entries.type`.
5. Keep `entries.type` during the first migration for compatibility if needed, but new code reads and writes `entry_type_id`.
6. Create `user_project_type_permissions`.
7. Existing Admin users need no explicit rows because Admin bypasses detailed checks.
8. Existing non-admin users start with no detailed access until Admin grants rules.

## Testing

Add backend tests for:

- migration creates account types and maps existing entries;
- non-admin without permission cannot see projects or entries;
- user with Web permission sees only Web entries in the project;
- user with username permission but no password permission can see username and cannot reveal password;
- user with CMS password permission can reveal CMS password but not Web password;
- create/edit/delete are scoped by project and type;
- search and export do not leak unauthorized entries or fields.

Add frontend policy tests for:

- type dropdown is loaded dynamically;
- permission matrix renders projects and account types from API data;
- detail view hides fields/actions that backend marks unavailable.

## Acceptance Criteria

The feature is complete when an Admin can add account types, create accounts using those types, assign project/type/field/action permissions to a user, and the backend consistently prevents that user from seeing or revealing anything outside those rules.
