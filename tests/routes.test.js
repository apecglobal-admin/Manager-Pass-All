import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

const TEST_ADMIN_PASSWORD = 'admin123';

test('login, create project, create entry, and reveal password through API', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 5) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const projectRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Apec Portal', description: '', status: 'Active' })
    });
    const project = await projectRes.json();
    assert.equal(project.name, 'Apec Portal');

    const entryRes = await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        projectId: project.id,
        name: 'Portal Admin',
        type: 'Admin',
        environment: 'Production',
        url: 'https://portal.local',
        username: 'cto',
        password: 'portal-secret',
        notes: '',
        tags: ['portal'],
        status: 'Active'
      })
    });
    const entry = await entryRes.json();

    const reveal = await fetch(`${base}/api/entries/${entry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie }
    });
    assert.equal((await reveal.json()).password, 'portal-secret');
  } finally {
    await app.close();
  }
});

test('authenticated user can save JSON backup to disk', async () => {
  const backupDir = mkdtempSync(join(tmpdir(), 'apec-route-backup-'));
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 6), backupDir });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const backup = await fetch(`${base}/api/backups/save-json`, {
      method: 'POST',
      headers: { cookie }
    });
    const body = await backup.json();

    assert.equal(backup.status, 201);
    assert.equal(body.counts.users, 1);
    assert.equal(existsSync(body.latestPath), true);
    assert.equal(existsSync(body.timestampedPath), true);
  } finally {
    await app.close();
  }
});

test('admin can update and delete projects through API', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 11) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const created = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Old Name', description: '', status: 'Active' })
    })).json();

    const updated = await fetch(`${base}/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'New Name', description: 'Renamed', status: 'Inactive' })
    });
    const updatedBody = await updated.json();
    assert.equal(updated.status, 200);
    assert.equal(updatedBody.name, 'New Name');
    assert.equal(updatedBody.status, 'Inactive');

    const deleted = await fetch(`${base}/api/projects/${created.id}`, {
      method: 'DELETE',
      headers: { cookie }
    });
    assert.equal(deleted.status, 200);

    const projects = await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json();
    assert.equal(projects.some(project => project.id === created.id), false);
  } finally {
    await app.close();
  }
});

test('project and entry writes can be delegated to a Supabase-backed data store', async () => {
  const calls = [];
  const projectId = '11111111-1111-4111-8111-111111111111';
  const entryId = '22222222-2222-4222-8222-222222222222';
  const dataStore = {
    projects: {
      list: async () => [],
      create: async input => {
        calls.push(['project.create', input.name]);
        return { id: projectId, name: input.name, description: input.description || '', status: input.status || 'Active' };
      },
      update: async (id, input) => {
        calls.push(['project.update', id, input.name]);
        return { id, name: input.name, description: input.description || '', status: input.status || 'Active' };
      },
      delete: async id => {
        calls.push(['project.delete', id]);
      }
    },
    entries: {
      listByProject: async id => {
        calls.push(['entry.listByProject', id]);
        return [];
      },
      search: async () => [],
      create: async input => {
        calls.push(['entry.create', input.name]);
        return { id: entryId, projectId: input.projectId, name: input.name, type: input.type || 'Other', tags: [] };
      },
      update: async (id, input) => {
        calls.push(['entry.update', id, input.name]);
        return { id, projectId: input.projectId, name: input.name, type: input.type || 'Other', tags: [] };
      },
      delete: async id => {
        calls.push(['entry.delete', id]);
      }
    }
  };

  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 21), dataStore });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const project = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Supabase Project', description: '', status: 'Active' })
    })).json();

    await fetch(`${base}/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Supabase Project Updated', description: '', status: 'Active' })
    });

    const entry = await (await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        projectId: project.id,
        name: 'Supabase Entry',
        type: 'Admin',
        password: 'server-secret'
      })
    })).json();

    await fetch(`${base}/api/entries/${entry.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        projectId: project.id,
        name: 'Supabase Entry Updated',
        type: 'Admin'
      })
    });

    await fetch(`${base}/api/entries/${entry.id}`, { method: 'DELETE', headers: { cookie } });
    await fetch(`${base}/api/projects/${project.id}`, { method: 'DELETE', headers: { cookie } });

    assert.deepEqual(calls, [
      ['project.create', 'Supabase Project'],
      ['project.update', projectId, 'Supabase Project Updated'],
      ['entry.create', 'Supabase Entry'],
      ['entry.update', entryId, 'Supabase Entry Updated'],
      ['entry.delete', entryId],
      ['project.delete', projectId]
    ]);
  } finally {
    await app.close();
  }
});

