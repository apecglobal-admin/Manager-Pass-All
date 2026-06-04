import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { APP_DOWNLOAD_URL, APP_PORT, APP_URL, DATA_DIR, getEncryptionKey, getPublicSupabaseConfig, getSupabaseAdminConfig } from './config.js';
import { createSupabaseRepositories } from './supabase-repositories.js';
import { createRouter } from './routes.js';
import { serveStatic } from './http-utils.js';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

export function createVercelHandler(options = {}) {
  return createRequestHandler({
    ...options,
    statelessSessions: true,
    sessionStore: null
  });
}

export function createApp(options = {}) {
  const handler = createRequestHandler(options);
  const server = createServer(handler);

  return {
    listen(port = APP_PORT) {
      return new Promise(resolve => {
        server.listen(port, '127.0.0.1', () => resolve(server));
      });
    },
    close() {
      return new Promise(resolve => {
        server.close(() => {
          resolve();
        });
      });
    }
  };
}

export function createRequestHandler({
  encryptionKey = getEncryptionKey(),
  authenticateWithPassword,
  verifyGoogleAccessToken,
  inviteUserByEmail,
  notifyUserApproved,
  deleteAuthUserByEmail,
  appUrl = APP_URL,
  appDownloadUrl = APP_DOWNLOAD_URL,
  repos,
  supabase,
  createSupabaseClient = createClient,
  authDeleteFetch = fetch,
  createReposForAccessToken,
  statelessSessions = false,
  sessionStore = statelessSessions ? null : createFileSessionStore()
} = {}) {
  const appSupabase = supabase || (repos ? null : createServerSupabaseClient(createSupabaseClient));
  const appRepos = repos || createSupabaseRepositories({ supabase: appSupabase, encryptionKey });
  const scopedReposCache = new Map();
  const scopedReposForAccessToken = createReposForAccessToken || (repos || supabase
    ? null
    : accessToken => {
        if (!accessToken) return appRepos;
        if (!scopedReposCache.has(accessToken)) {
          scopedReposCache.set(accessToken, createSupabaseRepositories({
            supabase: createServerSupabaseClient(createSupabaseClient, { accessToken }),
            encryptionKey
          }));
        }
        return scopedReposCache.get(accessToken);
      });
  const appInviteUserByEmail = inviteUserByEmail === undefined
    ? createSupabaseInviteService(createSupabaseClient, { appDownloadUrl })
    : inviteUserByEmail;
  const appNotifyUserApproved = notifyUserApproved === undefined
    ? createApprovalNotificationService({ appDownloadUrl })
    : notifyUserApproved;
  const appDeleteAuthUserByEmail = deleteAuthUserByEmail === undefined
    ? createSupabaseAuthDeleteService(createSupabaseClient, { fetchImpl: authDeleteFetch })
    : deleteAuthUserByEmail;
  const route = createRouter(appRepos, {
    authenticateWithPassword: authenticateWithPassword === undefined
      ? createSupabasePasswordAuthenticator(createSupabaseClient)
      : authenticateWithPassword,
    verifyGoogleAccessToken: verifyGoogleAccessToken === undefined
      ? createSupabaseTokenVerifier(createSupabaseClient)
      : verifyGoogleAccessToken,
    inviteUserByEmail: appInviteUserByEmail,
    notifyUserApproved: appNotifyUserApproved,
    deleteAuthUserByEmail: appDeleteAuthUserByEmail,
    appUrl,
    appDownloadUrl,
    sessionSecret: encryptionKey.toString('base64'),
    repos: appRepos,
    createReposForAccessToken: scopedReposForAccessToken,
    sessionStore,
    statelessSessions
  });
  return async function handleRequest(req, res) {
    applyCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/runtime-config.js') {
      const config = getPublicSupabaseConfig();
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(`window.APECGLOBAL_CONFIG = ${JSON.stringify(config)};`);
      return;
    }
    if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/vendor/supabase.js') {
      const vendorPath = join(__dirname, '..', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
      if (!existsSync(vendorPath)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Supabase client bundle is not installed. Run npm install.');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      createReadStream(vendorPath).pipe(res);
      return;
    }
    const handled = await route(req, res);
    if (handled !== false) return;
    if (serveStatic(req, res, publicDir)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  };
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!origin || !allowedCorsOrigins().has(origin)) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization,apikey');
  res.setHeader('vary', 'Origin');
}

