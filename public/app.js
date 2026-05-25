const state = {
  projects: [],
  entries: [],
  entryTypes: [],
  selectedProjectId: null,
  selectedEntryId: null,
  selectedTypeId: 'All',
  autoLockMinutes: 15,
  revealCache: new Map(),
  mode: 'local',
  supabase: null,
  user: null,
  vault: null,
  vaultKey: null,
  vaultSalt: null,
  currentUser: null,
  users: [],
  projectMemberDraft: [],
  projectMemberProjectId: null,
  view: 'vault'
};

const $ = selector => document.querySelector(selector);
const loginView = $('#loginView');
const appView = $('#appView');

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await checkSession();
});

function bindEvents() {
  $('#loginForm').addEventListener('submit', login);
  $('#googleLoginBtn')?.addEventListener('click', loginWithGoogle);
  $('#lockBtn').addEventListener('click', logout);
  $('#usersNavBtn').addEventListener('click', showUsersPanel);
  $('#newProjectBtn').addEventListener('click', () => openProjectDialog());
  $('#newEntryBtn').addEventListener('click', () => openEntryDialog());
  $('#projectForm').addEventListener('submit', saveProject);
  $('#addProjectMemberBtn')?.addEventListener('click', addSelectedProjectMember);
  $('#memberPermissionForm')?.addEventListener('submit', saveMemberPermissionDraft);
  $('#entryForm').addEventListener('submit', saveEntry);
  $('#userForm').addEventListener('submit', saveUser);
  $('#userRoleSelect').addEventListener('change', syncRolePermissions);
  $('#projectSearch').addEventListener('input', renderProjects);
  $('#globalSearch').addEventListener('input', globalSearch);
  $('#exportJsonBtn').addEventListener('click', () => download('/api/export/json?passwords=1', 'apecglobal-backup.json'));
  $('#exportCsvBtn').addEventListener('click', () => download('/api/export/csv?passwords=1', 'apecglobal-export.csv'));
  $('#addEntryTypeBtn')?.addEventListener('click', createEntryType);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#saveJsonBtn').addEventListener('click', saveJsonBackup);
  $('#importFile').addEventListener('change', importFile);
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });
  document.addEventListener('mousemove', resetAutoLock);
  document.addEventListener('keydown', resetAutoLock);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
}

async function checkSession() {
  await initializeGoogleAuth();
  const session = await api('/api/session');
  if (session.authenticated) {
    state.currentUser = session.user;
    await enterApp();
    return;
  }
  if (await completeGoogleLogin()) return;
  showLogin();
}

async function login(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
    state.currentUser = result.user;
    $('#loginError').textContent = '';
    await enterApp();
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
  if (state.supabase) await state.supabase.auth.signOut().catch(() => null);
  state.user = null;
  state.currentUser = null;
  state.vault = null;
  state.vaultKey = null;
  state.vaultSalt = null;
  showLogin();
}

async function enterApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  await loadEntryTypes();
  if (state.mode === 'local') {
    const settings = await api('/api/settings');
    state.autoLockMinutes = Number(settings.autoLockMinutes || 15);
  }
  applyPermissionUi();
  await loadProjects();
  resetAutoLock();
}

async function loadEntryTypes() {
  state.entryTypes = await api('/api/entry-types');
  renderTypeFilters();
  fillEntryTypes();
}

function showLogin() {
  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
  state.revealCache.clear();
  state.view = 'vault';
}

async function initializeGoogleAuth() {
  const button = $('#googleLoginBtn');
  if (!button || !window.ApecSupabase?.isConfigured()) {
    button?.classList.add('hidden');
    return;
  }

  try {
    state.supabase = await window.ApecSupabase.getClient();
    button.classList.remove('hidden');
    button.disabled = false;
  } catch (error) {
    button.classList.add('hidden');
  }
}

async function loginWithGoogle() {
  if (!state.supabase) {
    $('#loginError').textContent = 'Google login chưa được cấu hình.';
    return;
  }

  $('#loginError').textContent = '';
  const { error } = await state.supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        prompt: 'select_account'
      }
    }
  });
  if (error) $('#loginError').textContent = error.message;
}

async function completeGoogleLogin() {
  if (!state.supabase) return false;
  const { data, error } = await state.supabase.auth.getSession();
  if (error || !data.session?.access_token) return false;

  try {
    const result = await api('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ accessToken: data.session.access_token })
    });
    state.currentUser = result.user;
    $('#loginError').textContent = '';
    window.history.replaceState({}, document.title, window.location.pathname);
    await enterApp();
    return true;
  } catch (loginError) {
    $('#loginError').textContent = loginError.message;
    await state.supabase.auth.signOut().catch(() => null);
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }
}

async function loadProjects() {
  state.projects = await api('/api/projects');
  if (!state.selectedProjectId && state.projects[0]) state.selectedProjectId = state.projects[0].id;
  renderProjects();
  await loadEntries();
}