test('delegated entry create resolves frontend type ids before writing to data store', async () => {
  const calls = [];
  const dataStore = {
    projects: {
      list: async () => [],
      create: async input => ({ id: 'project-id', name: input.name, description: '', status: 'Active' })
    },
    entries: {
      listByProject: async () => [],
      search: async () => [],
      create: async input => {
        calls.push(['entry.create', input.name, input.type]);
        return { id: 'entry-id', projectId: input.projectId, name: input.name, type: input.type, tags: [] };
      }
    },
    activity: {
      log: async () => {}
    }
  };
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 25), dataStore });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie } })).json();
    const webType = types.find(type => type.name === 'Web');

    await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        projectId: 'project-id',
        name: 'Frontend Typed Entry',
        typeId: webType.id,
        password: 'server-secret'
      })
    });

    assert.deepEqual(calls, [['entry.create', 'Frontend Typed Entry', 'Web']]);
  } finally {
    await app.close();
  }
});

test('project member permissions support delegated project ids without numeric coercion', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const dataStore = {
    projects: {
      list: async () => [{ id: projectId, name: 'Delegated Project', description: '', status: 'Active' }],
      create: async input => ({ id: projectId, name: input.name, description: input.description || '', status: input.status || 'Active' }),
      update: async (id, input) => ({ id, name: input.name, description: input.description || '', status: input.status || 'Active' }),
      delete: async () => {}
    },
    entries: {
      listByProject: async () => [],
      search: async () => [],
      create: async input => ({ id: 'entry-1', projectId: input.projectId, name: input.name, type: input.type || 'Other', tags: [] }),
      update: async (id, input) => ({ id, projectId: input.projectId, name: input.name, type: input.type || 'Other', tags: [] }),
      delete: async () => {}
    },
    activity: {
      log: async () => {}
    }
  };
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 22), dataStore });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie } })).json();
    const webType = types.find(type => type.name === 'Web');
    const user = await (await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        username: 'delegated-member',
        password: 'member-pass',
        displayName: 'Delegated Member',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    })).json();

    const savedMembers = await fetch(`${base}/api/projects/${projectId}/members`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        members: [{
          userId: user.user.id,
          detailedPermissions: [{
            entryTypeId: webType.id,
            canViewEntry: true
          }]
        }]
      })
    });
    const savedBody = await savedMembers.json();

    assert.equal(savedMembers.status, 200);
    assert.equal(savedBody.members[0].detailedPermissions[0].projectId, projectId);
  } finally {
    await app.close();
  }
});

test('project member API ignores admin users because admins already have full access', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 27) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie } })).json();
    const webType = types.find(type => type.name === 'Web');

    const project = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Admin Not Member Project', description: '', status: 'Active' })
    })).json();
    const user = await (await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        username: 'non-admin-member@example.com',
        password: 'member-pass',
        displayName: 'Non Admin Member',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    })).json();

    const saved = await fetch(`${base}/api/projects/${project.id}/members`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        members: [
          {
            userId: 1,
            detailedPermissions: [{
              entryTypeId: webType.id,
              canViewEntry: true
            }]
          },
          {
            userId: user.user.id,
            detailedPermissions: [{
              entryTypeId: webType.id,
              canViewEntry: true
            }]
          }
        ]
      })
    });
    const body = await saved.json();

    assert.equal(saved.status, 200);
    assert.deepEqual(body.members.map(member => member.userId), [user.user.id]);
  } finally {
    await app.close();
  }
});