function allowedCorsOrigins() {
  const origins = new Set(['capacitor://localhost', 'http://127.0.0.1:3000', 'http://localhost', 'https://localhost']);
  addOrigin(origins, APP_URL);
  for (const origin of String(process.env.APP_ALLOWED_ORIGINS || '').split(',')) {
    addOrigin(origins, origin);
  }
  return origins;
}

function addOrigin(origins, value) {
  const raw = String(value || '').trim();
  if (!raw) return;
  try {
    origins.add(new URL(raw).origin);
  } catch {
    origins.add(raw.replace(/\/$/, ''));
  }
}

function createFileSessionStore() {
  const sessionDir = join(DATA_DIR, 'sessions');
  return {
    get(id) {
      try {
        const file = sessionFilePath(sessionDir, id);
        if (!file || !existsSync(file)) return null;
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
    set(id, session) {
      const file = sessionFilePath(sessionDir, id);
      if (!file) return;
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(file, JSON.stringify(session), 'utf8');
    },
    delete(id) {
      const file = sessionFilePath(sessionDir, id);
      if (!file) return;
      rmSync(file, { force: true });
    }
  };
}

function sessionFilePath(sessionDir, id) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id || ''))) return null;
  return join(sessionDir, `${id}.json`);
}

function createServerSupabaseClient(createSupabaseClient, { accessToken } = {}) {
  const adminConfig = getSupabaseAdminConfig();
  const publicConfig = getPublicSupabaseConfig();
  const supabaseUrl = adminConfig.supabaseUrl || publicConfig.supabaseUrl;
  const supabaseKey = adminConfig.serviceRoleKey || publicConfig.supabaseAnonKey;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY.');
  }
  const options = createSupabaseClientOptions();
  if (accessToken && !adminConfig.serviceRoleKey) {
    options.global = { headers: { Authorization: `Bearer ${accessToken}` } };
  }
  return createSupabaseClient(supabaseUrl, supabaseKey, {
    ...options
  });
}

function createSupabasePasswordAuthenticator(createSupabaseClient = createClient) {
  const config = getPublicSupabaseConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey, {
    ...createSupabaseClientOptions()
  });
  return async ({ username, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(username || '').trim(),
      password: String(password || '')
    });
    if (error) throw error;
    return {
      accessToken: data.session?.access_token || '',
      refreshToken: data.session?.refresh_token || '',
      id: data.user?.id || '',
      authUserId: data.user?.id || '',
      email: data.user?.email || '',
      name: data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || ''
    };
  };
}

function createSupabaseTokenVerifier(createSupabaseClient = createClient) {
  const config = getPublicSupabaseConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey, {
    ...createSupabaseClientOptions()
  });
  return async accessToken => {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) throw error;
    return {
      id: data.user?.id || '',
      authUserId: data.user?.id || '',
      email: data.user?.email || '',
      name: data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || ''
    };
  };
}

export function createSupabaseInviteService(createSupabaseClient = createClient, { appDownloadUrl = APP_DOWNLOAD_URL } = {}) {
  const adminConfig = getSupabaseAdminConfig();
  if (adminConfig.supabaseUrl && adminConfig.serviceRoleKey) {
    const supabase = createSupabaseClient(adminConfig.supabaseUrl, adminConfig.serviceRoleKey, {
      ...createSupabaseClientOptions()
    });
    return async (email, options) => {
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, options);
      if (error) throw error;
      return data.user;
    };
  }

  const publicConfig = getPublicSupabaseConfig();
  if (!publicConfig.supabaseUrl || !publicConfig.supabaseAnonKey) return null;
  const supabase = createSupabaseClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
    ...createSupabaseClientOptions()
  });
  return async (email, options = {}) => {
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: options.redirectTo || normalizeDownloadUrl(appDownloadUrl),
        data: options.data || {}
      }
    });
    if (error) throw error;
    return data.user || { email };
  };
}

