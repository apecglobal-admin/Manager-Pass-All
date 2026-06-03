import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovalEmail, createApp } from '../src/server.js';

test('server Supabase clients provide a WebSocket transport for packaged Electron', () => {
  const previousEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const calls = [];

  try {
    assert.doesNotThrow(() => createApp({
      createSupabaseClient: (url, key, options = {}) => {
        calls.push({ url, key, options });
        if (typeof options.realtime?.transport !== 'function') {
          throw new Error('Node.js 20 detected without native WebSocket support.');
        }
        return {
          auth: {
            signInWithPassword: async () => ({ data: {}, error: null }),
            getUser: async () => ({ data: {}, error: null })
          }
        };
      }
    }));

    assert.equal(calls.length, 4);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Supabase login, create project, create entry, and reveal password through API', async () => {
  const repos = createMemoryRepos();
  const app = createApp({
    repos,
    verifyGoogleAccessToken: async token => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: token === 'admin-token' ? 'admin@example.com' : '',
      name: 'Admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'admin-token' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const project = await (await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Apec Portal', description: '', status: 'Active' })
    })).json();
    assert.equal(project.name, 'Apec Portal');

    const entry = await (await fetch(`${base}/api/entries`, {
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
    })).json();

    const reveal = await fetch(`${base}/api/entries/${entry.id}/reveal-password`, {
      method: 'POST',
      headers: { cookie }
    });
    assert.equal((await reveal.json()).password, 'portal-secret');
  } finally {
    await app.close();
  }
});

test('password login uses Supabase Auth and creates app session', async () => {
  const app = createApp({
    repos: createMemoryRepos(),
    verifyGoogleAccessToken: null,
    authenticateWithPassword: async ({ username, password }) => {
      assert.equal(username, 'admin@example.com');
      assert.equal(password, 'admin-pass');
      return {
        accessToken: 'password-session-token',
        authUserId: 'auth-admin',
        email: 'admin@example.com',
        name: 'Admin'
      };
    }
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@example.com', password: 'admin-pass' })
    });
    const body = await login.json();

    assert.equal(login.status, 200);
    assert.equal(body.user.username, 'admin@example.com');
    assert.equal(login.headers.get('set-cookie').includes('session='), true);
  } finally {
    await app.close();
  }
});

