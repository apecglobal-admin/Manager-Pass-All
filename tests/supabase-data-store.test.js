import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseDataStore } from '../src/supabase-data-store.js';
import { encryptText } from '../src/crypto.js';

test('server-side Supabase data store creates a vault from the first auth user when none exists', async () => {
  const calls = [];
  const rows = { vaults: [], projects: [] };
  const supabase = createFakeSupabase({
    calls,
    rows,
    users: [{ id: 'auth-user-1', email: 'admin@example.com' }]
  });
  const store = createSupabaseDataStore({
    supabase,
    encryptionKey: Buffer.alloc(32, 23)
  });

  const project = await store.projects.create({ name: 'Created From Local Login', status: 'Active' });

  assert.equal(project.name, 'Created From Local Login');
  assert.deepEqual(rows.vaults.map(row => row.owner_id), ['auth-user-1']);
  assert.deepEqual(calls, [
    ['select', 'vaults'],
    ['listUsers'],
    ['insert', 'vaults'],
    ['insert', 'projects']
  ]);
});

test('Supabase entries include full permissions for admin UI actions', async () => {
  const calls = [];
  const rows = {
    vaults: [{ id: 'vault-1', owner_id: 'auth-user-1', name: 'Personal' }],
    projects: [],
    entries: [{
      id: 'entry-1',
      vault_id: 'vault-1',
      project_id: 'project-1',
      name: 'Supabase Login',
      type: 'Web',
      environment: 'Production',
      url: 'https://portal.local',
      username: 'admin',
      password_cipher: null,
      secret_notes_cipher: null,
      tags: [],
      status: 'Active',
      created_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
      deleted_at: null
    }]
  };
  const supabase = createFakeSupabase({
    calls,
    rows,
    users: [{ id: 'auth-user-1', email: 'admin@example.com' }]
  });
  const store = createSupabaseDataStore({
    supabase,
    encryptionKey: Buffer.alloc(32, 24)
  });

  const entries = await store.entries.listByProject('project-1');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].permissions.canRevealPassword, true);
  assert.equal(entries[0].permissions.canEdit, true);
  assert.equal(entries[0].permissions.canDelete, true);
});

test('Supabase data store lists delegated projects by id without resolving a personal vault', async () => {
  const calls = [];
  const rows = {
    vaults: [],
    projects: [
      {
        id: 'project-shared',
        vault_id: 'vault-admin',
        name: 'Shared Project',
        description: '',
        status: 'Active',
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
        deleted_at: null
      },
      {
        id: 'project-other',
        vault_id: 'vault-admin',
        name: 'Other Project',
        description: '',
        status: 'Active',
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
        deleted_at: null
      }
    ],
    entries: []
  };
  const supabase = createFakeSupabase({
    calls,
    rows,
    users: []
  });
  const store = createSupabaseDataStore({
    supabase,
    encryptionKey: Buffer.alloc(32, 25)
  });

  const projects = await store.projects.listByIds(['project-shared']);

  assert.deepEqual(projects.map(project => project.name), ['Shared Project']);
  assert.deepEqual(calls, [['select', 'projects']]);
});

test('Supabase data store lists delegated entries by project id without resolving a personal vault', async () => {
  const calls = [];
  const rows = {
    vaults: [],
    projects: [],
    entries: [
      {
        id: 'entry-shared',
        vault_id: 'vault-admin',
        project_id: 'project-shared',
        name: 'Shared Entry',
        type: 'Web',
        environment: 'Production',
        url: 'https://shared.example',
        username: 'shared-user',
        password_cipher: null,
        secret_notes_cipher: null,
        tags: [],
        status: 'Active',
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
        deleted_at: null
      }
    ]
  };
  const supabase = createFakeSupabase({
    calls,
    rows,
    users: []
  });
  const store = createSupabaseDataStore({
    supabase,
    encryptionKey: Buffer.alloc(32, 26)
  });

  const entries = await store.entries.listByProject('project-shared');

  assert.deepEqual(entries.map(entry => entry.name), ['Shared Entry']);
  assert.deepEqual(calls, [['select', 'entries']]);
});

