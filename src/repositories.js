import { createSessionToken, decryptText, encryptText, hashPassword, verifyPassword } from './crypto.js';
import { DEFAULT_AUTO_LOCK_MINUTES } from './config.js';

export const ROLE_PERMISSIONS = {
  Admin: ['users.manage'],
  Manager: ['users.manage'],
  Viewer: []
};

export function createRepositories(db, encryptionKey) {
  return {
    users: usersRepo(db),
    projects: projectsRepo(db),
    entryTypes: entryTypesRepo(db),
    entries: entriesRepo(db, encryptionKey),
    detailedPermissions: detailedPermissionsRepo(db),
    projectMemberships: projectMembershipsRepo(db),
    activity: activityRepo(db),
    settings: settingsRepo(db)
  };
}

function usersRepo(db) {
  const mapUser = row => row && {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: normalizeRole(row.role),
    status: row.status || 'Active',
    permissions: permissionsFor(row),
    invitationSentAt: row.invitation_sent_at || null,
    inviteExpiresAt: row.invite_expires_at || null,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at
  };

  return {
    authenticate(username, password) {
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user || !verifyPassword(password, user.password_hash)) return null;
      if (user.status !== 'Active') throw new Error('User is inactive');
      return mapUser(user);
    },
    findActiveByUsername(username) {
      const trimmed = String(username || '').trim();
      if (!trimmed) return null;
      const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(trimmed);
      if (!user) return null;
      if (user.status !== 'Active') throw new Error('User is inactive');
      return mapUser(user);
    },
    activateForGoogleLogin(username, now = new Date()) {
      const trimmed = String(username || '').trim();
      if (!trimmed) return null;
      const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(trimmed);
      if (!user) return null;
      const status = normalizeUserStatus(user.status);
      if (status === 'Active') return mapUser(user);
      if (status === 'Inactive') throw new Error('User is inactive');
      if (status === 'Expired') throw new Error('Invite expired');
      if (status === 'Pending') throw new Error('Tài khoản đang chờ admin phê duyệt');
      if (status === 'Invited') {
        const nowIso = toIso(now);
        if (user.invite_expires_at && Date.parse(user.invite_expires_at) <= Date.parse(nowIso)) {
          db.prepare('UPDATE users SET status = ? WHERE id = ?').run('Expired', user.id);
          throw new Error('Invite expired');
        }
        db.prepare('UPDATE users SET status = ?, accepted_at = ? WHERE id = ?').run('Active', nowIso, user.id);
        return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
      }
      throw new Error('User is inactive');
    },
    requestGoogleAccess(input) {
      const username = String(input.username || '').trim();
      if (!username) throw new Error('Username is required');
      const existing = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
      if (existing) return mapUser(existing);
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, display_name, role, status, permissions, invitation_sent_at, invite_expires_at, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(
        username,
        hashPassword(createSessionToken()),
        input.displayName?.trim() || username,
        'Viewer',
        'Pending',
        JSON.stringify([])
      );
      return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid));
    },
    list(now = new Date()) {
      expireStaleInvites(db, now);
      return db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all().map(mapUser);
    },
    get(id) {
      return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    },
    create(input) {
      validateUserInput(input, { creating: true });
      const role = normalizeRole(input.role);
      const password = input.password || createSessionToken();
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, display_name, role, status, permissions, invitation_sent_at, invite_expires_at, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.username.trim(),
        hashPassword(password),
        input.displayName?.trim() || input.username.trim(),
        role,
        normalizeUserStatus(input.status || 'Active'),
        JSON.stringify(normalizePermissions(input.permissions, role)),
        input.invitationSentAt || null,
        input.inviteExpiresAt || null,
        input.acceptedAt || null
      );
      return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid));
    },
    markInvited(id, { sentAt = new Date(), expiresAt = addHours(sentAt, 24) } = {}) {
      db.prepare(`
        UPDATE users
        SET status = 'Invited', invitation_sent_at = ?, invite_expires_at = ?, accepted_at = NULL
        WHERE id = ?
      `).run(toIso(sentAt), toIso(expiresAt), id);
      return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    },
    update(id, input) {
      const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!current) throw new Error('User not found');
      const role = normalizeRole(input.role || current.role);
      const permissions = input.permissions === undefined
        ? normalizePermissions(JSON.parse(current.permissions || '[]'), role)
        : normalizePermissions(input.permissions, role);
      db.prepare(`
        UPDATE users
        SET display_name = ?, role = ?, status = ?, permissions = ?
        WHERE id = ?
      `).run(
        input.displayName?.trim() || current.display_name || current.username,
        role,
        normalizeUserStatus(input.status || current.status || 'Active'),
        JSON.stringify(permissions),
        id
      );
      if (input.password) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(input.password), id);
      }
      return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    },
    delete(id, currentUserId) {
      if (Number(id) === Number(currentUserId)) throw new Error('Cannot delete current user');
      const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
      if (!existing) throw new Error('User not found');
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    }
  };
}