test('admin can delete an unused entry type but not one used by entries', async () => {
  const app = createApp({
    repos: createMemoryRepos({
      entries: [{ id: 'entry-used', projectId: 'project-1', typeId: 'type-web', name: 'Used Web' }]
    }),
    verifyGoogleAccessToken: async () => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: 'admin@example.com',
      name: 'Admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'admin-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const usedDelete = await fetch(`${base}/api/entry-types/type-web`, {
      method: 'DELETE',
      headers: { cookie }
    });
    assert.equal(usedDelete.status, 400);
    assert.match((await usedDelete.json()).error, /being used/i);

    const unusedDelete = await fetch(`${base}/api/entry-types/type-other`, {
      method: 'DELETE',
      headers: { cookie }
    });
    assert.equal(unusedDelete.status, 200);

    const types = await (await fetch(`${base}/api/entry-types`, { headers: { cookie } })).json();
    assert.equal(types.some(type => type.id === 'type-other'), false);
  } finally {
    await app.close();
  }
});

test('project members are authorized by project systems', async () => {
  const repos = createMemoryRepos({
    users: [{
      id: 'user-admin',
      username: 'admin@example.com',
      displayName: 'Admin',
      role: 'Admin',
      status: 'Active',
      permissions: ['users.manage'],
      preferences: {},
      createdAt: '2026-05-27T00:00:00.000Z'
    }, {
      id: 'user-member',
      username: 'member@example.com',
      displayName: 'Member',
      role: 'Viewer',
      status: 'Active',
      permissions: [],
      authUserId: 'auth-member'
    }],
    projects: [{ id: 'project-apecspace', name: 'ApecSpace', status: 'Active' }],
    systems: [
      { id: 'system-web', projectId: 'project-apecspace', name: 'Website chính', type: 'Web', status: 'Active' },
      { id: 'system-cms', projectId: 'project-apecspace', name: 'CMS quản trị', type: 'CMS', status: 'Active' }
    ],
    memberships: [{ userId: 'user-member', projectId: 'project-apecspace' }],
    permissions: [{
      userId: 'user-member',
      projectId: 'project-apecspace',
      systemId: 'system-web',
      canViewEntry: true,
      canViewUrl: true,
      canViewUsername: true,
      canRevealPassword: false,
      canViewNotes: false,
      canCreate: false,
      canEdit: false,
      canDelete: false
    }],
    entries: [{
      id: 'entry-web',
      projectId: 'project-apecspace',
      systemId: 'system-web',
      typeId: 'type-web',
      name: 'Website account',
      username: 'web-user',
      url: 'https://web.example',
      notes: 'web note',
      tags: [],
      status: 'Active'
    }, {
      id: 'entry-cms',
      projectId: 'project-apecspace',
      systemId: 'system-cms',
      typeId: 'type-admin',
      name: 'CMS account',
      username: 'cms-user',
      url: 'https://cms.example',
      notes: 'cms note',
      tags: [],
      status: 'Active'
    }]
  });
  const app = createApp({
    repos,
    verifyGoogleAccessToken: async token => ({
      id: token === 'member-token' ? 'auth-member' : 'auth-admin',
      authUserId: token === 'member-token' ? 'auth-member' : 'auth-admin',
      email: token === 'member-token' ? 'member@example.com' : 'admin@example.com',
      name: token === 'member-token' ? 'Member' : 'Admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const memberLogin = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'member-token' })
    });
    const memberCookie = memberLogin.headers.get('set-cookie').split(';')[0];

    const systems = await (await fetch(`${base}/api/projects/project-apecspace/systems`, {
      headers: { cookie: memberCookie }
    })).json();
    assert.deepEqual(systems.map(system => system.name), ['Website chính']);

    const entries = await (await fetch(`${base}/api/projects/project-apecspace/entries`, {
      headers: { cookie: memberCookie }
    })).json();
    assert.deepEqual(entries.map(entry => entry.name), ['Website account']);
    assert.equal(entries[0].systemId, 'system-web');
    assert.equal(entries[0].username, 'web-user');
  } finally {
    await app.close();
  }
});

test('admin can reorder projects and project systems', async () => {
  const repos = createMemoryRepos({
    projects: [
      { id: 'project-a', name: 'ApecSpace', status: 'Active', sortOrder: 1 },
      { id: 'project-b', name: 'ApecTech', status: 'Active', sortOrder: 2 }
    ],
    systems: [
      { id: 'system-web', projectId: 'project-a', name: 'Website', type: 'Web', status: 'Active', sortOrder: 1 },
      { id: 'system-cms', projectId: 'project-a', name: 'CMS', type: 'CMS', status: 'Active', sortOrder: 2 }
    ]
  });
  const app = createApp({
    repos,
    verifyGoogleAccessToken: async () => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: 'admin@example.com',
      name: 'Admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'admin-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const projectReorder = await fetch(`${base}/api/projects/reorder`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ids: ['project-b', 'project-a'] })
    });
    assert.equal(projectReorder.status, 200);

    const systemReorder = await fetch(`${base}/api/projects/project-a/systems/reorder`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ids: ['system-cms', 'system-web'] })
    });
    assert.equal(systemReorder.status, 200);

    assert.deepEqual((await repos.projects.list()).map(project => project.id), ['project-b', 'project-a']);
    assert.deepEqual((await repos.projectSystems.listForProject('project-a')).map(system => system.id), ['system-cms', 'system-web']);
  } finally {
    await app.close();
  }
});