test('non-admin sees delegated data-store projects through local project memberships', async () => {
  const projectId = 'fda2986d-a8df-48e2-aa36-ccc741573150';
  const visibleEntryId = 'entry-visible-web';
  const hiddenEntryId = 'entry-hidden-admin';
  const project = { id: projectId, name: 'Delegated Team Project', description: '', status: 'Active' };
  const updates = [];
  const dataStore = {
    projects: {
      list: async () => [],
      listByIds: async ids => ids.includes(projectId) ? [project] : [],
      create: async input => ({ ...project, name: input.name }),
      update: async (id, input) => ({ ...project, id, name: input.name }),
      delete: async () => {}
    },
    entries: {
      listByProject: async id => id === projectId ? [
        {
          id: visibleEntryId,
          projectId,
          type: 'Web',
          name: 'Visible Web',
          url: 'https://visible.example',
          username: 'visible-user',
          passwordMasked: true,
          notes: 'visible notes',
          status: 'Active',
          tags: ['private-tag']
        },
        {
          id: hiddenEntryId,
          projectId,
          type: 'Admin',
          name: 'Hidden Admin',
          url: 'https://hidden.example',
          username: 'hidden-user',
          passwordMasked: true,
          notes: 'hidden notes',
          status: 'Active',
          tags: []
        }
      ] : [],
      search: async () => [],
      create: async input => ({ id: 'created-entry', projectId: input.projectId, name: input.name, type: input.type || 'Other', tags: [] }),
      update: async (id, input) => {
        updates.push({ id, input });
        return { id, projectId: input.projectId, name: input.name, type: input.type || 'Other', tags: [] };
      },
      delete: async () => {},
      revealPassword: async id => id === visibleEntryId ? 'visible-secret' : ''
    },
    activity: {
      log: async () => {}
    }
  };
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 24), dataStore });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie: adminCookie } })).json();
    const webType = types.find(type => type.name === 'Web');

    const user = await (await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'delegated-reader',
        password: 'reader-pass',
        displayName: 'Delegated Reader',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    })).json();

    await fetch(`${base}/api/projects/${projectId}/members`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        members: [{
          userId: user.user.id,
          detailedPermissions: [{
            entryTypeId: webType.id,
            canViewEntry: true,
            canViewUsername: true,
            canViewUrl: false,
            canViewNotes: false,
            canRevealPassword: true,
            canEdit: true
          }]
        }]
      })
    });

    const userLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'delegated-reader', password: 'reader-pass' })
    });
    const userCookie = userLogin.headers.get('set-cookie').split(';')[0];

    const projects = await (await fetch(`${base}/api/projects`, { headers: { cookie: userCookie } })).json();
    assert.deepEqual(projects.map(item => item.name), ['Delegated Team Project']);
    assert.deepEqual(projects[0].entryTypePermissions, [{
      entryTypeId: webType.id,
      canViewEntry: true,
      canViewUrl: false,
      canViewUsername: true,
      canRevealPassword: true,
      canViewNotes: false,
      canCreate: false,
      canEdit: true,
      canDelete: false
    }]);

    const entries = await (await fetch(`${base}/api/projects/${projectId}/entries`, { headers: { cookie: userCookie } })).json();
    assert.deepEqual(entries.map(item => item.name), ['Visible Web']);
    assert.equal(entries[0].username, 'visible-user');
    assert.equal(entries[0].url, '');
    assert.equal(entries[0].notes, '');
    assert.deepEqual(entries[0].tags, []);

    const editable = await (await fetch(`${base}/api/entries/${visibleEntryId}/edit`, { headers: { cookie: userCookie } })).json();
    assert.equal(editable.url, 'https://visible.example');
    assert.equal(editable.notes, 'visible notes');
    assert.equal(editable.username, 'visible-user');
    assert.deepEqual(editable.tags, ['private-tag']);

    const reveal = await fetch(`${base}/api/entries/${visibleEntryId}/reveal-password`, {
      method: 'POST',
      headers: { cookie: userCookie }
    });
    assert.equal(reveal.status, 200);
    assert.equal((await reveal.json()).password, 'visible-secret');

    const edited = await fetch(`${base}/api/entries/${visibleEntryId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: userCookie },
      body: JSON.stringify({
        projectId,
        typeId: webType.id,
        name: 'Visible Web Edited',
        url: 'https://edited.example',
        username: 'edited-user',
        notes: 'edited notes',
        status: 'Active',
        tags: []
      })
    });
    assert.equal(edited.status, 200);
    assert.equal(updates[0].input.type, 'Web');
    assert.equal(updates[0].input.name, 'Visible Web Edited');
  } finally {
    await app.close();
  }
});

test('local login still delegates project writes through configured data store factory', async () => {
  const calls = [];
  const dataStoreFactory = async session => {
    calls.push(['factory', session.user.username, Boolean(session.accessToken)]);
    return {
      projects: {
        list: async () => [],
        create: async input => {
          calls.push(['project.create', input.name]);
          return { id: 'factory-project-id', name: input.name, description: '', status: 'Active' };
        }
      },
      entries: {
        listByProject: async () => [],
        search: async () => []
      },
      activity: {
        log: async action => calls.push(['activity.log', action])
      }
    };
  };

  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 22),
    dataStoreFactory
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const created = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Local Login Supabase Project', description: '', status: 'Active' })
    });
    assert.equal(created.status, 201);

    assert.deepEqual(calls, [
      ['factory', 'admin', false],
      ['project.create', 'Local Login Supabase Project'],
      ['activity.log', 'project.create']
    ]);
  } finally {
    await app.close();
  }
});

test('admin can create users and viewer permissions are enforced', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 10) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const created = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'viewer',
        password: 'viewer-pass',
        displayName: 'Read Only',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    });
    assert.equal(created.status, 201);

    const project = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Permission Portal', description: '', status: 'Active' })
    })).json();

    const entry = await (await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        name: 'Viewer Locked Secret',
        type: 'Admin',
        environment: 'Production',
        url: 'https://locked.local',
        username: 'reader',
        password: 'locked-secret',
        notes: '',
        tags: [],
        status: 'Active'
      })
    })).json();

    const viewerLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer-pass' })
    });
    assert.equal(viewerLogin.status, 200);
    const viewerCookie = viewerLogin.headers.get('set-cookie').split(';')[0];

    const listProjects = await fetch(`${base}/api/projects`, { headers: { cookie: viewerCookie } });
    assert.equal(listProjects.status, 200);

    const reveal = await fetch(`${base}/api/entries/${entry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie: viewerCookie }
    });
    assert.equal(reveal.status, 403);

    const createEntry = await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: viewerCookie },
      body: JSON.stringify({ projectId: project.id, name: 'Denied', password: '' })
    });
    assert.equal(createEntry.status, 403);
  } finally {
    await app.close();
  }
});