async function loadEntries() {
  if (!state.selectedProjectId) {
    state.entries = [];
    state.selectedEntryId = null;
    renderHeader();
    renderEntries();
    return;
  }
  state.entries = await api(`/api/projects/${state.selectedProjectId}/entries`);
  if (!state.entries.some(entry => entry.id === state.selectedEntryId)) {
    state.selectedEntryId = state.entries[0]?.id || null;
  }
  renderHeader();
  renderEntries();
}

function renderProjects() {
  const query = $('#projectSearch').value.toLowerCase();
  $('#projectList').innerHTML = state.projects
    .filter(project => project.name.toLowerCase().includes(query))
    .map(project => `
      <div class="project-item ${String(project.id) === String(state.selectedProjectId) ? 'active' : ''}" data-id="${project.id}">
        <span class="vault-icon">${projectIcon(project.name)}</span>
        <div>
          <strong>${escapeHtml(project.name)}</strong>
          <small>${escapeHtml(project.status)}</small>
        </div>
        <span class="project-actions">
          ${can('users.manage') ? `<button class="icon-btn" type="button" title="Thành viên dự án" aria-label="Thành viên dự án" data-project-members="${project.id}">${svgIcon('users')}</button>` : ''}
          ${isAdmin() ? `<button class="icon-btn" type="button" title="Sửa dự án" aria-label="Sửa dự án" data-edit-project="${project.id}">${svgIcon('edit')}</button><button class="icon-btn danger" type="button" title="Xóa dự án" aria-label="Xóa dự án" data-delete-project="${project.id}">${svgIcon('trash')}</button>` : ''}
        </span>
      </div>
    `).join('');
  document.querySelectorAll('.project-item').forEach(item => item.addEventListener('click', async () => {
    state.view = 'vault';
    state.selectedProjectId = item.dataset.id;
    state.revealCache.clear();
    renderProjects();
    await loadEntries();
  }));
  document.querySelectorAll('[data-edit-project]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openProjectDialog(state.projects.find(project => String(project.id) === String(button.dataset.editProject)));
  }));
  document.querySelectorAll('[data-project-members]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openProjectMembersDialog(state.projects.find(project => String(project.id) === String(button.dataset.projectMembers)));
  }));
  document.querySelectorAll('[data-delete-project]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    deleteProject(button.dataset.deleteProject);
  }));
}

function renderHeader() {
  const project = currentProject();
  $('#newEntryBtn').disabled = !project || !canCreateEntry();
  const title = $('#currentProjectName');
  const meta = $('#currentProjectMeta');
  if (title) title.textContent = project?.name || 'Tất cả dự án';
  if (meta) {
    const typeName = state.selectedTypeId === 'All'
      ? 'Tất cả loại account'
      : state.entryTypes.find(type => String(type.id) === String(state.selectedTypeId))?.name || 'Đang lọc';
    meta.textContent = `${state.entries.length} mục - ${typeName}`;
  }
  const search = $('#globalSearch');
  if (search) search.placeholder = project ? `Tìm trong ${project.name}...` : 'Tìm account, URL, username...';
  renderStats();
}

function currentProject() {
  return state.projects.find(item => String(item.id) === String(state.selectedProjectId)) || null;
}

function projectTypePermissions(project = currentProject()) {
  return project?.entryTypePermissions || [];
}

function permissionForProjectType(typeId, project = currentProject()) {
  if (state.currentUser?.role === 'Admin') {
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
  return projectTypePermissions(project).find(permission => String(permission.entryTypeId) === String(typeId)) || null;
}

function canCreateEntry(typeId = null) {
  const project = currentProject();
  if (!project) return false;
  if (state.currentUser?.role === 'Admin') return true;
  const selectedTypeId = typeId || (state.selectedTypeId === 'All' ? null : state.selectedTypeId);
  if (selectedTypeId) return Boolean(permissionForProjectType(selectedTypeId, project)?.canCreate);
  return projectTypePermissions(project).some(permission => permission.canCreate);
}

function entryTypeOptionsForEntry(entry = {}) {
  if (state.currentUser?.role === 'Admin') return state.entryTypes;
  if (entry.id) {
    return state.entryTypes.filter(type => (
      String(type.id) === String(entryTypeIdForEntry(entry))
        || permissionForProjectType(type.id)?.canEdit
    ));
  }
  return state.entryTypes.filter(type => permissionForProjectType(type.id)?.canCreate);
}

function entryTypeIdForEntry(entry = {}) {
  if (entry.typeId) return entry.typeId;
  if (!entry.type) return '';
  return state.entryTypes.find(type => String(type.name).toLowerCase() === String(entry.type).toLowerCase())?.id || '';
}

function firstCreatableEntryTypeId() {
  if (state.currentUser?.role === 'Admin') return state.entryTypes[0]?.id || '';
  const permission = projectTypePermissions().find(item => item.canCreate);
  return permission?.entryTypeId || '';
}

function renderStats() {
  const allItems = $('#allItemsCount');
  if (allItems) allItems.textContent = `${state.entries.length} nội dung`;
}

function renderTypeFilters() {
  const filters = [{ id: 'All', name: 'All' }, ...state.entryTypes];
  $('#typeFilters').innerHTML = filters.map(type => `<button class="filter ${String(type.id) === String(state.selectedTypeId) ? 'active' : ''}" data-type-id="${type.id}">${escapeHtml(type.name)}</button>`).join('');
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
    state.selectedTypeId = button.dataset.typeId;
    renderTypeFilters();
    renderEntries();
    renderHeader();
  }));
}