test('default Supabase invite service sends packaged app download link from user creation', async () => {
  const previousEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const inviteCalls = [];
  const repos = createMemoryRepos();
  const app = createApp({
    repos,
    appDownloadUrl: 'https://example.com/download',
    verifyGoogleAccessToken: async () => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: 'admin@example.com',
      name: 'Admin'
    }),
    authenticateWithPassword: null,
    createSupabaseClient: (url, key, options = {}) => ({
      auth: {
        signInWithOtp: async payload => {
          inviteCalls.push({ url, key, options, payload });
          return { data: { user: { email: payload.email } }, error: null };
        }
      }
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'admin-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const created = await fetch(`${base}/api/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        username: 'member@example.com',
        displayName: 'Member',
        role: 'Viewer',
        status: 'Invited',
        permissions: []
      })
    });
    const body = await created.json();

    assert.equal(created.status, 201);
    assert.equal(body.inviteSent, true);
    assert.equal(inviteCalls.length, 1);
    assert.equal(inviteCalls[0].url, 'https://example.supabase.co');
    assert.equal(inviteCalls[0].key, 'anon-key');
    assert.equal(inviteCalls[0].payload.email, 'member@example.com');
    assert.equal(inviteCalls[0].payload.options.emailRedirectTo, 'https://example.com/download/');
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('approval email template points users to packaged app download', () => {
  const email = buildApprovalEmail({
    id: 'user-member',
    username: 'member@example.com',
    displayName: 'Member',
    role: 'Viewer',
    permissions: []
  }, {
    appUrl: 'http://localhost:3000/',
    appDownloadUrl: 'https://example.com/download/'
  });

  assert.match(email.text, /https:\/\/example\.com\/download\//);
  assert.match(email.html, /https:\/\/example\.com\/download\//);
  assert.doesNotMatch(email.text, /http:\/\/localhost:3000/);
  assert.doesNotMatch(email.html, /http:\/\/localhost:3000/);
});

test('default auth delete service calls Edge Function with admin access token when packaged app has no service role', async () => {
  const previousEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const functionCalls = [];
  const repos = createMemoryRepos({
    users: [
      {
        id: 'user-admin',
        username: 'admin@example.com',
        displayName: 'Admin',
        role: 'Admin',
        status: 'Active',
        permissions: ['users.manage']
      },
      {
        id: 'user-member',
        username: 'member@example.com',
        displayName: 'Member',
        role: 'Viewer',
        status: 'Invited',
        permissions: []
      }
    ]
  });
  const app = createApp({
    repos,
    authenticateWithPassword: null,
    authDeleteFetch: async (url, options) => {
      functionCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, authDeleted: true })
      };
    },
    verifyGoogleAccessToken: async token => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: token === 'admin-token' ? 'admin@example.com' : '',
      name: 'Admin'
    }),
    createSupabaseClient: () => ({
      auth: {
        signInWithOtp: async () => ({ data: {}, error: null })
      }
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'admin-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const deleted = await fetch(`${base}/api/users/user-member`, {
      method: 'DELETE',
      headers: { cookie }
    });
    const body = await deleted.json();

    assert.equal(deleted.status, 200);
    assert.equal(body.authDeleted, true);
    assert.equal(functionCalls.length, 1);
    assert.equal(functionCalls[0].url, 'https://example.supabase.co/functions/v1/delete-auth-user');
    assert.equal(functionCalls[0].options.headers.authorization, 'Bearer admin-token');
    assert.equal(functionCalls[0].options.headers.apikey, 'anon-key');
    assert.deepEqual(JSON.parse(functionCalls[0].options.body), { email: 'member@example.com' });
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('default auth delete service falls back to Supabase RPC when Edge Function is not deployed', async () => {
  const previousEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const rpcCalls = [];
  const repos = createMemoryRepos({
    users: [
      {
        id: 'user-admin',
        username: 'admin@example.com',
        displayName: 'Admin',
        role: 'Admin',
        status: 'Active',
        permissions: ['users.manage']
      },
      {
        id: 'user-member',
        username: 'member@example.com',
        displayName: 'Member',
        role: 'Viewer',
        status: 'Invited',
        permissions: []
      }
    ]
  });
  const app = createApp({
    repos,
    authenticateWithPassword: null,
    authDeleteFetch: async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Function not found' })
    }),
    verifyGoogleAccessToken: async token => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: token === 'admin-token' ? 'admin@example.com' : '',
      name: 'Admin'
    }),
    createSupabaseClient: (url, key, options = {}) => ({
      auth: {
        signInWithOtp: async () => ({ data: {}, error: null })
      },
      rpc: async (name, params) => {
        rpcCalls.push({ url, key, options, name, params });
        return { data: true, error: null };
      }
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'admin-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const deleted = await fetch(`${base}/api/users/user-member`, {
      method: 'DELETE',
      headers: { cookie }
    });
    const body = await deleted.json();

    assert.equal(deleted.status, 200);
    assert.equal(body.authDeleted, true);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'delete_auth_user_by_email');
    assert.deepEqual(rpcCalls[0].params, { target_email: 'member@example.com' });
    assert.equal(rpcCalls[0].options.global.headers.Authorization, 'Bearer admin-token');
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('signed session cookie survives app restart', async () => {
  const repos = createMemoryRepos();
  const app = createApp({
    repos,
    verifyGoogleAccessToken: async () => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: 'admin@example.com',
      name: 'Admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'admin-token' })
    });
    cookie = login.headers.get('set-cookie').split(';')[0];
  } finally {
    await app.close();
  }

  const restarted = createApp({ repos, verifyGoogleAccessToken: null });
  const restartedServer = await restarted.listen(0);
  const restartedBase = `http://127.0.0.1:${restartedServer.address().port}`;

  try {
    const session = await fetch(`${restartedBase}/api/session`, { headers: { cookie } });
    const body = await session.json();

    assert.equal(session.status, 200);
    assert.equal(body.authenticated, true);
    assert.equal(body.user.username, 'admin@example.com');
  } finally {
    await restarted.close();
  }
});

