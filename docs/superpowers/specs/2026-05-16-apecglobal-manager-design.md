# ApecGlobal Manager Design

## Goal

Build a local web app for managing project links, accounts, and passwords across ApecGlobal products. The app must be compact, easy to search, easy to remember, and fast for daily use. The first version runs locally on one machine, but its data model and API boundaries must allow a later upgrade to an internal multi-user server.

## Product Scope

The first version includes:

- Project/product-based organization.
- Link and credential management for websites, mobile apps, desktop apps, admin panels, APIs, hosting, domains, databases, and other systems.
- Local login.
- Encrypted credential storage.
- Password reveal/copy after login.
- Auto-lock after inactivity.
- Basic activity logging.
- JSON backup/restore.
- CSV import/export for Excel workflows.

The first version does not include:

- Cloud sync.
- Public internet hosting.
- Full enterprise SSO.
- Fine-grained team permission management.
- Mobile app clients.

## Recommended Approach

Use a local web application with:

- Node.js backend.
- SQLite database.
- Browser-based dashboard UI served from the local backend.
- REST API between frontend and backend.

This approach is the best fit because it is simple enough to run locally, stronger than a frontend-only app for data safety, and easier to evolve into an internal server than an Electron-only desktop app.

## User Model

Version 1 supports one local admin account. The schema should reserve space for future users and roles so the app can later support a small team.

Initial login behavior:

- User opens the local web app.
- User logs in with local username and password.
- After successful login, the app can decrypt and display saved credentials.
- Password fields remain hidden by default in the UI.
- The app auto-locks after the configured inactivity timeout.

Future-ready behavior:

- Add multiple users.
- Add roles such as owner, editor, and viewer.
- Add project-level permissions.

## Information Architecture

Projects/products are the primary grouping level. Each project contains multiple entries. Each entry represents a system, link, account, or technical access point.

Entry types:

- Web
- Admin
- Mobile
- Desktop
- API
- Hosting
- Domain
- Database
- Server
- Other

Optional metadata:

- Environment: Production, Staging, Development, Testing, Other.
- Tags.
- Notes.
- Owner/contact.
- Last verified date.
- Status: Active, Inactive, Deprecated.

## UI Design

The selected layout is an operations dashboard.

Main screen:

- Left sidebar: project/product list, project search, project status.
- Top bar: global search, add button, import/export, lock button.
- Main content: credential/link table for the selected project.
- Filter chips: Web, Admin, Mobile, Desktop, API, Hosting, Domain, Database, Server, Other.
- Row actions: open link, copy username, copy password, reveal password, edit, delete.

Detail/edit view:

- Use a modal or right-side panel.
- Show entry name, URL, type, environment, username, password, notes, tags, and status.
- Keep password hidden unless the user explicitly reveals it.

Daily workflow:

1. Open the local app.
2. Log in.
3. Search globally or choose a project in the sidebar.
4. Filter by system type when needed.
5. Open URL or copy username/password.
6. App auto-locks after inactivity.

## Data Model

Recommended tables:

- `users`: local accounts.
- `projects`: project/product records.
- `entries`: links and systems under each project.
- `credentials`: encrypted usernames/passwords and credential notes.
- `tags`: reusable tags.
- `entry_tags`: many-to-many mapping between entries and tags.
- `activity_logs`: important user actions.
- `settings`: app-level settings.

Important relationships:

- A project has many entries.
- An entry may have one primary credential.
- An entry may have many tags.
- Activity logs may reference projects and entries.

## Security Design

Authentication:

- Store the local login password as a secure hash using Argon2id or bcrypt.
- Use server-side sessions or signed HTTP-only cookies for authenticated local use.

Credential encryption:

- Encrypt saved passwords before writing them to SQLite.
- Use authenticated encryption such as AES-256-GCM.
- Store encryption metadata such as IV/nonce and auth tag per encrypted value.
- Keep the encryption key outside plain database rows. For version 1, derive or protect the key from app configuration and login secret. A later version can move this to OS keychain integration.

UI safety:

- Passwords are hidden by default.
- Copy actions should provide short visual confirmation without leaving password text visible.
- Auto-lock clears sensitive UI state.
- Export with passwords requires explicit confirmation.

Audit logging:

- Log create, update, delete, import, export, reveal password, and copy password events.
- Do not log plaintext passwords.

## Import And Export

JSON:

- Full backup format.
- Supports restore to another local installation.
- Can include encrypted credential data.

CSV:

- Excel-friendly format.
- Supports project, entry name, type, environment, URL, username, password, notes, tags, and status.
- Export should allow excluding password values.
- Import should preview rows before saving.
- Import should detect likely duplicates by project, entry name, URL, and username.

## API Design

Core endpoints:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/session`
- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/entries`
- `POST /api/entries`
- `PATCH /api/entries/:id`
- `DELETE /api/entries/:id`
- `POST /api/entries/:id/reveal-password`
- `POST /api/entries/:id/copy-password-log`
- `POST /api/import/preview`
- `POST /api/import/commit`
- `GET /api/export/json`
- `GET /api/export/csv`
- `GET /api/activity`
- `GET /api/settings`
- `PATCH /api/settings`

The reveal endpoint returns plaintext only after authentication and records an activity event. Normal list endpoints should return masked credential state, not plaintext passwords.

## Error Handling

Handle these cases explicitly:

- Invalid login.
- Locked session.
- Duplicate project or entry.
- Invalid URL.
- Import file parse failure.
- Import rows with missing required values.
- Decryption failure.
- Database read/write failure.

User-facing errors should be short and actionable. Technical details should be logged locally without exposing secrets.

## Testing Strategy

Backend tests:

- Auth login/logout.
- Password hashing.
- Encryption and decryption round trip.
- CRUD for projects and entries.
- Import preview and commit.
- Export JSON/CSV.
- Activity logging.

Frontend tests:

- Login screen.
- Dashboard project selection.
- Search and filtering.
- Add/edit entry.
- Reveal/copy password behavior.
- Auto-lock behavior.
- Import/export flows.

Manual verification:

- Create a project.
- Add several entries of different types.
- Search and filter.
- Reveal/copy password.
- Export and restore from backup.
- Confirm plaintext passwords are not stored directly in SQLite.

## Implementation Notes

Prefer a compact, maintainable stack:

- TypeScript if the chosen tooling supports it cleanly.
- Express or Fastify for the backend.
- SQLite with a structured migration path.
- React or a lightweight frontend framework for the dashboard.
- A small component set optimized for data density.

The UI should avoid a marketing-style landing page. The first authenticated screen should be the working dashboard.
