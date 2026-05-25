import { createRequire } from 'node:module';
import { DEFAULT_ADMIN_USERNAME, getConfiguredAdminPassword } from './config.js';
import { hashPassword } from './crypto.js';

const require = createRequire(import.meta.url);
const DEFAULT_ENTRY_TYPES = ['Web', 'Admin', 'Mobile', 'Desktop', 'API', 'Hosting', 'Domain', 'Database', 'Server', 'Other'];

export function createDatabase(path) {
  const db = openDatabase(path);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedAdmin(db, path);
  return db;
}

function openDatabase(path) {
  if (process.versions.electron) {
    const Database = require('better-sqlite3');
    return new Database(path);
  }

  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(path);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'Admin',
      status TEXT NOT NULL DEFAULT 'Active',
      permissions TEXT NOT NULL DEFAULT '[]',
      invitation_sent_at TEXT,
      invite_expires_at TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entry_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      entry_type_id INTEGER,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'Production',
      url TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      password_encrypted TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (entry_type_id) REFERENCES entry_types(id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (entry_id, tag_id),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      project_id INTEGER,
      entry_id INTEGER,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_project_type_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      entry_type_id INTEGER NOT NULL,
      can_view_entry INTEGER NOT NULL DEFAULT 0,
      can_view_url INTEGER NOT NULL DEFAULT 0,
      can_view_username INTEGER NOT NULL DEFAULT 0,
      can_reveal_password INTEGER NOT NULL DEFAULT 0,
      can_view_notes INTEGER NOT NULL DEFAULT 0,
      can_create INTEGER NOT NULL DEFAULT 0,
      can_edit INTEGER NOT NULL DEFAULT 0,
      can_delete INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, project_id, entry_type_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (entry_type_id) REFERENCES entry_types(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_project_memberships (
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  migrateUsers(db);
  migrateEntryTypes(db);
  migrateEntries(db);
  migrateProjectPermissionProjectIds(db);
  db.prepare(`
    INSERT OR IGNORE INTO user_project_memberships (user_id, project_id)
    SELECT DISTINCT user_id, project_id FROM user_project_type_permissions
  `).run();
}

function migrateUsers(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all().map(row => row.name);
  if (!columns.includes('display_name')) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  if (!columns.includes('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'");
  if (!columns.includes('permissions')) db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'");
  if (!columns.includes('invitation_sent_at')) db.exec('ALTER TABLE users ADD COLUMN invitation_sent_at TEXT');
  if (!columns.includes('invite_expires_at')) db.exec('ALTER TABLE users ADD COLUMN invite_expires_at TEXT');
  if (!columns.includes('accepted_at')) db.exec('ALTER TABLE users ADD COLUMN accepted_at TEXT');
  db.prepare("UPDATE users SET role = 'Admin' WHERE role = 'owner'").run();
  db.prepare("UPDATE users SET status = 'Active' WHERE status IS NULL OR status = ''").run();
}

function migrateEntryTypes(db) {
  const columns = db.prepare('PRAGMA table_info(entry_types)').all().map(row => row.name);
  if (!columns.includes('description')) db.exec("ALTER TABLE entry_types ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if (!columns.includes('sort_order')) db.exec('ALTER TABLE entry_types ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('is_active')) db.exec('ALTER TABLE entry_types ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  if (!columns.includes('updated_at')) db.exec('ALTER TABLE entry_types ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');

  DEFAULT_ENTRY_TYPES.forEach((name, index) => {
    db.prepare(`
      INSERT INTO entry_types (name, slug, description, sort_order, is_active, updated_at)
      VALUES (?, ?, '', ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO NOTHING
    `).run(name, slugify(name), index + 1);
  });
}

function migrateEntries(db) {
  const columns = db.prepare('PRAGMA table_info(entries)').all().map(row => row.name);
  if (!columns.includes('entry_type_id')) db.exec('ALTER TABLE entries ADD COLUMN entry_type_id INTEGER');

  const existingTypes = db.prepare("SELECT DISTINCT type FROM entries WHERE type IS NOT NULL AND trim(type) != ''").all();
  existingTypes.forEach((row, index) => {
    const name = String(row.type || 'Other').trim() || 'Other';
    db.prepare(`
      INSERT INTO entry_types (name, slug, description, sort_order, is_active, updated_at)
      VALUES (?, ?, '', ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO NOTHING
    `).run(name, slugify(name), 100 + index);
  });

  db.prepare(`
    UPDATE entries
    SET entry_type_id = (
      SELECT entry_types.id FROM entry_types
      WHERE lower(entry_types.name) = lower(entries.type)
      LIMIT 1
    )
    WHERE entry_type_id IS NULL
  `).run();

  const other = db.prepare('SELECT id FROM entry_types WHERE name = ?').get('Other');
  if (other) db.prepare('UPDATE entries SET entry_type_id = ? WHERE entry_type_id IS NULL').run(other.id);
}

function migrateProjectPermissionProjectIds(db) {
  const permissionColumns = db.prepare('PRAGMA table_info(user_project_type_permissions)').all();
  const membershipColumns = db.prepare('PRAGMA table_info(user_project_memberships)').all();
  const permissionProject = permissionColumns.find(column => column.name === 'project_id');
  const membershipProject = membershipColumns.find(column => column.name === 'project_id');
  const permissionProjectFk = db.prepare('PRAGMA foreign_key_list(user_project_type_permissions)').all()
    .some(row => row.table === 'projects' && row.from === 'project_id');
  const membershipProjectFk = db.prepare('PRAGMA foreign_key_list(user_project_memberships)').all()
    .some(row => row.table === 'projects' && row.from === 'project_id');
  const needsMigration = permissionProject?.type?.toUpperCase() !== 'TEXT'
    || membershipProject?.type?.toUpperCase() !== 'TEXT'
    || permissionProjectFk
    || membershipProjectFk;
  if (!needsMigration) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;

    ALTER TABLE user_project_type_permissions RENAME TO user_project_type_permissions_old;
    ALTER TABLE user_project_memberships RENAME TO user_project_memberships_old;

    CREATE TABLE user_project_type_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      entry_type_id INTEGER NOT NULL,
      can_view_entry INTEGER NOT NULL DEFAULT 0,
      can_view_url INTEGER NOT NULL DEFAULT 0,
      can_view_username INTEGER NOT NULL DEFAULT 0,
      can_reveal_password INTEGER NOT NULL DEFAULT 0,
      can_view_notes INTEGER NOT NULL DEFAULT 0,
      can_create INTEGER NOT NULL DEFAULT 0,
      can_edit INTEGER NOT NULL DEFAULT 0,
      can_delete INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, project_id, entry_type_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (entry_type_id) REFERENCES entry_types(id) ON DELETE CASCADE
    );

    CREATE TABLE user_project_memberships (
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    INSERT INTO user_project_type_permissions (
      id, user_id, project_id, entry_type_id, can_view_entry, can_view_url, can_view_username,
      can_reveal_password, can_view_notes, can_create, can_edit, can_delete, created_at, updated_at
    )
    SELECT
      id, user_id, CAST(project_id AS TEXT), entry_type_id, can_view_entry, can_view_url, can_view_username,
      can_reveal_password, can_view_notes, can_create, can_edit, can_delete, created_at, updated_at
    FROM user_project_type_permissions_old;

    INSERT OR IGNORE INTO user_project_memberships (user_id, project_id, created_at)
    SELECT user_id, CAST(project_id AS TEXT), created_at
    FROM user_project_memberships_old;

    DROP TABLE user_project_type_permissions_old;
    DROP TABLE user_project_memberships_old;

    PRAGMA foreign_keys = ON;
  `);
}

function seedAdmin(db, path) {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(DEFAULT_ADMIN_USERNAME);
  if (row) {
    db.prepare("UPDATE users SET role = 'Admin', status = 'Active' WHERE id = ?").run(row.id);
    return;
  }
  const adminPassword = getInitialAdminPassword(path);
  db.prepare('INSERT INTO users (username, password_hash, display_name, role, status, permissions) VALUES (?, ?, ?, ?, ?, ?)').run(
    DEFAULT_ADMIN_USERNAME,
    hashPassword(adminPassword),
    'Quản trị hệ thống',
    'Admin',
    'Active',
    '[]'
  );
}

function getInitialAdminPassword(path) {
  const configuredPassword = getConfiguredAdminPassword();
  if (configuredPassword) return configuredPassword;

  throw new Error('ADMIN_PASSWORD is required to create the initial admin user. Set ADMIN_PASSWORD before first launch.');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'type';
}