function fillEntryTypes(types = state.entryTypes) {
  $('#entryTypeSelect').innerHTML = types.map(type => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join('');
}

function entryMatchesSelectedType(entry) {
  if (state.selectedTypeId === 'All') return true;
  if (String(entry.typeId || '') === String(state.selectedTypeId)) return true;
  const selectedType = state.entryTypes.find(type => String(type.id) === String(state.selectedTypeId));
  return Boolean(selectedType?.name && String(entry.type || '').toLowerCase() === String(selectedType.name).toLowerCase());
}

function renderEntries(rows = state.entries) {
  const filtered = rows.filter(entryMatchesSelectedType);
  $('#emptyState').classList.toggle('hidden', filtered.length > 0);
  $('#entryList').innerHTML = filtered.map(entry => `
    <button class="entry-card ${String(entry.id) === String(state.selectedEntryId) ? 'active' : ''}" data-select="${entry.id}">
      <span class="entry-icon">${svgIcon(iconNameForType(entry.type))}<span>${iconForType(entry.type)}</span></span>
      <span class="entry-text">
        <strong>${escapeHtml(entry.name)}</strong>
        <small>${escapeHtml(entry.username || entry.url || 'No user')}</small>
      </span>
    </button>
  `).join('');
  if (!filtered.some(entry => String(entry.id) === String(state.selectedEntryId))) {
    state.selectedEntryId = filtered[0]?.id || null;
  }
  renderDetail(filtered.find(entry => String(entry.id) === String(state.selectedEntryId)) || null);
  bindRowActions();
}

function bindRowActions() {
  document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => {
    state.selectedEntryId = button.dataset.select;
    renderEntries();
  }));
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copyText(button.dataset.copy)));
  document.querySelectorAll('[data-reveal]').forEach(button => button.addEventListener('click', () => revealPassword(button.dataset.reveal)));
  document.querySelectorAll('[data-copy-pass]').forEach(button => button.addEventListener('click', () => copyPassword(button.dataset.copyPass)));
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openEntryDialog(state.entries.find(entry => String(entry.id) === String(button.dataset.edit)))));
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => deleteEntry(button.dataset.delete)));
}

