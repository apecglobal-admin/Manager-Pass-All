import { randomBytes } from 'node:crypto';
import { decryptText, encryptText } from './crypto.js';
import { DEFAULT_AUTO_LOCK_MINUTES } from './config.js';

export const ROLE_PERMISSIONS = {
  Admin: ['users.manage'],
  Manager: ['users.manage'],
  Viewer: []
};

const DEFAULT_ENTRY_TYPES = ['Web', 'Admin', 'Mobile', 'Desktop', 'API', 'Hosting', 'Domain', 'Database', 'Server', 'Other'];

export function createSupabaseRepositories({ supabase, encryptionKey }) {
  if (!supabase) throw new Error('Supabase client is required');

  const repos = {
    users: usersRepo(supabase),
    departments: departmentsRepo(supabase),
    entryTypes: entryTypesRepo(supabase),
    projects: projectsRepo(supabase),
    projectSystems: projectSystemsRepo(supabase),
    entries: entriesRepo(supabase, encryptionKey),
    projectMemberships: projectMembershipsRepo(supabase),
    detailedPermissions: detailedPermissionsRepo(supabase),
    activity: activityRepo(supabase),
    settings: settingsRepo(supabase),
    export: null
  };
  repos.export = exportRepo(repos);
  return repos;
}

export function hasPermission(user, permission) {
  if (normalizeRole(user?.role) === 'Admin') return true;
  return Boolean(user?.permissions?.includes(permission));
}

