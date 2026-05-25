import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync } from 'node:fs';
import { APP_PORT, APP_URL, DB_PATH, getEncryptionKey, getPublicSupabaseConfig, getSupabaseAdminConfig } from './config.js';
import { createDatabase } from './db.js';
import { createRepositories } from './repositories.js';
import { createRouter } from './routes.js';
import { serveStatic } from './http-utils.js';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseDataStore } from './supabase-data-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

export function createApp({
  dbPath = DB_PATH,
  encryptionKey = getEncryptionKey(),
  backupDir,
  verifyGoogleAccessToken,
  inviteUserByEmail,
  notifyUserApproved,
  deleteAuthUserByEmail,
  appUrl = APP_URL,
  dataStore,
  dataStoreFactory
} = {}) {
  const db = createDatabase(dbPath);
  const repos = createRepositories(db, encryptionKey);
  const route = createRouter(repos, db, {
    backupDir,
    verifyGoogleAccessToken,
    inviteUserByEmail,
    notifyUserApproved,
    deleteAuthUserByEmail,
    appUrl,
    dataStore,
    dataStoreFactory: dataStoreFactory === undefined
      ? createDefaultDataStoreFactory({ dbPath, encryptionKey })
      : dataStoreFactory
  });
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/config.js') {
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
  });

  return {
    listen(port = APP_PORT) {
      return new Promise(resolve => {
        server.listen(port, '127.0.0.1', () => resolve(server));
      });
    },
    close() {
      return new Promise(resolve => {
        server.close(() => {
          db.close();
          resolve();
        });
      });
    }
  };
}

function createDefaultDataStoreFactory({ dbPath, encryptionKey }) {
  if (dbPath === ':memory:') return null;
  return createSupabaseDataStoreFactory(encryptionKey);
}

function createSupabaseTokenVerifier() {
  const config = getPublicSupabaseConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return async accessToken => {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) throw error;
    return {
      id: data.user?.id || '',
      email: data.user?.email || '',
      name: data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || ''
    };
  };
}

function createSupabaseInviteService() {
  const config = getSupabaseAdminConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) return null;
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return async (email, options) => {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, options);
    if (error) throw error;
    return data.user;
  };
}

function createSupabaseAuthDeleteService() {
  const config = getSupabaseAdminConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) return null;
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
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

function createApprovalNotificationService() {
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
        body: JSON.stringify(buildApprovalEmail(user, options))
      });
      if (!response.ok) throw new Error(`Approval notification failed: ${response.status}`);
    };
  }

  const resendApiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.APPROVAL_EMAIL_FROM || process.env.EMAIL_FROM || '';
  if (resendApiKey && from) {
    return async (user, options) => {
      const email = buildApprovalEmail(user, options);
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

function buildApprovalEmail(user, options = {}) {
  const appUrl = options.appUrl || APP_URL;
  const displayName = user.displayName || user.username;
  const subject = 'Tài khoản ApecGlobal Manager đã được duyệt';
  const text = [
    `Chào ${displayName},`,
    '',
    'Tài khoản của bạn đã được admin duyệt vào hệ thống ApecGlobal Manager.',
    `Vai trò: ${user.role}`,
    `Đăng nhập bằng Google tại: ${appUrl}`,
    '',
    'Email này chỉ là thông báo, không phải email invite Supabase.'
  ].join('\n');
  const html = `
    <p>Chào ${escapeHtml(displayName)},</p>
    <p>Tài khoản của bạn đã được admin duyệt vào hệ thống <strong>ApecGlobal Manager</strong>.</p>
    <p>Vai trò: <strong>${escapeHtml(user.role)}</strong></p>
    <p><a href="${escapeAttr(appUrl)}">Đăng nhập bằng Google</a></p>
    <p>Email này chỉ là thông báo, không phải email invite Supabase.</p>
  `;
  return {
    to: user.username,
    subject,
    text,
    html,
    appUrl,
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

function createSupabaseDataStoreFactory(encryptionKey) {
  const adminConfig = getSupabaseAdminConfig();
  if (adminConfig.supabaseUrl && adminConfig.serviceRoleKey) {
    return session => createSupabaseDataStore({
      supabaseUrl: adminConfig.supabaseUrl,
      supabaseKey: adminConfig.serviceRoleKey,
      accessToken: session.accessToken,
      encryptionKey,
      useAccessTokenAuthorization: false
    });
  }

  const config = getPublicSupabaseConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  return session => createSupabaseDataStore({
    supabaseUrl: config.supabaseUrl,
    supabaseKey: config.supabaseAnonKey,
    accessToken: session.accessToken,
    encryptionKey
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp({
    verifyGoogleAccessToken: createSupabaseTokenVerifier(),
    inviteUserByEmail: createSupabaseInviteService(),
    notifyUserApproved: createApprovalNotificationService(),
    deleteAuthUserByEmail: createSupabaseAuthDeleteService()
  });
  const server = await app.listen(APP_PORT);
  console.log(`ApecGlobal Manager running at http://localhost:${server.address().port}`);
}