function createSupabaseAuthDeleteService(createSupabaseClient = createClient, { fetchImpl = fetch } = {}) {
  const config = getSupabaseAdminConfig();
  if (config.supabaseUrl && config.serviceRoleKey) {
    const supabase = createSupabaseClient(config.supabaseUrl, config.serviceRoleKey, {
      ...createSupabaseClientOptions()
    });
    return async email => {
      const normalized = String(email || '').trim().toLowerCase();
      if (!normalized) return false;

      for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;
        const users = data?.users || [];
        const user = users.find(item => String(item.email || '').trim().toLowerCase() === normalized);
        if (user) {
          const deleted = await supabase.auth.admin.deleteUser(user.id);
          if (deleted.error) throw deleted.error;
          return true;
        }
        if (users.length < 100) return false;
      }

      throw new Error('Supabase auth user lookup exceeded 100 pages');
    };
  }

  const publicConfig = getPublicSupabaseConfig();
  if (!publicConfig.supabaseUrl || !publicConfig.supabaseAnonKey) return null;
  return async (email, { accessToken } = {}) => {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return false;
    if (!accessToken) throw new Error('Supabase Auth delete requires an admin session token');

    const functionUrl = `${publicConfig.supabaseUrl.replace(/\/$/, '')}/functions/v1/delete-auth-user`;
    let response;
    try {
      response = await fetchImpl(functionUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          apikey: publicConfig.supabaseAnonKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ email: normalized })
      });
    } catch {
      return await deleteAuthUserByRpc(createSupabaseClient, publicConfig, accessToken, normalized);
    }
    let body = await readJsonResponse(response);
    if (!response.ok) {
      if (response.status === 404) {
        return await deleteAuthUserByRpc(createSupabaseClient, publicConfig, accessToken, normalized);
      }
      throw new Error(body.error || `Supabase Auth delete failed: ${response.status}`);
    }
    return Boolean(body.authDeleted ?? body.ok);
  };
}

async function deleteAuthUserByRpc(createSupabaseClient, publicConfig, accessToken, email) {
  const supabase = createSupabaseClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
    ...createSupabaseClientOptions(),
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
  const { data, error } = await supabase.rpc('delete_auth_user_by_email', { target_email: email });
  if (error) throw error;
  return Boolean(data);
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function createApprovalNotificationService({ appDownloadUrl = APP_DOWNLOAD_URL } = {}) {
  const webhookUrl = process.env.APPROVAL_EMAIL_WEBHOOK_URL || '';
  const webhookToken = process.env.APPROVAL_EMAIL_WEBHOOK_TOKEN || '';
  if (webhookUrl) {
    return async (user, options) => {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(webhookToken ? { authorization: `Bearer ${webhookToken}` } : {})
        },
        body: JSON.stringify(buildApprovalEmail(user, { ...options, appDownloadUrl }))
      });
      if (!response.ok) throw new Error(`Approval notification failed: ${response.status}`);
    };
  }

  const resendApiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.APPROVAL_EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (resendApiKey && from) {
    return async (user, options) => {
      const email = buildApprovalEmail(user, { ...options, appDownloadUrl });
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html
        })
      });
      if (!response.ok) throw new Error(`Approval notification failed: ${response.status}`);
    };
  }

  return null;
}

export function buildApprovalEmail(user, options = {}) {
  const appDownloadUrl = normalizeDownloadUrl(options.appDownloadUrl || APP_DOWNLOAD_URL);
  const displayName = user.displayName || user.username;
  const subject = 'Tài khoản ApecGlobal Manager đã được duyệt';
  const text = [
    `Chào ${displayName},`,
    '',
    'Tài khoản của bạn đã được admin duyệt vào hệ thống ApecGlobal Manager.',
    `Vai trò: ${user.role}`,
    `Tải app ApecGlobal Manager tại: ${appDownloadUrl}`,
    '',
    'Email này chỉ là thông báo, không phải email invite Supabase.'
  ].join('\n');
  const html = `
    <p>Chào ${escapeHtml(displayName)},</p>
    <p>Tài khoản của bạn đã được admin duyệt vào hệ thống <strong>ApecGlobal Manager</strong>.</p>
    <p>Vai trò: <strong>${escapeHtml(user.role)}</strong></p>
    <p><a href="${escapeAttr(appDownloadUrl)}">Tải app ApecGlobal Manager</a></p>
    <p>Email này chỉ là thông báo, không phải email invite Supabase.</p>
  `;
  return {
    to: user.username,
    subject,
    text,
    html,
    appDownloadUrl,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      permissions: user.permissions
    }
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function normalizeDownloadUrl(value) {
  const raw = String(value || '').trim() || APP_DOWNLOAD_URL;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function createSupabaseClientOptions() {
  return {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp({
    verifyGoogleAccessToken: createSupabaseTokenVerifier(),
    inviteUserByEmail: createSupabaseInviteService(),
    notifyUserApproved: createApprovalNotificationService(),
    deleteAuthUserByEmail: createSupabaseAuthDeleteService()
  });
  const server = await app.listen(APP_PORT);
  console.log(`ApecGlobal Manager running at http://127.0.0.1:${server.address().port}`);
}