test('current user theme preferences persist in session', async () => {
  const repos = createMemoryRepos();
  const app = createApp({
    repos,
    authenticateWithPassword: async () => ({
      email: 'admin@example.com',
      authUserId: 'auth-admin',
      accessToken: 'token-admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@example.com', password: 'pw' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const saved = await fetch(`${base}/api/me/preferences`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        theme: 'mix',
        mixTheme: { accent: '#22c55e', accent2: '#ef4444' }
      })
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.deepEqual(savedBody.preferences, {
      theme: 'mix',
      mixTheme: { accent: '#22c55e', accent2: '#ef4444' }
    });

    const session = await fetch(`${base}/api/session`, { headers: { cookie } });
    const sessionBody = await session.json();
    assert.equal(sessionBody.user.preferences.theme, 'mix');
    assert.equal(sessionBody.user.preferences.mixTheme.accent, '#22c55e');
  } finally {
    await app.close();
  }
});

test('login session cookie stays small when Supabase access token is large', async () => {
  const largeAccessToken = `token.${'x'.repeat(5000)}.sig`;
  const app = createApp({
    repos: createMemoryRepos(),
    verifyGoogleAccessToken: async () => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: 'admin@example.com',
      name: 'Admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: largeAccessToken })
    });
    const cookie = login.headers.get('set-cookie');

    assert.equal(login.status, 200);
    assert.ok(cookie.length < 1024, `session cookie length ${cookie.length} should stay safely below browser limits`);
  } finally {
    await app.close();
  }
});

test('backup endpoint returns Supabase JSON export without local file paths', async () => {
  const repos = createMemoryRepos();
  const app = createApp({
    repos,
    verifyGoogleAccessToken: async () => ({
      id: 'auth-admin',
      authUserId: 'auth-admin',
      email: 'admin@example.com',
      name: 'Admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'admin-token' })
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];

    await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Backup Project', description: '', status: 'Active' })
    });

    const backup = await fetch(`${base}/api/backups/save-json`, {
      method: 'POST',
      headers: { cookie }
    });
    const body = await backup.json();

    assert.equal(backup.status, 201);
    assert.equal(body.counts.users, 1);
    assert.equal(body.counts.projects, 1);
    assert.equal('latestPath' in body, false);
    assert.equal('timestampedPath' in body, false);
  } finally {
    await app.close();
  }
});

test('first Supabase login bootstraps admin session when app users table is empty', async () => {
  const repos = createMemoryRepos({ users: [] });
  const app = createApp({
    repos,
    verifyGoogleAccessToken: async () => ({
      id: 'auth-first',
      authUserId: 'auth-first',
      email: 'first@example.com',
      name: 'First Admin'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'first-token' })
    });
    const body = await login.json();

    assert.equal(login.status, 200);
    assert.equal(body.user.username, 'first@example.com');
    assert.equal(body.user.role, 'Admin');
    assert.equal(body.user.status, 'Active');
  } finally {
    await app.close();
  }
});