test('Supabase data store reveals delegated entry password by id without resolving a personal vault', async () => {
  const calls = [];
  const encryptionKey = Buffer.alloc(32, 28);
  const rows = {
    vaults: [{ id: 'vault-user', owner_id: 'auth-user-1', name: 'Personal' }],
    projects: [],
    entries: [
      {
        id: 'entry-shared',
        vault_id: 'vault-admin',
        project_id: 'project-shared',
        name: 'Shared Entry',
        type: 'Web',
        password_cipher: JSON.parse(encryptText('shared-secret', encryptionKey)),
        deleted_at: null
      }
    ]
  };
  const supabase = createFakeSupabase({
    calls,
    rows,
    users: [{ id: 'auth-user-1', email: 'member@example.com' }]
  });
  const store = createSupabaseDataStore({
    supabase,
    accessToken: 'member-token',
    encryptionKey,
    useAccessTokenAuthorization: false
  });

  const password = await store.entries.revealPassword('entry-shared');

  assert.equal(password, 'shared-secret');
  assert.deepEqual(calls, [['select', 'entries']]);
});

test('Supabase data store updates delegated entry by id without resolving a personal vault', async () => {
  const calls = [];
  const encryptionKey = Buffer.alloc(32, 29);
  const rows = {
    vaults: [{ id: 'vault-user', owner_id: 'auth-user-1', name: 'Personal' }],
    projects: [],
    entries: [
      {
        id: 'entry-shared',
        vault_id: 'vault-admin',
        project_id: 'project-shared',
        name: 'Shared Entry',
        type: 'Web',
        environment: 'Production',
        url: 'https://old.example',
        username: 'old-user',
        password_cipher: null,
        secret_notes_cipher: null,
        tags: [],
        status: 'Active',
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
        deleted_at: null
      }
    ]
  };
  const supabase = createFakeSupabase({
    calls,
    rows,
    users: [{ id: 'auth-user-1', email: 'member@example.com' }]
  });
  const store = createSupabaseDataStore({
    supabase,
    accessToken: 'member-token',
    encryptionKey,
    useAccessTokenAuthorization: false
  });

  const updated = await store.entries.update('entry-shared', {
    projectId: 'project-shared',
    type: 'Web',
    name: 'Shared Entry Edited',
    environment: 'Production',
    url: 'abc',
    username: 'abcd',
    notes: '',
    tags: [],
    status: 'Active'
  });

  assert.equal(updated.name, 'Shared Entry Edited');
  assert.equal(rows.entries[0].vault_id, 'vault-admin');
  assert.equal(rows.entries[0].url, 'abc');
  assert.deepEqual(calls, [['update', 'entries']]);
});

test('Supabase data store shares entry passwords across app instances with different app secrets', async () => {
  const calls = [];
  const rows = {
    vaults: [{ id: 'vault-user', owner_id: 'auth-user-1', name: 'Personal' }],
    projects: [],
    entries: []
  };
  const supabase = createFakeSupabase({
    calls,
    rows,
    users: [{ id: 'auth-user-1', email: 'member@example.com' }]
  });
  const creatorStore = createSupabaseDataStore({
    supabase,
    encryptionKey: Buffer.alloc(32, 31)
  });
  const viewerStore = createSupabaseDataStore({
    supabase,
    encryptionKey: Buffer.alloc(32, 32)
  });

  const created = await creatorStore.entries.create({
    projectId: 'project-shared',
    type: 'Web',
    name: 'Shared Entry Password',
    environment: 'Production',
    url: 'https://shared.example',
    username: 'shared-user',
    password: 'shared-password',
    notes: '',
    tags: [],
    status: 'Active'
  });

  const password = await viewerStore.entries.revealPassword(created.id);

  assert.equal(password, 'shared-password');
});

