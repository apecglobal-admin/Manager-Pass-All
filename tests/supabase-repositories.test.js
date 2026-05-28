import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseRepositories } from '../src/supabase-repositories.js';
import { encryptText } from '../src/crypto.js';

test('activates active app user from Supabase auth email', async () => {
  const rows = createRows();
  rows.app_users.push({
    id: 'user-1',
    auth_user_id: null,
    username: 'admin@example.com',
    display_name: 'Admin User',
    role: 'Admin',
    status: 'Active',
    permissions: [],
    created_at: '2026-05-27T00:00:00.000Z'
  });
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(rows),
    encryptionKey: Buffer.alloc(32, 1)
  });

  const user = await repos.users.activateForGoogleLogin('admin@example.com', {
    authUserId: 'auth-1',
    displayName: 'Admin User'
  });

  assert.equal(user.id, 'user-1');
  assert.equal(user.role, 'Admin');
  assert.equal(user.permissions.includes('users.manage'), true);
  assert.equal(rows.app_users[0].auth_user_id, 'auth-1');
});

test('missing app user returns null instead of throwing Supabase single-row error', async () => {
  const rows = createRows();
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(rows, { strictSingle: true }),
    encryptionKey: Buffer.alloc(32, 5)
  });

  const user = await repos.users.activateForGoogleLogin('new-admin@example.com', {
    authUserId: 'auth-new-admin',
    displayName: 'New Admin'
  });

  assert.equal(user, null);
});

test('first Supabase access request bootstraps an active admin user', async () => {
  const rows = createRows();
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(rows),
    encryptionKey: Buffer.alloc(32, 6)
  });

  const user = await repos.users.requestGoogleAccess({
    username: 'first-admin@example.com',
    authUserId: 'auth-first-admin',
    displayName: 'First Admin'
  });

  assert.equal(user.username, 'first-admin@example.com');
  assert.equal(user.role, 'Admin');
  assert.equal(user.status, 'Active');
  assert.equal(user.permissions.includes('users.manage'), true);
});

test('access request uses security definer app user count when RLS hides other users', async () => {
  const rows = createRows();
  rows.app_users.push({
    id: 'existing-user',
    auth_user_id: 'auth-existing',
    username: 'existing@example.com',
    display_name: 'Existing User',
    role: 'Admin',
    status: 'Active',
    permissions: ['users.manage'],
    created_at: '2026-05-27T00:00:00.000Z'
  });
  let rpcCalled = false;
  const supabase = {
    ...createFakeSupabase(rows),
    rpc(name) {
      rpcCalled = true;
      assert.equal(name, 'has_no_app_users');
      return Promise.resolve({ data: false, error: null });
    }
  };
  const repos = createSupabaseRepositories({
    supabase,
    encryptionKey: Buffer.alloc(32, 6)
  });

  const user = await repos.users.requestGoogleAccess({
    username: 'new-user@example.com',
    authUserId: 'auth-new-user',
    displayName: 'New User'
  });

  assert.equal(rpcCalled, true);
  assert.equal(user.role, 'Viewer');
  assert.equal(user.status, 'Pending');
});

test('lists entry types from Supabase', async () => {
  const rows = createRows();
  rows.entry_types.push({
    id: 'type-web',
    name: 'Web',
    slug: 'web',
    description: '',
    sort_order: 1,
    is_active: true,
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z'
  });
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(rows),
    encryptionKey: Buffer.alloc(32, 2)
  });

  const types = await repos.entryTypes.list();

  assert.deepEqual(types.map(type => type.name), ['Web']);
  assert.equal(types[0].isActive, true);
});

test('exports backup JSON from Supabase rows without file paths', async () => {
  const rows = createRows();
  rows.app_users.push({
    id: 'user-1',
    username: 'admin@example.com',
    display_name: 'Admin',
    role: 'Admin',
    status: 'Active',
    permissions: [],
    created_at: '2026-05-27T00:00:00.000Z'
  });
  rows.projects.push({
    id: 'project-1',
    name: 'Portal',
    description: '',
    status: 'Active',
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z',
    deleted_at: null
  });
  rows.entries.push({
    id: 'entry-1',
    project_id: 'project-1',
    entry_type_id: null,
    name: 'Portal Admin',
    type: 'Admin',
    environment: 'Production',
    url: '',
    username: 'root',
    password_cipher: null,
    secret_notes_cipher: null,
    tags: [],
    status: 'Active',
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z',
    deleted_at: null
  });
  rows.app_settings.push({ key: 'autoLockMinutes', value: 10 });
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(rows),
    encryptionKey: Buffer.alloc(32, 3)
  });

  const backup = await repos.export.backupJson({ includePasswords: false });

  assert.equal(backup.counts.users, 1);
  assert.equal(backup.counts.projects, 1);
  assert.equal(backup.counts.entries, 1);
  assert.equal('latestPath' in backup, false);
  assert.equal(backup.entries[0].password, undefined);
  assert.equal(backup.settings.autoLockMinutes, 10);
});