test('user account payload ignores legacy detailed permissions without a project id', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 23) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie } })).json();
    const webType = types.find(type => type.name === 'Web');

    const created = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        username: 'legacy-permission-user',
        password: 'member-pass',
        displayName: 'Legacy Permission User',
        role: 'Viewer',
        status: 'Active',
        permissions: [],
        detailedPermissions: [
          {
            entryTypeId: webType.id,
            canViewEntry: true
          }
        ]
      })
    });
    const body = await created.json();

    assert.equal(created.status, 201);
    assert.deepEqual(body.detailedPermissions, []);
  } finally {
    await app.close();
  }
});

test('non-admin without detailed rules cannot see projects or reveal passwords', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 33) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'manager-no-scope',
        password: 'manager-pass',
        displayName: 'Manager No Scope',
        role: 'Manager',
        status: 'Active',
        permissions: ['passwords.reveal', 'entries.write']
      })
    });

    const project = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'No Scope Project', description: '', status: 'Active' })
    })).json();
    const entry = await (await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        name: 'Hidden Web',
        type: 'Web',
        username: 'hidden-user',
        password: 'hidden-secret'
      })
    })).json();

    const userLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'manager-no-scope', password: 'manager-pass' })
    });
    const userCookie = userLogin.headers.get('set-cookie').split(';')[0];

    const projects = await fetch(`${base}/api/projects`, { headers: { cookie: userCookie } });
    assert.deepEqual(await projects.json(), []);

    const reveal = await fetch(`${base}/api/entries/${entry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie: userCookie }
    });
    assert.equal(reveal.status, 403);
  } finally {
    await app.close();
  }
});

test('detailed project type permissions control visible fields and password reveal', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 34) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie: adminCookie } })).json();
    const webType = types.find(type => type.name === 'Web');
    const adminType = types.find(type => type.name === 'Admin');

    const createdUser = await (await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'scoped-user',
        password: 'scoped-pass',
        displayName: 'Scoped User',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    })).json();

    const project = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Scoped Route Project', description: '', status: 'Active' })
    })).json();
    const webEntry = await (await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        typeId: webType.id,
        name: 'Route Web',
        url: 'https://web.route',
        username: 'web-route-user',
        password: 'web-route-secret',
        notes: 'web route notes'
      })
    })).json();
    const adminEntry = await (await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        typeId: adminType.id,
        name: 'Route Admin',
        username: 'admin-route-user',
        password: 'admin-route-secret'
      })
    })).json();

    const updated = await fetch(`${base}/api/users/${createdUser.user.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        displayName: 'Scoped User',
        role: 'Viewer',
        status: 'Active',
        permissions: [],
        detailedPermissions: [
          {
            projectId: project.id,
            entryTypeId: webType.id,
            canViewEntry: true,
            canViewUsername: true,
            canViewUrl: false,
            canViewNotes: false,
            canRevealPassword: false
          },
          {
            projectId: project.id,
            entryTypeId: adminType.id,
            canViewEntry: true,
            canViewUsername: false,
            canRevealPassword: true
          }
        ]
      })
    });
    assert.equal(updated.status, 200);

    const userLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'scoped-user', password: 'scoped-pass' })
    });
    const userCookie = userLogin.headers.get('set-cookie').split(';')[0];

    const entries = await (await fetch(`${base}/api/projects/${project.id}/entries`, { headers: { cookie: userCookie } })).json();
    assert.equal(entries.length, 2);
    const visibleWeb = entries.find(entry => entry.id === webEntry.id);
    const visibleAdmin = entries.find(entry => entry.id === adminEntry.id);
    assert.equal(visibleWeb.username, 'web-route-user');
    assert.equal(visibleWeb.url, '');
    assert.equal(visibleWeb.notes, '');
    assert.equal(visibleAdmin.username, '');

    const deniedReveal = await fetch(`${base}/api/entries/${webEntry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie: userCookie }
    });
    assert.equal(deniedReveal.status, 403);

    const allowedReveal = await fetch(`${base}/api/entries/${adminEntry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie: userCookie }
    });
    assert.equal((await allowedReveal.json()).password, 'admin-route-secret');
  } finally {
    await app.close();
  }
});