function usersRepo(client) {
  return {
    async authenticate() {
      throw new Error('Password login is disabled. Use Supabase login.');
    },
    async findActiveByUsername(username) {
      const user = await findUserByUsername(client, username);
      if (!user) return null;
      if (normalizeUserStatus(user.status) !== 'Active') throw new Error('User is inactive');
      return await hydrateUserDepartments(client, mapUser(user));
    },
    async activateForGoogleLogin(username, verified = {}) {
      const user = await findUserByUsername(client, username);
      if (!user) return null;
      const status = normalizeUserStatus(user.status);
      if (status === 'Inactive') throw new Error('User is inactive');
      if (status === 'Expired') throw new Error('Invite expired');
      if (status === 'Pending') throw new Error('Tai khoan dang cho admin phe duyet');
      const patch = {};
      if (verified.authUserId && !user.auth_user_id) patch.auth_user_id = verified.authUserId;
      if (status === 'Invited') {
        patch.status = 'Active';
        patch.accepted_at = new Date().toISOString();
      }
      if (Object.keys(patch).length) {
        const { data, error } = await client
          .from('app_users')
          .update(patch)
          .eq('id', user.id)
          .select()
          .single();
        if (error) throw error;
        return await hydrateUserDepartments(client, mapUser(data));
      }
      return await hydrateUserDepartments(client, mapUser(user));
    },
    async requestGoogleAccess(input) {
      const username = normalizeEmail(input.username);
      if (!username) throw new Error('Username is required');
      const existing = await findUserByUsername(client, username);
      if (existing) return await hydrateUserDepartments(client, mapUser(existing));
      const bootstrapAdmin = await hasNoAppUsers(client);
      const role = bootstrapAdmin ? 'Admin' : 'Viewer';
      const { data, error } = await client
        .from('app_users')
        .insert({
          auth_user_id: input.authUserId || null,
          username,
          display_name: input.displayName?.trim() || username,
          role,
          status: bootstrapAdmin ? 'Active' : 'Pending',
          permissions: normalizePermissions([], role),
          department_id: null,
          preferences: {},
          accepted_at: bootstrapAdmin ? new Date().toISOString() : null
        })
        .select()
        .single();
      if (error) throw error;
      return await hydrateUserDepartments(client, mapUser(data));
    },
    async list() {
      const { data, error } = await client.from('app_users').select('*').order('username', { ascending: true });
      if (error) throw error;
      return await hydrateUsersDepartments(client, data.map(mapUser));
    },
    async get(id) {
      const { data, error } = await client.from('app_users').select('*').eq('id', id).single();
      if (error) throw error;
      return await hydrateUserDepartments(client, mapUser(data));
    },
    async create(input) {
      const username = normalizeEmail(input.username);
      if (!username) throw new Error('Username is required');
      const role = normalizeRole(input.role);
      const departmentIds = normalizeUserDepartmentIds(input, role);
      const { data, error } = await client
        .from('app_users')
        .insert({
          username,
          display_name: input.displayName?.trim() || username,
          department_id: departmentIds[0] || null,
          role,
          status: normalizeUserStatus(input.status || 'Active'),
          permissions: normalizePermissions(input.permissions, role),
          preferences: sanitizeUserPreferences(input.preferences),
          invitation_sent_at: input.invitationSentAt || null,
          invite_expires_at: input.inviteExpiresAt || null,
          accepted_at: input.acceptedAt || null
        })
        .select()
        .single();
      if (error) throw error;
      await syncUserDepartments(client, data.id, departmentIds);
      return await hydrateUserDepartments(client, mapUser(data));
    },
    async markInvited(id, { sentAt = new Date(), expiresAt = addHours(sentAt, 24) } = {}) {
      const { data, error } = await client
        .from('app_users')
        .update({
          status: 'Invited',
          invitation_sent_at: toIso(sentAt),
          invite_expires_at: toIso(expiresAt),
          accepted_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return await hydrateUserDepartments(client, mapUser(data));
    },
    async update(id, input) {
      const current = await this.get(id);
      if (!current) throw new Error('User not found');
      const role = normalizeRole(input.role || current.role);
      const departmentIds = normalizeUserDepartmentIds(
        input.departmentIds === undefined && input.departmentId === undefined
          ? { departmentIds: current.departmentIds, departmentId: current.departmentId }
          : input,
        role
      );
      const { data, error } = await client
        .from('app_users')
        .update({
          display_name: input.displayName?.trim() || current.displayName || current.username,
          department_id: departmentIds[0] || null,
          role,
          status: normalizeUserStatus(input.status || current.status || 'Active'),
          permissions: input.permissions === undefined
            ? normalizePermissions(current.permissions, role)
            : normalizePermissions(input.permissions, role),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      await syncUserDepartments(client, id, departmentIds);
      return await hydrateUserDepartments(client, mapUser(data));
    },
    async updatePreferences(id, preferences = {}) {
      const current = await this.get(id);
      if (!current) throw new Error('User not found');
      const nextPreferences = {
        ...(current.preferences || {}),
        ...sanitizeUserPreferences(preferences)
      };
      const { data, error } = await client
        .from('app_users')
        .update({
          preferences: nextPreferences,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return await hydrateUserDepartments(client, mapUser(data));
    },
    async delete(id, currentUserId) {
      if (String(id) === String(currentUserId)) throw new Error('Cannot delete current user');
      const { error } = await client.from('app_users').delete().eq('id', id);
      if (error) throw error;
    }
  };
}

function departmentsRepo(client) {
  return {
    async list() {
      const { data, error } = await client.from('departments').select('*').order('sort_order', { ascending: true });
      if (error) throw error;
      return data.map(mapDepartment);
    },
    async create(input) {
      const name = String(input.name || '').trim();
      if (!name) throw new Error('Department name is required');
      const { data, error } = await client
        .from('departments')
        .insert({
          name,
          description: input.description || '',
          sort_order: input.sortOrder || await nextDepartmentSortOrder(client)
        })
        .select()
        .single();
      if (error) throw error;
      return mapDepartment(data);
    }
  };
}

function entryTypesRepo(client) {
  return {
    async list({ includeInactive = false } = {}) {
      let query = client.from('entry_types').select('*').order('sort_order', { ascending: true });
      if (!includeInactive) query = query.eq('is_active', true);
      const { data, error } = await query;
      if (error) throw error;
      return data.map(mapEntryType);
    },
    async get(id) {
      const { data, error } = await client.from('entry_types').select('*').eq('id', id).single();
      if (error) throw error;
      return mapEntryType(data);
    },
    async findByName(name) {
      const types = await this.list({ includeInactive: true });
      return types.find(type => type.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;
    },
    async create(input) {
      const name = String(input.name || '').trim();
      if (!name) throw new Error('Entry type name is required');
      const { data, error } = await client
        .from('entry_types')
        .insert({
          name,
          slug: slugify(input.slug || name),
          description: input.description || '',
          sort_order: input.sortOrder || await nextTypeSortOrder(client),
          is_active: input.isActive !== false
        })
        .select()
        .single();
      if (error) throw error;
      return mapEntryType(data);
    },
    async update(id, input) {
      const patch = {
        updated_at: new Date().toISOString()
      };
      if (input.name !== undefined) {
        patch.name = String(input.name || '').trim();
        patch.slug = slugify(input.slug || input.name);
      }
      if (input.description !== undefined) patch.description = input.description || '';
      if (input.sortOrder !== undefined) patch.sort_order = Number(input.sortOrder) || 0;
      if (input.isActive !== undefined) patch.is_active = Boolean(input.isActive);
      const { data, error } = await client.from('entry_types').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return mapEntryType(data);
    },
    async delete(id) {
      const { data: usedEntries, error: usedEntriesError } = await client
        .from('entries')
        .select('id')
        .eq('entry_type_id', id)
        .is('deleted_at', null)
        .limit(1);
      if (usedEntriesError) throw usedEntriesError;
      if (usedEntries?.length) throw new Error('Entry type is being used by entries');

      const { error } = await client.from('entry_types').delete().eq('id', id);
      if (error) throw error;
    },
    defaults() {
      return DEFAULT_ENTRY_TYPES;
    }
  };
}

function projectsRepo(client) {
  return {
    async list() {
      const { data, error } = await client
        .from('projects')
        .select('*')
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return data.map(mapProject);
    },
    async listByIds(ids = []) {
      const projectIds = uniqueStrings(ids);
      if (!projectIds.length) return [];
      const { data, error } = await client
        .from('projects')
        .select('*')
        .in('id', projectIds)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return data.map(mapProject);
    },
    async listForUser(user) {
      if (isAdmin(user)) return await this.list();
      const memberships = await projectMembershipsRepo(client).listForUser(user.id);
      return await this.listByIds(memberships);
    },
    async create(input) {
      const vaultId = input.vaultId || await resolveVaultId(client, input.ownerAuthUserId || input.authUserId);
      const { data, error } = await client
        .from('projects')
        .insert({
          vault_id: vaultId,
          name: input.name.trim(),
          description: input.description || '',
          status: input.status || 'Active',
          sort_order: input.sortOrder || await nextProjectSortOrder(client)
        })
        .select()
        .single();
      if (error) throw error;
      return mapProject(data);
    },
    async update(id, input) {
      const patch = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.description !== undefined) patch.description = input.description || '';
      if (input.status !== undefined) patch.status = input.status || 'Active';
      if (input.sortOrder !== undefined) patch.sort_order = Number(input.sortOrder) || 0;
      const { data, error } = await client
        .from('projects')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return mapProject(data);
    },
    async delete(id) {
      const { error } = await client
        .from('projects')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    async reorder(ids = []) {
      const projectIds = uniqueStrings(ids);
      for (const [index, id] of projectIds.entries()) {
        const { error } = await client
          .from('projects')
          .update({ sort_order: index + 1, updated_at: new Date().toISOString() })
          .eq('id', id)
          .is('deleted_at', null);
        if (error) throw error;
      }
    }
  };
}

function projectSystemsRepo(client) {
  return {
    async listForProject(projectId) {
      const { data, error } = await client
        .from('project_systems')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return data.map(mapProjectSystem);
    },
    async get(id) {
      const { data, error } = await client
        .from('project_systems')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .single();
      if (error) throw error;
      return mapProjectSystem(data);
    },
    async create(input) {
      const name = String(input.name || '').trim();
      if (!name) throw new Error('System name is required');
      const { data, error } = await client
        .from('project_systems')
        .insert({
          project_id: input.projectId,
          name,
          type: input.type || 'Web',
          description: input.description || '',
          status: input.status || 'Active',
          sort_order: input.sortOrder || await nextProjectSystemSortOrder(client, input.projectId)
        })
        .select()
        .single();
      if (error) throw error;
      return mapProjectSystem(data);
    },
    async update(id, input) {
      const patch = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = String(input.name || '').trim();
      if (input.type !== undefined) patch.type = input.type || 'Web';
      if (input.description !== undefined) patch.description = input.description || '';
      if (input.status !== undefined) patch.status = input.status || 'Active';
      if (input.sortOrder !== undefined) patch.sort_order = Number(input.sortOrder) || 0;
      const { data, error } = await client.from('project_systems').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return mapProjectSystem(data);
    },
    async delete(id) {
      const { data: usedEntries, error: usedEntriesError } = await client
        .from('entries')
        .select('id')
        .eq('system_id', id)
        .is('deleted_at', null)
        .limit(1);
      if (usedEntriesError) throw usedEntriesError;
      if (usedEntries?.length) throw new Error('System is being used by entries');
      const { error } = await client
        .from('project_systems')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    async reorder(projectId, ids = []) {
      const systemIds = uniqueStrings(ids);
      for (const [index, id] of systemIds.entries()) {
        const { error } = await client
          .from('project_systems')
          .update({ sort_order: index + 1, updated_at: new Date().toISOString() })
          .eq('project_id', projectId)
          .eq('id', id)
          .is('deleted_at', null);
        if (error) throw error;
      }
    }
  };
}

function entriesRepo(client, encryptionKey) {
  return {
    async listByProject(projectId) {
      const { data, error } = await client
        .from('entries')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw error;
      const entries = data.map(row => mapEntry(row, encryptionKey));
      return attachEntryCredentials(entries, await credentialsForEntries(client, entries.map(entry => entry.id)));
    },
    async listByProjectForUser(projectId) {
      return await this.listByProject(projectId);
    },
    async search(query) {
      const { data, error } = await client
        .from('entries')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw error;
      const term = String(query || '').toLowerCase();
      const entries = data
        .filter(row => !term
          || String(row.name || '').toLowerCase().includes(term)
          || String(row.url || '').toLowerCase().includes(term)
          || String(row.username || '').toLowerCase().includes(term))
        .map(row => mapEntry(row, encryptionKey));
      return attachEntryCredentials(entries, await credentialsForEntries(client, entries.map(entry => entry.id)));
    },
    async searchForUser(query) {
      return await this.search(query);
    },
    async get(id) {
      const row = await getEntryRow(client, id);
      return attachEntryCredentials([mapEntry(row, encryptionKey)], await credentialsForEntries(client, [id]))[0];
    },
    async getRaw(id) {
      return await getEntryRow(client, id);
    },
    async create(input) {
      const project = await getProjectRow(client, input.projectId);
      const { data, error } = await client
        .from('entries')
        .insert({
          vault_id: input.vaultId || project?.vault_id || await resolveVaultId(client, input.ownerAuthUserId || input.authUserId),
          project_id: input.projectId,
          system_id: input.systemId || input.projectSystemId || null,
          entry_type_id: input.typeId || input.entryTypeId || null,
          name: input.name.trim(),
          type: input.type || 'Other',
          environment: input.environment || 'Production',
          url: input.url || '',
          username: input.username || '',
          password_cipher: encryptPayload(input.password || '', encryptionKey),
          secret_notes_cipher: encryptPayload(input.notes || '', encryptionKey),
          tags: input.tags || [],
          status: input.status || 'Active'
        })
        .select()
        .single();
      if (error) throw error;
      if (Array.isArray(input.credentials)) await syncEntryCredentials(client, data.id, input.credentials, encryptionKey);
      return attachEntryCredentials([mapEntry(data, encryptionKey)], await credentialsForEntries(client, [data.id]))[0];
    },
    async update(id, input) {
      const patch = {
        project_id: input.projectId,
        system_id: input.systemId || input.projectSystemId || null,
        entry_type_id: input.typeId || input.entryTypeId || null,
        name: input.name.trim(),
        type: input.type || 'Other',
        environment: input.environment || 'Production',
        url: input.url || '',
        username: input.username || '',
        secret_notes_cipher: encryptPayload(input.notes || '', encryptionKey),
        tags: input.tags || [],
        status: input.status || 'Active',
        updated_at: new Date().toISOString()
      };
      if (input.password !== undefined) patch.password_cipher = encryptPayload(input.password || '', encryptionKey);
      const { data, error } = await client.from('entries').update(patch).eq('id', id).select().single();
      if (error) throw error;
      if (Array.isArray(input.credentials)) await syncEntryCredentials(client, id, input.credentials, encryptionKey);
      return attachEntryCredentials([mapEntry(data, encryptionKey)], await credentialsForEntries(client, [id]))[0];
    },
    async delete(id) {
      const { error } = await client
        .from('entries')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    async revealPassword(id) {
      const row = await getEntryRow(client, id);
      return decryptPayload(row?.password_cipher, encryptionKey);
    },
    async revealPasswordForUser(id) {
      return await this.revealPassword(id);
    },
    async getCredential(entryId, credentialId) {
      return mapCredential(await getCredentialRow(client, entryId, credentialId));
    },
    async revealCredentialPassword(entryId, credentialId) {
      const credential = await getCredentialRow(client, entryId, credentialId);
      return decryptPayload(credential?.password_cipher, encryptionKey);
    },
    async exportForUser(_user, { includePasswords = false } = {}) {
      const { data, error } = await client.from('entries').select('*').is('deleted_at', null).order('name', { ascending: true });
      if (error) throw error;
      return data.map(row => mapEntryExport(row, encryptionKey, includePasswords));
    }
  };
}

function projectMembershipsRepo(client) {
  return {
    async listForUser(userId) {
      const { data, error } = await client.from('project_memberships').select('*').eq('user_id', userId);
      if (error) throw error;
      return data.map(row => row.project_id);
    },
    async listForProject(projectId) {
      const { data, error } = await client.from('project_memberships').select('*').eq('project_id', projectId);
      if (error) throw error;
      return data.map(row => row.user_id);
    },
    async has(userId, projectId) {
      const ids = await this.listForUser(userId);
      return ids.some(id => String(id) === String(projectId));
    },
    async replaceForUser(userId, projectIds = []) {
      await client.from('project_memberships').delete().eq('user_id', userId);
      const rows = uniqueStrings(projectIds).map(projectId => ({ user_id: userId, project_id: projectId }));
      if (!rows.length) return;
      const { error } = await client.from('project_memberships').insert(rows);
      if (error) throw error;
    },
    async replaceForProject(projectId, userIds = []) {
      await client.from('project_memberships').delete().eq('project_id', projectId);
      const rows = uniqueStrings(userIds).map(userId => ({ user_id: userId, project_id: projectId }));
      if (!rows.length) return;
      const { error } = await client.from('project_memberships').insert(rows);
      if (error) throw error;
    }
  };
}

function detailedPermissionsRepo(client) {
  return {
    async get(userId, projectId, entryTypeId) {
      const rows = await this.listForUser(userId);
      return rows.find(row => String(row.projectId) === String(projectId) && String(row.entryTypeId) === String(entryTypeId)) || null;
    },
    async getBySystem(userId, projectId, systemId) {
      const rows = await this.listForUser(userId);
      return rows.find(row => String(row.projectId) === String(projectId) && String(row.systemId) === String(systemId)) || null;
    },
    async listForUser(userId) {
      const { data, error } = await client.from('detailed_permissions').select('*').eq('user_id', userId);
      if (error) throw error;
      return data.map(mapPermission);
    },
    async listForProject(projectId) {
      const { data, error } = await client.from('detailed_permissions').select('*').eq('project_id', projectId);
      if (error) throw error;
      return data.map(mapPermission);
    },
    async upsert(userId, projectId, entryTypeId, permission) {
      const existing = permission.systemId
        ? await this.getBySystem(userId, projectId, permission.systemId)
        : await this.get(userId, projectId, entryTypeId);
      const payload = permissionPayload({ userId, projectId, entryTypeId, ...permission });
      if (existing) {
        const { data, error } = await client.from('detailed_permissions').update(payload).eq('id', existing.id).select().single();
        if (error) throw error;
        return mapPermission(data);
      }
      const { data, error } = await client.from('detailed_permissions').insert(payload).select().single();
      if (error) throw error;
      return mapPermission(data);
    },
    async replaceForUser(userId, permissions = []) {
      await client.from('detailed_permissions').delete().eq('user_id', userId);
      await insertPermissions(client, permissions.map(permission => ({ ...permission, userId })));
    },
    async replaceForProject(projectId, permissions = []) {
      await client.from('detailed_permissions').delete().eq('project_id', projectId);
      await insertPermissions(client, permissions.map(permission => ({ ...permission, projectId })));
    }
  };
}

function activityRepo(client) {
  return {
    async log(action, { projectId = null, entryId = null, details = '' } = {}) {
      const { error } = await client.from('activity_logs').insert({
        action,
        entry_id: entryId || null,
        metadata: { projectId, details }
      });
      if (error) throw error;
    },
    async list() {
      const { data, error } = await client.from('activity_logs').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(row => ({
        id: row.id,
        action: row.action,
        projectId: row.metadata?.projectId || null,
        entryId: row.entry_id || null,
        details: row.metadata?.details || '',
        createdAt: row.created_at
      }));
    }
  };
}

function settingsRepo(client) {
  return {
    async getAll() {
      const { data, error } = await client.from('app_settings').select('*');
      if (error) throw error;
      return {
        autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
        ...Object.fromEntries(data.map(row => [row.key, row.value]))
      };
    },
    async update(input) {
      const entries = Object.entries(input || {});
      for (const [key, value] of entries) {
        const existing = await client.from('app_settings').select('*').eq('key', key).single();
        if (existing.data) {
          const { error } = await client.from('app_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
          if (error) throw error;
        } else {
          const { error } = await client.from('app_settings').insert({ key, value });
          if (error) throw error;
        }
      }
      return await this.getAll();
    }
  };
}

function exportRepo(repos) {
  return {
    async backupJson({ includePasswords = false } = {}) {
      const [users, departments, projects, entries, settings] = await Promise.all([
        repos.users.list(),
        repos.departments.list(),
        repos.projects.list(),
        repos.entries.exportForUser({ role: 'Admin' }, { includePasswords }),
        repos.settings.getAll()
      ]);
      return {
        exportedAt: new Date().toISOString(),
        counts: {
          users: users.length,
          departments: departments.length,
          projects: projects.length,
          entries: entries.length,
          settings: Object.keys(settings).length
        },
        users,
        departments,
        projects,
        entries,
        settings
      };
    }
  };
}

async function findUserByUsername(client, username) {
  const normalized = normalizeEmail(username);
  if (!normalized) return null;
  const { data, error } = await client.from('app_users').select('*').eq('username', normalized).single();
  if (isMissingSingleRowError(error)) return null;
  if (error) throw error;
  return data || null;
}

async function hasNoAppUsers(client) {
  if (typeof client.rpc === 'function') {
    const result = await client.rpc('has_no_app_users');
    if (!result.error) return Boolean(result.data);
    if (result.error.code !== 'PGRST202') throw result.error;
  }
  const { data, error } = await client.from('app_users').select('id').limit(1);
  if (error) throw error;
  return !data?.length;
}

async function getEntryRow(client, id) {
  const { data, error } = await client.from('entries').select('*').eq('id', id).single();
  if (error) throw error;
  if (!data) throw new Error('Entry not found');
  return data;
}

async function getCredentialRow(client, entryId, credentialId) {
  const { data, error } = await client
    .from('entry_credentials')
    .select('*')
    .eq('entry_id', entryId)
    .eq('id', credentialId)
    .is('deleted_at', null)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Credential not found');
  return data;
}

async function credentialsForEntries(client, entryIds) {
  if (!entryIds.length) return [];
  const { data, error } = await client
    .from('entry_credentials')
    .select('*')
    .in('entry_id', entryIds)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data.map(mapCredential);
}

function attachEntryCredentials(entries, credentials) {
  const byEntryId = new Map();
  for (const credential of credentials) {
    const key = String(credential.entryId);
    byEntryId.set(key, [...(byEntryId.get(key) || []), credential]);
  }
  return entries.map(entry => {
    const entryCredentials = byEntryId.get(String(entry.id)) || [];
    return {
      ...entry,
      credentials: entryCredentials,
      username: entryCredentials[0]?.username || entry.username || ''
    };
  });
}

async function syncEntryCredentials(client, entryId, credentials, encryptionKey) {
  const { data: existingRows, error: existingError } = await client
    .from('entry_credentials')
    .select('*')
    .eq('entry_id', entryId)
    .is('deleted_at', null);
  if (existingError) throw existingError;

  const existingIds = new Set((existingRows || []).map(row => String(row.id)));
  const incomingIds = new Set(credentials.filter(item => item.id).map(item => String(item.id)));

  for (const id of existingIds) {
    if (incomingIds.has(id)) continue;
    const { error } = await client
      .from('entry_credentials')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  for (const [index, credential] of credentials.entries()) {
    const payload = {
      entry_id: entryId,
      department_id: credential.departmentId || null,
      username: credential.username || '',
      sort_order: index + 1,
      updated_at: new Date().toISOString()
    };
    if (credential.password !== undefined) payload.password_cipher = encryptPayload(credential.password || '', encryptionKey);

    if (credential.id && existingIds.has(String(credential.id))) {
      const { error } = await client.from('entry_credentials').update(payload).eq('id', credential.id);
      if (error) throw error;
    } else {
      const { error } = await client.from('entry_credentials').insert({
        ...payload,
        password_cipher: payload.password_cipher || encryptPayload('', encryptionKey)
      });
      if (error) throw error;
    }
  }
}

async function getProjectRow(client, id) {
  if (!id) return null;
  const { data, error } = await client.from('projects').select('*').eq('id', id).single();
  if (isMissingSingleRowError(error)) return null;
  if (error) throw error;
  return data || null;
}

async function hydrateUserDepartments(client, user) {
  if (!user) return user;
  return (await hydrateUsersDepartments(client, [user]))[0] || user;
}

async function hydrateUsersDepartments(client, users) {
  if (!users.length) return users;
  const userIds = users.map(user => user.id).filter(Boolean);
  if (!userIds.length) return users;
  const { data, error } = await client
    .from('user_departments')
    .select('*')
    .in('user_id', userIds);
  if (isMissingTableError(error)) {
    return users.map(user => ({
      ...user,
      departmentIds: user.departmentId ? [user.departmentId] : []
    }));
  }
  if (error) throw error;
  const byUserId = new Map();
  for (const row of data || []) {
    const key = String(row.user_id);
    byUserId.set(key, [...(byUserId.get(key) || []), row.department_id]);
  }
  return users.map(user => {
    const departmentIds = byUserId.get(String(user.id)) || (user.departmentId ? [user.departmentId] : []);
    return {
      ...user,
      departmentId: user.role === 'Admin' ? null : (departmentIds[0] || user.departmentId || null),
      departmentIds: user.role === 'Admin' ? [] : departmentIds
    };
  });
}

async function syncUserDepartments(client, userId, departmentIds) {
  const { data: existingRows, error: existingError } = await client
    .from('user_departments')
    .select('*')
    .eq('user_id', userId);
  if (isMissingTableError(existingError)) return;
  if (existingError) throw existingError;
  const existingIds = new Set((existingRows || []).map(row => String(row.department_id)));
  const nextIds = new Set(departmentIds.map(id => String(id)));
  for (const departmentId of existingIds) {
    if (nextIds.has(departmentId)) continue;
    const { error } = await client
      .from('user_departments')
      .delete()
      .eq('user_id', userId)
      .eq('department_id', departmentId);
    if (error) throw error;
  }
  for (const departmentId of nextIds) {
    if (existingIds.has(departmentId)) continue;
    const { error } = await client
      .from('user_departments')
      .insert({ user_id: userId, department_id: departmentId });
    if (error) throw error;
  }
}

async function resolveVaultId(client, ownerAuthUserId) {
  if (!ownerAuthUserId) return null;
  const existing = await client
    .from('vaults')
    .select('*')
    .eq('owner_id', ownerAuthUserId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (existing.error) throw existing.error;
  if (existing.data?.[0]) return existing.data[0].id;

  const created = await client
    .from('vaults')
    .insert({
      owner_id: ownerAuthUserId,
      name: 'Personal',
      kdf_salt: randomBytes(16).toString('base64')
    })
    .select()
    .single();
  if (created.error) throw created.error;
  return created.data.id;
}

async function insertPermissions(client, permissions) {
  const rows = permissions.map(permissionPayload);
  if (!rows.length) return;
  const { error } = await client.from('detailed_permissions').insert(rows);
  if (error) throw error;
}

async function nextTypeSortOrder(client) {
  const { data, error } = await client.from('entry_types').select('*');
  if (error) throw error;
  return Math.max(0, ...data.map(row => Number(row.sort_order) || 0)) + 1;
}

async function nextProjectSortOrder(client) {
  const { data, error } = await client.from('projects').select('sort_order').is('deleted_at', null);
  if (error) throw error;
  return Math.max(0, ...data.map(row => Number(row.sort_order) || 0)) + 1;
}

async function nextProjectSystemSortOrder(client, projectId) {
  const { data, error } = await client.from('project_systems').select('sort_order').eq('project_id', projectId).is('deleted_at', null);
  if (error) throw error;
  return Math.max(0, ...data.map(row => Number(row.sort_order) || 0)) + 1;
}

async function nextDepartmentSortOrder(client) {
  const { data, error } = await client.from('departments').select('sort_order');
  if (error) throw error;
  return Math.max(0, ...data.map(row => Number(row.sort_order) || 0)) + 1;
}

function mapUser(row) {
  if (!row) return null;
  const role = normalizeRole(row.role);
  return {
    id: row.id,
    authUserId: row.auth_user_id || null,
    username: row.username,
    displayName: row.display_name || row.username,
    departmentId: role === 'Admin' ? null : (row.department_id || null),
    departmentIds: role === 'Admin' || !row.department_id ? [] : [row.department_id],
    role,
    status: normalizeUserStatus(row.status),
    permissions: normalizePermissions(row.permissions, role),
    preferences: sanitizeUserPreferences(row.preferences),
    invitationSentAt: row.invitation_sent_at || null,
    inviteExpiresAt: row.invite_expires_at || null,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at
  };
}

function mapDepartment(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEntryType(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    sortOrder: row.sort_order || 0,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    status: row.status || 'Active',
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizeUserPreferences(preferences = {}) {
  const input = preferences && typeof preferences === 'object' ? preferences : {};
  const output = {};
  const theme = String(input.theme || '').trim();
  if (['light', 'mix', 'dark'].includes(theme)) output.theme = theme;
  const mixTheme = input.mixTheme && typeof input.mixTheme === 'object' ? input.mixTheme : {};
  const accent = normalizeHexColor(mixTheme.accent);
  const accent2 = normalizeHexColor(mixTheme.accent2);
  if (accent || accent2) {
    output.mixTheme = {};
    if (accent) output.mixTheme.accent = accent;
    if (accent2) output.mixTheme.accent2 = accent2;
  }
  const panelLayout = input.panelLayout && typeof input.panelLayout === 'object' ? input.panelLayout : {};
  const sidebarWidth = normalizePanelWidth(panelLayout.sidebarWidth);
  const detailPanelWidth = normalizePanelWidth(panelLayout.detailPanelWidth);
  if (sidebarWidth || detailPanelWidth) {
    output.panelLayout = {};
    if (sidebarWidth) output.panelLayout.sidebarWidth = sidebarWidth;
    if (detailPanelWidth) output.panelLayout.detailPanelWidth = detailPanelWidth;
  }
  return output;
}

function normalizeHexColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : '';
}

function normalizePanelWidth(value) {
  const width = Number(value);
  if (!Number.isFinite(width)) return 0;
  return Math.max(10, Math.round(width));
}

function mapProjectSystem(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type || 'Web',
    description: row.description || '',
    status: row.status || 'Active',
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEntry(row, encryptionKey) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    systemId: row.system_id || null,
    projectSystemId: row.system_id || null,
    typeId: row.entry_type_id || null,
    entryTypeId: row.entry_type_id || null,
    name: row.name,
    type: row.type || 'Other',
    environment: row.environment || 'Production',
    url: row.url || '',
    username: row.username || '',
    passwordMasked: true,
    notes: decryptPayloadOrEmpty(row.secret_notes_cipher, encryptionKey),
    status: row.status || 'Active',
    tags: row.tags || [],
    permissions: fullEntryPermissions(),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCredential(row) {
  if (!row) return null;
  return {
    id: row.id,
    entryId: row.entry_id,
    departmentId: row.department_id || null,
    username: row.username || '',
    passwordMasked: true,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEntryExport(row, encryptionKey, includePasswords) {
  const entry = mapEntry(row, encryptionKey);
  const exported = {
    projectId: entry.projectId,
    systemId: entry.systemId,
    name: entry.name,
    type: entry.type,
    environment: entry.environment,
    url: entry.url,
    username: entry.username,
    notes: entry.notes,
    tags: entry.tags,
    status: entry.status
  };
  if (includePasswords) exported.password = decryptPayload(row.password_cipher, encryptionKey);
  return exported;
}

function mapPermission(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    systemId: row.system_id || null,
    projectSystemId: row.system_id || null,
    entryTypeId: row.entry_type_id || null,
    canViewEntry: Boolean(row.can_view_entry),
    canViewUrl: Boolean(row.can_view_url),
    canViewUsername: Boolean(row.can_view_username),
    canRevealPassword: Boolean(row.can_reveal_password),
    canViewNotes: Boolean(row.can_view_notes),
    canCreate: Boolean(row.can_create),
    canEdit: Boolean(row.can_edit),
    canDelete: Boolean(row.can_delete)
  };
}

function permissionPayload(permission) {
  return {
    user_id: permission.userId,
    project_id: permission.projectId,
    system_id: permission.systemId || permission.projectSystemId || null,
    entry_type_id: permission.entryTypeId || null,
    can_view_entry: Boolean(permission.canViewEntry),
    can_view_url: Boolean(permission.canViewUrl),
    can_view_username: Boolean(permission.canViewUsername),
    can_reveal_password: Boolean(permission.canRevealPassword),
    can_view_notes: Boolean(permission.canViewNotes),
    can_create: Boolean(permission.canCreate),
    can_edit: Boolean(permission.canEdit),
    can_delete: Boolean(permission.canDelete),
    updated_at: new Date().toISOString()
  };
}

function fullEntryPermissions() {
  return {
    canViewEntry: true,
    canViewUrl: true,
    canViewUsername: true,
    canRevealPassword: true,
    canViewNotes: true,
    canCreate: true,
    canEdit: true,
    canDelete: true
  };
}

function encryptPayload(value, encryptionKey) {
  return JSON.parse(encryptText(value || '', encryptionKey));
}

function decryptPayload(value, encryptionKey) {
  if (!value || !encryptionKey) return '';
  return decryptText(JSON.stringify(value), encryptionKey);
}

function decryptPayloadOrEmpty(value, encryptionKey) {
  try {
    return decryptPayload(value, encryptionKey);
  } catch (error) {
    if (isDecryptAuthError(error)) return '';
    throw error;
  }
}

function isDecryptAuthError(error) {
  return /Unsupported state or unable to authenticate data/i.test(error?.message || '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(role) {
  if (role === 'owner') return 'Admin';
  return ['Admin', 'Manager', 'Viewer'].includes(role) ? role : 'Viewer';
}

function normalizeUserStatus(status) {
  return ['Active', 'Inactive', 'Invited', 'Expired', 'Pending'].includes(status) ? status : 'Active';
}

function normalizePermissions(input, role) {
  const allowed = new Set(ROLE_PERMISSIONS[role] || []);
  if (role === 'Admin') return [...allowed];
  return uniqueStrings(Array.isArray(input) ? input : []).filter(permission => allowed.has(permission));
}

function normalizeUserDepartmentIds(input = {}, role = 'Viewer') {
  if (normalizeRole(role) === 'Admin') return [];
  const ids = Array.isArray(input.departmentIds)
    ? input.departmentIds
    : input.departmentId
      ? [input.departmentId]
      : [];
  return uniqueStrings(ids);
}

function isMissingSingleRowError(error) {
  if (!error) return false;
  return error.code === 'PGRST116'
    || /Cannot coerce the result to a single JSON object/i.test(error.message || '');
}

function isMissingTableError(error) {
  if (!error) return false;
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || /relation .* does not exist|Could not find the table/i.test(error.message || '');
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function isAdmin(user) {
  return normalizeRole(user?.role) === 'Admin';
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function addHours(value, hours) {
  return new Date(Date.parse(toIso(value)) + hours * 60 * 60 * 1000);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'type';
}