test('reveals encrypted Supabase entry password', async () => {
  const encryptionKey = Buffer.alloc(32, 4);
  const rows = createRows();
  rows.entries.push({
    id: 'entry-1',
    project_id: 'project-1',
    name: 'Portal Admin',
    type: 'Admin',
    password_cipher: JSON.parse(encryptText('supabase-secret', encryptionKey)),
    secret_notes_cipher: null,
    tags: [],
    status: 'Active',
    deleted_at: null
  });
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(rows),
    encryptionKey
  });

  const password = await repos.entries.revealPassword('entry-1');

  assert.equal(password, 'supabase-secret');
});

test('project create resolves a personal vault for the signed-in owner', async () => {
  const rows = createRows();
  rows.vaults.push({
    id: 'vault-owner',
    owner_id: 'auth-owner',
    name: 'Personal',
    kdf_salt: 'salt',
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z'
  });
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(rows),
    encryptionKey: Buffer.alloc(32, 7)
  });

  const project = await repos.projects.create({
    ownerAuthUserId: 'auth-owner',
    name: 'Owner Project',
    description: '',
    status: 'Active'
  });

  assert.equal(project.name, 'Owner Project');
  assert.equal(rows.projects[0].vault_id, 'vault-owner');
});

test('entry create inherits vault id from its project', async () => {
  const rows = createRows();
  rows.projects.push({
    id: 'project-owner',
    vault_id: 'vault-owner',
    name: 'Owner Project',
    description: '',
    status: 'Active',
    deleted_at: null
  });
  const repos = createSupabaseRepositories({
    supabase: createFakeSupabase(rows),
    encryptionKey: Buffer.alloc(32, 8)
  });

  const entry = await repos.entries.create({
    projectId: 'project-owner',
    type: 'Admin',
    name: 'Owner Account',
    password: 'secret'
  });

  assert.equal(entry.projectId, 'project-owner');
  assert.equal(rows.entries[0].vault_id, 'vault-owner');
});

function createRows() {
  return {
    app_users: [],
    vaults: [],
    projects: [],
    entry_types: [],
    entries: [],
    project_memberships: [],
    detailed_permissions: [],
    activity_logs: [],
    app_settings: []
  };
}

function createFakeSupabase(rows, options = {}) {
  return {
    from(table) {
      return new FakeQuery(rows, table, options);
    }
  };
}

class FakeQuery {
  constructor(rows, table, options = {}) {
    this.rows = rows;
    this.table = table;
    this.options = options;
    this.operation = 'select';
    this.values = null;
    this.filters = [];
    this.orderColumn = null;
    this.singleResult = false;
  }

  select() {
    return this;
  }

  insert(values) {
    this.operation = 'insert';
    this.values = values;
    return this;
  }

  update(values) {
    this.operation = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, value, operator: 'eq' });
    return this;
  }

  in(column, values) {
    this.filters.push({ column, values, operator: 'in' });
    return this;
  }

  is(column, value) {
    this.filters.push({ column, value, operator: 'is' });
    return this;
  }

  ilike(column, value) {
    this.filters.push({ column, value, operator: 'ilike' });
    return this;
  }

  or() {
    return this;
  }

  order(column) {
    this.orderColumn = column;
    return this;
  }

  limit() {
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }

  execute() {
    const tableRows = this.rows[this.table] || [];
    if (this.operation === 'insert') {
      const inserted = Array.isArray(this.values) ? this.values : [this.values];
      const prepared = inserted.map(value => ({
        id: value.id || `${this.table}-${tableRows.length + 1}`,
        created_at: value.created_at || '2026-05-27T00:00:00.000Z',
        updated_at: value.updated_at || '2026-05-27T00:00:00.000Z',
        ...value
      }));
      tableRows.push(...prepared);
      return this.result(prepared);
    }
    if (this.operation === 'update') {
      const matched = this.applyFilters(tableRows);
      matched.forEach(row => Object.assign(row, this.values));
      return this.result(matched);
    }
    if (this.operation === 'delete') {
      const matched = new Set(this.applyFilters(tableRows));
      this.rows[this.table] = tableRows.filter(row => !matched.has(row));
      return this.result([]);
    }
    return this.result(this.applyFilters(tableRows));
  }

  result(data) {
    const sorted = this.orderColumn
      ? [...data].sort((a, b) => String(a[this.orderColumn] || '').localeCompare(String(b[this.orderColumn] || '')))
      : data;
    if (this.singleResult && this.options.strictSingle && sorted.length !== 1) {
      return {
        data: null,
        error: {
          code: 'PGRST116',
          message: 'Cannot coerce the result to a single JSON object'
        }
      };
    }
    return { data: this.singleResult ? sorted[0] || null : sorted, error: null };
  }

  applyFilters(tableRows) {
    return tableRows.filter(row => this.filters.every(filter => {
      if (filter.operator === 'eq') return row[filter.column] === filter.value;
      if (filter.operator === 'in') return filter.values.includes(row[filter.column]);
      if (filter.operator === 'is') return row[filter.column] === filter.value;
      if (filter.operator === 'ilike') {
        const pattern = String(filter.value || '').replaceAll('%', '').toLowerCase();
        return String(row[filter.column] || '').toLowerCase().includes(pattern);
      }
      return true;
    }));
  }
}