function renderDetail(entry) {
  if (state.view === 'users') return renderUsersPanel();
  if (!entry) {
    $('#detailPanel').className = 'detail-empty';
    $('#detailPanel').innerHTML = `
      <div class="empty-lock">${svgIcon('shield')}</div>
      <h2>Chọn một account</h2>
      <p>Account, mật khẩu và đường link sẽ hiển thị ở đây.</p>
    `;
    return;
  }

  const password = state.revealCache.get(entry.id) || '************';
  const canEditEntry = Boolean(entry.permissions?.canEdit);
  const canDeleteEntry = Boolean(entry.permissions?.canDelete);
  const canRevealEntryPassword = Boolean(entry.permissions?.canRevealPassword);
  const canViewUsername = Boolean(entry.permissions?.canViewUsername);
  const canViewUrl = Boolean(entry.permissions?.canViewUrl);
  const canViewNotes = Boolean(entry.permissions?.canViewNotes);
  $('#detailPanel').className = 'detail-content';
  $('#detailPanel').innerHTML = `
    <header class="detail-head">
      <div>
        <h1>${escapeHtml(entry.name)}</h1>
        <p><span class="tag-dot"></span> ${escapeHtml(projectName(entry.projectId))}</p>
      </div>
      <div class="detail-actions">
        ${canEditEntry ? `<button data-edit="${entry.id}">${svgIcon('edit')} Sửa</button>` : ''}
        ${canDeleteEntry ? `<button data-delete="${entry.id}">${svgIcon('trash')} Xóa</button>` : ''}
      </div>
    </header>

    <section class="secret-card">
      <div class="secret-row">
        <span class="secret-icon">${svgIcon('user')}</span>
        <div>
          <small>Email</small>
          <strong>${canViewUsername ? escapeHtml(entry.username || 'Chưa có username') : 'Bị giới hạn'}</strong>
        </div>
        ${canViewUsername && entry.username ? `<button class="ghost-btn" data-copy="${escapeAttr(entry.username)}">${svgIcon('copy')} Copy</button>` : ''}
      </div>
      <div class="secret-row">
        <span class="secret-icon">${svgIcon('key')}</span>
        <div>
          <small>Mật khẩu</small>
          <strong class="password-text">${escapeHtml(password)}</strong>
        </div>
        ${canRevealEntryPassword ? `<span class="risk-badge">Nhạy cảm</span>
        <button class="ghost-btn" data-reveal="${entry.id}">${svgIcon('eye')} Xem</button>
        <button class="ghost-btn" data-copy-pass="${entry.id}">${svgIcon('copy')} Copy</button>` : '<span class="risk-badge">Bị giới hạn</span>'}
      </div>
    </section>

    <section class="secret-card single">
      <div class="secret-row">
        <span class="secret-icon">${svgIcon('link')}</span>
        <div>
          <small>Trang web</small>
          ${canViewUrl
            ? (entry.url ? `<a class="detail-link" href="${escapeAttr(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.url)}</a>` : '<strong>Chưa có URL</strong>')
            : '<strong>Bị giới hạn</strong>'}
        </div>
      </div>
    </section>

    <section class="meta-card">
      <div><span>SYNC</span><strong>Tự động điền mới nhất</strong><small>Chưa có dữ liệu</small></div>
      <div><span>UPD</span><strong>Sửa đổi lần cuối</strong><small>${escapeHtml(entry.updatedAt || '')}</small></div>
      <div><span>NEW</span><strong>Đã tạo</strong><small>${escapeHtml(entry.createdAt || '')}</small></div>
    </section>

    <details class="more-info">
      <summary>Thông tin thêm</summary>
      <p>${canViewNotes ? escapeHtml(entry.notes || 'Không có ghi chú.') : 'Bị giới hạn'}</p>
      <p>${canViewNotes ? escapeHtml(entry.tags.join(', ') || 'Không có tag.') : 'Bị giới hạn'}</p>
    </details>
  `;
}

function projectName(projectId) {
  return state.projects.find(project => String(project.id) === String(projectId))?.name || 'Personal';
}

function iconForType(type) {
  const labels = { Web: 'WEB', Admin: 'ADM', Mobile: 'MOB', Desktop: 'DSK', API: 'API', Hosting: 'HST', Domain: 'DOM', Database: 'DB', Server: 'SRV' };
  return labels[type] || String(type || 'ACC').slice(0, 3).toUpperCase();
}

function iconNameForType(type) {
  return {
    Web: 'globe',
    Admin: 'shield',
    Mobile: 'phone',
    Desktop: 'monitor',
    API: 'api',
    Hosting: 'server',
    Domain: 'link',
    Database: 'database',
    Server: 'server'
  }[type] || 'key';
}

function projectIcon(name) {
  return String(name || 'P').slice(0, 2).toUpperCase();
}

async function openProjectDialog(project = {}) {
  if (!isAdmin()) return toast('Chỉ admin được quản lý dự án');
  const form = $('#projectForm');
  form.id.value = project.id || '';
  form.name.value = project.name || '';
  form.description.value = project.description || '';
  form.status.value = project.status || 'Active';
  $('#projectDialog').showModal();
  focusDialogField('#projectDialog', 'input[name="name"]');
}

async function saveProject(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const id = data.id;
  delete data.id;
  const project = await api(id ? `/api/projects/${id}` : '/api/projects', {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(data)
  });
  state.selectedProjectId = project.id;
  $('#projectDialog').close();
  toast('Đã lưu dự án');
  await loadProjects();
}

async function openProjectMembersDialog(project) {
  if (!project || !can('users.manage')) return toast('Bạn không có quyền quản lý thành viên dự án');
  const form = $('#projectMembersForm');
  const title = $('#projectMembersTitle');
  form.projectId.value = project.id;
  state.projectMemberProjectId = project.id;
  if (title) title.textContent = `Thành viên - ${project.name}`;
  await renderProjectMemberMatrix(project.id);
  $('#projectMembersDialog').showModal();
}

async function renderProjectMemberMatrix(projectId) {
  const section = $('#projectMembersSection');
  if (!section) return;
  section.classList.toggle('hidden', !projectId);
  state.projectMemberDraft = [];
  if (!projectId) return;

  await loadUsersForPermissions();
  state.projectMemberDraft = await loadProjectMembers(projectId);
  renderProjectMemberOptions();
  renderProjectMemberList();
}

async function loadUsersForPermissions() {
  if (state.users.length) return;
  state.users = await api('/api/users?basic=1');
}

async function loadProjectMembers(projectId) {
  return api(`/api/projects/${projectId}/members`);
}

async function persistProjectMembers() {
  const projectId = $('#projectMembersForm')?.projectId?.value || state.projectMemberProjectId;
  if (!projectId) return;
  const result = await api(`/api/projects/${projectId}/members`, {
    method: 'PATCH',
    body: JSON.stringify({ members: collectProjectMembers() })
  });
  state.projectMemberDraft = Array.isArray(result.members) ? result.members : state.projectMemberDraft;
}

function renderProjectMemberOptions() {
  const select = $('#projectMemberSelect');
  if (!select) return;
  const selected = new Set(state.projectMemberDraft.map(member => String(member.userId)));
  const options = state.users
    .filter(user => user.role !== 'Admin' && !selected.has(String(user.id)))
    .map(user => `<option value="${user.id}">${escapeHtml(user.displayName || user.username)} - ${escapeHtml(user.username)}</option>`)
    .join('');
  select.innerHTML = options || '<option value="">Không còn user để thêm</option>';
  select.disabled = !options;
  const addButton = $('#addProjectMemberBtn');
  if (addButton) addButton.disabled = !options;
}

function renderProjectMemberList() {
  const list = $('#projectMemberList');
  if (!list) return;
  list.innerHTML = state.projectMemberDraft.map(member => `
    <article class="project-member-card" data-member-id="${member.userId}">
      <div>
        <strong>${escapeHtml(member.displayName || member.username)}</strong>
        <small>${escapeHtml(member.username || '')} - ${escapeHtml(member.role || '')}</small>
      </div>
      <div class="user-actions">
        <button type="button" data-edit-member="${member.userId}">Quyền trong dự án</button>
        <button type="button" data-remove-member="${member.userId}">Xóa khỏi dự án</button>
      </div>
    </article>
  `).join('') || '<p class="form-hint">Chưa có thành viên. Chọn user bên trên để thêm vào dự án.</p>';
  document.querySelectorAll('[data-edit-member]').forEach(button => {
    button.addEventListener('click', () => openMemberPermissionDialog(button.dataset.editMember));
  });
  document.querySelectorAll('[data-remove-member]').forEach(button => {
    button.addEventListener('click', () => removeProjectMember(button.dataset.removeMember));
  });
}

function addSelectedProjectMember() {
  const select = $('#projectMemberSelect');
  const userId = Number(select?.value);
  if (!userId) return;
  const user = state.users.find(item => Number(item.id) === userId);
  if (!user || state.projectMemberDraft.some(member => Number(member.userId) === userId)) return;
  const member = {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    detailedPermissions: defaultProjectMemberPermissions()
  };
  state.projectMemberDraft.push(member);
  renderProjectMemberOptions();
  renderProjectMemberList();
  openMemberPermissionDialog(member.userId);
}

function defaultProjectMemberPermissions() {
  return state.entryTypes.map(type => ({
    entryTypeId: type.id,
    canViewEntry: true,
    canViewUrl: false,
    canViewUsername: false,
    canRevealPassword: false,
    canViewNotes: false,
    canCreate: false,
    canEdit: false,
    canDelete: false
  }));
}

async function removeProjectMember(userId) {
  state.projectMemberDraft = state.projectMemberDraft.filter(member => String(member.userId) !== String(userId));
  await persistProjectMembers();
  renderProjectMemberOptions();
  renderProjectMemberList();
  toast('Đã xóa thành viên khỏi dự án');
}

async function deleteProject(id) {
  if (!isAdmin()) return toast('Chỉ admin được xóa dự án');
  const project = state.projects.find(item => String(item.id) === String(id));
  if (!confirm(`Xóa dự án "${project?.name || id}" và toàn bộ account bên trong?`)) return;
  await api(`/api/projects/${id}`, { method: 'DELETE' });
  if (String(state.selectedProjectId) === String(id)) {
    state.selectedProjectId = null;
    state.selectedEntryId = null;
  }
  toast('Đã xóa dự án');
  await loadProjects();
}

async function openEntryDialog(entry = {}) {
  const editing = Boolean(entry.id);
  if (editing && !entry.permissions?.canEdit) return toast('Bạn không có quyền sửa account này');
  if (!editing && !canCreateEntry()) return toast('Bạn không có quyền tạo account trong dự án này');
  let formEntry = entry;
  if (editing) {
    try {
      formEntry = await api(`/api/entries/${entry.id}/edit`);
    } catch (error) {
      toast(error.message);
      return;
    }
  }
  const typeOptions = entryTypeOptionsForEntry(formEntry);
  if (!typeOptions.length) return toast('Bạn không có quyền với loại account nào trong dự án này');
  const form = $('#entryForm');
  fillEntryTypes(typeOptions);
  form.id.value = formEntry.id || '';
  form.name.value = formEntry.name || '';
  form.typeId.value = formEntry.id ? entryTypeIdForEntry(formEntry) : firstCreatableEntryTypeId();
  form.environment.value = formEntry.environment || 'Production';
  form.url.value = formEntry.url || '';
  form.username.value = formEntry.username || '';
  form.password.value = '';
  form.tags.value = (formEntry.tags || []).join(', ');
  form.notes.value = formEntry.notes || '';
  form.status.value = formEntry.status || 'Active';
  $('#entryDialog').showModal();
  focusDialogField('#entryDialog', 'input[name="name"]');
}

async function saveEntry(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const id = data.id;
  delete data.id;
  data.projectId = state.selectedProjectId;
  data.tags = data.tags.split(',').map(tag => tag.trim()).filter(Boolean);
  if (!data.password && id) delete data.password;
  try {
    await api(id ? `/api/entries/${id}` : '/api/entries', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(data)
    });
  } catch (error) {
    toast(error.message);
    return;
  }
  $('#entryDialog').close();
  toast('Đã lưu account/link');
  await loadEntries();
}

async function revealPassword(id) {
  const entry = state.entries.find(item => String(item.id) === String(id));
  if (!entry?.permissions?.canRevealPassword) return toast('Bạn không có quyền xem mật khẩu');
  const result = await api(`/api/entries/${id}/reveal-password`, { method: 'POST' });
  state.revealCache.set(id, result.password);
  renderEntries();
}

async function copyPassword(id) {
  const entry = state.entries.find(item => String(item.id) === String(id));
  if (!entry?.permissions?.canRevealPassword) return toast('Bạn không có quyền copy mật khẩu');
  let password = state.revealCache.get(id);
  if (!password) {
    const result = await api(`/api/entries/${id}/reveal-password`, { method: 'POST' });
    password = result.password || '';
  }
  await copyText(password);
  await api(`/api/entries/${id}/copy-password-log`, { method: 'POST' });
}

async function deleteEntry(id) {
  const entry = state.entries.find(item => String(item.id) === String(id));
  if (!entry?.permissions?.canDelete) return toast('Bạn không có quyền xóa account này');
  if (!confirm('Xóa mục này?')) return;
  await api(`/api/entries/${id}`, { method: 'DELETE' });
  toast('Đã xóa');
  await loadEntries();
}

async function globalSearch() {
  const query = $('#globalSearch').value.trim();
  if (!query) return renderEntries();
  const rows = await api(`/api/entries/search?q=${encodeURIComponent(query)}`);
  renderEntries(rows);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text || '');
  toast('Đã copy');
}

async function download(path, filename) {
  if (!isAdmin()) return toast('Chỉ admin được export dữ liệu');
  const res = await fetch(path);
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function saveJsonBackup() {
  if (!isAdmin()) return toast('Chỉ admin được lưu backup');
  const result = await api('/api/backups/save-json', { method: 'POST' });
  toast(`Đã lưu JSON: ${result.counts.projects} dự án, ${result.counts.entries} account`);
}

async function importFile(event) {
  if (!isAdmin()) return toast('Chỉ admin được import dữ liệu');
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  if (file.name.endsWith('.json')) {
    const data = JSON.parse(text);
    toast(`Đã đọc JSON: ${(data.entries || []).length} entries`);
  } else {
    const rows = text.split(/\r?\n/).slice(1).filter(Boolean);
    toast(`Đã đọc CSV: ${rows.length} dòng`);
  }
  event.target.value = '';
}

async function createEntryType() {
  if (!can('users.manage')) return toast('Bạn không có quyền quản lý loại account');
  const name = prompt('Tên loại account mới');
  if (!name?.trim()) return;
  await api('/api/entry-types', {
    method: 'POST',
    body: JSON.stringify({ name: name.trim() })
  });
  await loadEntryTypes();
  toast('Đã thêm loại account');
}

let autoLockTimer;
function resetAutoLock() {
  clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(logout, state.autoLockMinutes * 60 * 1000);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

function can(permission) {
  if (state.currentUser?.role === 'Admin') return true;
  return Boolean(state.currentUser?.permissions?.includes(permission));
}

function isAdmin() {
  return state.currentUser?.role === 'Admin';
}

function applyPermissionUi() {
  $('#usersNavBtn').classList.toggle('hidden', !can('users.manage'));
  $('#newProjectBtn').disabled = !isAdmin();
  $('#importBtn').disabled = !isAdmin();
  $('#addEntryTypeBtn').classList.toggle('hidden', !can('users.manage'));
  $('#saveJsonBtn').disabled = !isAdmin();
  $('#exportJsonBtn').disabled = !isAdmin();
  $('#exportCsvBtn').disabled = !isAdmin();
  renderCurrentUser();
}

function renderCurrentUser() {
  const user = state.currentUser;
  if (!user) return;
  const card = $('#currentUserCard');
  const markup = `
    <span class="account-avatar">${escapeHtml((user.displayName || user.username || 'A').slice(0, 1).toUpperCase())}</span>
    <div>
      <strong>${escapeHtml(user.displayName || user.username)}</strong>
      <small>${escapeHtml(user.username)} - ${escapeHtml(user.role)}</small>
    </div>
  `;
  if (card) card.innerHTML = markup;
  const topbar = $('#currentUserTopbar');
  if (topbar) topbar.innerHTML = markup;
}

async function showUsersPanel() {
  if (!can('users.manage')) return toast('Bạn không có quyền quản lý người dùng');
  state.view = 'users';
  state.users = await api('/api/users');
  renderUsersPanel();
}

function renderUsersPanel() {
  $('#detailPanel').className = 'detail-content users-panel';
  $('#detailPanel').innerHTML = `
    <header class="detail-head">
      <div>
        <h1>Người dùng & phân quyền</h1>
        <p><span class="tag-dot"></span> Tài khoản nội bộ được tạo sau khi admin đăng nhập</p>
      </div>
      <div class="detail-actions">
        <button id="addUserBtn">+ Thêm user</button>
      </div>
    </header>
    <section class="users-grid">
      ${state.users.map(user => `
        <article class="user-card">
          <div>
            <strong>${escapeHtml(user.displayName || user.username)}</strong>
            <small>${escapeHtml(user.username)} - ${escapeHtml(user.status)}</small>
          </div>
          <span class="role-chip">${escapeHtml(user.role)}</span>
          <p>${permissionSummary(user)}</p>
          <div class="user-actions">
            <button data-edit-user="${user.id}">${user.status === 'Pending' ? 'Duyệt & phân quyền' : 'Sửa'}</button>
            ${['Invited', 'Expired'].includes(user.status) ? `<button data-invite-user="${user.id}">Gửi email mời</button>` : ''}
            ${Number(user.id) === Number(state.currentUser?.id) ? '' : `<button data-delete-user="${user.id}">Xóa</button>`}
          </div>
        </article>
      `).join('')}
    </section>
  `;
  $('#addUserBtn').addEventListener('click', () => openUserDialog());
  document.querySelectorAll('[data-edit-user]').forEach(button => {
    button.addEventListener('click', () => openUserDialog(state.users.find(user => String(user.id) === String(button.dataset.editUser))));
  });
  document.querySelectorAll('[data-invite-user]').forEach(button => {
    button.addEventListener('click', () => resendUserInvite(button.dataset.inviteUser));
  });
  document.querySelectorAll('[data-delete-user]').forEach(button => {
    button.addEventListener('click', () => deleteUser(button.dataset.deleteUser));
  });
}

function permissionSummary(user) {
  if (user.status === 'Pending') return 'Yêu cầu tham gia - Chờ admin phê duyệt. Duyệt xong user sẽ Active ngay và gửi email thông báo nếu đã cấu hình mail.';
  if (user.status === 'Invited') return `Đã mời, hết hạn ${formatDateTime(user.inviteExpiresAt)}`;
  if (user.status === 'Expired') return 'Lời mời đã hết hạn. Gửi email mời để cấp lại quyền truy cập.';
  if (user.role === 'Admin') return 'Toàn quyền hệ thống';
  if (!user.permissions.length) return 'Quyền thao tác được cấp theo từng dự án';
  const labels = {
    'users.manage': 'quản lý phân quyền'
  };
  return user.permissions.map(permission => labels[permission] || permission).join(', ');
}

function openUserDialog(user = {}) {
  const form = $('#userForm');
  const creating = !user.id;
  const passwordField = form.password.closest('label');
  const statusField = form.status.closest('label');
  const inviteHint = $('#userInviteHint');
  const saveButton = $('#saveUserBtn');
  form.id.value = user.id || '';
  form.username.value = user.username || '';
  form.username.disabled = Boolean(user.id);
  form.displayName.value = user.displayName || '';
  form.password.value = '';
  form.password.required = false;
  passwordField?.classList.toggle('hidden', creating);
  statusField?.classList.toggle('hidden', creating);
  if (inviteHint) {
    if (creating) inviteHint.textContent = 'Nhập email Google của user. Khi lưu, hệ thống sẽ tạo tài khoản nội bộ và gửi email mời Supabase.';
    else if (user.status === 'Pending') inviteHint.textContent = 'Tài khoản Google này đang yêu cầu tham gia. Chuyển trạng thái sang Active và cấp quyền; hệ thống sẽ gửi email thông báo nếu đã cấu hình mail.';
    else inviteHint.textContent = 'Email đăng nhập là định danh dùng để map Google vào quyền nội bộ.';
  }
  if (saveButton) saveButton.textContent = creating ? 'Tạo user & gửi email mời' : (user.status === 'Pending' ? 'Duyệt và cấp quyền' : 'Lưu thay đổi');
  if (user.status === 'Pending') form.status.value = 'Active';
  else form.status.value = user.status || 'Invited';
  form.role.value = user.role || 'Viewer';
  setPermissionChecks(user.permissions || []);
  syncRolePermissions();
  $('#userDialog').showModal();
  focusDialogField('#userDialog', user.id ? 'input[name="displayName"]' : 'input[name="username"]');
}

function setPermissionChecks(permissions) {
  document.querySelectorAll('#userForm input[name="permissions"]').forEach(input => {
    input.checked = permissions.includes(input.value);
  });
}

function permissionColumns() {
  return [
    ['canViewEntry', 'Xem'],
    ['canViewUrl', 'URL'],
    ['canViewUsername', 'User'],
    ['canRevealPassword', 'Pass'],
    ['canViewNotes', 'Note'],
    ['canCreate', 'Tạo'],
    ['canEdit', 'Sửa'],
    ['canDelete', 'Xóa']
  ];
}

function openMemberPermissionDialog(userId) {
  const member = state.projectMemberDraft.find(item => String(item.userId) === String(userId));
  if (!member) return;
  const form = $('#memberPermissionForm');
  const title = $('#memberPermissionTitle');
  const matrix = $('#memberPermissionMatrix');
  form.userId.value = member.userId;
  if (title) title.textContent = `Quyền trong dự án - ${member.displayName || member.username}`;
  const existing = new Map((member.detailedPermissions || []).map(permission => [
    String(permission.entryTypeId),
    permission
  ]));
  const columns = permissionColumns();
  matrix.innerHTML = state.entryTypes.map(type => {
    const permission = existing.get(String(type.id)) || {};
    return `
      <div class="permission-type-row" data-entry-type-id="${type.id}">
        <span>${escapeHtml(type.name)}</span>
        ${columns.map(([key, label]) => `
          <label><input type="checkbox" data-permission-key="${key}" ${permission[key] ? 'checked' : ''}> ${label}</label>
        `).join('')}
      </div>
    `;
  }).join('');
  $('#memberPermissionDialog').showModal();
}

function collectProjectMembers() {
  return state.projectMemberDraft.map(member => ({
    userId: member.userId,
    detailedPermissions: member.detailedPermissions || []
  }));
}

function collectDetailedPermissions() {
  return Array.from(document.querySelectorAll('#memberPermissionMatrix .permission-type-row'))
    .map(row => {
      const permission = {
        entryTypeId: Number(row.dataset.entryTypeId)
      };
      row.querySelectorAll('[data-permission-key]').forEach(input => {
        permission[input.dataset.permissionKey] = input.checked;
      });
      return permission;
    })
    .filter(permission => Object.entries(permission).some(([key, value]) => key.startsWith('can') && value));
}

async function saveMemberPermissionDraft(event) {
  event.preventDefault();
  const userId = Number(event.target.userId.value);
  const member = state.projectMemberDraft.find(item => Number(item.userId) === userId);
  if (!member) return;
  member.detailedPermissions = collectDetailedPermissions();
  await persistProjectMembers();
  $('#memberPermissionDialog').close();
  renderProjectMemberList();
  toast('Đã lưu quyền thành viên');
}

function syncRolePermissions() {
  const role = $('#userRoleSelect').value;
  const rolePermissions = {
    Admin: ['users.manage'],
    Manager: ['users.manage'],
    Viewer: []
  };
  const allowed = new Set(rolePermissions[role] || []);
  document.querySelectorAll('#userForm input[name="permissions"]').forEach(input => {
    input.disabled = role === 'Admin' || !allowed.has(input.value);
    if (role === 'Admin') input.checked = true;
    else if (!allowed.has(input.value)) input.checked = false;
  });
}

async function saveUser(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const id = formData.get('id');
  const payload = {
    username: form.username.value.trim(),
    displayName: form.displayName.value.trim(),
    password: form.password.value,
    role: form.role.value,
    status: form.status.value,
    permissions: formData.getAll('permissions')
  };
  if (!payload.password) delete payload.password;
  const result = await api(id ? `/api/users/${id}` : '/api/users', {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload)
  });
  $('#userDialog').close();
  if (result.approvalEmailSent) toast('Đã duyệt và gửi email thông báo');
  else if (result.approvalEmailRequired) toast('Đã duyệt. Email thông báo chưa được cấu hình');
  else toast('Đã lưu người dùng');
  await showUsersPanel();
}

async function resendUserInvite(id) {
  try {
    const result = await api(`/api/users/${id}/invite`, { method: 'POST' });
    toast(result.inviteSent ? 'Đã gửi email mời Supabase' : 'Supabase invite chưa được cấu hình');
  } catch (error) {
    toast(error.message);
  }
}

async function deleteUser(id) {
  if (!confirm('Xóa người dùng này?')) return;
  const result = await api(`/api/users/${id}`, { method: 'DELETE' });
  toast(result.authDeleted ? 'Đã xóa người dùng và Supabase Auth' : 'Đã xóa người dùng');
  await showUsersPanel();
}

function focusDialogField(dialogSelector, fieldSelector) {
  requestAnimationFrame(() => {
    const field = $(`${dialogSelector} ${fieldSelector}`);
    if (!field || field.disabled) return;
    field.focus({ preventScroll: true });
    if (typeof field.select === 'function') field.select();
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function svgIcon(name) {
  const icons = {
    api: '<path d="M4 7h16"/><path d="M4 17h16"/><path d="M7 4v16"/><path d="M17 4v16"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
    key: '<circle cx="7.5" cy="14.5" r="3.5"/><path d="M10 12 21 1"/><path d="m16 6 2 2"/><path d="m19 3 2 2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 8h.01"/><path d="M7 17h.01"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-5"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.7-4 14.3-4 16 0"/>',
    users: '<path d="M16 21c0-2.2-2.7-4-6-4s-6 1.8-6 4"/><circle cx="10" cy="8" r="4"/><path d="M22 21c0-1.8-1.4-3.3-3.5-4"/><path d="M17 4a4 4 0 0 1 0 8"/>'
  };
  return `<svg class="svg-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.key}</svg>`;
}

function formatDateTime(value) {
  if (!value) return 'chua co thoi han';
  return new Date(value).toLocaleString('vi-VN');
}