export function hasPermission(user, permission) {
  if (normalizeRole(user?.role) === 'Admin') return true;
  return Boolean(user?.permissions?.includes(permission));
}

function normalizeRole(role) {
  if (role === 'owner') return 'Admin';
  return ['Admin', 'Manager', 'Viewer'].includes(role) ? role : 'Viewer';
}

function normalizeUserStatus(status) {
  return ['Active', 'Inactive', 'Invited', 'Expired', 'Pending'].includes(status) ? status : 'Active';
}

function permissionsFor(row) {
  const role = normalizeRole(row.role);
  return normalizePermissions(JSON.parse(row.permissions || '[]'), role);
}

function normalizePermissions(input, role) {
  const allowed = new Set(ROLE_PERMISSIONS[role] || []);
  if (role === 'Admin') return [...allowed];
  return [...new Set(Array.isArray(input) ? input : [])].filter(permission => allowed.has(permission));
}

function validateUserInput(input, { creating = false } = {}) {
  if (!input.username?.trim()) throw new Error('Username is required');
}

function expireStaleInvites(db, now = new Date()) {
  db.prepare(`
    UPDATE users
    SET status = 'Expired'
    WHERE status = 'Invited'
      AND invite_expires_at IS NOT NULL
      AND invite_expires_at <= ?
  `).run(toIso(now));
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function addHours(value, hours) {
  return new Date(Date.parse(toIso(value)) + hours * 60 * 60 * 1000);
}

function projectsRepo(db) {
  const mapProject = row => row && ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  return {
    list() {
      return db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all().map(mapProject);
    },
    listForUser(user) {
      if (isAdmin(user)) return this.list();
      return db.prepare(`
        SELECT DISTINCT projects.* FROM projects
        JOIN user_project_memberships memberships ON memberships.project_id = projects.id
        WHERE memberships.user_id = ?
        ORDER BY projects.name COLLATE NOCASE
      `).all(user.id).map(mapProject);
    },
    create(input) {
      const result = db.prepare(`
        INSERT INTO projects (name, description, status, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).run(input.name.trim(), input.description || '', input.status || 'Active');
      return mapProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid));
    },
    update(id, input) {
      db.prepare(`
        UPDATE projects
        SET name = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(input.name.trim(), input.description || '', input.status || 'Active', id);
      return mapProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
    },
    delete(id) {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    }
  };
}

function entryTypesRepo(db) {
  const mapType = row => row && ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    sortOrder: row.sort_order || 0,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  return {
    list({ includeInactive = false } = {}) {
      const where = includeInactive ? '' : 'WHERE is_active = 1';
      return db.prepare(`SELECT * FROM entry_types ${where} ORDER BY sort_order, name COLLATE NOCASE`).all().map(mapType);
    },
    get(id) {
      return mapType(db.prepare('SELECT * FROM entry_types WHERE id = ?').get(id));
    },
    findByName(name) {
      return mapType(db.prepare('SELECT * FROM entry_types WHERE lower(name) = lower(?)').get(String(name || '').trim()));
    },
    create(input) {
      const name = String(input.name || '').trim();
      if (!name) throw new Error('Type name is required');
      const result = db.prepare(`
        INSERT INTO entry_types (name, slug, description, sort_order, is_active, updated_at)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `).run(name, slugify(name), input.description || '', input.sortOrder || nextTypeSortOrder(db));
      return this.get(result.lastInsertRowid);
    },
    update(id, input) {
      const current = db.prepare('SELECT * FROM entry_types WHERE id = ?').get(id);
      if (!current) throw new Error('Entry type not found');
      const name = String(input.name || current.name).trim();
      db.prepare(`
        UPDATE entry_types
        SET name = ?, slug = ?, description = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        name,
        slugify(name),
        input.description ?? current.description ?? '',
        input.sortOrder ?? current.sort_order ?? 0,
        input.isActive === undefined ? current.is_active : (input.isActive ? 1 : 0),
        id
      );
      return this.get(id);
    }
  };
}

function projectMembershipsRepo(db) {
  return {
    replaceForUser(userId, projectIds = []) {
      db.prepare('DELETE FROM user_project_memberships WHERE user_id = ?').run(userId);
      const uniqueIds = [...new Set(projectIds.map(normalizeProjectId).filter(Boolean))];
      uniqueIds.forEach(projectId => {
        db.prepare(`
          INSERT OR IGNORE INTO user_project_memberships (user_id, project_id)
          VALUES (?, ?)
        `).run(userId, projectId);
      });
      return this.listForUser(userId);
    },
    replaceForProject(projectId, userIds = []) {
      const normalizedProjectId = normalizeProjectId(projectId);
      db.prepare('DELETE FROM user_project_memberships WHERE project_id = ?').run(normalizedProjectId);
      const uniqueIds = [...new Set(userIds.map(id => Number(id)).filter(Boolean))];
      uniqueIds.forEach(userId => {
        db.prepare(`
          INSERT OR IGNORE INTO user_project_memberships (user_id, project_id)
          VALUES (?, ?)
        `).run(userId, normalizedProjectId);
      });
      return this.listForProject(normalizedProjectId);
    },
    listForUser(userId) {
      return db.prepare(`
        SELECT project_id FROM user_project_memberships
        WHERE user_id = ?
        ORDER BY project_id
      `).all(userId).map(row => row.project_id);
    },
    listForProject(projectId) {
      return db.prepare(`
        SELECT user_id FROM user_project_memberships
        WHERE project_id = ?
        ORDER BY user_id
      `).all(normalizeProjectId(projectId)).map(row => row.user_id);
    },
    has(userId, projectId) {
      return Boolean(db.prepare(`
        SELECT 1 FROM user_project_memberships
        WHERE user_id = ? AND project_id = ?
      `).get(userId, normalizeProjectId(projectId)));
    }
  };
}

function detailedPermissionsRepo(db) {
  return {
    upsert(userId, projectId, entryTypeId, input = {}) {
      const normalizedProjectId = normalizeProjectId(projectId);
      const normalizedEntryTypeId = Number(entryTypeId);
      if (!normalizedProjectId || !normalizedEntryTypeId) return null;
      db.prepare(`
        INSERT OR IGNORE INTO user_project_memberships (user_id, project_id)
        VALUES (?, ?)
      `).run(userId, normalizedProjectId);
      db.prepare(`
        INSERT INTO user_project_type_permissions (
          user_id, project_id, entry_type_id, can_view_entry, can_view_url, can_view_username,
          can_reveal_password, can_view_notes, can_create, can_edit, can_delete, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, project_id, entry_type_id) DO UPDATE SET
          can_view_entry = excluded.can_view_entry,
          can_view_url = excluded.can_view_url,
          can_view_username = excluded.can_view_username,
          can_reveal_password = excluded.can_reveal_password,
          can_view_notes = excluded.can_view_notes,
          can_create = excluded.can_create,
          can_edit = excluded.can_edit,
          can_delete = excluded.can_delete,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        userId,
        normalizedProjectId,
        normalizedEntryTypeId,
        boolInt(input.canViewEntry),
        boolInt(input.canViewUrl),
        boolInt(input.canViewUsername),
        boolInt(input.canRevealPassword),
        boolInt(input.canViewNotes),
        boolInt(input.canCreate),
        boolInt(input.canEdit),
        boolInt(input.canDelete)
      );
      return this.get(userId, normalizedProjectId, normalizedEntryTypeId);
    },
    replaceForUser(userId, rows = []) {
      db.prepare('DELETE FROM user_project_type_permissions WHERE user_id = ?').run(userId);
      rows.filter(isPersistablePermissionRow).forEach(row => {
        this.upsert(userId, row.projectId, row.entryTypeId, row);
      });
      return this.listForUser(userId);
    },
    replaceForProject(projectId, rows = []) {
      const normalizedProjectId = normalizeProjectId(projectId);
      db.prepare('DELETE FROM user_project_type_permissions WHERE project_id = ?').run(normalizedProjectId);
      rows.forEach(row => {
        this.upsert(row.userId, normalizedProjectId, row.entryTypeId, row);
      });
      return this.listForProject(normalizedProjectId);
    },
    get(userId, projectId, entryTypeId) {
      return mapPermission(db.prepare(`
        SELECT * FROM user_project_type_permissions
        WHERE user_id = ? AND project_id = ? AND entry_type_id = ?
      `).get(userId, normalizeProjectId(projectId), entryTypeId));
    },
    listForUser(userId) {
      return db.prepare(`
        SELECT * FROM user_project_type_permissions
        WHERE user_id = ?
        ORDER BY project_id, entry_type_id
      `).all(userId).map(mapPermission);
    },
    listForProject(projectId) {
      return db.prepare(`
        SELECT * FROM user_project_type_permissions
        WHERE project_id = ?
        ORDER BY user_id, entry_type_id
      `).all(normalizeProjectId(projectId)).map(mapPermission);
    }
  };
}

function entriesRepo(db, encryptionKey) {
  return {
    listByProject(projectId) {
      return entryRows(selectEntryRows(db, 'WHERE entries.project_id = ?', [projectId]), db);
    },
    listByProjectForUser(projectId, user) {
      if (isAdmin(user)) return this.listByProject(projectId);
      const rows = selectEntryRows(db, `
        JOIN user_project_memberships memberships
          ON memberships.project_id = entries.project_id
          AND memberships.user_id = ?
        JOIN user_project_type_permissions permissions
          ON permissions.project_id = entries.project_id
          AND permissions.entry_type_id = entries.entry_type_id
          AND permissions.user_id = memberships.user_id
        WHERE entries.project_id = ?
          AND permissions.can_view_entry = 1
      `, [user.id, projectId]);
      return rows.map(row => maskEntryForPermission(entryRows([row], db)[0], mapPermission(row)));
    },
    search(query) {
      const like = `%${query}%`;
      return entryRows(db.prepare(`
        SELECT entries.* FROM entries
        JOIN projects ON projects.id = entries.project_id
        WHERE entries.name LIKE ? OR entries.url LIKE ? OR entries.username LIKE ? OR projects.name LIKE ?
        ORDER BY projects.name COLLATE NOCASE, entries.name COLLATE NOCASE
      `).all(like, like, like, like), db);
    },
    searchForUser(query, user) {
      if (isAdmin(user)) return this.search(query);
      const like = `%${query}%`;
      const rows = selectEntryRows(db, `
        JOIN projects ON projects.id = entries.project_id
        JOIN user_project_memberships memberships
          ON memberships.project_id = entries.project_id
          AND memberships.user_id = ?
        JOIN user_project_type_permissions permissions
          ON permissions.project_id = entries.project_id
          AND permissions.entry_type_id = entries.entry_type_id
          AND permissions.user_id = memberships.user_id
        WHERE permissions.can_view_entry = 1
          AND (entries.name LIKE ? OR entries.url LIKE ? OR entries.username LIKE ? OR projects.name LIKE ?)
      `, [user.id, like, like, like, like]);
      return rows.map(row => maskEntryForPermission(entryRows([row], db)[0], mapPermission(row)));
    },
    create(input) {
      const entryType = resolveEntryType(db, input);
      const encrypted = encryptText(input.password || '', encryptionKey);
      const result = db.prepare(`
        INSERT INTO entries (project_id, entry_type_id, name, type, environment, url, username, password_encrypted, notes, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        input.projectId,
        entryType.id,
        input.name.trim(),
        entryType.name,
        input.environment || 'Production',
        input.url || '',
        input.username || '',
        encrypted,
        input.notes || '',
        input.status || 'Active'
      );
      setTags(db, result.lastInsertRowid, input.tags || []);
      return this.get(result.lastInsertRowid);
    },
    update(id, input) {
      const current = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
      if (!current) throw new Error('Entry not found');
      const entryType = resolveEntryType(db, input, current.entry_type_id);
      const encrypted = input.password === undefined ? current.password_encrypted : encryptText(input.password || '', encryptionKey);
      db.prepare(`
        UPDATE entries
        SET project_id = ?, entry_type_id = ?, name = ?, type = ?, environment = ?, url = ?, username = ?,
            password_encrypted = ?, notes = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        input.projectId || current.project_id,
        entryType.id,
        input.name.trim(),
        entryType.name,
        input.environment || 'Production',
        input.url || '',
        input.username || '',
        encrypted,
        input.notes || '',
        input.status || 'Active',
        id
      );
      setTags(db, id, input.tags || []);
      return this.get(id);
    },
    get(id) {
      const row = selectEntryRows(db, 'WHERE entries.id = ?', [id])[0];
      return entryRows(row ? [row] : [], db)[0] || null;
    },
    getRaw(id) {
      return selectEntryRows(db, 'WHERE entries.id = ?', [id])[0] || null;
    },
    delete(id) {
      db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    },
    revealPassword(id) {
      const row = db.prepare('SELECT password_encrypted FROM entries WHERE id = ?').get(id);
      if (!row) throw new Error('Entry not found');
      return decryptText(row.password_encrypted, encryptionKey);
    },
    revealPasswordForUser(id, user) {
      if (!isAdmin(user) && !canAccessEntry(db, user, id, 'can_reveal_password')) {
        throw new Error('Permission denied');
      }
      return this.revealPassword(id);
    },
    exportAll({ includePasswords = false } = {}) {
      return entryRows(selectEntryRows(db, '', []), db)
        .map(entry => ({
          ...entry,
          password: includePasswords ? this.revealPassword(entry.id) : ''
        }));
    },
    exportForUser(user, { includePasswords = false } = {}) {
      if (isAdmin(user)) return this.exportAll({ includePasswords });
      return this.searchForUser('', user).map(entry => ({
        ...entry,
        password: includePasswords && entry.permissions.canRevealPassword ? this.revealPassword(entry.id) : ''
      }));
    }
  };
}

function entryRows(rows, db) {
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    typeId: row.entry_type_id,
    name: row.name,
    type: row.type_name || row.type,
    environment: row.environment,
    url: row.url,
    username: row.username,
    passwordMasked: true,
    notes: row.notes,
    status: row.status,
    tags: tagsForEntry(db, row.id),
    permissions: fullEntryPermissions(),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function selectEntryRows(db, tail = '', args = []) {
  const permissionColumns = tail.includes('permissions')
    ? `, permissions.can_view_entry, permissions.can_view_url, permissions.can_view_username,
       permissions.can_reveal_password, permissions.can_view_notes, permissions.can_create,
       permissions.can_edit, permissions.can_delete`
    : '';
  return db.prepare(`
    SELECT entries.*, entry_types.name AS type_name${permissionColumns}
    FROM entries
    LEFT JOIN entry_types ON entry_types.id = entries.entry_type_id
    ${tail}
    ORDER BY entries.project_id, entries.name COLLATE NOCASE
  `).all(...args);
}

function resolveEntryType(db, input, fallbackTypeId = null) {
  if (input.typeId || input.entryTypeId) {
    const row = db.prepare('SELECT * FROM entry_types WHERE id = ?').get(input.typeId || input.entryTypeId);
    if (!row) throw new Error('Entry type not found');
    return row;
  }
  if (input.type) {
    const name = String(input.type).trim() || 'Other';
    const existing = db.prepare('SELECT * FROM entry_types WHERE lower(name) = lower(?)').get(name);
    if (existing) return existing;
    const result = db.prepare(`
      INSERT INTO entry_types (name, slug, description, sort_order, is_active, updated_at)
      VALUES (?, ?, '', ?, 1, CURRENT_TIMESTAMP)
    `).run(name, slugify(name), nextTypeSortOrder(db));
    return db.prepare('SELECT * FROM entry_types WHERE id = ?').get(result.lastInsertRowid);
  }
  if (fallbackTypeId) {
    const row = db.prepare('SELECT * FROM entry_types WHERE id = ?').get(fallbackTypeId);
    if (row) return row;
  }
  return db.prepare('SELECT * FROM entry_types WHERE name = ?').get('Other');
}

function canAccessEntry(db, user, entryId, column) {
  if (isAdmin(user)) return true;
  const allowedColumns = new Set([
    'can_view_entry',
    'can_view_url',
    'can_view_username',
    'can_reveal_password',
    'can_view_notes',
    'can_create',
    'can_edit',
    'can_delete'
  ]);
  if (!allowedColumns.has(column)) return false;
  const row = db.prepare(`
    SELECT permissions.${column} AS allowed FROM entries
    JOIN user_project_memberships memberships
      ON memberships.project_id = entries.project_id
      AND memberships.user_id = ?
    JOIN user_project_type_permissions permissions
      ON permissions.project_id = entries.project_id
      AND permissions.entry_type_id = entries.entry_type_id
      AND permissions.user_id = memberships.user_id
    WHERE entries.id = ?
  `).get(user.id, entryId);
  return Boolean(row?.allowed);
}

function maskEntryForPermission(entry, permission) {
  return {
    ...entry,
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

function setTags(db, entryId, tags) {
  db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(entryId);
  for (const rawTag of tags) {
    const tag = String(rawTag).trim();
    if (!tag) continue;
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tag);
    const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag);
    db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(entryId, row.id);
  }
}

function tagsForEntry(db, entryId) {
  return db.prepare(`
    SELECT tags.name FROM tags
    JOIN entry_tags ON entry_tags.tag_id = tags.id
    WHERE entry_tags.entry_id = ?
    ORDER BY tags.name COLLATE NOCASE
  `).all(entryId).map(row => row.name);
}

function mapPermission(row) {
  return row && {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    entryTypeId: row.entry_type_id,
    canViewEntry: Boolean(row.can_view_entry),
    canViewUrl: Boolean(row.can_view_url),
    canViewUsername: Boolean(row.can_view_username),
    canRevealPassword: Boolean(row.can_reveal_password),
    canViewNotes: Boolean(row.can_view_notes),
    canCreate: Boolean(row.can_create),
    canEdit: Boolean(row.can_edit),
    canDelete: Boolean(row.can_delete),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function boolInt(value) {
  return value ? 1 : 0;
}

function normalizeProjectId(value) {
  const id = String(value ?? '').trim();
  return id || null;
}

function isPersistablePermissionRow(row) {
  return Boolean(normalizeProjectId(row?.projectId) && Number(row?.entryTypeId));
}

function isAdmin(user) {
  return normalizeRole(user?.role) === 'Admin';
}

function nextTypeSortOrder(db) {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM entry_types').get();
  return row?.value || 1;
}

function slugify(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'type';
  return base;
}

function activityRepo(db) {
  return {
    log(action, { projectId = null, entryId = null, details = '' } = {}) {
      db.prepare('INSERT INTO activity_logs (action, project_id, entry_id, details) VALUES (?, ?, ?, ?)')
        .run(action, projectId, entryId, details);
    },
    list() {
      return db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100').all().map(row => ({
        id: row.id,
        action: row.action,
        projectId: row.project_id,
        entryId: row.entry_id,
        details: row.details,
        createdAt: row.created_at
      }));
    }
  };
}

function settingsRepo(db) {
  return {
    getAll() {
      const rows = db.prepare('SELECT key, value FROM settings').all();
      const settings = Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value)]));
      return { autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES, ...settings };
    },
    update(input) {
      for (const [key, value] of Object.entries(input)) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run(key, JSON.stringify(value));
      }
      return this.getAll();
    }
  };
}