test('project membership controls project visibility before detailed account permissions', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 41) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie: adminCookie } })).json();
    const webType = types.find(type => type.name === 'Web');

    const memberProject = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Member Project', description: '', status: 'Active' })
    })).json();
    const outsideProject = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Outside Project', description: '', status: 'Active' })
    })).json();

    await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        projectId: memberProject.id,
        typeId: webType.id,
        name: 'Member Web',
        username: 'member-user',
        password: 'member-secret'
      })
    });
    const outsideEntry = await (await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        projectId: outsideProject.id,
        typeId: webType.id,
        name: 'Outside Web',
        username: 'outside-user',
        password: 'outside-secret'
      })
    })).json();

    await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'project-member',
        password: 'member-pass',
        displayName: 'Project Member',
        role: 'Viewer',
        status: 'Active',
        permissions: [],
        projectMemberships: [memberProject.id],
        detailedPermissions: [
          {
            projectId: outsideProject.id,
            entryTypeId: webType.id,
            canViewEntry: true,
            canViewUsername: true,
            canRevealPassword: true
          }
        ]
      })
    });

    const userLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'project-member', password: 'member-pass' })
    });
    const userCookie = userLogin.headers.get('set-cookie').split(';')[0];

    const projects = await (await fetch(`${base}/api/projects`, { headers: { cookie: userCookie } })).json();
    assert.deepEqual(projects.map(project => project.name), ['Member Project']);

    const memberEntries = await (await fetch(`${base}/api/projects/${memberProject.id}/entries`, { headers: { cookie: userCookie } })).json();
    assert.deepEqual(memberEntries, []);

    const outsideEntries = await (await fetch(`${base}/api/projects/${outsideProject.id}/entries`, { headers: { cookie: userCookie } })).json();
    assert.deepEqual(outsideEntries, []);

    const revealOutside = await fetch(`${base}/api/entries/${outsideEntry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie: userCookie }
    });
    assert.equal(revealOutside.status, 403);
  } finally {
    await app.close();
  }
});

test('admin manages project members and detailed permissions from the project API', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 42) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie: adminCookie } })).json();
    const webType = types.find(type => type.name === 'Web');

    const user = await (await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'project-member-api',
        password: 'member-pass',
        displayName: 'Project Member API',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    })).json();

    const project = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: 'Project Member API Scope', description: '', status: 'Active' })
    })).json();
    const entry = await (await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        projectId: project.id,
        typeId: webType.id,
        name: 'Project Scoped Web',
        username: 'scoped-user',
        password: 'scoped-secret'
      })
    })).json();

    const savedMembers = await fetch(`${base}/api/projects/${project.id}/members`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        members: [
          {
            userId: user.user.id,
            detailedPermissions: [
              {
                entryTypeId: webType.id,
                canViewEntry: true,
                canViewUsername: true,
                canRevealPassword: true
              }
            ]
          }
        ]
      })
    });
    const savedBody = await savedMembers.json();
    assert.equal(savedMembers.status, 200);
    assert.equal(savedBody.members.length, 1);
    assert.equal(savedBody.members[0].userId, user.user.id);

    const memberLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'project-member-api', password: 'member-pass' })
    });
    const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];

    const projects = await (await fetch(`${base}/api/projects`, { headers: { cookie: memberCookie } })).json();
    assert.deepEqual(projects.map(item => item.name), ['Project Member API Scope']);

    const entries = await (await fetch(`${base}/api/projects/${project.id}/entries`, { headers: { cookie: memberCookie } })).json();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].username, 'scoped-user');

    const reveal = await fetch(`${base}/api/entries/${entry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie: memberCookie }
    });
    assert.equal((await reveal.json()).password, 'scoped-secret');
  } finally {
    await app.close();
  }
});

