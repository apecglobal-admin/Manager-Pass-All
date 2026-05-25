import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/db.js';
import { createRepositories, hasPermission } from '../src/repositories.js';

test('creates a project with encrypted entry credentials', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 3));

  const project = repos.projects.create({ name: 'Apec CRM', description: 'Main CRM', status: 'Active' });
  const entry = repos.entries.create({
    projectId: project.id,
    name: 'CRM Admin',
    type: 'Admin',
    environment: 'Production',
    url: 'https://crm.local',
    username: 'cto',
    password: 'very-secret',
    notes: 'Primary admin',
    tags: ['crm', 'admin'],
    status: 'Active'
  });

  const rows = repos.entries.listByProject(project.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'CRM Admin');
  assert.equal(rows[0].passwordMasked, true);
  assert.equal(rows[0].password, undefined);
  assert.equal(repos.entries.revealPassword(entry.id), 'very-secret');
});

test('entry types are normalized and entries relate to a type row', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 31));

  const defaultTypes = repos.entryTypes.list();
  const adminType = defaultTypes.find(type => type.name === 'Admin');
  assert.ok(adminType);

  const cmsType = repos.entryTypes.create({ name: 'CMS', description: 'Content management systems' });
  const project = repos.projects.create({ name: 'Apec CMS', description: '', status: 'Active' });
  const entry = repos.entries.create({
    projectId: project.id,
    typeId: cmsType.id,
    name: 'CMS Login',
    username: 'editor',
    password: 'cms-secret'
  });

  const rows = repos.entries.listByProject(project.id);
  assert.equal(rows[0].id, entry.id);
  assert.equal(rows[0].typeId, cmsType.id);
  assert.equal(rows[0].type, 'CMS');
  assert.equal(repos.entryTypes.list().some(type => type.name === 'CMS'), true);
});