test('Supabase data store deletes delegated entry by id without resolving a personal vault', async () => {
  const calls = [];
  const rows = {
    vaults: [{ id: 'vault-user', owner_id: 'auth-user-1', name: 'Personal' }],
    projects: [],
    entries: [
      {
        id: 'entry-shared',
        vault_id: 'vault-admin',
        project_id: 'project-shared',
        name: 'Shared Entry',
        type: 'Web',
        deleted_at: null
      }
    ]
  };
  const supabase = createFakeSupabase({
    calls,
    rows,
    users: [{ id: 'auth-user-1', email: 'member@example.com' }]
  });
  const store = createSupabaseDataStore({
    supabase,
    accessToken: 'member-token',
    encryptionKey: Buffer.alloc(32, 30),
    useAccessTokenAuthorization: false
  });

  await store.entries.delete('entry-shared');

  assert.ok(rows.entries[0].deleted_at);
  assert.deepEqual(calls, [['update', 'entries']]);
});

test('Supabase service-role data store can verify user token without authorizing table requests as that user', async () => {
  const createdClients = [];
  const rows = {
    vaults: [{ id: 'vault-user', owner_id: 'auth-user-1', name: 'Personal' }],
    projects: [],
    entries: []
  };
  const store = createSupabaseDataStore({
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'service-role-key',
    accessToken: 'user-access-token',
    encryptionKey: Buffer.alloc(32, 27),
    useAccessTokenAuthorization: false,
    createSupabaseClient: (url, key, options) => {
      createdClients.push({ url, key, options });
      return createFakeSupabase({
        calls: [],
        rows,
        users: [{ id: 'auth-user-1', email: 'user@example.com' }]
      });
    }
  });

  await store.projects.create({ name: 'Service Role Project', status: 'Active' });

  assert.equal(createdClients.length, 1);
  assert.equal(createdClients[0].options.global, undefined);
  assert.equal(rows.projects[0].vault_id, 'vault-user');
});

function createFakeSupabase({ calls, rows, users }) {
  return {
    auth: {
      async getUser(token) {
        calls.push(['getUser', token]);
        return { data: { user: users[0] || null }, error: null };
      },
      admin: {
        async listUsers() {
          calls.push(['listUsers']);
          return { data: { users }, error: null };
        }
      }
    },
    from(table) {
      return new FakeQuery({ calls, rows, table });
    }
  };
}

class FakeQuery {
  constructor({ calls, rows, table }) {
    this.calls = calls;
    this.rows = rows;
    this.table = table;
    this.operation = 'select';
    this.values = null;
    this.filters = [];
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

  eq(column, value) {
    this.filters.push({ column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ column, values, operator: 'in' });
    return this;
  }

  is(column, value) {
    this.filters.push({ column, value });
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  single() {
    return this.then(result => {
      if (result.error) return result;
      return { data: result.data[0], error: null };
    });
  }

  then(resolve, reject) {
    try {
      return resolve(this.execute());
    } catch (error) {
      if (reject) return reject(error);
      else throw error;
    }
  }

  execute() {
    if (this.operation === 'insert') {
      this.calls.push(['insert', this.table]);
      const row = {
        id: `${this.table}-1`,
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
        ...this.values
      };
      this.rows[this.table].push(row);
      return { data: [row], error: null };
    }

    if (this.operation === 'update') {
      this.calls.push(['update', this.table]);
      const matched = this.rows[this.table].filter(row => this.matches(row));
      for (const row of matched) Object.assign(row, this.values);
      return { data: matched, error: null };
    }

    this.calls.push(['select', this.table]);
    const data = this.rows[this.table].filter(row => this.matches(row));
    return { data, error: null };
  }

  matches(row) {
    return this.filters.every(filter => {
      if (filter.operator === 'in') return filter.values.includes(row[filter.column]);
      if (filter.value === null) return row[filter.column] == null;
      return row[filter.column] === filter.value;
    });
  }
}
