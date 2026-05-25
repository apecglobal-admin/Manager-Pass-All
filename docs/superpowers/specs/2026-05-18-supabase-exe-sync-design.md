# ApecGlobal Manager Supabase And EXE Sync Design

## Goal

Extend ApecGlobal Manager from a local-only web app into a secure multi-device product with:

- Supabase-backed web access.
- Windows desktop `.exe` packaging.
- Shared encrypted vault data between web and desktop.
- Supabase Auth with 2FA.
- Client-side encryption using a master password.

The design must protect account passwords even if the Supabase database is exposed.

## Security Decision

Use end-to-end style encryption for vault secrets:

- Supabase Auth protects account access.
- Supabase 2FA protects login.
- A separate master password derives the encryption key locally.
- Secret values are encrypted before they are saved to Supabase.
- Supabase stores ciphertext only for sensitive fields.
- The master password and derived encryption key are never sent to Supabase.

This is the required security model for passwords, API keys, tokens, and secret notes.

## Product Shape

The product will have two clients:

- Web app: runs in the browser and connects to Supabase.
- Windows EXE: packages the same app as a desktop shell with local storage/cache.

Both clients use the same Supabase project and the same encrypted data format.

## Authentication

Use Supabase Auth:

- Email/password login.
- Required 2FA/TOTP for production use.
- Session handled by Supabase client.
- Each user has a Supabase `auth.users.id`.

Login flow:

1. User opens web or desktop app.
2. User signs in with Supabase email/password.
3. If required, user completes 2FA.
4. User enters vault master password.
5. App derives a local encryption key.
6. App loads and decrypts vault data locally.

The app must distinguish these states:

- Not authenticated.
- Authenticated but 2FA pending.
- Authenticated but vault locked.
- Authenticated and vault unlocked.

## Encryption Model

Use browser/desktop Web Crypto compatible primitives:

- Key derivation: PBKDF2 or Argon2id if available cleanly in the target runtime.
- Encryption: AES-256-GCM.
- Per-record random nonce/IV.
- Store encryption metadata with each encrypted field.

Recommended encrypted payload format:

```json
{
  "v": 1,
  "alg": "AES-256-GCM",
  "kdf": "PBKDF2-SHA256",
  "iv": "base64",
  "salt": "base64",
  "tag": "base64",
  "data": "base64"
}
```

Sensitive fields:

- Password.
- Secret notes.
- API keys.
- Tokens.
- Recovery codes.
- Any credential metadata marked private.

Non-sensitive fields may remain searchable:

- Project name.
- Entry name.
- Type.
- Environment.
- URL domain.
- Status.
- Tags.

If the user wants maximum privacy later, username and full URL can also be encrypted, but version 1 keeps them searchable for daily usability.

## Supabase Data Model

Recommended tables:

- `profiles`
- `vaults`
- `projects`
- `entries`
- `entry_tags`
- `activity_logs`
- `sync_events`
- `devices`

`profiles`:

- `id uuid primary key references auth.users(id)`
- `email text`
- `display_name text`
- `created_at timestamptz`

`vaults`:

- `id uuid primary key`
- `owner_id uuid references auth.users(id)`
- `name text`
- `kdf_salt text`
- `created_at timestamptz`
- `updated_at timestamptz`

`projects`:

- `id uuid primary key`
- `vault_id uuid references vaults(id)`
- `name text`
- `description text`
- `status text`
- `created_at timestamptz`
- `updated_at timestamptz`
- `deleted_at timestamptz`

`entries`:

- `id uuid primary key`
- `vault_id uuid references vaults(id)`
- `project_id uuid references projects(id)`
- `name text`
- `type text`
- `environment text`
- `url text`
- `username text`
- `password_cipher jsonb`
- `secret_notes_cipher jsonb`
- `tags text[]`
- `status text`
- `created_at timestamptz`
- `updated_at timestamptz`
- `deleted_at timestamptz`

`devices`:

- `id uuid primary key`
- `user_id uuid references auth.users(id)`
- `name text`
- `kind text`
- `last_seen_at timestamptz`

`activity_logs`:

- `id uuid primary key`
- `vault_id uuid`
- `user_id uuid`
- `entry_id uuid`
- `action text`
- `metadata jsonb`
- `created_at timestamptz`

## Row Level Security

Enable RLS on every app table.

Basic policy:

- User can read/write rows only when they own the vault.
- Future team sharing can add membership tables and role policies.

No service role key may be shipped to the browser or desktop app.

Allowed client-side credentials:

- Supabase URL.
- Supabase anon publishable key.

Forbidden in clients:

- Supabase service role key.
- Raw database password.
- Master password.
- Derived vault encryption key.

## Sync Design

Version 1 uses Supabase as the source of truth.

Sync behavior:

- Web reads/writes directly to Supabase after login.
- EXE reads/writes to Supabase after login.
- Optional local cache stores encrypted rows only.
- Conflict handling uses `updated_at`.
- Soft delete uses `deleted_at`.

Conflict rule for version 1:

- Last write wins.
- If two clients edit the same entry, the latest `updated_at` wins.
- Activity log records update events.

Later versions can add field-level conflict resolution.

## Desktop EXE Design

Use Electron or Tauri.

Recommendation:

- Use Electron if fastest packaging and Node integration are preferred.
- Use Tauri if smaller installer size is preferred.

For this codebase, Electron is the fastest path because the current app is already a Node-served web UI.

Desktop behavior:

- Start local app shell.
- Load the same frontend.
- Connect to Supabase using the anon key.
- Store only safe local settings and encrypted cache.
- Never store plaintext passwords.

Packaging:

- Build Windows `.exe`.
- Include app assets.
- Provide installer or portable executable.

## Migration From Local SQLite

The existing local SQLite data should remain usable.

Migration flow:

1. User logs into Supabase.
2. User unlocks local vault.
3. App reads SQLite entries.
4. App encrypts secret fields with the new master password format.
5. App uploads projects and entries to Supabase.
6. App writes a JSON backup before migration.

The migration must not upload plaintext passwords.

## Required Configuration

The implementation needs:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- Supabase Auth enabled.
- Email/password provider enabled.
- 2FA/TOTP enabled in Supabase Auth settings.
- SQL migrations applied to the Supabase project.

Optional:

- App name for desktop packaging.
- Desktop icon `.ico`.
- Code signing certificate for trusted Windows installer.

## Testing Strategy

Core tests:

- Encryption/decryption round trip.
- Wrong master password fails decryption.
- Supabase row mapping does not include plaintext password.
- Local SQLite migration exports encrypted payloads.
- RLS SQL policies are present in migration files.

Manual tests:

- Create account in web.
- Enable 2FA.
- Login with 2FA.
- Unlock vault with master password.
- Create project and credential.
- Confirm Supabase row stores ciphertext.
- Open desktop app and verify same entry syncs.
- Reveal password only after vault unlock.

## Open Implementation Constraints

Implementation cannot connect to the real Supabase project until these values are provided:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Implementation can still prepare:

- SQL migration files.
- Supabase client wrapper.
- Encryption modules.
- Sync repository interface.
- Electron packaging skeleton.
- Environment template.
