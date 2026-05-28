import { createHmac, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readJson, sendJson, sendText, parseCookies, csvEscape } from './http-utils.js';
import { createSessionToken } from './crypto.js';
import { hasPermission } from './supabase-repositories.js';

const DEFAULT_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function createRouter(baseRepos, options = {}) {
  const sessions = new Map();
  const reposContext = new AsyncLocalStorage();
  const createReposForAccessToken = options.createReposForAccessToken;
  const repos = new Proxy({}, {
    get(_target, property) {
      return (reposContext.getStore()?.repos || baseRepos)[property];
    }
  });
  const sessionSecret = String(options.sessionSecret || process.env.APP_SECRET || 'apecglobal-manager-local-development-secret');
  const sessionMaxAgeSeconds = Number(options.sessionMaxAgeSeconds || DEFAULT_SESSION_MAX_AGE_SECONDS);
  const authenticateWithPassword = options.authenticateWithPassword;
  const verifyGoogleAccessToken = options.verifyGoogleAccessToken;
  const inviteUserByEmail = options.inviteUserByEmail;
  const notifyUserApproved = options.notifyUserApproved;
  const deleteAuthUserByEmail = options.deleteAuthUserByEmail;
  const appUrl = options.appUrl || 'http://localhost:3000';

  function reposForAccessToken(accessToken) {
    return accessToken && createReposForAccessToken ? createReposForAccessToken(accessToken) : baseRepos;
  }

  function useAccessToken(accessToken) {
    const store = reposContext.getStore();
    if (store) store.repos = reposForAccessToken(accessToken);
  }

  function currentSession(req) {
    const token = parseCookies(req).session;
    return token ? readSessionCookie(token) || sessions.get(token) || null : null;
  }

  function currentUser(req) {
    return currentSession(req)?.user || null;
  }

  function requireUser(req, res) {
    const user = currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Session locked or expired' });
      return null;
    }
    return user;
  }

  function requirePermission(req, res, permission) {
    const user = requireUser(req, res);
    if (!user) return null;
    if (!hasPermission(user, permission)) {
      sendJson(res, 403, { error: 'Permission denied' });
      return null;
    }
    return user;
  }

  function requireAdmin(req, res) {
    const user = requireUser(req, res);
    if (!user) return null;
    if (!isAdminUser(user)) {
      sendJson(res, 403, { error: 'Admin only' });
      return null;
    }
    return user;
  }

  function createSession(user, res, sessionData = {}) {
    const token = createSessionToken();
    const session = { user, ...sessionData };
    sessions.set(token, session);
    const cookieValue = signSessionCookie({
      ...session,
      exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds
    });
    sendJson(res, 200, { user }, {
      'set-cookie': `session=${encodeURIComponent(cookieValue)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}`
    });
  }

  function signSessionCookie(payload) {
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', sessionSecret).update(encodedPayload).digest('base64url');
    return `v1.${encodedPayload}.${signature}`;
  }

  function readSessionCookie(value) {
    const [version, encodedPayload, signature] = String(value || '').split('.');
    if (version !== 'v1' || !encodedPayload || !signature) return null;
    const expected = createHmac('sha256', sessionSecret).update(encodedPayload).digest('base64url');
    if (!safeEqual(signature, expected)) return null;
    try {
      const session = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      if (session.exp && session.exp <= Math.floor(Date.now() / 1000)) return null;
      return session;
    } catch {
      return null;
    }
  }

  function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
  }

  function isAdminUser(user) {
    return user?.role === 'Admin';
  }

  async function detailedPermissionFor(user, projectId, entryTypeId) {
    if (isAdminUser(user)) return null;
    if (!await repos.projectMemberships.has(user.id, projectId)) return null;
    return await repos.detailedPermissions.get(user.id, projectId, entryTypeId);
  }

  async function hasDetailedAction(user, projectId, entryTypeId, action) {
    if (isAdminUser(user)) return true;
    return Boolean((await detailedPermissionFor(user, projectId, entryTypeId))?.[action]);
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
    if (isAdminUser(user)) return entries;
    const decorated = [];
    for (const entry of entries) {
      const visible = await applyEntryPermission(entry, user, projectId);
      if (visible) decorated.push(visible);
    }
    return decorated;
  }

  async function searchEntriesForUser(query, user) {
    const entries = repos.entries.searchForUser
      ? await repos.entries.searchForUser(query, user)
      : await repos.entries.search(query);
    if (isAdminUser(user)) return entries;
    const decorated = [];
    for (const entry of entries) {
      const visible = await applyEntryPermission(entry, user, entry.projectId);
      if (visible) decorated.push(visible);
    }
    return decorated;
  }

  async function applyEntryPermission(entry, user, projectId) {
    const entryTypeId = await resolveEntryTypeId(entry);
    const permission = await detailedPermissionFor(user, projectId || entry.projectId, entryTypeId);
    if (!permission?.canViewEntry) return null;
    return {
      ...entry,
      typeId: entry.typeId || entryTypeId,
      url: permission.canViewUrl ? entry.url : '',
      username: permission.canViewUsername ? entry.username : '',
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
    const user = requireUser(req, res);
    if (!user) return null;
    if (isAdminUser(user)) return user;
    const existing = await findEntryForPermission(user, entryId);
    if (!existing) {
      sendJson(res, 404, { error: 'Entry not found' });
      return null;
    }
    if (!await hasDetailedAction(user, existing.projectId, existing.entryTypeId, action)) {
      sendJson(res, 403, { error: 'Permission denied' });
      return null;
    }
    return user;
  }

  async function sendUserInvite(user) {
    if (!inviteUserByEmail) return { inviteSent: false, user };
    await inviteUserByEmail(user.username, {
      redirectTo: normalizeRedirectUrl(appUrl),
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
        if (!authenticateWithPassword) {
          return sendJson(res, 503, { error: 'Supabase password login is not configured' });
        }
        const body = await readJson(req);
        if (!body.username || !body.password) {
          return sendJson(res, 400, { error: 'Username and password are required' });
        }

        let verified;
        try {
          verified = await authenticateWithPassword({
            username: body.username,
            password: body.password
          });
        } catch (error) {
          return sendJson(res, 401, { error: error.message || 'Invalid username or password' });
        }

        const email = String(verified?.email || '').trim();
        if (!email) return sendJson(res, 401, { error: 'Supabase account has no email' });
        useAccessToken(verified.accessToken);

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
            return createSession(requested, res, { accessToken: verified.accessToken, supabase: verified });
          }
          return sendJson(res, 403, { error: 'Tai khoan dang cho admin phe duyet' });
        }

        return createSession(user, res, { accessToken: verified.accessToken, supabase: verified });
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
            return createSession(requested, res, { accessToken: body.accessToken, supabase: verified });
          }
          return sendJson(res, 403, { error: 'Tai khoan dang cho admin phe duyet' });
        }

        return createSession(user, res, { accessToken: body.accessToken, supabase: verified });
      }

      if (req.method === 'POST' && path === '/api/auth/logout') {
        const token = parseCookies(req).session;
        if (token) sessions.delete(token);
        return sendJson(res, 200, { ok: true }, { 'set-cookie': 'session=; Max-Age=0; Path=/' });
      }

      if (req.method === 'GET' && path === '/api/session') {
        const user = currentUser(req);
        return sendJson(res, 200, { authenticated: Boolean(user), user: user || null });
      }

      if (!path.startsWith('/api/')) return false;
      const authenticated = requireUser(req, res);
      if (!authenticated) return true;

      if (req.method === 'GET' && path === '/api/users') {
        if (!requirePermission(req, res, 'users.manage')) return true;
        const users = await repos.users.list();
        if (url.searchParams.get('basic') === '1') return sendJson(res, 200, users);
        return sendJson(res, 200, await Promise.all(users.map(async user => ({
          ...user,
          projectMemberships: await repos.projectMemberships.listForUser(user.id),
          detailedPermissions: await repos.detailedPermissions.listForUser(user.id)
        }))));
      }

      if (req.method === 'POST' && path === '/api/users') {
        const user = requirePermission(req, res, 'users.manage');
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
            throw new Error(`Cannot send Supabase invite: ${error.message}`);
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
        if (!requirePermission(req, res, 'users.manage')) return true;
        if (!inviteUserByEmail) return sendJson(res, 503, { error: 'Supabase invite is not configured' });
        const invitedUser = await repos.users.get(decodeURIComponent(userInviteMatch[1]));
        if (!invitedUser) return sendJson(res, 404, { error: 'User not found' });
        const invite = await sendUserInvite(invitedUser);
        await repos.activity.log('user.invite', { details: invitedUser.username });
        return sendJson(res, 200, { user: invite.user, inviteSent: invite.inviteSent });
      }
      if (userMatch && req.method === 'PATCH') {
        const user = requirePermission(req, res, 'users.manage');
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
        const user = requirePermission(req, res, 'users.manage');
        if (!user) return true;
        const id = decodeURIComponent(userMatch[1]);
        if (String(id) === String(user.id)) throw new Error('Cannot delete current user');
        const existing = await repos.users.get(id);
        if (!existing) return sendJson(res, 404, { error: 'User not found' });
        const authDeleted = deleteAuthUserByEmail ? await deleteAuthUserByEmail(existing.username) : false;
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
        if (!requirePermission(req, res, 'users.manage')) return true;
        const type = await repos.entryTypes.create(await readJson(req));
        await repos.activity.log('entry_type.create', { details: type.name });
        return sendJson(res, 201, type);
      }

      const entryTypeMatch = path.match(/^\/api\/entry-types\/([^/]+)$/);
      if (entryTypeMatch && req.method === 'PATCH') {
        if (!requirePermission(req, res, 'users.manage')) return true;
        const type = await repos.entryTypes.update(decodeURIComponent(entryTypeMatch[1]), await readJson(req));
        await repos.activity.log('entry_type.update', { details: type.name });
        return sendJson(res, 200, type);
      }

      if (req.method === 'GET' && path === '/api/projects') {
        return sendJson(res, 200, await listProjectsForUser(authenticated));
      }

      if (req.method === 'POST' && path === '/api/projects') {
        if (!requireAdmin(req, res)) return true;
        const project = await repos.projects.create({ ...await readJson(req), ownerAuthUserId: authenticated.authUserId });
        await repos.activity.log('project.create', { projectId: project.id, details: project.name });
        return sendJson(res, 201, project);
      }

      const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      const projectMembersMatch = path.match(/^\/api\/projects\/([^/]+)\/members$/);
      if (projectMembersMatch && req.method === 'GET') {
        if (!requirePermission(req, res, 'users.manage')) return true;
        return sendJson(res, 200, await projectMembersPayload(decodeURIComponent(projectMembersMatch[1])));
      }
      if (projectMembersMatch && req.method === 'PATCH') {
        if (!requirePermission(req, res, 'users.manage')) return true;
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
        if (!requireAdmin(req, res)) return true;
        const project = await repos.projects.update(decodeURIComponent(projectMatch[1]), await readJson(req));
        await repos.activity.log('project.update', { projectId: project.id, details: project.name });
        return sendJson(res, 200, project);
      }
      if (projectMatch && req.method === 'DELETE') {
        if (!requireAdmin(req, res)) return true;
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
        const user = requireUser(req, res);
        if (!user) return true;
        const entryInput = await resolveEntryInput(await readJson(req));
        if (!isAdminUser(user) && !await hasDetailedAction(user, entryInput.projectId, entryInput.typeId, 'canCreate')) {
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
        if (!isAdminUser(user) && !await hasDetailedAction(user, targetProjectId, entryInput.typeId, 'canEdit')) {
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

      const copyLogMatch = path.match(/^\/api\/entries\/([^/]+)\/copy-password-log$/);
      if (copyLogMatch && req.method === 'POST') {
        const entryId = decodeURIComponent(copyLogMatch[1]);
        if (!await requireEntryAction(req, res, entryId, 'canRevealPassword')) return true;
        await repos.activity.log('entry.copy_password', { entryId });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && path === '/api/export/json') {
        if (!requireAdmin(req, res)) return true;
        await repos.activity.log('export.json');
        return sendJson(res, 200, await repos.export.backupJson({ includePasswords: url.searchParams.get('passwords') === '1' }));
      }

      if (req.method === 'GET' && path === '/api/export/csv') {
        if (!requireAdmin(req, res)) return true;
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
        if (!requireAdmin(req, res)) return true;
        const result = await repos.export.backupJson({ includePasswords: true });
        await repos.activity.log('backup.export_json', { details: result.exportedAt });
        return sendJson(res, 201, result);
      }

      if (req.method === 'POST' && path === '/api/import/preview') {
        if (!requireAdmin(req, res)) return true;
        const body = await readJson(req);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        return sendJson(res, 200, { rows, count: rows.length });
      }

      if (req.method === 'POST' && path === '/api/import/commit') {
        if (!requireAdmin(req, res)) return true;
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
        if (!requireAdmin(req, res)) return true;
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