test('admin create user sends Supabase invite when invite service is configured', async () => {
  const invites = [];
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 15),
    inviteUserByEmail: async (email, options) => {
      invites.push({ email, options });
      return { id: 'supabase-user-1', email };
    },
    appUrl: 'https://manager.example.com'
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const created = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'invitee@example.com',
        displayName: 'Invitee User',
        role: 'Manager',
        status: 'Active',
        permissions: ['projects.write']
      })
    });
    const body = await created.json();

    assert.equal(created.status, 201);
    assert.equal(body.user.username, 'invitee@example.com');
    assert.equal(body.user.status, 'Invited');
    assert.match(body.user.inviteExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(body.inviteSent, true);
    assert.deepEqual(invites, [{
      email: 'invitee@example.com',
      options: {
        redirectTo: 'https://manager.example.com/',
        data: {
          DisplayName: 'Invitee User',
          Role: 'Manager'
        }
      }
    }]);
  } finally {
    await app.close();
  }
});

test('admin create user without invite service still creates local user', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 16) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const created = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'local-only@example.com',
        displayName: 'Local Only',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    });
    const body = await created.json();

    assert.equal(created.status, 201);
    assert.equal(body.user.username, 'local-only@example.com');
    assert.equal(body.user.status, 'Invited');
    assert.equal(body.inviteSent, false);
  } finally {
    await app.close();
  }
});

test('admin can resend Supabase invite for an existing local user', async () => {
  const invites = [];
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 18),
    inviteUserByEmail: async (email, options) => {
      invites.push({ email, options });
      return { id: 'supabase-user-2', email };
    },
    appUrl: 'https://manager.example.com'
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const created = await (await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'resend@example.com',
        displayName: 'Resend User',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    })).json();
    invites.length = 0;

    const resent = await fetch(`${base}/api/users/${created.user.id}/invite`, {
      method: 'POST',
      headers: { cookie: adminCookie }
    });
    const body = await resent.json();

    assert.equal(resent.status, 200);
    assert.equal(body.inviteSent, true);
    assert.deepEqual(invites, [{
      email: 'resend@example.com',
      options: {
        redirectTo: 'https://manager.example.com/',
        data: {
          DisplayName: 'Resend User',
          Role: 'Viewer'
        }
      }
    }]);
  } finally {
    await app.close();
  }
});

