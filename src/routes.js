import { readJson, sendJson, sendText, parseCookies, csvEscape } from './http-utils.js';
import { createSessionToken } from './crypto.js';
import { BACKUP_DIR } from './config.js';
import { writeBackupFiles } from './backup.js';
import { hasPermission } from './repositories.js';

export function createRouter(repos, db, options = {}) {
  const sessions = new Map();
  const backupDir = options.backupDir || BACKUP_DIR;
  const verifyGoogleAccessToken = options.verifyGoogleAccessToken;
  const inviteUserByEmail = options.inviteUserByEmail;
  const notifyUserApproved = options.notifyUserApproved;
  const deleteAuthUserByEmail = options.deleteAuthUserByEmail;
  const appUrl = options.appUrl || 'http://localhost:3000';
  const dataStore = options.dataStore;
  const dataStoreFactory = options.dataStoreFactory;

  function currentUser(req) {
    return currentSession(req)?.user || null;
  }

  function currentSession(req) {
    const token = parseCookies(req).session;
    return token ? sessions.get(token) : null;
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
    sessions.set(token, { user, ...sessionData });
    sendJson(res, 200, { user }, {
      'set-cookie': `session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`
    });
  }

  async function getDataRepos(req) {
    if (dataStore) return dataStore;
    if (!dataStoreFactory) return repos;
    const session = currentSession(req);
    if (!session) return repos;
    return await dataStoreFactory(session);
  }

  function storeId(id, store) {
    return store === repos ? Number(id) : id;
  }

  async function logActivity(store, action, details) {
    const activity = store.activity || repos.activity;
    await activity.log(action, details);
  }

  function isAdminUser(user) {
    return user?.role === 'Admin';
  }

  function detailedPermissionFor(user, projectId, entryTypeId) {
    if (isAdminUser(user)) return null;
    if (!repos.projectMemberships.has(user.id, projectId)) return null;
    return repos.detailedPermissions.get(user.id, projectId, entryTypeId);
  }

  function hasDetailedAction(user, projectId, entryTypeId, action) {
    if (isAdminUser(user)) return true;
    return Boolean(detailedPermissionFor(user, projectId, entryTypeId)?.[action]);
  }

  async function listProjectsForUser(store, user) {
    let projects;
    if (store.projects.listForUser) {
      projects = await store.projects.listForUser(user);
    } else if (store !== repos && !isAdminUser(user)) {
      const projectIds = repos.projectMemberships.listForUser(user.id);
      if (!projectIds.length) return [];
      if (store.projects.listByIds) {
        projects = await store.projects.listByIds(projectIds);
      } else {
        const allowed = new Set(projectIds.map(id => String(id)));
        projects = (await store.projects.list()).filter(project => allowed.has(String(project.id)));
      }
    } else {
      projects = await store.projects.list();
    }
    return projects.map(project => decorateProjectForUser(project, user));
  }

  async function listProjectEntriesForUser(store, projectId, user) {
    if (store.entries.listByProjectForUser) return await store.entries.listByProjectForUser(projectId, user);
    const entries = await store.entries.listByProject(projectId);
    if (store === repos || isAdminUser(user)) return entries;
    return entries
      .map(entry => applyExternalEntryPermission(entry, user, projectId))
      .filter(Boolean);
  }

  async function searchEntriesForUser(store, query, user) {
    if (store.entries.searchForUser) return await store.entries.searchForUser(query, user);
    const entries = await store.entries.search(query);
    if (store === repos || isAdminUser(user)) return entries;
    return entries
      .map(entry => applyExternalEntryPermission(entry, user, entry.projectId))
      .filter(Boolean);
  }

  function applyExternalEntryPermission(entry, user, projectId) {
    const entryTypeId = resolveEntryTypeId(entry);
    const permission = detailedPermissionFor(user, projectId || entry.projectId, entryTypeId);
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

  function decorateProjectForUser(project, user) {
    if (isAdminUser(user)) return project;
    return {
      ...project,
      entryTypePermissions: repos.detailedPermissions.listForProject(project.id)
        .filter(permission => Number(permission.userId) === Number(user.id))
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

  function resolveEntryTypeId(input, existing = null) {
    if (input.typeId || input.entryTypeId) return Number(input.typeId || input.entryTypeId);
    if (input.type) {
      const type = repos.entryTypes.findByName(input.type);
      if (!type) throw new Error('Entry type not found');
      return type.id;
    }
    const existingTypeId = existing?.entry_type_id ?? existing?.typeId ?? existing?.entryTypeId;
    if (existingTypeId) return Number(existingTypeId);
    if (existing?.type) {
      const type = repos.entryTypes.findByName(existing.type);
      if (type) return type.id;
    }
    const fallback = repos.entryTypes.findByName('Other');
    return fallback?.id;
  }

  function resolveEntryInput(input, existing = null) {
    const entryTypeId = resolveEntryTypeId(input, existing);
    const entryType = repos.entryTypes.get(entryTypeId);
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

  function normalizeEntryForPermission(entry) {
    if (!entry) return null;
    return {
      projectId: entry.projectId ?? entry.project_id,
      entryTypeId: entry.typeId ?? entry.entryTypeId ?? entry.entry_type_id ?? resolveEntryTypeId(entry)
    };
  }

  async function findEntryForPermission(store, user, entryId) {
    if (store === repos) return normalizeEntryForPermission(repos.entries.getRaw(entryId));
    if (store.entries.get) return normalizeEntryForPermission(await store.entries.get(entryId));
    const projectIds = repos.projectMemberships.listForUser(user.id);
    for (const projectId of projectIds) {
      const entries = await store.entries.listByProject(projectId);
      const entry = entries.find(item => String(item.id) === String(entryId));
      if (entry) return normalizeEntryForPermission(entry);
    }
    return null;
  }

  async function findEditableEntry(store, user, entryId) {
    if (store === repos) return repos.entries.get(entryId);
    if (store.entries.get) return await store.entries.get(entryId);
    const projectIds = isAdminUser(user) ? (await store.projects.list()).map(project => project.id) : repos.projectMemberships.listForUser(user.id);
    for (const projectId of projectIds) {
      const entries = await store.entries.listByProject(projectId);
      const entry = entries.find(item => String(item.id) === String(entryId));
      if (entry) return entry;
    }
    return null;
  }

  async function requireEntryAction(req, res, store, entryId, action) {
    const user = requireUser(req, res);
    if (!user) return null;
    if (isAdminUser(user)) return user;
    const existing = await findEntryForPermission(store, user, entryId);
    if (!existing) {
      sendJson(res, 404, { error: 'Entry not found' });
      return null;
    }
    if (!hasDetailedAction(user, existing.projectId, existing.entryTypeId, action)) {
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
    return { inviteSent: true, user: repos.users.markInvited(user.id) };
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
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    try {
      if (req.method === 'POST' && path === '/api/auth/login') {
        const body = await readJson(req);
        let user;
        try {
          user = repos.users.authenticate(body.username, body.password);
        } catch (error) {
          return sendJson(res, 403, { error: error.message });
        }
        if (!user) return sendJson(res, 401, { error: 'Invalid username or password' });
        return createSession(user, res);
      }

      if (req.method === 'POST' && path === '/api/auth/google') {
        if (!verifyGoogleAccessToken) {
          return sendJson(res, 503, { error: 'Google login is not configured' });
        }
        const body = await readJson(req);
        if (!body.accessToken) return sendJson(res, 400, { error: 'Google access token is required' });

        let verified;
        try {
          verified = await verifyGoogleAccessToken(body.accessToken);
        } catch (error) {
          return sendJson(res, 401, { error: error.message || 'Invalid Google session' });
        }

        const email = String(verified?.email || '').trim();
        if (!email) return sendJson(res, 401, { error: 'Google account has no verified email' });

        let user;
        try {
          user = repos.users.activateForGoogleLogin(email);
        } catch (error) {
          return sendJson(res, 403, { error: error.message });
        }
        if (!user) {
          const requested = repos.users.requestGoogleAccess({
            username: email,
            displayName: verified?.name || verified?.displayName || email
          });
          repos.activity.log('user.access_request', { details: requested.username });
          return sendJson(res, 403, { error: 'Tài khoản đang chờ admin phê duyệt' });
        }

        return createSession(user, res, { accessToken: body.accessToken, google: verified });
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
        if (url.searchParams.get('basic') === '1') {
          return sendJson(res, 200, repos.users.list());
        }
        return sendJson(res, 200, repos.users.list().map(user => ({
          ...user,
          projectMemberships: repos.projectMemberships.listForUser(user.id),
          detailedPermissions: repos.detailedPermissions.listForUser(user.id)
        })));
      }

      if (req.method === 'POST' && path === '/api/users') {
        const user = requirePermission(req, res, 'users.manage');
        if (!user) return true;
        const input = await readJson(req);
        const isInviteOnly = !input.password;
        let created = repos.users.create({
          ...input,
          status: isInviteOnly ? 'Invited' : input.status,
          password: input.password || createSessionToken()
        });
        let inviteSent = false;
        if (inviteUserByEmail) {
          try {
            const invite = await sendUserInvite(created);
            inviteSent = invite.inviteSent;
            created = invite.user;
          } catch (error) {
            repos.users.delete(created.id, user.id);
            throw new Error(`Cannot send Supabase invite: ${error.message}`);
          }
        }
        if (Array.isArray(input.detailedPermissions)) {
          repos.detailedPermissions.replaceForUser(created.id, input.detailedPermissions);
        }
        const projectMemberships = projectMembershipsForInput(input);
        if (projectMemberships) repos.projectMemberships.replaceForUser(created.id, projectMemberships);
        repos.activity.log('user.create', { details: created.username });
        const detailedPermissions = repos.detailedPermissions.listForUser(created.id);
        const memberships = repos.projectMemberships.listForUser(created.id);
        return sendJson(res, 201, {
          ...created,
          projectMemberships: memberships,
          detailedPermissions,
          user: { ...created, projectMemberships: memberships, detailedPermissions },
          inviteSent
        });
      }

      const userMatch = path.match(/^\/api\/users\/(\d+)$/);
      const userInviteMatch = path.match(/^\/api\/users\/(\d+)\/invite$/);
      if (userInviteMatch && req.method === 'POST') {
        if (!requirePermission(req, res, 'users.manage')) return true;
        if (!inviteUserByEmail) return sendJson(res, 503, { error: 'Supabase invite is not configured' });
        const invitedUser = repos.users.get(Number(userInviteMatch[1]));
        if (!invitedUser) return sendJson(res, 404, { error: 'User not found' });
        const invite = await sendUserInvite(invitedUser);
        repos.activity.log('user.invite', { details: invitedUser.username });
        return sendJson(res, 200, { user: invite.user, inviteSent: invite.inviteSent });
      }
      if (userMatch && req.method === 'PATCH') {
        const user = requirePermission(req, res, 'users.manage');
        if (!user) return true;
        const id = Number(userMatch[1]);
        const existing = repos.users.get(id);
        if (!existing) return sendJson(res, 404, { error: 'User not found' });
        const input = await readJson(req);
        const updated = repos.users.update(id, input);
        if (Array.isArray(input.detailedPermissions)) {
          repos.detailedPermissions.replaceForUser(id, input.detailedPermissions);
        }
        const projectMemberships = projectMembershipsForInput(input);
        if (projectMemberships) repos.projectMemberships.replaceForUser(id, projectMemberships);
        const inviteSent = false;
        const approvalEmailRequired = existing.status === 'Pending' && updated.status === 'Active';
        const approvalEmailSent = approvalEmailRequired ? await sendApprovalNotification(updated) : false;
        repos.activity.log('user.update', { details: updated.username });
        const detailedPermissions = repos.detailedPermissions.listForUser(id);
        const memberships = repos.projectMemberships.listForUser(id);
        return sendJson(res, 200, {
          ...updated,
          projectMemberships: memberships,
          detailedPermissions,
          user: { ...updated, projectMemberships: memberships, detailedPermissions },
          inviteSent,
          approvalEmailSent,
          approvalEmailRequired
        });
      }
      if (userMatch && req.method === 'DELETE') {
        const user = requirePermission(req, res, 'users.manage');
        if (!user) return true;
        const id = Number(userMatch[1]);
        if (Number(id) === Number(user.id)) throw new Error('Cannot delete current user');
        const existing = repos.users.get(id);
        if (!existing) return sendJson(res, 404, { error: 'User not found' });
        const authDeleted = deleteAuthUserByEmail ? await deleteAuthUserByEmail(existing.username) : false;
        repos.users.delete(id, user.id);
        for (const [token, session] of sessions.entries()) {
          if (Number(session.user?.id) === Number(id)) sessions.delete(token);
        }
        repos.activity.log('user.delete', { details: existing.username });
        return sendJson(res, 200, { ok: true, authDeleted });
      }

      if (req.method === 'GET' && path === '/api/entry-types') {
        return sendJson(res, 200, repos.entryTypes.list({ includeInactive: hasPermission(authenticated, 'users.manage') }));
      }

      if (req.method === 'POST' && path === '/api/entry-types') {
        if (!requirePermission(req, res, 'users.manage')) return true;
        const type = repos.entryTypes.create(await readJson(req));
        repos.activity.log('entry_type.create', { details: type.name });
        return sendJson(res, 201, type);
      }

      const entryTypeMatch = path.match(/^\/api\/entry-types\/(\d+)$/);
      if (entryTypeMatch && req.method === 'PATCH') {
        if (!requirePermission(req, res, 'users.manage')) return true;
        const type = repos.entryTypes.update(Number(entryTypeMatch[1]), await readJson(req));
        repos.activity.log('entry_type.update', { details: type.name });
        return sendJson(res, 200, type);
      }

      if (req.method === 'GET' && path === '/api/projects') {
        const dataRepos = await getDataRepos(req);
        const projects = await listProjectsForUser(dataRepos, authenticated);
        return sendJson(res, 200, projects);
      }

      if (req.method === 'POST' && path === '/api/projects') {
        if (!requireAdmin(req, res)) return true;
        const dataRepos = await getDataRepos(req);
        const project = await dataRepos.projects.create(await readJson(req));
        await logActivity(dataRepos, 'project.create', { projectId: project.id, details: project.name });
        return sendJson(res, 201, project);
      }

      const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      const projectMembersMatch = path.match(/^\/api\/projects\/([^/]+)\/members$/);
      if (projectMembersMatch && req.method === 'GET') {
        if (!requirePermission(req, res, 'users.manage')) return true;
        const projectId = decodeURIComponent(projectMembersMatch[1]);
        return sendJson(res, 200, projectMembersPayload(projectId));
      }
      if (projectMembersMatch && req.method === 'PATCH') {
        if (!requirePermission(req, res, 'users.manage')) return true;
        const projectId = decodeURIComponent(projectMembersMatch[1]);
        const input = await readJson(req);
        const members = Array.isArray(input.members) ? input.members : [];
        const nonAdminMembers = members.filter(member => !isAdminUser(repos.users.get(Number(member.userId))));
        repos.projectMemberships.replaceForProject(projectId, nonAdminMembers.map(member => member.userId));
        repos.detailedPermissions.replaceForProject(projectId, nonAdminMembers.flatMap(member => (
          member.detailedPermissions || []
        ).map(permission => ({
          ...permission,
          userId: member.userId,
          projectId
        }))));
        repos.activity.log('project.members.update', { projectId, details: `${nonAdminMembers.length} members` });
        return sendJson(res, 200, { members: projectMembersPayload(projectId) });
      }
      if (projectMatch && req.method === 'PATCH') {
        if (!requireAdmin(req, res)) return true;
        const dataRepos = await getDataRepos(req);
        const project = await dataRepos.projects.update(storeId(projectMatch[1], dataRepos), await readJson(req));
        await logActivity(dataRepos, 'project.update', { projectId: project.id, details: project.name });
        return sendJson(res, 200, project);
      }
      if (projectMatch && req.method === 'DELETE') {
        if (!requireAdmin(req, res)) return true;
        const dataRepos = await getDataRepos(req);
        await dataRepos.projects.delete(storeId(projectMatch[1], dataRepos));
        await logActivity(dataRepos, 'project.delete', { projectId: storeId(projectMatch[1], dataRepos) });
        return sendJson(res, 200, { ok: true });
      }

      const projectEntriesMatch = path.match(/^\/api\/projects\/([^/]+)\/entries$/);
      if (projectEntriesMatch && req.method === 'GET') {
        const dataRepos = await getDataRepos(req);
        const id = storeId(projectEntriesMatch[1], dataRepos);
        const entries = await listProjectEntriesForUser(dataRepos, id, authenticated);
        return sendJson(res, 200, entries);
      }

      if (req.method === 'GET' && path === '/api/entries/search') {
        const dataRepos = await getDataRepos(req);
        const entries = await searchEntriesForUser(dataRepos, url.searchParams.get('q') || '', authenticated);
        return sendJson(res, 200, entries);
      }

      const entryEditMatch = path.match(/^\/api\/entries\/([^/]+)\/edit$/);
      if (entryEditMatch && req.method === 'GET') {
        const dataRepos = await getDataRepos(req);
        const entryId = storeId(entryEditMatch[1], dataRepos);
        const user = await requireEntryAction(req, res, dataRepos, entryId, 'canEdit');
        if (!user) return true;
        const entry = await findEditableEntry(dataRepos, user, entryId);
        if (!entry) return sendJson(res, 404, { error: 'Entry not found' });
        return sendJson(res, 200, {
          ...entry,
          typeId: entry.typeId || resolveEntryTypeId(entry)
        });
      }

      if (req.method === 'POST' && path === '/api/entries') {
        const user = requireUser(req, res);
        if (!user) return true;
        const input = await readJson(req);
        const entryInput = resolveEntryInput(input);
        if (!isAdminUser(user) && !hasDetailedAction(user, entryInput.projectId, entryInput.typeId, 'canCreate')) {
          return sendJson(res, 403, { error: 'Permission denied' });
        }
        const dataRepos = await getDataRepos(req);
        const entry = await dataRepos.entries.create(entryInput);
        await logActivity(dataRepos, 'entry.create', { projectId: entry.projectId, entryId: entry.id, details: entry.name });
        return sendJson(res, 201, entry);
      }

      const entryMatch = path.match(/^\/api\/entries\/([^/]+)$/);
      if (entryMatch && req.method === 'PATCH') {
        const dataRepos = await getDataRepos(req);
        const entryId = storeId(entryMatch[1], dataRepos);
        const user = await requireEntryAction(req, res, dataRepos, entryId, 'canEdit');
        if (!user) return true;
        const input = await readJson(req);
        const existing = dataRepos === repos
          ? repos.entries.getRaw(storeId(entryMatch[1], repos))
          : await findEntryForPermission(dataRepos, user, entryId);
        const entryInput = resolveEntryInput(input, existing);
        const targetProjectId = entryInput.projectId || existing?.project_id || existing?.projectId;
        const targetTypeId = entryInput.typeId;
        if (!isAdminUser(user) && !hasDetailedAction(user, targetProjectId, targetTypeId, 'canEdit')) {
          return sendJson(res, 403, { error: 'Permission denied' });
        }
        const entry = await dataRepos.entries.update(entryId, entryInput);
        await logActivity(dataRepos, 'entry.update', { projectId: entry.projectId, entryId: entry.id, details: entry.name });
        return sendJson(res, 200, entry);
      }
      if (entryMatch && req.method === 'DELETE') {
        const dataRepos = await getDataRepos(req);
        if (!await requireEntryAction(req, res, dataRepos, storeId(entryMatch[1], dataRepos), 'canDelete')) return true;
        await dataRepos.entries.delete(storeId(entryMatch[1], dataRepos));
        await logActivity(dataRepos, 'entry.delete', { entryId: storeId(entryMatch[1], dataRepos) });
        return sendJson(res, 200, { ok: true });
      }

      const revealMatch = path.match(/^\/api\/entries\/([^/]+)\/reveal-password$/);
      if (revealMatch && req.method === 'POST') {
        const dataRepos = await getDataRepos(req);
        const id = storeId(revealMatch[1], dataRepos);
        if (!await requireEntryAction(req, res, dataRepos, id, 'canRevealPassword')) return true;
        await logActivity(dataRepos, 'entry.reveal_password', { entryId: id });
        const password = dataRepos.entries.revealPasswordForUser
          ? await dataRepos.entries.revealPasswordForUser(id, authenticated)
          : await dataRepos.entries.revealPassword(id);
        return sendJson(res, 200, { password });
      }

      const copyLogMatch = path.match(/^\/api\/entries\/([^/]+)\/copy-password-log$/);
      if (copyLogMatch && req.method === 'POST') {
        const dataRepos = await getDataRepos(req);
        if (!await requireEntryAction(req, res, dataRepos, storeId(copyLogMatch[1], dataRepos), 'canRevealPassword')) return true;
        await logActivity(dataRepos, 'entry.copy_password', { entryId: storeId(copyLogMatch[1], dataRepos) });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && path === '/api/export/json') {
        if (!requireAdmin(req, res)) return true;
        repos.activity.log('export.json');
        const includePasswords = url.searchParams.get('passwords') === '1';
        return sendJson(res, 200, {
          exportedAt: new Date().toISOString(),
          projects: repos.projects.listForUser(authenticated),
          entries: repos.entries.exportForUser(authenticated, { includePasswords }),
          settings: repos.settings.getAll()
        });
      }

      if (req.method === 'GET' && path === '/api/export/csv') {
        if (!requireAdmin(req, res)) return true;
        repos.activity.log('export.csv');
        const includePasswords = url.searchParams.get('passwords') === '1';
        const rows = repos.entries.exportForUser(authenticated, { includePasswords });
        const headers = ['projectId', 'name', 'type', 'environment', 'url', 'username', 'password', 'notes', 'tags', 'status'];
        const csv = [headers.join(',')].concat(rows.map(row => headers.map(key => {
          const value = key === 'tags' ? row.tags.join('|') : row[key];
          return csvEscape(value);
        }).join(','))).join('\n');
        return sendText(res, 200, csv, { 'content-type': 'text/csv; charset=utf-8' });
      }

      if (req.method === 'POST' && path === '/api/backups/save-json') {
        if (!requireAdmin(req, res)) return true;
        const result = writeBackupFiles(db, backupDir);
        repos.activity.log('backup.save_json', { details: result.latestPath });
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
          const project = repos.projects.create({ name: row.projectName, description: '', status: 'Active' });
          created.push(repos.entries.create({ ...row, projectId: project.id, tags: splitTags(row.tags) }));
        }
        repos.activity.log('import.commit', { details: `${created.length} entries` });
        return sendJson(res, 201, { created });
      }

      if (req.method === 'GET' && path === '/api/activity') {
        return sendJson(res, 200, repos.activity.list());
      }

      if (req.method === 'GET' && path === '/api/settings') {
        return sendJson(res, 200, repos.settings.getAll());
      }

      if (req.method === 'PATCH' && path === '/api/settings') {
        if (!requireAdmin(req, res)) return true;
        return sendJson(res, 200, repos.settings.update(await readJson(req)));
      }

      sendJson(res, 404, { error: 'Not found' });
      return true;
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return true;
    }
  };

  function projectMembersPayload(projectId) {
    const memberIds = new Set(repos.projectMemberships.listForProject(projectId).map(id => Number(id)));
    const permissions = repos.detailedPermissions.listForProject(projectId);
    return repos.users.list()
      .filter(user => user.role !== 'Admin' && memberIds.has(Number(user.id)))
      .map(user => ({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        detailedPermissions: permissions.filter(permission => Number(permission.userId) === Number(user.id))
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