test('Google access request uses Supabase user token scoped repositories', async () => {
  const deniedRepos = createMemoryRepos({ users: [] });
  deniedRepos.users.activateForGoogleLogin = async () => {
    throw new Error('RLS denied');
  };
  const tokenRepos = createMemoryRepos({ users: [] });
  let tokenUsed = '';

  const app = createApp({
    repos: deniedRepos,
    createReposForAccessToken: accessToken => {
      tokenUsed = accessToken;
      return tokenRepos;
    },
    verifyGoogleAccessToken: async token => ({
      id: 'auth-scoped',
      authUserId: 'auth-scoped',
      email: token === 'user-token' ? 'scoped@example.com' : '',
      name: 'Scoped User'
    })
  });
  const server = await app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: 'user-token' })
    });
    const body = await login.json();

    assert.equal(login.status, 200);
    assert.equal(tokenUsed, 'user-token');
    assert.equal(body.user.username, 'scoped@example.com');
  } finally {
    await app.close();
  }
});

function createMemoryRepos(overrides = {}) {
  const rows = {
    users: overrides.users || [{
      id: 'user-admin',
      username: 'admin@example.com',
      displayName: 'Admin',
      role: 'Admin',
      status: 'Active',
      permissions: ['users.manage'],
      createdAt: '2026-05-27T00:00:00.000Z'
    }],
    projects: overrides.projects || [],
    systems: overrides.systems || [],
    entries: overrides.entries || [],
    entryTypes: [
      { id: 'type-web', name: 'Web', slug: 'web', sortOrder: 1, isActive: true },
      { id: 'type-admin', name: 'Admin', slug: 'admin', sortOrder: 2, isActive: true },
      { id: 'type-other', name: 'Other', slug: 'other', sortOrder: 10, isActive: true }
    ],
    memberships: overrides.memberships || [],
    permissions: overrides.permissions || [],
    activity: [],
    settings: { autoLockMinutes: 15 }
  };

  const repos = {
    users: {
      async activateForGoogleLogin(email, verified) {
        const user = rows.users.find(item => item.username.toLowerCase() === email.toLowerCase());
        if (!user) return null;
        user.authUserId = verified.authUserId;
        return user;
      },
      async requestGoogleAccess(input) {
        const bootstrapAdmin = rows.users.length === 0;
        const user = {
          id: `user-${rows.users.length + 1}`,
          authUserId: input.authUserId || null,
          username: input.username,
          displayName: input.displayName || input.username,
          role: bootstrapAdmin ? 'Admin' : 'Viewer',
          status: bootstrapAdmin ? 'Active' : 'Pending',
          permissions: bootstrapAdmin ? ['users.manage'] : [],
          preferences: {}
        };
        rows.users.push(user);
        return user;
      },
      async list() {
        return rows.users;
      },
      async get(id) {
        return rows.users.find(user => user.id === id) || null;
      },
      async create(input) {
        const user = {
          id: `user-${rows.users.length + 1}`,
          username: input.username,
          displayName: input.displayName || input.username,
          role: input.role || 'Viewer',
          status: input.status || 'Active',
          permissions: input.permissions || [],
          preferences: input.preferences || {}
        };
        rows.users.push(user);
        return user;
      },
      async markInvited(id) {
        const user = rows.users.find(item => item.id === id);
        user.status = 'Invited';
        return user;
      },
      async update(id, input) {
        const user = rows.users.find(item => item.id === id);
        Object.assign(user, input);
        return user;
      },
      async updatePreferences(id, preferences) {
        const user = rows.users.find(item => item.id === id);
        user.preferences = { ...(user.preferences || {}), ...preferences };
        return user;
      },
      async delete(id) {
        rows.users = rows.users.filter(user => user.id !== id);
      }
    },
    entryTypes: {
      async list() {
        return rows.entryTypes;
      },
      async get(id) {
        return rows.entryTypes.find(type => type.id === id) || null;
      },
      async findByName(name) {
        return rows.entryTypes.find(type => type.name.toLowerCase() === String(name).toLowerCase()) || null;
      },
      async create(input) {
        const type = { id: `type-${rows.entryTypes.length + 1}`, name: input.name, slug: input.name.toLowerCase(), isActive: true };
        rows.entryTypes.push(type);
        return type;
      },
      async update(id, input) {
        const type = rows.entryTypes.find(item => item.id === id);
        Object.assign(type, input);
        return type;
      },
      async delete(id) {
        if (rows.entries.some(entry => String(entry.typeId || entry.entryTypeId) === String(id))) {
          throw new Error('Entry type is being used by entries');
        }
        rows.entryTypes = rows.entryTypes.filter(type => String(type.id) !== String(id));
      }
    },
    projects: {
      async list() {
        return rows.projects;
      },
      async listByIds(ids) {
        return rows.projects.filter(project => ids.includes(project.id));
      },
      async listForUser() {
        return rows.projects;
      },
      async create(input) {
        const project = {
          id: `project-${rows.projects.length + 1}`,
          name: input.name,
          description: input.description || '',
          status: input.status || 'Active',
          sortOrder: input.sortOrder || rows.projects.length + 1
        };
        rows.projects.push(project);
        return project;
      },
      async update(id, input) {
        const project = rows.projects.find(item => item.id === id);
        Object.assign(project, input);
        return project;
      },
      async delete(id) {
        rows.projects = rows.projects.filter(project => project.id !== id);
      },
      async reorder(ids) {
        ids.forEach((id, index) => {
          const project = rows.projects.find(item => String(item.id) === String(id));
          if (project) project.sortOrder = index + 1;
        });
        rows.projects.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
      }
    },
    projectSystems: {
      async listForProject(projectId) {
        return rows.systems.filter(system => String(system.projectId) === String(projectId));
      },
      async get(id) {
        return rows.systems.find(system => String(system.id) === String(id)) || null;
      },
      async create(input) {
        const system = {
          id: `system-${rows.systems.length + 1}`,
          projectId: input.projectId,
          name: input.name,
          type: input.type || 'Web',
          description: input.description || '',
          status: input.status || 'Active',
          sortOrder: input.sortOrder || rows.systems.filter(system => String(system.projectId) === String(input.projectId)).length + 1
        };
        rows.systems.push(system);
        return system;
      },
      async update(id, input) {
        const system = rows.systems.find(item => String(item.id) === String(id));
        Object.assign(system, input);
        return system;
      },
      async delete(id) {
        if (rows.entries.some(entry => String(entry.systemId || entry.projectSystemId) === String(id))) {
          throw new Error('System is being used by entries');
        }
        rows.systems = rows.systems.filter(system => String(system.id) !== String(id));
      },
      async reorder(projectId, ids) {
        ids.forEach((id, index) => {
          const system = rows.systems.find(item => String(item.projectId) === String(projectId) && String(item.id) === String(id));
          if (system) system.sortOrder = index + 1;
        });
        rows.systems.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
      }
    },
    entries: {
      async listByProject(projectId) {
        return rows.entries.filter(entry => entry.projectId === projectId);
      },
      async search(query) {
        return rows.entries.filter(entry => entry.name.toLowerCase().includes(String(query).toLowerCase()));
      },
      async get(id) {
        return rows.entries.find(entry => entry.id === id) || null;
      },
      async getRaw(id) {
        return rows.entries.find(entry => entry.id === id) || null;
      },
      async create(input) {
        const entry = {
          id: `entry-${rows.entries.length + 1}`,
          projectId: input.projectId,
          systemId: input.systemId || input.projectSystemId || null,
          typeId: input.typeId,
          name: input.name,
          type: input.type || 'Other',
          environment: input.environment || 'Production',
          url: input.url || '',
          username: input.username || '',
          password: input.password || '',
          passwordMasked: true,
          notes: input.notes || '',
          tags: input.tags || [],
          status: input.status || 'Active',
          permissions: {
            canViewEntry: true,
            canViewUrl: true,
            canViewUsername: true,
            canRevealPassword: true,
            canViewNotes: true,
            canCreate: true,
            canEdit: true,
            canDelete: true
          }
        };
        rows.entries.push(entry);
        return entry;
      },
      async update(id, input) {
        const entry = rows.entries.find(item => item.id === id);
        Object.assign(entry, input);
        return entry;
      },
      async delete(id) {
        rows.entries = rows.entries.filter(entry => entry.id !== id);
      },
      async revealPassword(id) {
        return rows.entries.find(entry => entry.id === id)?.password || '';
      },
      async exportForUser(_user, { includePasswords = false } = {}) {
        return rows.entries.map(entry => ({
          projectId: entry.projectId,
          name: entry.name,
          type: entry.type,
          environment: entry.environment,
          url: entry.url,
          username: entry.username,
          ...(includePasswords ? { password: entry.password } : {}),
          notes: entry.notes,
          tags: entry.tags,
          status: entry.status
        }));
      }
    },
    projectMemberships: {
      async listForUser(userId) {
        return rows.memberships.filter(item => item.userId === userId).map(item => item.projectId);
      },
      async listForProject(projectId) {
        return rows.memberships.filter(item => item.projectId === projectId).map(item => item.userId);
      },
      async has(userId, projectId) {
        return rows.memberships.some(item => item.userId === userId && item.projectId === projectId);
      },
      async replaceForUser(userId, projectIds) {
        rows.memberships = rows.memberships.filter(item => item.userId !== userId);
        rows.memberships.push(...projectIds.map(projectId => ({ userId, projectId })));
      },
      async replaceForProject(projectId, userIds) {
        rows.memberships = rows.memberships.filter(item => item.projectId !== projectId);
        rows.memberships.push(...userIds.map(userId => ({ userId, projectId })));
      }
    },
    detailedPermissions: {
      async get(userId, projectId, entryTypeId) {
        return rows.permissions.find(item => item.userId === userId && item.projectId === projectId && item.entryTypeId === entryTypeId) || null;
      },
      async getBySystem(userId, projectId, systemId) {
        return rows.permissions.find(item => item.userId === userId && item.projectId === projectId && item.systemId === systemId) || null;
      },
      async listForUser(userId) {
        return rows.permissions.filter(item => item.userId === userId);
      },
      async listForProject(projectId) {
        return rows.permissions.filter(item => item.projectId === projectId);
      },
      async replaceForUser(userId, permissions) {
        rows.permissions = rows.permissions.filter(item => item.userId !== userId);
        rows.permissions.push(...permissions.map(permission => ({ ...permission, userId })));
      },
      async replaceForProject(projectId, permissions) {
        rows.permissions = rows.permissions.filter(item => item.projectId !== projectId);
        rows.permissions.push(...permissions.map(permission => ({ ...permission, projectId })));
      }
    },
    activity: {
      async log(action, details = {}) {
        rows.activity.push({ action, ...details });
      },
      async list() {
        return rows.activity;
      }
    },
    settings: {
      async getAll() {
        return rows.settings;
      },
      async update(input) {
        Object.assign(rows.settings, input);
        return rows.settings;
      }
    },
    export: {
      async backupJson({ includePasswords = false } = {}) {
        return {
          exportedAt: new Date().toISOString(),
          counts: {
            users: rows.users.length,
            projects: rows.projects.length,
            entries: rows.entries.length,
            settings: Object.keys(rows.settings).length
          },
          users: rows.users,
          projects: rows.projects,
          entries: await repos.entries.exportForUser(rows.users[0], { includePasswords }),
          settings: rows.settings
        };
      }
    }
  };
  return repos;
}
