import { createHmac, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readJson, sendJson, sendText, parseCookies, csvEscape } from './http-utils.js';
import { createSessionToken } from './crypto.js';
import { hasPermission } from './supabase-repositories.js';

const DEFAULT_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function createRouter(baseRepos, options = {}) {
  const sessions = new Map();
  const sessionStore = options.sessionStore || null;
  const reposContext = new AsyncLocalStorage();
  const createReposForAccessToken = options.createReposForAccessToken;
  const repos = new Proxy({}, {
    get(_target, property) {
      return (reposContext.getStore()?.repos || baseRepos)[property];
    }
  });
  const sessionSecret = String(options.sessionSecret || process.env.APP_SECRET || 'apecglobal-manager-local-development-secret');
  const sessionMaxAgeSeconds = Number(options.sessionMaxAgeSeconds || DEFAULT_SESSION_MAX_AGE_SECONDS);
  const verifyGoogleAccessToken = options.verifyGoogleAccessToken;
  const inviteUserByEmail = options.inviteUserByEmail;
  const notifyUserApproved = options.notifyUserApproved;
  const deleteAuthUserByEmail = options.deleteAuthUserByEmail;
  const appUrl = options.appUrl || 'http://localhost:3000';
  const appDownloadUrl = options.appDownloadUrl || appUrl;
  const statelessSessions = Boolean(options.statelessSessions);

  function reposForAccessToken(accessToken) {
    return accessToken && createReposForAccessToken ? createReposForAccessToken(accessToken) : baseRepos;
  }

  function useAccessToken(accessToken) {
    const store = reposContext.getStore();
    if (store) store.repos = reposForAccessToken(accessToken);
  }

  function currentSession(req) {
    const token = parseCookies(req).session;
    if (!token) return null;
    const cookie = readSessionCookie(token);
    if (!cookie) return sessions.get(token) || null;
    if (cookie.session) return cookie.session;
    const session = sessions.get(cookie.id) || sessionStore?.get(cookie.id) || null;
    if (!session || isExpiredSession(session)) {
      sessions.delete(cookie.id);
      sessionStore?.delete(cookie.id);
      return null;
    }
    sessions.set(cookie.id, session);
    return session;
  }

  function clearSessionCookieHeader(req) {
    return `session=; Max-Age=0; Path=/; ${sessionCookieSameSite(req)}`;
  }

  function clearCurrentSession(req) {
    const token = parseCookies(req).session;
    if (!token) return;
    const cookie = readSessionCookie(token);
    const id = cookie?.id || (sessions.has(token) ? token : null);
    if (!id) return;
    sessions.delete(id);
    sessionStore?.delete(id);
  }

  function isValidSessionUser(user) {
    return Boolean(
      user?.id &&
      user?.authUserId &&
      String(user.status || '').toLowerCase() === 'active'
    );
  }

  async function validateCurrentSession(req) {
    const session = currentSession(req);
    if (!session) return { session: null, invalidated: false };
    if (!session.user?.id) {
      clearCurrentSession(req);
      return { session: null, invalidated: true };
    }

    let user = null;
    try {
      user = await repos.users.get(session.user.id);
    } catch {
      user = null;
    }

    if (!isValidSessionUser(user)) {
      clearCurrentSession(req);
      return { session: null, invalidated: true };
    }

    session.user = user;
    const id = currentSessionId(req);
    if (id) {
      sessions.set(id, session);
      sessionStore?.set(id, session);
    }
    return { session, invalidated: false };
  }

  function updateCurrentSessionUser(req, user) {
    const session = currentSession(req);
    const id = currentSessionId(req);
    if (!session) return;
    session.user = user;
    if (id) {
      sessions.set(id, session);
      sessionStore?.set(id, session);
    }
  }

  async function requireUser(req, res) {
    const { session } = await validateCurrentSession(req);
    const user = session?.user || null;
    if (!user) {
      sendJson(res, 401, { error: 'Session locked or expired' }, { 'set-cookie': clearSessionCookieHeader(req) });
      return null;
    }
    return user;
  }

  async function requirePermission(req, res, permission) {
    const user = await requireUser(req, res);
    if (!user) return null;
    if (!hasPermission(user, permission)) {
      sendJson(res, 403, { error: 'Permission denied' });
      return null;
    }
    return user;
  }

  async function requireAdmin(req, res) {
    const user = await requireUser(req, res);
    if (!user) return null;
    if (!isAdminUser(user)) {
      sendJson(res, 403, { error: 'Admin only' });
      return null;
    }
    return user;
  }

  function currentSessionId(req) {
    const token = parseCookies(req).session;
    if (!token) return null;
    const cookie = readSessionCookie(token);
    return cookie?.id || (sessions.has(token) ? token : null);
  }

  function createSession(user, req, res, sessionData = {}) {
    const token = createSessionToken();
    const session = {
      user,
      ...sessionData,
      exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds
    };
    let cookieValue;
    if (statelessSessions) {
      cookieValue = signStatelessSessionCookie({ user, exp: session.exp });
    } else {
      sessions.set(token, session);
      sessionStore?.set(token, session);
      cookieValue = signSessionCookie(token);
    }
    sendJson(res, 200, { user }, {
      'set-cookie': `session=${encodeURIComponent(cookieValue)}; HttpOnly; ${sessionCookieSameSite(req)}; Path=/; Max-Age=${sessionMaxAgeSeconds}`
    });
  }

  function sessionCookieSameSite(req) {
    return isCrossSiteRequest(req) ? 'SameSite=None; Secure' : 'SameSite=Lax';
  }

  function isCrossSiteRequest(req) {
    const origin = req.headers.origin;
    if (!origin) return false;
    try {
      const appOrigin = new URL(appUrl).origin;
      const requestOrigin = new URL(origin).origin;
      if (requestOrigin === appOrigin) return false;
      return !(isLoopbackHttpOrigin(requestOrigin) && isLoopbackHttpOrigin(appOrigin));
    } catch {
      return true;
    }
  }

  function isLoopbackHttpOrigin(origin) {
    try {
      const url = new URL(origin);
      return url.protocol === 'http:' && ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  function signSessionCookie(sessionId) {
    const signature = createHmac('sha256', sessionSecret).update(sessionId).digest('base64url');
    return `v2.${sessionId}.${signature}`;
  }

  function signStatelessSessionCookie(session) {
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    return `v1.${payload}.${signature}`;
  }

  function readSessionCookie(value) {
    const [version, encodedPayload, signature] = String(value || '').split('.');
    if (!encodedPayload || !signature) return null;
    if (version === 'v2') {
      const expected = createHmac('sha256', sessionSecret).update(encodedPayload).digest('base64url');
      return safeEqual(signature, expected) ? { id: encodedPayload } : null;
    }
    if (version !== 'v1') return null;
    const expected = createHmac('sha256', sessionSecret).update(encodedPayload).digest('base64url');
    if (!safeEqual(signature, expected)) return null;
    try {
      const session = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      if (isExpiredSession(session)) return null;
      return { session };
    } catch {
      return null;
    }
  }

  function isExpiredSession(session) {
    return Boolean(session?.exp && session.exp <= Math.floor(Date.now() / 1000));
  }

  function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
  }

  function isAdminUser(user) {
    return user?.role === 'Admin';
  }

  async function detailedPermissionFor(user, projectId, scope) {
    if (isAdminUser(user)) return null;
    if (!await repos.projectMemberships.has(user.id, projectId)) return null;
    const systemId = typeof scope === 'object' ? scope.systemId : null;
    const entryTypeId = typeof scope === 'object' ? scope.entryTypeId : scope;
    if (systemId && repos.detailedPermissions.getBySystem) {
      const permission = await repos.detailedPermissions.getBySystem(user.id, projectId, systemId);
      if (permission) return permission;
    }
    if (!entryTypeId) return null;
    return await repos.detailedPermissions.get(user.id, projectId, entryTypeId);
  }

  async function hasDetailedAction(user, projectId, scope, action) {
    if (isAdminUser(user)) return true;
    return Boolean((await detailedPermissionFor(user, projectId, scope))?.[action]);
  }

  async function listProjectsForUser(user) {
    const projects = repos.projects.listForUser
      ? await repos.projects.listForUser(user)
      : isAdminUser(user)
        ? await repos.projects.list()
        : await repos.projects.listByIds(await repos.projectMemberships.listForUser(user.id));
    return Promise.all(projects.map(project => decorateProjectForUser(project, user)));
  }

  async function listProjectEntriesForUser(projectId, user) {
    const entries = repos.entries.listByProjectForUser
      ? await repos.entries.listByProjectForUser(projectId, user)
      : await repos.entries.listByProject(projectId);
    if (isAdminUser(user)) return entries.map(sanitizeEntryCredentials);
    const decorated = [];
    for (const entry of entries) {
      const visible = await applyEntryPermission(entry, user, projectId);
      if (visible) decorated.push(visible);
    }
    return decorated;
  }

  async function listProjectSystemsForUser(projectId, user) {
    if (!repos.projectSystems) return [];
    const systems = await repos.projectSystems.listForProject(projectId);
    if (isAdminUser(user)) return systems;
    if (!await repos.projectMemberships.has(user.id, projectId)) return [];
    const permissions = await repos.detailedPermissions.listForProject(projectId);
    const allowedSystemIds = new Set(permissions
      .filter(permission => String(permission.userId) === String(user.id) && permission.systemId && permission.canViewEntry)
      .map(permission => String(permission.systemId)));
    return systems.filter(system => allowedSystemIds.has(String(system.id)));
  }

  async function searchEntriesForUser(query, user) {
    const entries = repos.entries.searchForUser
      ? await repos.entries.searchForUser(query, user)
      : await repos.entries.search(query);
    if (isAdminUser(user)) return entries.map(sanitizeEntryCredentials);
    const decorated = [];
    for (const entry of entries) {
      const visible = await applyEntryPermission(entry, user, entry.projectId);
      if (visible) decorated.push(visible);
    }
    return decorated;
  }

  async function applyEntryPermission(entry, user, projectId) {
    const entryTypeId = await resolveEntryTypeId(entry);
    const permission = await detailedPermissionFor(user, projectId || entry.projectId, {
      systemId: entry.systemId || entry.projectSystemId,
      entryTypeId
    });
    if (!permission?.canViewEntry) return null;
    const credentials = visibleCredentialsForUser(entry.credentials || [], user)
      .map(credential => ({
        id: credential.id,
        entryId: credential.entryId || entry.id,
        departmentId: credential.departmentId || null,
        username: permission.canViewUsername ? credential.username : '',
        passwordMasked: true,
        sortOrder: credential.sortOrder || 0
      }));
    const primaryCredential = credentials[0] || null;
    return {
      ...entry,
      systemId: entry.systemId || entry.projectSystemId || null,
      typeId: entry.typeId || entryTypeId,
      url: permission.canViewUrl ? entry.url : '',
      username: permission.canViewUsername ? (primaryCredential?.username || entry.username || '') : '',
      credentials,
      notes: permission.canViewNotes ? entry.notes : '',
      tags: permission.canViewNotes ? entry.tags : [],
      permissions: {
        canViewEntry: permission.canViewEntry,
        canViewUrl: permission.canViewUrl,
        canViewUsername: permission.canViewUsername,
        canRevealPassword: permission.canRevealPassword,
        canViewNotes: permission.canViewNotes,
        canCreate: permission.canCreate,
        canEdit: permission.canEdit,
        canDelete: permission.canDelete
      }
    };
  }

  function visibleCredentialsForUser(credentials, user) {
    if (isAdminUser(user)) return credentials;
    const departmentIds = userDepartmentIds(user);
    if (!departmentIds.size) return [];
    return credentials.filter(credential => departmentIds.has(String(credential.departmentId || '')));
  }

  function userDepartmentIds(user) {
    return new Set((user?.departmentIds?.length ? user.departmentIds : [user?.departmentId])
      .filter(Boolean)
      .map(id => String(id)));
  }

  function sanitizeEntryCredentials(entry) {
    return {
      ...entry,
      credentials: (entry.credentials || []).map(credential => ({
        id: credential.id,
        entryId: credential.entryId || entry.id,
        departmentId: credential.departmentId || null,
        username: credential.username || '',
        passwordMasked: true,
        sortOrder: credential.sortOrder || 0
      }))
    };
  }

  async function requireCredentialAction(req, res, entryId, credentialId, action) {
    const user = await requireEntryAction(req, res, entryId, action);
    if (!user) return null;
    if (isAdminUser(user)) return user;
    const credential = repos.entries.getCredential
      ? await repos.entries.getCredential(entryId, credentialId)
      : (await findEditableEntry(user, entryId))?.credentials?.find(item => String(item.id) === String(credentialId));
    if (!credential) {
      sendJson(res, 404, { error: 'Credential not found' });
      return null;
    }
    if (!userDepartmentIds(user).has(String(credential.departmentId || ''))) {
      sendJson(res, 403, { error: 'Permission denied' });
      return null;
    }
    return user;
  }

  async function decorateProjectForUser(project, user) {
    if (isAdminUser(user)) return project;
    return {
      ...project,
      entryTypePermissions: (await repos.detailedPermissions.listForProject(project.id))
        .filter(permission => String(permission.userId) === String(user.id))
        .map(projectEntryTypePermissionPayload)
    };
  }

  function projectEntryTypePermissionPayload(permission) {
    return {
      entryTypeId: permission.entryTypeId,
      systemId: permission.systemId || null,
      canViewEntry: permission.canViewEntry,
      canViewUrl: permission.canViewUrl,
      canViewUsername: permission.canViewUsername,
      canRevealPassword: permission.canRevealPassword,
      canViewNotes: permission.canViewNotes,
      canCreate: permission.canCreate,
      canEdit: permission.canEdit,
      canDelete: permission.canDelete
    };
  }

  async function resolveEntryTypeId(input, existing = null) {
    if (input.typeId || input.entryTypeId) return input.typeId || input.entryTypeId;
    if (input.type) {
      const type = await repos.entryTypes.findByName(input.type);
      if (!type) throw new Error('Entry type not found');
      return type.id;
    }
    const existingTypeId = existing?.entry_type_id ?? existing?.typeId ?? existing?.entryTypeId;
    if (existingTypeId) return existingTypeId;
    if (existing?.type) {
      const type = await repos.entryTypes.findByName(existing.type);
      if (type) return type.id;
    }
    return (await repos.entryTypes.findByName('Other'))?.id || null;
  }

  async function resolveEntryInput(input, existing = null) {
    const entryTypeId = await resolveEntryTypeId(input, existing);
    const entryType = entryTypeId ? await repos.entryTypes.get(entryTypeId) : null;
    return {
      ...input,
      typeId: entryTypeId,
      type: entryType?.name || input.type || existing?.type || 'Other'
    };
  }

  function projectMembershipsForInput(input) {
    if (Array.isArray(input.projectMemberships)) return input.projectMemberships;
    if (Array.isArray(input.detailedPermissions)) {
      return [...new Set(input.detailedPermissions.map(permission => permission.projectId).filter(Boolean))];
    }
    return null;
  }

  async function normalizeEntryForPermission(entry) {
    if (!entry) return null;
    return {
      projectId: entry.projectId ?? entry.project_id,
      systemId: entry.systemId ?? entry.projectSystemId ?? entry.system_id ?? null,
      entryTypeId: entry.typeId ?? entry.entryTypeId ?? entry.entry_type_id ?? await resolveEntryTypeId(entry)
    };
  }

  async function findEntryForPermission(user, entryId) {
    if (repos.entries.getRaw) return await normalizeEntryForPermission(await repos.entries.getRaw(entryId));
    if (repos.entries.get) return await normalizeEntryForPermission(await repos.entries.get(entryId));
    const projectIds = isAdminUser(user) ? (await repos.projects.list()).map(project => project.id) : await repos.projectMemberships.listForUser(user.id);
    for (const projectId of projectIds) {
      const entry = (await repos.entries.listByProject(projectId)).find(item => String(item.id) === String(entryId));
      if (entry) return await normalizeEntryForPermission(entry);
    }
    return null;
  }

  async function findEditableEntry(user, entryId) {
    if (repos.entries.get) return await repos.entries.get(entryId);
    const projectIds = isAdminUser(user) ? (await repos.projects.list()).map(project => project.id) : await repos.projectMemberships.listForUser(user.id);
    for (const projectId of projectIds) {
      const entry = (await repos.entries.listByProject(projectId)).find(item => String(item.id) === String(entryId));
      if (entry) return entry;
    }
    return null;
  }

  async function requireEntryAction(req, res, entryId, action) {
    const user = await requireUser(req, res);
    if (!user) return null;
    if (isAdminUser(user)) return user;
    const existing = await findEntryForPermission(user, entryId);
    if (!existing) {
      sendJson(res, 404, { error: 'Entry not found' });
      return null;
    }
    if (!await hasDetailedAction(user, existing.projectId, {
      systemId: existing.systemId,
      entryTypeId: existing.entryTypeId
    }, action)) {
      sendJson(res, 403, { error: 'Permission denied' });
      return null;
    }
    return user;
  }

  async function sendUserInvite(user) {
    if (!inviteUserByEmail) return { inviteSent: false, user };
    await inviteUserByEmail(user.username, {
      redirectTo: normalizeRedirectUrl(appDownloadUrl),
      data: {
        DisplayName: user.displayName,
        Role: user.role
      }
    });
    return { inviteSent: true, user: await repos.users.markInvited(user.id) };
  }

  async function sendApprovalNotification(user) {
    if (!notifyUserApproved) return false;
    await notifyUserApproved(user, {
      appUrl: normalizeRedirectUrl(appUrl),
      appDownloadUrl: normalizeRedirectUrl(appDownloadUrl),
      role: user.role,
      permissions: user.permissions
    });
    return true;
  }

  return async function route(req, res) {
    return reposContext.run({ repos: reposForAccessToken(currentSession(req)?.accessToken) }, async () => {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;

      try {
      if (req.method === 'POST' && path === '/api/auth/login') {
        return sendJson(res, 410, { error: 'Username/password login is disabled. Use Google login.' });
      }

      if (req.method === 'POST' && path === '/api/auth/google') {
        if (!verifyGoogleAccessToken) {
          return sendJson(res, 503, { error: 'Supabase login is not configured' });
        }
        const body = await readJson(req);
        if (!body.accessToken) return sendJson(res, 400, { error: 'Supabase access token is required' });

        let verified;
        try {
          verified = await verifyGoogleAccessToken(body.accessToken);
        } catch (error) {
          return sendJson(res, 401, { error: error.message || 'Invalid Supabase session' });
        }

        const email = String(verified?.email || '').trim();
        if (!email) return sendJson(res, 401, { error: 'Supabase account has no verified email' });
        useAccessToken(body.accessToken);

        let user;
        try {
          user = await repos.users.activateForGoogleLogin(email, {
            authUserId: verified.authUserId || verified.id,
            displayName: verified?.name || verified?.displayName || email
          });
        } catch (error) {
          return sendJson(res, 403, { error: error.message });
        }
        if (!user) {
          const requested = await repos.users.requestGoogleAccess({
            username: email,
            authUserId: verified.authUserId || verified.id,
            displayName: verified?.name || verified?.displayName || email
          });
          await repos.activity.log('user.access_request', { details: requested.username });
          if (requested.status === 'Active') {
            return createSession(requested, req, res, { accessToken: body.accessToken, supabase: verified });
          }
          return sendJson(res, 403, { error: 'Tai khoan dang cho admin phe duyet' });
        }

        return createSession(user, req, res, { accessToken: body.accessToken, supabase: verified });
      }

      if (req.method === 'POST' && path === '/api/auth/logout') {
        const token = currentSessionId(req) || parseCookies(req).session;
        if (token) {
          sessions.delete(token);
          sessionStore?.delete(token);
        }
        return sendJson(res, 200, { ok: true }, { 'set-cookie': 'session=; Max-Age=0; Path=/' });
      }

      if (req.method === 'GET' && path === '/api/session') {
        const { session, invalidated } = await validateCurrentSession(req);
        const user = session?.user || null;
        return sendJson(
          res,
          200,
          { authenticated: Boolean(user), user: user || null },
          invalidated ? { 'set-cookie': clearSessionCookieHeader(req) } : {}
        );
      }

      if (!path.startsWith('/api/')) return false;
      const authenticated = await requireUser(req, res);
      if (!authenticated) return true;

      if (req.method === 'PATCH' && path === '/api/me/preferences') {
        const input = await readJson(req);
        const updated = repos.users.updatePreferences
          ? await repos.users.updatePreferences(authenticated.id, input)
          : await repos.users.update(authenticated.id, { preferences: input });
        updateCurrentSessionUser(req, updated);
        return sendJson(res, 200, { user: updated, preferences: updated.preferences || {} });
      }

      if (req.method === 'GET' && path === '/api/users') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const users = await repos.users.list();
        if (url.searchParams.get('basic') === '1') return sendJson(res, 200, users);
        return sendJson(res, 200, await Promise.all(users.map(async user => ({
          ...user,
          projectMemberships: await repos.projectMemberships.listForUser(user.id),
          detailedPermissions: await repos.detailedPermissions.listForUser(user.id)
        }))));
      }

      if (req.method === 'GET' && path === '/api/departments') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        return sendJson(res, 200, await repos.departments.list());
      }

      if (req.method === 'POST' && path === '/api/departments') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const department = await repos.departments.create(await readJson(req));
        await repos.activity.log('department.create', { details: department.name });
        return sendJson(res, 201, department);
      }

      if (req.method === 'POST' && path === '/api/users') {
        const user = await requirePermission(req, res, 'users.manage');
        if (!user) return true;
        const input = await readJson(req);
        let created = await repos.users.create({
          ...input,
          status: !input.password ? 'Invited' : input.status
        });
        let inviteSent = false;
        if (inviteUserByEmail) {
          try {
            const invite = await sendUserInvite(created);
            inviteSent = invite.inviteSent;
            created = invite.user;
          } catch (error) {
            await repos.users.delete(created.id, user.id);
            throw new Error(`Cannot send invite email: ${error.message}`);
          }
        }
        if (Array.isArray(input.detailedPermissions)) {
          await repos.detailedPermissions.replaceForUser(created.id, input.detailedPermissions);
        }
        const projectMemberships = projectMembershipsForInput(input);
        if (projectMemberships) await repos.projectMemberships.replaceForUser(created.id, projectMemberships);
        await repos.activity.log('user.create', { details: created.username });
        const detailedPermissions = await repos.detailedPermissions.listForUser(created.id);
        const memberships = await repos.projectMemberships.listForUser(created.id);
        return sendJson(res, 201, {
          ...created,
          projectMemberships: memberships,
          detailedPermissions,
          user: { ...created, projectMemberships: memberships, detailedPermissions },
          inviteSent
        });
      }

      const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
      const userInviteMatch = path.match(/^\/api\/users\/([^/]+)\/invite$/);
      if (userInviteMatch && req.method === 'POST') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        if (!inviteUserByEmail) return sendJson(res, 503, { error: 'Invite email is not configured' });
        const invitedUser = await repos.users.get(decodeURIComponent(userInviteMatch[1]));
        if (!invitedUser) return sendJson(res, 404, { error: 'User not found' });
        const invite = await sendUserInvite(invitedUser);
        await repos.activity.log('user.invite', { details: invitedUser.username });
        return sendJson(res, 200, { user: invite.user, inviteSent: invite.inviteSent });
      }
      if (userMatch && req.method === 'PATCH') {
        const user = await requirePermission(req, res, 'users.manage');
        if (!user) return true;
        const id = decodeURIComponent(userMatch[1]);
        const existing = await repos.users.get(id);
        if (!existing) return sendJson(res, 404, { error: 'User not found' });
        const input = await readJson(req);
        const updated = await repos.users.update(id, input);
        if (Array.isArray(input.detailedPermissions)) {
          await repos.detailedPermissions.replaceForUser(id, input.detailedPermissions);
        }
        const projectMemberships = projectMembershipsForInput(input);
        if (projectMemberships) await repos.projectMemberships.replaceForUser(id, projectMemberships);
        const approvalEmailRequired = existing.status === 'Pending' && updated.status === 'Active';
        const approvalEmailSent = approvalEmailRequired ? await sendApprovalNotification(updated) : false;
        await repos.activity.log('user.update', { details: updated.username });
        const detailedPermissions = await repos.detailedPermissions.listForUser(id);
        const memberships = await repos.projectMemberships.listForUser(id);
        return sendJson(res, 200, {
          ...updated,
          projectMemberships: memberships,
          detailedPermissions,
          user: { ...updated, projectMemberships: memberships, detailedPermissions },
          inviteSent: false,
          approvalEmailSent,
          approvalEmailRequired
        });
      }
      if (userMatch && req.method === 'DELETE') {
        const user = await requirePermission(req, res, 'users.manage');
        if (!user) return true;
        const id = decodeURIComponent(userMatch[1]);
        if (String(id) === String(user.id)) throw new Error('Cannot delete current user');
        const existing = await repos.users.get(id);
        if (!existing) return sendJson(res, 404, { error: 'User not found' });
        const session = currentSession(req);
        const authDeleted = deleteAuthUserByEmail
          ? await deleteAuthUserByEmail(existing.username, { accessToken: session?.accessToken || '' })
          : false;
        await repos.users.delete(id, user.id);
        for (const [token, session] of sessions.entries()) {
          if (String(session.user?.id) === String(id)) sessions.delete(token);
        }
        await repos.activity.log('user.delete', { details: existing.username });
        return sendJson(res, 200, { ok: true, authDeleted });
      }

      if (req.method === 'GET' && path === '/api/entry-types') {
        return sendJson(res, 200, await repos.entryTypes.list({ includeInactive: hasPermission(authenticated, 'users.manage') }));
      }

      if (req.method === 'POST' && path === '/api/entry-types') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const type = await repos.entryTypes.create(await readJson(req));
        await repos.activity.log('entry_type.create', { details: type.name });
        return sendJson(res, 201, type);
      }

      const entryTypeMatch = path.match(/^\/api\/entry-types\/([^/]+)$/);
      if (entryTypeMatch && req.method === 'PATCH') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const type = await repos.entryTypes.update(decodeURIComponent(entryTypeMatch[1]), await readJson(req));
        await repos.activity.log('entry_type.update', { details: type.name });
        return sendJson(res, 200, type);
      }

      if (entryTypeMatch && req.method === 'DELETE') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const id = decodeURIComponent(entryTypeMatch[1]);
        const type = await repos.entryTypes.get(id);
        if (!type) return sendJson(res, 404, { error: 'Entry type not found' });
        await repos.entryTypes.delete(id);
        await repos.activity.log('entry_type.delete', { details: type.name });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && path === '/api/projects') {
        return sendJson(res, 200, await listProjectsForUser(authenticated));
      }

      if (req.method === 'POST' && path === '/api/projects') {
        if (!await requireAdmin(req, res)) return true;
        const project = await repos.projects.create({ ...await readJson(req), ownerAuthUserId: authenticated.authUserId });
        await repos.activity.log('project.create', { projectId: project.id, details: project.name });
        return sendJson(res, 201, project);
      }

      if (req.method === 'PATCH' && path === '/api/projects/reorder') {
        if (!await requireAdmin(req, res)) return true;
        const input = await readJson(req);
        const ids = Array.isArray(input.ids) ? input.ids : [];
        await repos.projects.reorder(ids);
        await repos.activity.log('project.reorder', { details: `${ids.length} projects` });
        return sendJson(res, 200, { ok: true });
      }

      const projectSystemsMatch = path.match(/^\/api\/projects\/([^/]+)\/systems(?:\/([^/]+))?$/);
      if (projectSystemsMatch && req.method === 'GET' && !projectSystemsMatch[2]) {
        return sendJson(res, 200, await listProjectSystemsForUser(decodeURIComponent(projectSystemsMatch[1]), authenticated));
      }
      if (projectSystemsMatch && req.method === 'POST' && !projectSystemsMatch[2]) {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const projectId = decodeURIComponent(projectSystemsMatch[1]);
        const system = await repos.projectSystems.create({ ...await readJson(req), projectId });
        await repos.activity.log('project_system.create', { projectId, details: system.name });
        return sendJson(res, 201, system);
      }
      if (projectSystemsMatch && req.method === 'PATCH' && projectSystemsMatch[2] === 'reorder') {
        if (!await requireAdmin(req, res)) return true;
        const projectId = decodeURIComponent(projectSystemsMatch[1]);
        const input = await readJson(req);
        const ids = Array.isArray(input.ids) ? input.ids : [];
        await repos.projectSystems.reorder(projectId, ids);
        await repos.activity.log('project_system.reorder', { projectId, details: `${ids.length} systems` });
        return sendJson(res, 200, { ok: true });
      }
      if (projectSystemsMatch && req.method === 'PATCH' && projectSystemsMatch[2]) {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const projectId = decodeURIComponent(projectSystemsMatch[1]);
        const system = await repos.projectSystems.update(decodeURIComponent(projectSystemsMatch[2]), await readJson(req));
        await repos.activity.log('project_system.update', { projectId, details: system.name });
        return sendJson(res, 200, system);
      }
      if (projectSystemsMatch && req.method === 'DELETE' && projectSystemsMatch[2]) {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const projectId = decodeURIComponent(projectSystemsMatch[1]);
        await repos.projectSystems.delete(decodeURIComponent(projectSystemsMatch[2]));
        await repos.activity.log('project_system.delete', { projectId });
        return sendJson(res, 200, { ok: true });
      }

      const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      const projectMembersMatch = path.match(/^\/api\/projects\/([^/]+)\/members$/);
      if (projectMembersMatch && req.method === 'GET') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        return sendJson(res, 200, await projectMembersPayload(decodeURIComponent(projectMembersMatch[1])));
      }
      if (projectMembersMatch && req.method === 'PATCH') {
        if (!await requirePermission(req, res, 'users.manage')) return true;
        const projectId = decodeURIComponent(projectMembersMatch[1]);
        const input = await readJson(req);
        const members = Array.isArray(input.members) ? input.members : [];
        const nonAdminMembers = [];
        for (const member of members) {
          const memberUser = await repos.users.get(member.userId);
          if (!isAdminUser(memberUser)) nonAdminMembers.push(member);
        }
        await repos.projectMemberships.replaceForProject(projectId, nonAdminMembers.map(member => member.userId));
        await repos.detailedPermissions.replaceForProject(projectId, nonAdminMembers.flatMap(member => (
          member.detailedPermissions || []
        ).map(permission => ({
          ...permission,
          userId: member.userId,
          projectId
        }))));
        await repos.activity.log('project.members.update', { projectId, details: `${nonAdminMembers.length} members` });
        return sendJson(res, 200, { members: await projectMembersPayload(projectId) });
      }
      if (projectMatch && req.method === 'PATCH') {
        if (!await requireAdmin(req, res)) return true;
        const project = await repos.projects.update(decodeURIComponent(projectMatch[1]), await readJson(req));
        await repos.activity.log('project.update', { projectId: project.id, details: project.name });
        return sendJson(res, 200, project);
      }
      if (projectMatch && req.method === 'DELETE') {
        if (!await requireAdmin(req, res)) return true;
        const projectId = decodeURIComponent(projectMatch[1]);
        await repos.projects.delete(projectId);
        await repos.activity.log('project.delete', { projectId });
        return sendJson(res, 200, { ok: true });
      }

      const projectEntriesMatch = path.match(/^\/api\/projects\/([^/]+)\/entries$/);
      if (projectEntriesMatch && req.method === 'GET') {
        return sendJson(res, 200, await listProjectEntriesForUser(decodeURIComponent(projectEntriesMatch[1]), authenticated));
      }

      if (req.method === 'GET' && path === '/api/entries/search') {
        return sendJson(res, 200, await searchEntriesForUser(url.searchParams.get('q') || '', authenticated));
      }

      const entryEditMatch = path.match(/^\/api\/entries\/([^/]+)\/edit$/);
      if (entryEditMatch && req.method === 'GET') {
        const entryId = decodeURIComponent(entryEditMatch[1]);
        const user = await requireEntryAction(req, res, entryId, 'canEdit');
        if (!user) return true;
        const entry = await findEditableEntry(user, entryId);
        if (!entry) return sendJson(res, 404, { error: 'Entry not found' });
        return sendJson(res, 200, { ...entry, typeId: entry.typeId || await resolveEntryTypeId(entry) });
      }

      if (req.method === 'POST' && path === '/api/entries') {
        const user = await requireUser(req, res);
        if (!user) return true;
        const entryInput = await resolveEntryInput(await readJson(req));
        if (!isAdminUser(user) && !await hasDetailedAction(user, entryInput.projectId, {
          systemId: entryInput.systemId || entryInput.projectSystemId,
          entryTypeId: entryInput.typeId
        }, 'canCreate')) {
          return sendJson(res, 403, { error: 'Permission denied' });
        }
        const entry = await repos.entries.create({ ...entryInput, ownerAuthUserId: user.authUserId });
        await repos.activity.log('entry.create', { projectId: entry.projectId, entryId: entry.id, details: entry.name });
        return sendJson(res, 201, entry);
      }

      const entryMatch = path.match(/^\/api\/entries\/([^/]+)$/);
      if (entryMatch && req.method === 'PATCH') {
        const entryId = decodeURIComponent(entryMatch[1]);
        const user = await requireEntryAction(req, res, entryId, 'canEdit');
        if (!user) return true;
        const input = await readJson(req);
        const existing = await findEntryForPermission(user, entryId);
        const entryInput = await resolveEntryInput(input, existing);
        const targetProjectId = entryInput.projectId || existing?.projectId;
        if (!isAdminUser(user) && !await hasDetailedAction(user, targetProjectId, {
          systemId: entryInput.systemId || entryInput.projectSystemId || existing?.systemId,
          entryTypeId: entryInput.typeId
        }, 'canEdit')) {
          return sendJson(res, 403, { error: 'Permission denied' });
        }
        const entry = await repos.entries.update(entryId, entryInput);
        await repos.activity.log('entry.update', { projectId: entry.projectId, entryId: entry.id, details: entry.name });
        return sendJson(res, 200, entry);
      }
      if (entryMatch && req.method === 'DELETE') {
        const entryId = decodeURIComponent(entryMatch[1]);
        if (!await requireEntryAction(req, res, entryId, 'canDelete')) return true;
        await repos.entries.delete(entryId);
        await repos.activity.log('entry.delete', { entryId });
        return sendJson(res, 200, { ok: true });
      }

      const revealMatch = path.match(/^\/api\/entries\/([^/]+)\/reveal-password$/);
      if (revealMatch && req.method === 'POST') {
        const entryId = decodeURIComponent(revealMatch[1]);
        if (!await requireEntryAction(req, res, entryId, 'canRevealPassword')) return true;
        await repos.activity.log('entry.reveal_password', { entryId });
        return sendJson(res, 200, { password: await repos.entries.revealPassword(entryId) });
      }

      const credentialRevealMatch = path.match(/^\/api\/entries\/([^/]+)\/credentials\/([^/]+)\/reveal-password$/);
      if (credentialRevealMatch && req.method === 'POST') {
        const entryId = decodeURIComponent(credentialRevealMatch[1]);
        const credentialId = decodeURIComponent(credentialRevealMatch[2]);
        if (!await requireCredentialAction(req, res, entryId, credentialId, 'canRevealPassword')) return true;
        await repos.activity.log('entry.credential_reveal_password', { entryId, details: credentialId });
        const password = repos.entries.revealCredentialPassword
          ? await repos.entries.revealCredentialPassword(entryId, credentialId)
          : (await findEditableEntry(await requireUser(req, res), entryId))?.credentials?.find(item => String(item.id) === String(credentialId))?.password || '';
        return sendJson(res, 200, { password });
      }

      const copyLogMatch = path.match(/^\/api\/entries\/([^/]+)\/copy-password-log$/);
      if (copyLogMatch && req.method === 'POST') {
        const entryId = decodeURIComponent(copyLogMatch[1]);
        if (!await requireEntryAction(req, res, entryId, 'canRevealPassword')) return true;
        await repos.activity.log('entry.copy_password', { entryId });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && path === '/api/export/json') {
        if (!await requireAdmin(req, res)) return true;
        await repos.activity.log('export.json');
        return sendJson(res, 200, await repos.export.backupJson({ includePasswords: url.searchParams.get('passwords') === '1' }));
      }

      if (req.method === 'GET' && path === '/api/export/csv') {
        if (!await requireAdmin(req, res)) return true;
        await repos.activity.log('export.csv');
        const rows = await repos.entries.exportForUser(authenticated, { includePasswords: url.searchParams.get('passwords') === '1' });
        const headers = ['projectId', 'name', 'type', 'environment', 'url', 'username', 'password', 'notes', 'tags', 'status'];
        const csv = [headers.join(',')].concat(rows.map(row => headers.map(key => {
          const value = key === 'tags' ? row.tags.join('|') : row[key];
          return csvEscape(value);
        }).join(','))).join('\n');
        return sendText(res, 200, csv, { 'content-type': 'text/csv; charset=utf-8' });
      }

      if (req.method === 'POST' && path === '/api/backups/save-json') {
        if (!await requireAdmin(req, res)) return true;
        const result = await repos.export.backupJson({ includePasswords: true });
        await repos.activity.log('backup.export_json', { details: result.exportedAt });
        return sendJson(res, 201, result);
      }

      if (req.method === 'POST' && path === '/api/import/preview') {
        if (!await requireAdmin(req, res)) return true;
        const body = await readJson(req);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        return sendJson(res, 200, { rows, count: rows.length });
      }

      if (req.method === 'POST' && path === '/api/import/commit') {
        if (!await requireAdmin(req, res)) return true;
        const body = await readJson(req);
        const created = [];
        for (const row of body.rows || []) {
          const project = await repos.projects.create({
            name: row.projectName,
            description: '',
            status: 'Active',
            ownerAuthUserId: authenticated.authUserId
          });
          created.push(await repos.entries.create({
            ...row,
            projectId: project.id,
            tags: splitTags(row.tags),
            ownerAuthUserId: authenticated.authUserId
          }));
        }
        await repos.activity.log('import.commit', { details: `${created.length} entries` });
        return sendJson(res, 201, { created });
      }

      if (req.method === 'GET' && path === '/api/activity') {
        return sendJson(res, 200, await repos.activity.list());
      }

      if (req.method === 'GET' && path === '/api/settings') {
        return sendJson(res, 200, await repos.settings.getAll());
      }

      if (req.method === 'PATCH' && path === '/api/settings') {
        if (!await requireAdmin(req, res)) return true;
        return sendJson(res, 200, await repos.settings.update(await readJson(req)));
      }

      sendJson(res, 404, { error: 'Not found' });
      return true;
      } catch (error) {
        sendJson(res, 400, { error: error.message });
        return true;
      }
    });
  };

  async function projectMembersPayload(projectId) {
    const memberIds = new Set((await repos.projectMemberships.listForProject(projectId)).map(id => String(id)));
    const permissions = await repos.detailedPermissions.listForProject(projectId);
    return (await repos.users.list())
      .filter(user => user.role !== 'Admin' && memberIds.has(String(user.id)))
      .map(user => ({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        detailedPermissions: permissions.filter(permission => String(permission.userId) === String(user.id))
      }));
  }
}

function splitTags(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/[|,]/).map(tag => tag.trim()).filter(Boolean);
}

function normalizeRedirectUrl(value) {
  const raw = String(value || '').trim() || 'http://localhost:3000';
  return raw.endsWith('/') ? raw : `${raw}/`;
}