test('admin delete user also deletes matching Supabase auth user when configured', async () => {
  const deletedAuthEmails = [];
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 26),
    deleteAuthUserByEmail: async email => {
      deletedAuthEmails.push(email);
      return true;
    }
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const created = await (await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'delete-auth@example.com',
        password: 'local-password',
        displayName: 'Delete Auth User',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    })).json();

    const deleted = await fetch(`${base}/api/users/${created.user.id}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie }
    });
    const body = await deleted.json();

    assert.equal(deleted.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.authDeleted, true);
    assert.deepEqual(deletedAuthEmails, ['delete-auth@example.com']);

    const users = await (await fetch(`${base}/api/users`, { headers: { cookie: adminCookie } })).json();
    assert.equal(users.some(user => user.username === 'delete-auth@example.com'), false);
  } finally {
    await app.close();
  }
});

test('config endpoint exposes only public Supabase browser config', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnon = process.env.SUPABASE_ANON_KEY;
  const previousNextUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousNextKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-public-key';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';

  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 7) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${base}/config.js`);
    const text = await res.text();

    assert.equal(res.status, 200);
    assert.match(text, /window\.APECGLOBAL_CONFIG/);
    assert.match(text, /https:\/\/example\.supabase\.co/);
    assert.match(text, /anon-public-key/);
    assert.equal(text.includes('service-role-secret'), false);
  } finally {
    await app.close();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousAnon;
    if (previousNextUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousNextUrl;
    if (previousNextKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousNextKey;
    if (previousService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
  }
});

test('config endpoint supports NEXT_PUBLIC Supabase environment aliases', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnon = process.env.SUPABASE_ANON_KEY;
  const previousNextUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousNextKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://next-public.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key';

  const { createApp: freshCreateApp } = await import(`../src/server.js?alias=${Date.now()}`);
  const app = freshCreateApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 9) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const text = await (await fetch(`${base}/config.js`)).text();
    assert.match(text, /https:\/\/next-public\.supabase\.co/);
    assert.match(text, /publishable-key/);
  } finally {
    await app.close();
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousAnon;
    if (previousNextUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousNextUrl;
    if (previousNextKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousNextKey;
  }
});

test('vendor Supabase client bundle is served locally', async () => {
  const app = createApp({ dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 8) });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${base}/vendor/supabase.js`);
    const text = await res.text();

    assert.equal(res.status, 200);
    assert.match(text, /supabase/i);
  } finally {
    await app.close();
  }
});

test('Google login maps a verified email to an active local user', async () => {
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 12),
    verifyGoogleAccessToken: async token => {
      assert.equal(token, 'valid-google-token');
      return { email: 'manager@example.com' };
    }
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const created = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'manager@example.com',
        password: 'local-password',
        displayName: 'Google Manager',
        role: 'Manager',
        status: 'Active',
        permissions: ['projects.write']
      })
    });
    assert.equal(created.status, 201);

    const googleLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'valid-google-token' })
    });
    const body = await googleLogin.json();
    const cookie = googleLogin.headers.get('set-cookie');

    assert.equal(googleLogin.status, 200);
    assert.equal(body.user.username, 'manager@example.com');
    assert.equal(body.user.role, 'Manager');
    assert.match(cookie, /^session=/);

    const session = await fetch(`${base}/api/session`, {
      headers: { cookie: cookie.split(';')[0] }
    });
    assert.equal((await session.json()).user.username, 'manager@example.com');
  } finally {
    await app.close();
  }
});

test('Google login activates an invited local user before the invite expires', async () => {
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 20),
    inviteUserByEmail: async () => ({ id: 'supabase-invite-user' }),
    verifyGoogleAccessToken: async () => ({ email: 'pending@example.com' })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const created = await (await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'pending@example.com',
        displayName: 'Pending User',
        role: 'Viewer',
        status: 'Active',
        permissions: []
      })
    })).json();
    assert.equal(created.user.status, 'Invited');

    const googleLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'pending-token' })
    });
    const body = await googleLogin.json();

    assert.equal(googleLogin.status, 200);
    assert.equal(body.user.username, 'pending@example.com');
    assert.equal(body.user.status, 'Active');

    const users = await (await fetch(`${base}/api/users`, { headers: { cookie: adminCookie } })).json();
    assert.equal(users.find(user => user.username === 'pending@example.com').status, 'Active');
  } finally {
    await app.close();
  }
});

test('Google login creates a pending access request for verified emails that are not provisioned locally', async () => {
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 13),
    verifyGoogleAccessToken: async () => ({ email: 'outsider@example.com', name: 'Outside User' })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const googleLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'outsider-token' })
    });
    const body = await googleLogin.json();

    assert.equal(googleLogin.status, 403);
    assert.equal(body.error, 'Tài khoản đang chờ admin phê duyệt');
    assert.equal(googleLogin.headers.get('set-cookie'), null);

    const users = await (await fetch(`${base}/api/users`, { headers: { cookie: adminCookie } })).json();
    const pending = users.find(user => user.username === 'outsider@example.com');
    assert.equal(pending.displayName, 'Outside User');
    assert.equal(pending.status, 'Pending');
    assert.deepEqual(pending.permissions, []);
  } finally {
    await app.close();
  }
});

test('admin can approve a pending Google access request and then Google login succeeds', async () => {
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 24),
    verifyGoogleAccessToken: async () => ({ email: 'approve-me@example.com', name: 'Approve Me' })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const firstLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'pending-approval-token' })
    });
    assert.equal(firstLogin.status, 403);

    const users = await (await fetch(`${base}/api/users`, { headers: { cookie: adminCookie } })).json();
    const pending = users.find(user => user.username === 'approve-me@example.com');

    const approved = await fetch(`${base}/api/users/${pending.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        displayName: pending.displayName,
        role: 'Manager',
        status: 'Active',
        permissions: ['users.manage']
      })
    });
    assert.equal(approved.status, 200);

    const secondLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'approved-token' })
    });
    const body = await secondLogin.json();

    assert.equal(secondLogin.status, 200);
    assert.equal(body.user.username, 'approve-me@example.com');
    assert.equal(body.user.role, 'Manager');
    assert.deepEqual(body.user.permissions, ['users.manage']);
    assert.match(secondLogin.headers.get('set-cookie'), /^session=/);
  } finally {
    await app.close();
  }
});