test('migrates project permission tables to support delegated project ids', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'apec-permission-migration-')), 'app.db');
  const oldDb = new DatabaseSync(dbPath);
  oldDb.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'Admin',
      status TEXT NOT NULL DEFAULT 'Active',
      permissions TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active'
    );
    CREATE TABLE entry_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_project_type_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
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
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (entry_type_id) REFERENCES entry_types(id) ON DELETE CASCADE
    );
    CREATE TABLE user_project_memberships (
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    INSERT INTO users (id, username, password_hash, display_name, role, status, permissions)
      VALUES (2, 'old-user', 'hash', 'Old User', 'Viewer', 'Active', '[]');
    INSERT INTO projects (id, name, description, status) VALUES (1, 'Old Project', '', 'Active');
    INSERT INTO entry_types (id, name, slug) VALUES (1, 'Web', 'web');
    INSERT INTO user_project_type_permissions (user_id, project_id, entry_type_id, can_view_entry)
      VALUES (2, 1, 1, 1);
    INSERT INTO user_project_memberships (user_id, project_id) VALUES (2, 1);
  `);
  oldDb.close();

  const db = createDatabase(dbPath);
  const repos = createRepositories(db, Buffer.alloc(32, 32));
  const permissionProject = db.prepare('PRAGMA table_info(user_project_type_permissions)').all()
    .find(column => column.name === 'project_id');
  const membershipProject = db.prepare('PRAGMA table_info(user_project_memberships)').all()
    .find(column => column.name === 'project_id');
  const permissionProjectFk = db.prepare('PRAGMA foreign_key_list(user_project_type_permissions)').all()
    .some(row => row.table === 'projects' && row.from === 'project_id');
  const membershipProjectFk = db.prepare('PRAGMA foreign_key_list(user_project_memberships)').all()
    .some(row => row.table === 'projects' && row.from === 'project_id');

  assert.equal(permissionProject.type, 'TEXT');
  assert.equal(membershipProject.type, 'TEXT');
  assert.equal(permissionProjectFk, false);
  assert.equal(membershipProjectFk, false);
  assert.equal(repos.projectMemberships.has(2, 1), true);
  assert.equal(repos.detailedPermissions.get(2, 1, 1).canViewEntry, true);
  repos.detailedPermissions.upsert(2, '11111111-1111-4111-8111-111111111111', 1, { canViewEntry: true });
  assert.equal(repos.projectMemberships.has(2, '11111111-1111-4111-8111-111111111111'), true);
  db.close();
});

test('detailed permissions filter entries and mask unauthorized fields', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 32));
  const webType = repos.entryTypes.findByName('Web');
  const adminType = repos.entryTypes.findByName('Admin');
  const project = repos.projects.create({ name: 'Scoped Project', description: '', status: 'Active' });
  const otherProject = repos.projects.create({ name: 'Hidden Project', description: '', status: 'Active' });
  const user = repos.users.create({
    username: 'scoped@example.com',
    password: 'scoped-pass',
    displayName: 'Scoped User',
    role: 'Viewer',
    status: 'Active',
    permissions: []
  });

  repos.entries.create({
    projectId: project.id,
    typeId: webType.id,
    name: 'Web Login',
    url: 'https://web.local',
    username: 'web-user',
    password: 'web-secret',
    notes: 'web notes',
    tags: ['private-tag']
  });
  repos.entries.create({
    projectId: project.id,
    typeId: adminType.id,
    name: 'Admin Login',
    username: 'admin-user',
    password: 'admin-secret'
  });
  repos.entries.create({
    projectId: otherProject.id,
    typeId: webType.id,
    name: 'Other Web',
    username: 'other-user',
    password: 'other-secret'
  });

  repos.detailedPermissions.upsert(user.id, project.id, webType.id, {
    canViewEntry: true,
    canViewUsername: true,
    canRevealPassword: false,
    canViewUrl: false,
    canViewNotes: false
  });

  const visibleProjects = repos.projects.listForUser(user);
  assert.deepEqual(visibleProjects.map(item => item.name), ['Scoped Project']);

  const rows = repos.entries.listByProjectForUser(project.id, user);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Web Login');
  assert.equal(rows[0].username, 'web-user');
  assert.equal(rows[0].url, '');
  assert.equal(rows[0].notes, '');
  assert.deepEqual(rows[0].tags, []);
  assert.equal(rows[0].permissions.canRevealPassword, false);
  assert.equal(rows[0].permissions.canViewUsername, true);
  assert.throws(() => repos.entries.revealPasswordForUser(rows[0].id, user), /Permission denied/);

  repos.detailedPermissions.upsert(user.id, project.id, webType.id, {
    canViewEntry: true,
    canViewUsername: false,
    canViewUrl: false,
    canViewNotes: false,
    canEdit: true
  });
  const editableRows = repos.entries.listByProjectForUser(project.id, user);
  assert.equal(editableRows[0].username, '');
  assert.equal(editableRows[0].url, '');
  assert.equal(editableRows[0].notes, '');
  assert.deepEqual(editableRows[0].tags, []);
  assert.equal(editableRows[0].permissions.canEdit, true);
});

test('admin has full project entry permissions without project membership', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 36));
  const webType = repos.entryTypes.findByName('Web');
  const project = repos.projects.create({ name: 'Admin Full Project', description: '', status: 'Active' });
  repos.entries.create({
    projectId: project.id,
    typeId: webType.id,
    name: 'Admin Visible Entry',
    url: 'https://admin.local',
    username: 'admin-user',
    password: 'admin-secret',
    notes: 'admin notes'
  });
  const admin = {
    id: 999,
    role: 'Admin',
    permissions: []
  };

  assert.equal(hasPermission(admin, 'users.manage'), true);
  assert.deepEqual(repos.projects.listForUser(admin).map(item => item.name), ['Admin Full Project']);
  const rows = repos.entries.listByProjectForUser(project.id, admin);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://admin.local');
  assert.equal(rows[0].username, 'admin-user');
  assert.equal(rows[0].notes, 'admin notes');
  assert.equal(rows[0].permissions.canEdit, true);
  assert.equal(rows[0].permissions.canDelete, true);
  assert.equal(rows[0].permissions.canRevealPassword, true);
  assert.equal(repos.entries.revealPasswordForUser(rows[0].id, admin), 'admin-secret');
});

test('global permissions only retain permission-management access', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 37));

  const manager = repos.users.create({
    username: 'permission-manager@example.com',
    password: 'manager-pass',
    displayName: 'Permission Manager',
    role: 'Manager',
    status: 'Active',
    permissions: [
      'users.manage',
      'projects.write',
      'entries.write',
      'entries.delete',
      'passwords.reveal',
      'import.export',
      'backup.save',
      'settings.manage'
    ]
  });

  assert.deepEqual(manager.permissions, ['users.manage']);
  assert.equal(hasPermission(manager, 'users.manage'), true);
  assert.equal(hasPermission(manager, 'projects.write'), false);
  assert.equal(hasPermission(manager, 'entries.write'), false);
  assert.equal(hasPermission(manager, 'passwords.reveal'), false);
});

test('creates a local user without requiring an admin-entered password', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 17));

  const user = repos.users.create({
    username: 'invitee@example.com',
    displayName: 'Invitee User',
    role: 'Viewer',
    status: 'Invited',
    inviteExpiresAt: '2099-01-01T00:00:00.000Z',
    permissions: []
  });

  assert.equal(user.username, 'invitee@example.com');
  assert.equal(user.role, 'Viewer');
  assert.equal(user.status, 'Invited');
  assert.equal(user.inviteExpiresAt, '2099-01-01T00:00:00.000Z');
});

test('Google login activates an invited user before invite expiry', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 18));
  const user = repos.users.create({
    username: 'pending@example.com',
    displayName: 'Pending User',
    role: 'Manager',
    status: 'Invited',
    inviteExpiresAt: '2099-01-01T00:00:00.000Z',
    permissions: ['projects.write']
  });

  const activated = repos.users.activateForGoogleLogin('pending@example.com', new Date('2026-01-01T00:00:00.000Z'));

  assert.equal(activated.id, user.id);
  assert.equal(activated.status, 'Active');
  assert.equal(activated.acceptedAt, '2026-01-01T00:00:00.000Z');
});

test('Google access requests create a pending user and block login until approval', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 8));

  const requested = repos.users.requestGoogleAccess({
    username: 'request@example.com',
    displayName: 'Request User'
  });

  assert.equal(requested.username, 'request@example.com');
  assert.equal(requested.displayName, 'Request User');
  assert.equal(requested.status, 'Pending');
  assert.deepEqual(requested.permissions, []);
  assert.throws(
    () => repos.users.activateForGoogleLogin('request@example.com'),
    /chờ admin phê duyệt/
  );

  const approved = repos.users.update(requested.id, {
    displayName: requested.displayName,
    role: 'Manager',
    status: 'Active',
    permissions: ['projects.write']
  });
  assert.equal(approved.status, 'Active');

  const loggedIn = repos.users.activateForGoogleLogin('request@example.com');
  assert.equal(loggedIn.status, 'Active');
  assert.equal(loggedIn.role, 'Manager');
});

test('Google access requests are idempotent for the same email', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 9));

  const first = repos.users.requestGoogleAccess({ username: 'repeat@example.com', displayName: 'Repeat User' });
  const second = repos.users.requestGoogleAccess({ username: 'repeat@example.com', displayName: 'Changed Name' });

  assert.equal(second.id, first.id);
  assert.equal(second.displayName, 'Repeat User');
  assert.equal(repos.users.list().filter(user => user.username === 'repeat@example.com').length, 1);
});

test('Google login rejects an expired invited user and marks it expired', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 19));
  const user = repos.users.create({
    username: 'expired@example.com',
    displayName: 'Expired User',
    role: 'Viewer',
    status: 'Invited',
    inviteExpiresAt: '2026-01-01T00:00:00.000Z',
    permissions: []
  });

  assert.throws(
    () => repos.users.activateForGoogleLogin('expired@example.com', new Date('2026-01-02T00:00:00.000Z')),
    /Invite expired/
  );
  assert.equal(repos.users.get(user.id).status, 'Expired');
});

test('listing users marks stale invitations as expired', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 20));
  repos.users.create({
    username: 'stale@example.com',
    displayName: 'Stale User',
    role: 'Viewer',
    status: 'Invited',
    inviteExpiresAt: '2026-01-01T00:00:00.000Z',
    permissions: []
  });

  const users = repos.users.list(new Date('2026-01-02T00:00:00.000Z'));

  assert.equal(users.find(user => user.username === 'stale@example.com').status, 'Expired');
});