test('approving a pending Google request activates the same user record and sends approval notification', async () => {
  const invites = [];
  const notifications = [];
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 25),
    verifyGoogleAccessToken: async () => ({ email: 'approve-invite@example.com', name: 'Approve Invite' }),
    inviteUserByEmail: async (email, options) => {
      invites.push({ email, options });
      return { id: 'supabase-approved-user', email };
    },
    notifyUserApproved: async (user, options) => {
      notifications.push({ user, options });
    },
    appUrl: 'https://manager.example.com'
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const firstLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'pending-approval-token' })
    });
    assert.equal(firstLogin.status, 403);

    const users = await (await fetch(`${base}/api/users`, { headers: { cookie: adminCookie } })).json();
    const pending = users.find(user => user.username === 'approve-invite@example.com');
    assert.equal(pending.status, 'Pending');

    const approved = await fetch(`${base}/api/users/${pending.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        displayName: pending.displayName,
        role: 'Manager',
        status: 'Active',
        permissions: ['users.manage']
      })
    });
    const approvedBody = await approved.json();

    assert.equal(approved.status, 200);
    assert.equal(approvedBody.inviteSent, false);
    assert.equal(approvedBody.user.id, pending.id);
    assert.equal(approvedBody.user.status, 'Active');
    assert.deepEqual(invites, []);
    assert.equal(approvedBody.approvalEmailRequired, true);
    assert.equal(approvedBody.approvalEmailSent, true);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].user.id, pending.id);
    assert.equal(notifications[0].user.username, 'approve-invite@example.com');
    assert.deepEqual(notifications[0].options, {
      appUrl: 'https://manager.example.com/',
      role: 'Manager',
      permissions: ['users.manage']
    });

    const secondLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'approved-token' })
    });
    const body = await secondLogin.json();

    assert.equal(secondLogin.status, 200);
    assert.equal(body.user.id, pending.id);
    assert.equal(body.user.status, 'Active');
  } finally {
    await app.close();
  }
});

test('Google login rejects inactive local users', async () => {
  const app = createApp({
    dbPath: ':memory:',
    encryptionKey: Buffer.alloc(32, 14),
    verifyGoogleAccessToken: async () => ({ email: 'inactive@example.com' })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const adminLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const created = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'inactive@example.com',
        password: 'local-password',
        displayName: 'Inactive User',
        role: 'Viewer',
        status: 'Inactive',
        permissions: []
      })
    });
    assert.equal(created.status, 201);

    const googleLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'inactive-token' })
    });
    const body = await googleLogin.json();

    assert.equal(googleLogin.status, 403);
    assert.equal(body.error, 'User is inactive');
    assert.equal(googleLogin.headers.get('set-cookie'), null);
  } finally {
    await app.close();
  }
});
