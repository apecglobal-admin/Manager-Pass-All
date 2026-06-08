const state = {
  projects: [],
  projectSystems: [],
  projectSystemsByProjectId: {},
  entries: [],
  entryTypes: [],
  selectedProjectId: null,
  selectedEntryId: null,
  selectedSystemId: null,
  selectedEntryIds: new Set(),
  bulkEntryMode: false,
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
  departments: [],
  projectMemberDraft: [],
  projectMemberProjectId: null,
  view: 'vault',
  uiTheme: 'dark',
  uiThemeColors: {
    accent: '#14b8a6',
    accent2: '#f59e0b'
  },
  themePreferenceTimer: null,
  panelLayoutPreferenceTimer: null,
  sidebarCollapsed: false,
  sidebarWidth: 280,
  expandedProjectIds: new Set()
};

const THEME_MODES = new Set(['light', 'mix', 'dark']);
const MIX_THEME_VARIABLES = ['--accent', '--accent-light', '--accent-dim', '--accent2', '--body-glow-1', '--body-glow-2'];
const SIDEBAR_COLLAPSED_WIDTH = 56;
const PANEL_MIN_WIDTH = 10;
const runtimeConfig = window.APECGLOBAL_CONFIG || {};

const $ = selector => document.querySelector(selector);
const loginView = $('#loginView');
const appView = $('#appView');

document.addEventListener('DOMContentLoaded', async () => {
  initializeTheme();
  bindEvents();
  await checkSession();
});

function bindEvents() {
  $('#loginForm').addEventListener('submit', login);
  $('#googleLoginBtn')?.addEventListener('click', loginWithGoogle);
  $('#lockBtn').addEventListener('click', logout);
  $('#usersNavBtn').addEventListener('click', showUsersPanel);
  $('#sidebarToggleBtn')?.addEventListener('click', toggleSidebar);
  $('#themeMenuBtn')?.addEventListener('click', toggleThemeMenu);
  document.querySelectorAll('[data-theme-option]').forEach(button => {
    button.addEventListener('click', () => {
      const selectedTheme = button.dataset.themeOption;
      setTheme(selectedTheme);
      closeThemeMenu();
      if (selectedTheme === 'mix') openMixColorPopover();
      else closeMixColorPopover();
    });
  });
  $('#mixAccentColor')?.addEventListener('input', event => updateMixThemeColor('accent', event.target.value));
  $('#mixAccent2Color')?.addEventListener('input', event => updateMixThemeColor('accent2', event.target.value));
  $('#newProjectBtn').addEventListener('click', () => openProjectDialog());
  $('#projectSystemForm')?.addEventListener('submit', saveProjectSystem);
  $('#manageEntryTypesBtn')?.addEventListener('click', openEntryTypeDialog);
  $('#newEntryBtn').addEventListener('click', () => openEntryDialog());
  $('#toggleEntryDeleteModeBtn')?.addEventListener('click', toggleEntryDeleteMode);
  $('#deleteSelectedEntriesBtn')?.addEventListener('click', deleteSelectedEntries);
  $('#projectForm').addEventListener('submit', saveProject);
  $('#addProjectMemberBtn')?.addEventListener('click', addSelectedProjectMember);
  $('#memberPermissionForm')?.addEventListener('submit', saveMemberPermissionDraft);
  $('#entryForm').addEventListener('submit', saveEntry);
  $('#addCredentialBtn')?.addEventListener('click', () => addEntryCredentialRow());
  $('#entryTypeForm')?.addEventListener('submit', saveEntryType);
  $('#resetEntryTypeBtn')?.addEventListener('click', resetEntryTypeForm);
  $('#userForm').addEventListener('submit', saveUser);
  $('#userRoleSelect').addEventListener('change', () => {
    syncRolePermissions();
    syncUserDepartmentVisibility();
  });
  $('#userDepartmentSelect')?.addEventListener('change', renderSelectedDepartmentLabels);
  $('#userDepartmentDropdownBtn')?.addEventListener('click', toggleDepartmentDropdown);
  $('#userDepartmentDropdown')?.addEventListener('click', toggleDepartmentOption);
  $('#selectedDepartmentLabels')?.addEventListener('click', removeSelectedDepartmentLabel);
  $('#toggleDepartmentQuickAddBtn')?.addEventListener('click', toggleDepartmentQuickAdd);
  $('#saveDepartmentQuickAddBtn')?.addEventListener('click', saveDepartmentQuickAdd);
  $('#projectSearch').addEventListener('input', renderProjects);
  $('#globalSearch').addEventListener('input', globalSearch);
  $('#exportJsonBtn').addEventListener('click', () => download('/api/export/json?passwords=1', 'apecglobal-backup.json'));
  $('#exportCsvBtn').addEventListener('click', () => download('/api/export/csv?passwords=1', 'apecglobal-export.csv'));
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#saveJsonBtn').addEventListener('click', saveJsonBackup);
  $('#importFile').addEventListener('change', importFile);
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });
  document.addEventListener('mousemove', resetAutoLock);
  document.addEventListener('keydown', resetAutoLock);
  document.addEventListener('click', event => {
    if (!event.target.closest('.theme-picker')) {
      closeThemeMenu();
      closeMixColorPopover();
    }
    if (!event.target.closest('.department-picker')) closeDepartmentDropdown();
    if (!event.target.closest('.item-menu-wrap')) closeItemMenus();
  });
  bindPanelResizeActions();
  syncSidebarState();
}

function initializeTheme() {
  const initialTheme = document.documentElement.dataset.theme || state.uiTheme;
  syncMixThemeInputs();
  setTheme(initialTheme, { silent: true });
}

function setTheme(theme, { silent = false } = {}) {
  const nextTheme = THEME_MODES.has(theme) ? theme : 'dark';
  state.uiTheme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  $('#themeMenuLabel').textContent = themeDisplayName(nextTheme);
  document.querySelectorAll('[data-theme-option]').forEach(button => {
    const active = button.dataset.themeOption === nextTheme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  applyMixThemeColors();
  if (!silent) scheduleThemePreferenceSave();
  if (!silent) toast(`Đã đổi chế độ ${themeLabel(nextTheme)}`);
}

function themeLabel(theme) {
  return { light: 'sáng', mix: 'mix', dark: 'tối' }[theme] || 'tối';
}

function toggleThemeMenu(event) {
  event.stopPropagation();
  const menu = $('#themeMenu');
  const button = $('#themeMenuBtn');
  const willOpen = menu?.classList.contains('hidden');
  menu?.classList.toggle('hidden', !willOpen);
  button?.setAttribute('aria-expanded', String(Boolean(willOpen)));
  if (willOpen) closeMixColorPopover();
}

function closeThemeMenu() {
  $('#themeMenu')?.classList.add('hidden');
  $('#themeMenuBtn')?.setAttribute('aria-expanded', 'false');
}

function openMixColorPopover() {
  $('#mixColorPopover')?.classList.remove('hidden');
}

function closeMixColorPopover() {
  $('#mixColorPopover')?.classList.add('hidden');
}

function themeDisplayName(theme) {
  return { light: 'Sáng', mix: 'Mix', dark: 'Tối' }[theme] || 'Tối';
}

function updateMixThemeColor(key, color) {
  if (!isHexColor(color)) return;
  state.uiThemeColors[key] = color.toLowerCase();
  syncMixThemeInputs();
  if (state.uiTheme !== 'mix') {
    setTheme('mix', { silent: true });
    scheduleThemePreferenceSave();
    return;
  }
  applyMixThemeColors();
  scheduleThemePreferenceSave();
}

function applyUserThemePreferences(user = state.currentUser) {
  const preferences = user?.preferences || {};
  const mixTheme = preferences.mixTheme || {};
  if (isHexColor(mixTheme.accent)) state.uiThemeColors.accent = mixTheme.accent.toLowerCase();
  if (isHexColor(mixTheme.accent2)) state.uiThemeColors.accent2 = mixTheme.accent2.toLowerCase();
  syncMixThemeInputs();
  setTheme(THEME_MODES.has(preferences.theme) ? preferences.theme : state.uiTheme, { silent: true });
  applyUserPanelLayoutPreferences(preferences);
}

function currentThemePreferences() {
  return {
    theme: state.uiTheme,
    mixTheme: {
      accent: state.uiThemeColors.accent,
      accent2: state.uiThemeColors.accent2
    }
  };
}

function scheduleThemePreferenceSave() {
  if (!state.currentUser) return;
  clearTimeout(state.themePreferenceTimer);
  state.themePreferenceTimer = setTimeout(saveThemePreferences, 350);
}

async function saveThemePreferences() {
  if (!state.currentUser) return;
  const preferences = currentThemePreferences();
  try {
    const result = await api('/api/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify(preferences)
    });
    mergeCurrentUserPreferences(result, preferences);
  } catch (error) {
    toast(error.message);
  }
}

function applyUserPanelLayoutPreferences(preferences = state.currentUser?.preferences || {}) {
  const panelLayout = preferences.panelLayout && typeof preferences.panelLayout === 'object' ? preferences.panelLayout : {};
  const sidebarWidth = panelWidthPreference(panelLayout.sidebarWidth, maxSidebarWidth());
  if (sidebarWidth) state.sidebarWidth = sidebarWidth;
  updatePanelWidths();
}

function panelWidthPreference(value, max) {
  const width = Number(value);
  if (!Number.isFinite(width)) return null;
  return clampNumber(Math.round(width), PANEL_MIN_WIDTH, max);
}

function currentPanelLayoutPreferences() {
  return {
    panelLayout: {
      sidebarWidth: Math.round(state.sidebarWidth)
    }
  };
}

function schedulePanelLayoutPreferenceSave() {
  if (!state.currentUser) return;
  clearTimeout(state.panelLayoutPreferenceTimer);
  state.panelLayoutPreferenceTimer = setTimeout(savePanelLayoutPreferences, 200);
}

async function savePanelLayoutPreferences() {
  if (!state.currentUser) return;
  const preferences = currentPanelLayoutPreferences();
  try {
    const result = await api('/api/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify(preferences)
    });
    mergeCurrentUserPreferences(result, preferences);
  } catch (error) {
    toast(error.message);
  }
}

function mergeCurrentUserPreferences(result, preferences) {
  if (result.user) {
    state.currentUser = result.user;
    return;
  }
  state.currentUser = {
    ...state.currentUser,
    preferences: {
      ...(state.currentUser?.preferences || {}),
      ...preferences
    }
  };
}

function syncMixThemeInputs() {
  const accentInput = $('#mixAccentColor');
  const accent2Input = $('#mixAccent2Color');
  if (accentInput) accentInput.value = state.uiThemeColors.accent;
  if (accent2Input) accent2Input.value = state.uiThemeColors.accent2;
}

function applyMixThemeColors() {
  const rootStyle = document.documentElement.style;
  if (state.uiTheme !== 'mix') {
    MIX_THEME_VARIABLES.forEach(variable => rootStyle.removeProperty(variable));
    return;
  }
  const accent = state.uiThemeColors.accent;
  const accent2 = state.uiThemeColors.accent2;
  rootStyle.setProperty('--accent', accent);
  rootStyle.setProperty('--accent-light', lightenHex(accent, 34));
  rootStyle.setProperty('--accent-dim', rgbaFromHex(accent, .14));
  rootStyle.setProperty('--accent2', accent2);
  rootStyle.setProperty('--body-glow-1', rgbaFromHex(accent, .12));
  rootStyle.setProperty('--body-glow-2', rgbaFromHex(accent2, .08));
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}

function rgbaFromHex(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function lightenHex(hex, amount = 30) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    Math.min(255, rgb.r + amount),
    Math.min(255, rgb.g + amount),
    Math.min(255, rgb.b + amount)
  );
}

function hexToRgb(hex) {
  if (!isHexColor(hex)) return null;
  const value = hex.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  syncSidebarState();
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function maxSidebarWidth() {
  return Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MIN_WIDTH - PANEL_MIN_WIDTH);
}

function updatePanelWidths() {
  state.sidebarWidth = clampNumber(state.sidebarWidth, PANEL_MIN_WIDTH, maxSidebarWidth());
  appView?.style.setProperty('--project-sidebar-width', `${state.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : state.sidebarWidth}px`);
}

function bindPanelResizeActions() {
  const sidebarHandle = $('#sidebarResizeHandle');

  sidebarHandle?.addEventListener('pointerdown', event => {
    if (state.sidebarCollapsed) return;
    startPanelResize(event, nextEvent => {
      state.sidebarWidth = clampNumber(nextEvent.clientX, PANEL_MIN_WIDTH, maxSidebarWidth());
      updatePanelWidths();
    });
  });
}

function startPanelResize(event, onMove) {
  event.preventDefault();
  appView?.classList.add('panel-resizing');
  let didResize = false;

  const handleMove = nextEvent => {
    nextEvent.preventDefault();
    didResize = true;
    onMove(nextEvent);
  };

  const stopResize = () => {
    appView?.classList.remove('panel-resizing');
    document.removeEventListener('pointermove', handleMove);
    document.removeEventListener('pointerup', stopResize);
    document.removeEventListener('pointercancel', stopResize);
    if (didResize) schedulePanelLayoutPreferenceSave();
  };

  document.addEventListener('pointermove', handleMove);
  document.addEventListener('pointerup', stopResize, { once: true });
  document.addEventListener('pointercancel', stopResize, { once: true });
}

function syncSidebarState() {
  appView?.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  updatePanelWidths();
  const sidebarHandle = $('#sidebarResizeHandle');
  if (sidebarHandle) {
    sidebarHandle.disabled = state.sidebarCollapsed;
    sidebarHandle.setAttribute('aria-hidden', String(state.sidebarCollapsed));
  }
  const button = $('#sidebarToggleBtn');
  if (!button) return;
  button.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  button.setAttribute('aria-label', state.sidebarCollapsed ? 'Mở sidebar' : 'Đóng sidebar');
  button.title = state.sidebarCollapsed ? 'Mở sidebar' : 'Đóng sidebar';
}

async function api(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }
  return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
}

function apiUrl(path) {
  const apiBaseUrl = String(runtimeConfig.apiBaseUrl || '').trim().replace(/\/$/, '');
  if (!apiBaseUrl || /^https?:\/\//i.test(path)) return path;
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
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
  applyUserThemePreferences();
  await loadEntryTypes();
  if (can('users.manage')) await loadDepartments();
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
  if (state.selectedTypeId !== 'All' && !state.entryTypes.some(type => String(type.id) === String(state.selectedTypeId))) {
    state.selectedTypeId = 'All';
  }
  fillEntryTypes();
}

async function loadDepartments() {
  if (!can('users.manage')) {
    state.departments = [];
    return;
  }
  state.departments = await api('/api/departments');
  fillDepartmentOptions();
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
  if (state.selectedProjectId) state.expandedProjectIds.add(String(state.selectedProjectId));
  renderProjects();
  await loadEntries();
}

async function loadEntries() {
  if (!state.selectedProjectId) {
    state.projectSystems = [];
    state.entries = [];
    state.selectedEntryId = null;
    renderHeader();
    renderEntries();
    return;
  }
  try {
    await loadProjectSystems();
  } catch (error) {
    state.projectSystems = [];
    state.selectedSystemId = null;
    toast(error.message);
  }
  renderProjects();
  try {
    state.entries = await api(`/api/projects/${state.selectedProjectId}/entries`);
    pruneSet(state.selectedEntryIds, new Set(state.entries.map(entry => String(entry.id))));
    state.selectedEntryId = null;
  } catch (error) {
    state.entries = [];
    state.selectedEntryId = null;
    toast(error.message);
  } finally {
    renderHeader();
    renderEntries();
  }
}

async function loadProjectSystems(projectId = state.selectedProjectId) {
  if (!projectId) {
    state.projectSystems = [];
    state.selectedSystemId = null;
    return;
  }
  const systems = await api(`/api/projects/${projectId}/systems`);
  state.projectSystemsByProjectId[String(projectId)] = systems;
  if (String(projectId) !== String(state.selectedProjectId)) return systems;
  state.projectSystems = systems;
  if (!systems.length) {
    state.selectedSystemId = null;
    return systems;
  }
  if (!state.selectedSystemId || !systems.some(system => String(system.id) === String(state.selectedSystemId))) {
    state.selectedSystemId = systems[0].id;
  }
  return systems;
}

function renderProjects() {
  const query = $('#projectSearch').value.toLowerCase();
  $('#projectList').innerHTML = state.projects
    .filter(project => project.name.toLowerCase().includes(query))
    .map(project => `
      <div class="project-node">
      <div class="project-chip ${String(project.id) === String(state.selectedProjectId) ? 'active' : ''} ${isAdmin() ? 'draggable-row' : ''}" data-id="${project.id}" data-drag-project="${project.id}" draggable="${isAdmin() ? 'true' : 'false'}">
        <span class="chip-avatar">${projectIcon(project.name)}</span>
        <strong>${escapeHtml(project.name)}</strong>
        ${can('users.manage') || isAdmin() ? `
          <div class="item-menu-wrap account-menu-wrap">
            <button type="button" class="item-more-btn account-more-btn" aria-label="Mở menu dự án" title="Thao tác">...</button>
            <div class="item-action-menu account-action-menu" role="menu">
              ${can('users.manage') ? `<button type="button" role="menuitem" data-project-members="${project.id}">${svgIcon('users')} Thành viên</button>` : ''}
              ${isAdmin() ? `<button type="button" role="menuitem" data-edit-project="${project.id}">${svgIcon('edit')} Sửa</button><button type="button" role="menuitem" class="danger" data-delete-project="${project.id}">${svgIcon('trash')} Xóa</button>` : ''}
            </div>
          </div>
        ` : ''}
      </div>
      ${renderSystemSubmenu(project)}
      </div>
    `).join('');
  document.querySelectorAll('.project-chip').forEach(item => item.addEventListener('click', async event => {
    if (event.target.closest('.item-menu-wrap')) return;
    state.view = 'vault';
    if (String(state.selectedProjectId) !== String(item.dataset.id)) state.selectedSystemId = null;
    state.selectedProjectId = item.dataset.id;
    state.revealCache.clear();
    state.expandedProjectIds.add(String(state.selectedProjectId));
    renderProjects();
    await loadEntries();
  }));
  document.querySelectorAll('[data-edit-project]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    closeItemMenus();
    openProjectDialog(state.projects.find(project => String(project.id) === String(button.dataset.editProject)));
  }));
  document.querySelectorAll('[data-project-members]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    closeItemMenus();
    openProjectMembersDialog(state.projects.find(project => String(project.id) === String(button.dataset.projectMembers)));
  }));
  document.querySelectorAll('[data-delete-project]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    closeItemMenus();
    deleteProject(button.dataset.deleteProject);
  }));
  document.querySelectorAll('.project-chip .item-more-btn').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const wrap = button.closest('.item-menu-wrap');
    const willOpen = !wrap?.classList.contains('menu-open');
    closeItemMenus();
    if (willOpen) wrap?.classList.add('menu-open');
  }));
  bindSystemSubmenuActions();
  bindProjectDragActions();
  bindSystemDragActions();
  syncBulkActionButtons();
}

function renderSystemSubmenu(project) {
  const projectId = String(project?.id || '');
  const expanded = projectId && (state.expandedProjectIds.has(projectId) || String(state.selectedProjectId) === projectId);
  if (!expanded) return '';
  const systems = String(state.selectedProjectId) === projectId
    ? state.projectSystems
    : (state.projectSystemsByProjectId[projectId] || []);
  const addButton = can('users.manage')
    ? `<button class="add-system-inline" type="button" data-open-system-dialog data-system-project-id="${escapeAttr(projectId)}">+ Thêm hệ thống</button>`
    : '';
  const systemItems = systems.length
    ? systems.map(system => {
      const active = String(system.id) === String(state.selectedSystemId) && String(state.selectedProjectId) === projectId;
      return `
        <button type="button" class="system-chip ${active ? 'active' : ''} ${isAdmin() ? 'draggable-row' : ''}" data-system-project-id="${escapeAttr(projectId)}" data-system-filter="${system.id}" data-drag-system="${system.id}" draggable="${isAdmin() ? 'true' : 'false'}">
          <span class="system-chip-main">
            <span>${escapeHtml(system.name)}</span>
          </span>
          ${can('users.manage') ? `
            <span class="item-menu-wrap account-menu-wrap system-chip-actions">
              <span class="item-more-btn account-more-btn" role="button" aria-label="Mở menu hệ thống" title="Thao tác">...</span>
              <span class="item-action-menu account-action-menu" role="menu">
                <span role="menuitem" data-edit-system="${system.id}">${svgIcon('edit')} Sửa</span>
                <span role="menuitem" class="danger" data-delete-system="${system.id}">${svgIcon('trash')} Xóa</span>
              </span>
            </span>
          ` : ''}
        </button>
      `;
    }).join('')
    : '<div class="system-empty">Chưa có hệ thống</div>';
  return `<div class="system-submenu">${systemItems}${addButton}</div>`;
}

async function activateProjectForSystemAction(projectId) {
  if (!projectId) return;
  if (String(state.selectedProjectId) !== String(projectId)) {
    state.selectedProjectId = projectId;
    state.selectedSystemId = null;
    state.selectedEntryId = null;
  }
  state.projectSystems = state.projectSystemsByProjectId[String(projectId)] || await loadProjectSystems(projectId);
}

function toggleSetValue(set, value, checked) {
  const normalized = String(value || '');
  if (!normalized) return;
  if (checked) set.add(normalized);
  else set.delete(normalized);
}

function pruneSet(set, allowedValues) {
  for (const value of [...set]) {
    if (!allowedValues.has(String(value))) set.delete(value);
  }
}

function syncBulkActionButtons() {
  const entryToggle = $('#toggleEntryDeleteModeBtn');
  entryToggle?.classList.add('hidden');
  if (entryToggle) entryToggle.textContent = state.bulkEntryMode ? 'Hủy chọn account' : 'Chọn xóa account';
  $('#deleteSelectedEntriesBtn')?.classList.add('hidden');
}

function toggleEntryDeleteMode() {
  state.bulkEntryMode = !state.bulkEntryMode;
  if (!state.bulkEntryMode) state.selectedEntryIds.clear();
  renderEntries();
}

function bindProjectDragActions() {
  if (!isAdmin()) return;
  document.querySelectorAll('[data-drag-project]').forEach(row => {
    row.addEventListener('dragstart', event => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/project-id', row.dataset.dragProject);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', event => {
      event.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', async event => {
      event.preventDefault();
      row.classList.remove('drop-target');
      const draggedId = event.dataTransfer.getData('text/project-id');
      const targetId = row.dataset.dragProject;
      if (!draggedId || draggedId === targetId) return;
      state.projects = moveItemBefore(state.projects, draggedId, targetId);
      renderProjects();
      await persistProjectOrder();
    });
  });
}

function bindSystemDragActions() {
  if (!isAdmin()) return;
  document.querySelectorAll('[data-drag-system]').forEach(row => {
    row.addEventListener('dragstart', event => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/system-id', row.dataset.dragSystem);
      event.dataTransfer.setData('text/project-id', row.dataset.systemProjectId);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', event => {
      event.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', async event => {
      event.preventDefault();
      row.classList.remove('drop-target');
      const projectId = row.dataset.systemProjectId;
      const draggedProjectId = event.dataTransfer.getData('text/project-id');
      const draggedId = event.dataTransfer.getData('text/system-id');
      const targetId = row.dataset.dragSystem;
      if (!draggedId || draggedId === targetId || String(projectId) !== String(draggedProjectId)) return;
      const systems = state.projectSystemsByProjectId[String(projectId)] || [];
      const reordered = moveItemBefore(systems, draggedId, targetId);
      state.projectSystemsByProjectId[String(projectId)] = reordered;
      if (String(projectId) === String(state.selectedProjectId)) state.projectSystems = reordered;
      renderEntries();
      await persistSystemOrder(projectId);
    });
  });
}

function moveItemBefore(items, draggedId, targetId) {
  const next = [...items];
  const fromIndex = next.findIndex(item => String(item.id) === String(draggedId));
  const toIndex = next.findIndex(item => String(item.id) === String(targetId));
  if (fromIndex < 0 || toIndex < 0) return next;
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next.map((row, index) => ({ ...row, sortOrder: index + 1 }));
}

async function persistProjectOrder() {
  if (!isAdmin()) return;
  try {
    await api('/api/projects/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ ids: state.projects.map(project => project.id) })
    });
  } catch (error) {
    toast(error.message);
    await loadProjects();
  }
}

async function persistSystemOrder(projectId) {
  if (!isAdmin()) return;
  const systems = state.projectSystemsByProjectId[String(projectId)] || [];
  try {
    await api(`/api/projects/${projectId}/systems/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ ids: systems.map(system => system.id) })
    });
  } catch (error) {
    toast(error.message);
    await loadProjectSystems(projectId);
    renderEntries();
  }
}

function renderHeader() {
  const project = currentProject();
  const system = currentSystem();
  const missingSystems = Boolean(project && !state.projectSystems.length);
  $('#newEntryBtn').disabled = !project || missingSystems || !canCreateEntry();
  $('#newEntryBtn').title = missingSystems
    ? 'Tạo hệ thống trước khi thêm account'
    : '';
  const title = $('#currentProjectName');
  const meta = $('#currentProjectMeta');
  if (title) title.textContent = project?.name || 'Tất cả dự án';
  if (meta) {
    const systemName = system ? system.name : 'He thong';
    meta.textContent = `${state.projectSystems.length} hệ thống - ${systemName}`;
  }
  const search = $('#globalSearch');
  if (search) search.placeholder = project ? `Tìm trong ${project.name}...` : 'Tìm account, URL, username...';
  renderStats();
}

function currentProject() {
  return state.projects.find(item => String(item.id) === String(state.selectedProjectId)) || null;
}

function currentSystem() {
  return state.projectSystems.find(item => String(item.id) === String(state.selectedSystemId)) || null;
}

function projectTypePermissions(project = currentProject()) {
  return project?.entryTypePermissions || [];
}

function permissionForProjectSystem(systemId, project = currentProject()) {
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
  if (!systemId) return null;
  return projectTypePermissions(project).find(permission => String(permission.systemId) === String(systemId)) || null;
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

function canCreateEntry() {
  const project = currentProject();
  if (!project) return false;
  if (!state.projectSystems.length) return false;
  if (!state.selectedSystemId) return false;
  if (state.currentUser?.role === 'Admin') return true;
  return Boolean(permissionForProjectSystem(state.selectedSystemId, project)?.canCreate);
}

function entryTypeOptionsForEntry(entry = {}) {
  if (state.currentUser?.role === 'Admin') return state.entryTypes;
  if (state.projectSystems.length) return state.entryTypes;
  if (entry.id) {
    return state.entryTypes.filter(type => (
      String(type.id) === String(entryTypeIdForEntry(entry))
        || permissionForProjectType(type.id)?.canEdit
    ));
  }
  return state.entryTypes.filter(type => permissionForProjectType(type.id)?.canCreate);
}

function systemOptionsForEntry(entry = {}) {
  if (state.currentUser?.role === 'Admin') return state.projectSystems;
  if (entry.id) {
    return state.projectSystems.filter(system => (
      String(system.id) === String(entry.systemId || entry.projectSystemId)
        || permissionForProjectSystem(system.id)?.canEdit
    ));
  }
  return state.projectSystems.filter(system => permissionForProjectSystem(system.id)?.canCreate);
}

function entryTypeIdForEntry(entry = {}) {
  if (entry.typeId) return entry.typeId;
  if (!entry.type) return '';
  return state.entryTypes.find(type => String(type.name).toLowerCase() === String(entry.type).toLowerCase())?.id || '';
}

function firstCreatableEntryTypeId() {
  if (state.currentUser?.role === 'Admin') return state.entryTypes[0]?.id || '';
  if (state.projectSystems.length) return state.entryTypes[0]?.id || '';
  const permission = projectTypePermissions().find(item => item.canCreate);
  return permission?.entryTypeId || '';
}

function firstCreatableSystemId() {
  if (state.selectedSystemId && state.projectSystems.some(system => String(system.id) === String(state.selectedSystemId))) return state.selectedSystemId;
  return '';
}

function renderStats() {
  const allItems = $('#allItemsCount');
  if (allItems) allItems.textContent = `${state.entries.length} nội dung`;
}

function renderTypeFilters() {
  const container = $('#typeFilters');
  if (!container) return;
  const filters = [{ id: 'All', name: 'All' }, ...state.entryTypes];
  container.innerHTML = filters.map(type => `<button class="filter ${String(type.id) === String(state.selectedTypeId) ? 'active' : ''}" data-type-id="${type.id}">${escapeHtml(type.name)}</button>`).join('');
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

function fillEntrySystems(systems = state.projectSystems) {
  const select = $('#entrySystemSelect');
  if (!select) return;
  if (select.tagName !== 'SELECT') return;
  select.innerHTML = systems.map(system => `<option value="${system.id}">${escapeHtml(system.name)}</option>`).join('');
}

function systemForEntry(entry = {}) {
  const systemId = entry.systemId || entry.projectSystemId;
  return state.projectSystems.find(system => String(system.id) === String(systemId)) || null;
}

function entryMatchesSelectedType(entry) {
  return true;
}

function entryMatchesSelectedSystem(entry) {
  if (!state.selectedSystemId) return false;
  return entryMatchesSystem(entry, state.selectedSystemId);
}

function entryMatchesSystem(entry, systemId) {
  return String(entry.systemId || entry.projectSystemId || '') === String(systemId);
}

function visibleEntries(rows = state.entries) {
  return rows.filter(entryMatchesSelectedSystem);
}

function firstVisibleEntry(entries = visibleEntries()) {
  return entries[0] || null;
}

function selectedVisibleEntry(entries = visibleEntries()) {
  if (state.selectedEntryId) {
    const selected = entries.find(item => String(item.id) === String(state.selectedEntryId));
    if (selected) return selected;
  }
  return firstVisibleEntry(entries);
}

function renderEntries(rows = state.entries) {
  const filtered = visibleEntries(rows);
  const selectedEntry = selectedVisibleEntry(filtered);
  state.selectedEntryId = selectedEntry?.id || null;
  renderProjects();
  renderDetail(selectedEntry);
  bindRowActions();
}

function unusedSystemSections(rows = state.entries) {
  const addButton = can('users.manage')
    ? '<button class="btn-outline system-add-btn" type="button" data-open-system-dialog>＋ Thêm hệ thống</button>'
    : '';
  return `
    <div class="system-column-head">
      <span>Hệ thống</span>
      ${addButton}
    </div>
    <div class="system-section-list">
      ${state.projectSystems.map(system => {
        const active = String(system.id) === String(state.selectedSystemId);
        return `
          <div class="system-group ${active ? 'active' : ''}">
            <section class="system-section ${active ? 'active' : ''} ${isAdmin() ? 'draggable-row' : ''}" data-system-project-id="${state.selectedProjectId}" data-system-filter="${system.id}" data-drag-system="${system.id}" draggable="${isAdmin() ? 'true' : 'false'}">
              <header class="system-section-head">
                <div class="system-section-title">
                  <strong>${escapeHtml(system.name)}</strong>
                </div>
                ${can('users.manage') ? `
                  <div class="item-menu-wrap account-menu-wrap system-section-actions">
                    <button type="button" class="item-more-btn account-more-btn" aria-label="Mở menu hệ thống" title="Thao tác">...</button>
                    <div class="item-action-menu account-action-menu" role="menu">
                      <button type="button" role="menuitem" data-edit-system="${system.id}">${svgIcon('edit')} Sửa</button>
                      <button type="button" role="menuitem" class="danger" data-delete-system="${system.id}">${svgIcon('trash')} Xóa</button>
                    </div>
                  </div>
                ` : ''}
              </header>
            </section>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function bindSystemSubmenuActions() {
  document.querySelectorAll('[data-system-filter]').forEach(section => section.addEventListener('click', async event => {
    if (event.target.closest('[data-edit-system], [data-delete-system], [data-select], [data-edit], [data-delete], [data-select-entry], .item-menu-wrap')) return;
    const projectId = section.dataset.systemProjectId;
    if (projectId && String(projectId) !== String(state.selectedProjectId)) {
      state.selectedProjectId = projectId;
      state.projectSystems = state.projectSystemsByProjectId[String(projectId)] || state.projectSystems;
    }
    state.selectedSystemId = section.dataset.systemFilter;
    state.selectedEntryId = null;
    state.revealCache.clear();
    state.expandedProjectIds.add(String(state.selectedProjectId));
    await loadEntries();
    renderHeader();
  }));
  document.querySelectorAll('.system-submenu .item-more-btn').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const wrap = button.closest('.item-menu-wrap');
    const willOpen = !wrap?.classList.contains('menu-open');
    closeItemMenus();
    if (willOpen) wrap?.classList.add('menu-open');
  }));
  document.querySelectorAll('[data-edit-system]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    closeItemMenus();
    const projectId = button.closest('[data-system-project-id]')?.dataset.systemProjectId || state.selectedProjectId;
    const systems = state.projectSystemsByProjectId[String(projectId)] || state.projectSystems;
    const system = systems.find(item => String(item.id) === String(button.dataset.editSystem));
    if (projectId && String(projectId) !== String(state.selectedProjectId)) {
      state.selectedProjectId = projectId;
      state.projectSystems = systems;
    }
    if (system) openProjectSystemDialog(system);
  }));
  document.querySelectorAll('[data-delete-system]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    closeItemMenus();
    const projectId = button.closest('[data-system-project-id]')?.dataset.systemProjectId;
    if (projectId && String(projectId) !== String(state.selectedProjectId)) {
      state.selectedProjectId = projectId;
      state.projectSystems = state.projectSystemsByProjectId[String(projectId)] || state.projectSystems;
    }
    const systemId = button.dataset.deleteSystem;
    await deleteProjectSystem(systemId);
  }));
  document.querySelectorAll('[data-open-system-dialog]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const projectId = button.dataset.systemProjectId;
    if (projectId && String(projectId) !== String(state.selectedProjectId)) {
      state.selectedProjectId = projectId;
      state.projectSystems = state.projectSystemsByProjectId[String(projectId)] || state.projectSystems;
      renderHeader();
      renderProjects();
    }
    openProjectSystemDialog();
  }));
}

function emptyEntryHtml(filtered, rows) {
  if (!currentProject()) return '<strong>Chọn dự án</strong><p>Chọn một công ty/dự án bên trái để xem hệ thống và account.</p>';
  if (!state.projectSystems.length) {
    const action = can('users.manage')
      ? '<button id="createFirstSystemBtn" class="btn-accent" type="button">＋ Tạo hệ thống đầu tiên</button>'
      : '<p>Admin cần tạo hệ thống trước khi thêm account.</p>';
    return `<strong>Chưa có hệ thống trong dự án</strong><p>Tạo Website, CMS, App hoặc API trước, sau đó mới thêm account vào đúng hệ thống.</p>${action}`;
  }
  if (!filtered.length && rows.length > 0) return '<strong>Không có account phù hợp</strong><p>Thử chọn hệ thống khác trong cột Hệ thống.</p>';
  if (state.currentUser?.role !== 'Admin' && !projectTypePermissions().some(permission => permission.canViewEntry)) {
    return '<strong>Chưa có quyền xem account</strong><p>Admin cần cấp quyền theo hệ thống cho bạn.</p>';
  }
  return '<strong>Chưa có account trong dự án</strong><p>Thêm account đầu tiên vào một hệ thống bên trên.</p>';
}

function emptyEntryMessage(filtered, rows) {
  if (!currentProject()) return 'Chọn dự án để xem tài khoản';
  if (!filtered.length && rows.length > 0) return 'Không có tài khoản phù hợp bộ lọc hiện tại';
  if (state.currentUser?.role !== 'Admin' && !projectTypePermissions().some(permission => permission.canViewEntry)) {
    return 'Bạn chưa có quyền xem tài khoản trong dự án này';
  }
  return 'Chưa có tài khoản trong dự án';
}

function entryListSubtitle(entry) {
  const permissions = entry.permissions || {};
  const canViewUsername = Boolean(permissions.canViewUsername);
  const canViewUrl = Boolean(permissions.canViewUrl);
  if (canViewUsername && entry.username) return entry.username;
  if (canViewUrl && entry.url) return entry.url;
  if (canViewUsername) return 'Chưa có username';
  if (canViewUrl) return 'Chưa có URL';
  return 'Bị giới hạn';
}

function bindRowActions() {
  document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', event => {
    if (event.target.closest('[data-edit], [data-delete], [data-copy], [data-reveal], [data-copy-pass], [data-select-entry], .item-menu-wrap')) return;
    const entry = state.entries.find(item => String(item.id) === String(button.dataset.select));
    state.selectedSystemId = entry?.systemId || entry?.projectSystemId || state.selectedSystemId;
    state.selectedEntryId = button.dataset.select;
    renderEntries();
    renderHeader();
  }));
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => copyText(button.dataset.copy)));
  document.querySelectorAll('[data-reveal]').forEach(button => button.addEventListener('click', () => revealPassword(button.dataset.reveal, button.dataset.credentialReveal || '')));
  document.querySelectorAll('[data-copy-pass]').forEach(button => button.addEventListener('click', () => copyPassword(button.dataset.copyPass, button.dataset.credentialCopy || '')));
  document.querySelectorAll('#detailPanel .item-more-btn').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const wrap = button.closest('.item-menu-wrap');
    const willOpen = !wrap?.classList.contains('menu-open');
    closeItemMenus();
    if (willOpen) wrap?.classList.add('menu-open');
  }));
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    closeItemMenus();
    openEntryDialog(state.entries.find(entry => String(entry.id) === String(button.dataset.edit)));
  }));
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    closeItemMenus();
    deleteEntry(button.dataset.delete);
  }));
  document.querySelectorAll('[data-select-entry]').forEach(input => input.addEventListener('click', event => {
    event.stopPropagation();
    toggleSetValue(state.selectedEntryIds, input.dataset.selectEntry, input.checked);
    syncBulkActionButtons();
  }));
  document.querySelectorAll('.close-detail').forEach(button => button.addEventListener('click', () => {
    const aside = $('#detailAside');
    if (aside) aside.classList.add('open');
  }));
  syncBulkActionButtons();
}

function closeItemMenus() {
  document.querySelectorAll('.item-menu-wrap.menu-open').forEach(menu => menu.classList.remove('menu-open'));
}

function renderDetail(entry) {
  const aside = $('#detailAside');
  if (!entry) {
    $('#detailPanel').className = 'detail-empty';
    $('#detailPanel').innerHTML = `
      <div class="empty-lock">🛡️</div>
      <h3>Chọn một account</h3>
      <p>Chi tiết sẽ hiển thị ở đây</p>
    `;
    if (aside) aside.classList.add('open');
    return;
  }
  if (aside) aside.classList.add('open');

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
        <button class="close-detail" title="Đóng">✕</button>
      </div>
    </header>

    <section class="secret-card credential-detail-list">
      ${credentialDetailRows(entry, { canViewUsername, canRevealEntryPassword })}
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
      <div><span>SYNC</span><strong>Trạng thái quyền</strong><small>${entry.permissions?.canViewEntry ? 'Có quyền xem account' : 'Bị giới hạn quyền'}</small></div>
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

async function openProjectSystemDialog(system = {}) {
  const project = currentProject();
  if (!project || !can('users.manage')) return toast('Bạn không có quyền quản lý hệ thống');
  const form = $('#projectSystemForm');
  form.id.value = system.id || '';
  form.projectId.value = project.id;
  form.name.value = system.name || '';
  form.description.value = system.description || '';
  form.status.value = system.status || 'Active';
  $('#projectSystemDialog').showModal();
  focusDialogField('#projectSystemDialog', 'input[name="name"]');
}

async function saveProjectSystem(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const id = data.id;
  const projectId = data.projectId || state.selectedProjectId;
  delete data.id;
  delete data.projectId;
  let savedSystem;
  try {
    savedSystem = await api(id ? `/api/projects/${projectId}/systems/${id}` : `/api/projects/${projectId}/systems`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(data)
    });
  } catch (error) {
    toast(error.message);
    return;
  }
  toast('Đã lưu hệ thống');
  if (savedSystem?.id) state.selectedSystemId = savedSystem.id;
  await loadProjectSystems(projectId);
  renderProjects();
  $('#projectSystemDialog')?.close();
  await loadEntries();
}

function resetProjectSystemForm(projectId = state.selectedProjectId) {
  const form = $('#projectSystemForm');
  if (!form) return;
  form.id.value = '';
  form.projectId.value = projectId || '';
  form.name.value = '';
  form.description.value = '';
  form.status.value = 'Active';
  $('#saveProjectSystemBtn').textContent = 'Lưu hệ thống';
}

async function deleteProjectSystem(id) {
  const projectId = state.selectedProjectId;
  const system = state.projectSystems.find(item => String(item.id) === String(id));
  if (!projectId || !system) return;
  if (!confirm(`Xóa hệ thống "${system.name}"?`)) return;
  try {
    await api(`/api/projects/${projectId}/systems/${id}`, { method: 'DELETE' });
    if (String(state.selectedSystemId) === String(id)) state.selectedSystemId = null;
    await loadProjectSystems(projectId);
    renderProjects();
    await loadEntries();
    toast('Đã xóa hệ thống');
  } catch (error) {
    toast(error.message);
  }
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
  await loadProjectSystems(projectId);
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
  const userId = String(select?.value || '');
  if (!userId) return;
  const user = state.users.find(item => String(item.id) === userId);
  if (!user || state.projectMemberDraft.some(member => String(member.userId) === userId)) return;
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
  return state.projectSystems.map(system => ({
    systemId: system.id,
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
  if (!editing && !state.projectSystems.length) return toast('Tạo hệ thống trước khi thêm account');
  if (!editing && !state.selectedSystemId) return toast('Chọn một hệ thống cụ thể trước khi thêm account');
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
  const systemOptions = systemOptionsForEntry(formEntry);
  if (state.projectSystems.length && !systemOptions.length) return toast('Bạn không có quyền với hệ thống nào trong dự án này');
  if (!typeOptions.length) return toast('Bạn không có quyền với loại account nào trong dự án này');
  const form = $('#entryForm');
  fillEntrySystems(systemOptions);
  fillEntryTypes(typeOptions);
  form.id.value = formEntry.id || '';
  form.name.value = formEntry.name || '';
  form.systemId.value = formEntry.id ? (formEntry.systemId || formEntry.projectSystemId || '') : firstCreatableSystemId();
  form.typeId.value = formEntry.id ? entryTypeIdForEntry(formEntry) : firstCreatableEntryTypeId();
  form.environment.value = formEntry.environment || 'Production';
  form.url.value = formEntry.url || '';
  renderEntryCredentials(formEntry.credentials?.length ? formEntry.credentials : defaultEntryCredentials(formEntry));
  form.tags.value = (formEntry.tags || []).join(', ');
  form.notes.value = formEntry.notes || '';
  $('#entryDialog').showModal();
  focusDialogField('#entryDialog', 'input[name="name"]');
}

function defaultEntryCredentials(entry = {}) {
  if (entry.id || entry.username) {
    return [{
      id: '',
      departmentId: currentCredentialDepartmentId(),
      username: entry.username || '',
      password: ''
    }];
  }
  return [{ id: '', departmentId: currentCredentialDepartmentId(), username: '', password: '' }];
}

function currentCredentialDepartmentId() {
  if (isAdmin()) return state.departments[0]?.id || '';
  return state.currentUser?.departmentIds?.[0] || state.currentUser?.departmentId || '';
}

function credentialDepartmentOptions(selectedId = '') {
  const departments = state.departments.length
    ? state.departments
    : state.currentUser?.departmentIds?.length
      ? state.currentUser.departmentIds.map(id => ({ id, name: departmentName(id) }))
      : state.currentUser?.departmentId
        ? [{ id: state.currentUser.departmentId, name: 'Phòng ban của tôi' }]
      : [];
  const options = ['<option value="">Chưa phân phòng ban</option>']
    .concat(departments.map(department => `<option value="${escapeAttr(department.id)}">${escapeHtml(department.name)}</option>`));
  return options.join('').replace(`value="${escapeAttr(selectedId)}"`, `value="${escapeAttr(selectedId)}" selected`);
}

function renderEntryCredentials(credentials = []) {
  const rows = $('#credentialRows');
  if (!rows) return;
  rows.innerHTML = credentials.map(credential => credentialRowHtml(credential)).join('');
  rows.querySelectorAll('[data-remove-credential]').forEach(button => button.addEventListener('click', () => {
    button.closest('.credential-row')?.remove();
    if (!rows.querySelector('.credential-row')) addEntryCredentialRow();
  }));
}

function credentialRowHtml(credential = {}) {
  const rowId = escapeAttr(credential.id || '');
  return `
    <div class="credential-row" data-credential-id="${rowId}">
      <label><span class="label-text">Phòng ban</span><select data-credential-department>${credentialDepartmentOptions(credential.departmentId || '')}</select></label>
      <label><span class="label-text">Username</span><input data-credential-username value="${escapeAttr(credential.username || '')}" placeholder="email / user"></label>
      <label><span class="label-text">Password</span><input data-credential-password type="password" placeholder="Để trống nếu không đổi"></label>
      <button type="button" class="icon-danger credential-remove" data-remove-credential title="Xóa user">${svgIcon('trash')}</button>
    </div>
  `;
}

function credentialDetailRows(entry, { canViewUsername, canRevealEntryPassword }) {
  const credentials = entry.credentials?.length
    ? entry.credentials
    : [{ id: '', entryId: entry.id, departmentId: '', username: entry.username || '' }];
  return credentials.map(credential => {
    const credentialKey = credential.id ? `${entry.id}:${credential.id}` : entry.id;
    const password = state.revealCache.get(credentialKey) || '************';
    return `
      <div class="credential-detail-item">
        <div class="credential-department-title">${escapeHtml(departmentName(credential.departmentId) || 'Phòng ban')}</div>
        <div class="secret-row">
          <span class="secret-icon">${svgIcon('user')}</span>
          <div>
            <small>Username</small>
            <strong>${canViewUsername ? escapeHtml(credential.username || 'Chưa có username') : 'Bị giới hạn'}</strong>
          </div>
          ${canViewUsername && credential.username ? `<button class="ghost-btn" data-copy="${escapeAttr(credential.username)}">${svgIcon('copy')} Copy</button>` : ''}
        </div>
        <div class="secret-row">
          <span class="secret-icon">${svgIcon('key')}</span>
          <div>
            <small>Mật khẩu</small>
            <strong class="password-text">${escapeHtml(password)}</strong>
          </div>
          ${canRevealEntryPassword ? `<span class="risk-badge">Nhạy cảm</span>
          <button class="ghost-btn" data-reveal="${entry.id}" data-credential-reveal="${escapeAttr(credential.id || '')}">${svgIcon('eye')} Xem</button>
          <button class="ghost-btn" data-copy-pass="${entry.id}" data-credential-copy="${escapeAttr(credential.id || '')}">${svgIcon('copy')} Copy</button>` : '<span class="risk-badge">Bị giới hạn</span>'}
        </div>
      </div>
    `;
  }).join('');
}

function addEntryCredentialRow(credential = {}) {
  const rows = $('#credentialRows');
  if (!rows) return;
  rows.insertAdjacentHTML('beforeend', credentialRowHtml({
    departmentId: currentCredentialDepartmentId(),
    ...credential
  }));
  const row = rows.lastElementChild;
  row?.querySelector('[data-remove-credential]')?.addEventListener('click', () => {
    row.remove();
    if (!rows.querySelector('.credential-row')) addEntryCredentialRow();
  });
  row?.querySelector('[data-credential-username]')?.focus();
}

function collectEntryCredentials() {
  return [...document.querySelectorAll('#credentialRows .credential-row')]
    .map(row => {
      const password = row.querySelector('[data-credential-password]')?.value || '';
      const credential = {
        id: row.dataset.credentialId || '',
        departmentId: row.querySelector('[data-credential-department]')?.value || null,
        username: row.querySelector('[data-credential-username]')?.value.trim() || ''
      };
      if (password || !credential.id) credential.password = password;
      return credential;
    })
    .filter(credential => credential.username || credential.password || credential.id);
}

async function saveEntry(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const id = data.id;
  delete data.id;
  data.projectId = state.selectedProjectId;
  data.typeId = data.typeId || firstCreatableEntryTypeId();
  data.tags = data.tags.split(',').map(tag => tag.trim()).filter(Boolean);
  data.status = 'Active';
  data.credentials = collectEntryCredentials();
  data.username = data.credentials[0]?.username || '';
  if (data.credentials[0]?.password !== undefined) data.password = data.credentials[0].password;
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

async function revealPassword(id, credentialId = '') {
  const entry = state.entries.find(item => String(item.id) === String(id));
  if (!entry?.permissions?.canRevealPassword) return toast('Bạn không có quyền xem mật khẩu');
  const path = credentialId
    ? credentialRevealPath(id, credentialId)
    : `/api/entries/${id}/reveal-password`;
  const result = await api(path, { method: 'POST' });
  state.revealCache.set(credentialId ? `${id}:${credentialId}` : id, result.password);
  renderEntries();
}

async function copyPassword(id, credentialId = '') {
  const entry = state.entries.find(item => String(item.id) === String(id));
  if (!entry?.permissions?.canRevealPassword) return toast('Bạn không có quyền copy mật khẩu');
  const cacheKey = credentialId ? `${id}:${credentialId}` : id;
  let password = state.revealCache.get(cacheKey);
  if (!password) {
    const path = credentialId
      ? credentialRevealPath(id, credentialId)
      : `/api/entries/${id}/reveal-password`;
    const result = await api(path, { method: 'POST' });
    password = result.password || '';
  }
  await copyText(password);
  await api(`/api/entries/${id}/copy-password-log`, { method: 'POST' });
}

function credentialRevealPath(entryId, credentialId) {
  return `/api/entries/${entryId}/credentials/${credentialId}/reveal-password`;
}

async function deleteEntry(id) {
  const entry = state.entries.find(item => String(item.id) === String(id));
  if (!entry?.permissions?.canDelete) return toast('Bạn không có quyền xóa account này');
  if (!confirm('Xóa mục này?')) return;
  await api(`/api/entries/${id}`, { method: 'DELETE' });
  toast('Đã xóa');
  await loadEntries();
}

async function deleteSelectedEntries() {
  const ids = [...state.selectedEntryIds];
  if (!ids.length) return;
  const deletableIds = ids.filter(id => state.entries.find(entry => String(entry.id) === String(id))?.permissions?.canDelete);
  if (!deletableIds.length) return toast('Bạn không có quyền xóa các account đã chọn');
  if (!confirm(`Xóa ${deletableIds.length} account đã chọn?`)) return;
  let deleted = 0;
  const errors = [];
  for (const id of deletableIds) {
    try {
      await api(`/api/entries/${id}`, { method: 'DELETE' });
      deleted += 1;
      if (String(state.selectedEntryId) === String(id)) state.selectedEntryId = null;
    } catch (error) {
      errors.push(error.message);
    }
  }
  state.selectedEntryIds.clear();
  state.bulkEntryMode = false;
  await loadEntries();
  toast(errors.length ? `Đã xóa ${deleted}/${deletableIds.length} account. ${errors[0]}` : `Đã xóa ${deleted} account`);
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

function openEntryTypeDialog() {
  if (!can('users.manage')) return toast('Bạn không có quyền quản lý loại account');
  resetEntryTypeForm();
  renderEntryTypeManager();
  $('#entryTypeDialog').showModal();
  focusDialogField('#entryTypeDialog', 'input[name="name"]');
}

function resetEntryTypeForm() {
  const form = $('#entryTypeForm');
  if (!form) return;
  form.id.value = '';
  form.name.value = '';
  form.description.value = '';
  form.sortOrder.value = '';
  form.isActive.checked = true;
  $('#saveEntryTypeBtn').textContent = 'Lưu loại';
}

function renderEntryTypeManager() {
  const list = $('#entryTypeList');
  if (!list) return;
  list.innerHTML = state.entryTypes.map(type => `
    <article class="type-manager-card">
      <div>
        <strong>${escapeHtml(type.name)}</strong>
        <small>${escapeHtml(type.description || 'Chưa có mô tả')} - Thứ tự ${Number(type.sortOrder || 0)}</small>
      </div>
      <span class="role-chip">${type.isActive ? 'Active' : 'Inactive'}</span>
      <div class="user-actions">
        <button type="button" data-edit-entry-type="${type.id}">Sửa</button>
        <button type="button" data-toggle-entry-type="${type.id}">${type.isActive ? 'Tắt' : 'Bật'}</button>
        <button type="button" class="danger" data-delete-entry-type="${type.id}">Xóa</button>
      </div>
    </article>
  `).join('') || '<p class="form-hint">Chưa có loại account.</p>';
  document.querySelectorAll('[data-edit-entry-type]').forEach(button => {
    button.addEventListener('click', () => editEntryType(button.dataset.editEntryType));
  });
  document.querySelectorAll('[data-toggle-entry-type]').forEach(button => {
    button.addEventListener('click', () => toggleEntryType(button.dataset.toggleEntryType));
  });
  document.querySelectorAll('[data-delete-entry-type]').forEach(button => {
    button.addEventListener('click', () => deleteEntryType(button.dataset.deleteEntryType));
  });
}

function editEntryType(id) {
  const type = state.entryTypes.find(item => String(item.id) === String(id));
  if (!type) return;
  const form = $('#entryTypeForm');
  form.id.value = type.id;
  form.name.value = type.name || '';
  form.description.value = type.description || '';
  form.sortOrder.value = Number(type.sortOrder || 0);
  form.isActive.checked = type.isActive !== false;
  $('#saveEntryTypeBtn').textContent = 'Lưu thay đổi';
  focusDialogField('#entryTypeDialog', 'input[name="name"]');
}

async function toggleEntryType(id) {
  const type = state.entryTypes.find(item => String(item.id) === String(id));
  if (!type) return;
  try {
    await api(`/api/entry-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !type.isActive })
    });
    await loadEntryTypes();
    renderEntryTypeManager();
    refreshEntryTypeSelect(type.id);
    toast(type.isActive ? 'Đã tắt loại account' : 'Đã bật loại account');
  } catch (error) {
    toast(error.message);
  }
}

async function deleteEntryType(id) {
  const type = state.entryTypes.find(item => String(item.id) === String(id));
  if (!type) return;
  if (!confirm(`Xóa loại account "${type.name}"?`)) return;
  try {
    await api(`/api/entry-types/${id}`, { method: 'DELETE' });
    await loadEntryTypes();
    renderEntryTypeManager();
    refreshEntryTypeSelect();
    resetEntryTypeForm();
    toast('Đã xóa loại account');
  } catch (error) {
    toast(error.message);
  }
}

async function saveEntryType(event) {
  event.preventDefault();
  const form = event.target;
  const id = form.id.value;
  const payload = {
    name: form.name.value.trim(),
    description: form.description.value.trim(),
    sortOrder: form.sortOrder.value ? Number(form.sortOrder.value) : undefined,
    isActive: form.isActive.checked
  };
  if (!payload.name) return toast('Tên loại account là bắt buộc');
  try {
    await api(id ? `/api/entry-types/${id}` : '/api/entry-types', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    await loadEntryTypes();
    renderEntryTypeManager();
    refreshEntryTypeSelect(id || payload.name);
    resetEntryTypeForm();
    toast(id ? 'Đã cập nhật loại account' : 'Đã thêm loại account');
  } catch (error) {
    toast(error.message);
  }
}

function refreshEntryTypeSelect(preferredType = '') {
  const select = $('#entryTypeSelect');
  if (!select) return;
  const currentValue = preferredType || select.value || firstCreatableEntryTypeId();
  fillEntryTypes(entryTypeOptionsForEntry());
  const option = Array.from(select.options).find(item => String(item.value) === String(currentValue));
  if (option) select.value = option.value;
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
  $('#usersNavBtn')?.classList.toggle('hidden', !can('users.manage'));
  const npb = $('#newProjectBtn'); if (npb) npb.disabled = !isAdmin();
  const ib = $('#importBtn'); if (ib) ib.disabled = !isAdmin();
  const sjb = $('#saveJsonBtn'); if (sjb) sjb.disabled = !isAdmin();
  const ejb = $('#exportJsonBtn'); if (ejb) ejb.disabled = !isAdmin();
  const ecb = $('#exportCsvBtn'); if (ecb) ecb.disabled = !isAdmin();
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
  await loadDepartments();
  state.users = await api('/api/users');
  renderUsersPanel();
  $('#userManagementDialog').showModal();
}

function renderUsersPanel() {
  const list = $('#userManagementList');
  if (list) {
    list.innerHTML = state.users.map(user => `
      <article class="user-card">
        <div>
          <strong>${escapeHtml(user.displayName || user.username)}</strong>
          <small>${escapeHtml(user.username)} - ${escapeHtml(user.status)}</small>
        </div>
        <span class="role-chip">${escapeHtml(user.role)}</span>
        ${userDepartmentChips(user)}
        <p>${permissionSummary(user)}</p>
        <div class="user-actions">
          <button data-edit-user="${user.id}">${user.status === 'Pending' ? 'Duyệt & phân quyền' : 'Sửa'}</button>
          ${['Invited', 'Expired'].includes(user.status) ? `<button data-invite-user="${user.id}">Gửi email mời</button>` : ''}
          ${Number(user.id) === Number(state.currentUser?.id) ? '' : `<button data-delete-user="${user.id}">Xóa</button>`}
        </div>
      </article>
    `).join('');
    bindUserManagementActions();
    return;
  }
  const aside = $('#detailAside');
  if (aside) aside.classList.add('open');
  $('#detailPanel').className = 'detail-content users-panel';
  $('#detailPanel').innerHTML = `
    <header class="detail-head">
      <div>
        <h1>Người dùng & phân quyền</h1>
        <p><span class="tag-dot"></span> Tài khoản nội bộ</p>
      </div>
      <div class="detail-actions">
        <button id="addUserBtn" class="btn-accent">+ Thêm user</button>
        <button class="close-detail" title="Đóng">✕</button>
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
          ${userDepartmentChips(user)}
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

function bindUserManagementActions() {
  $('#addUserBtn')?.addEventListener('click', () => openUserDialog());
  document.querySelectorAll('#userManagementDialog [data-edit-user]').forEach(button => {
    button.addEventListener('click', () => openUserDialog(state.users.find(user => String(user.id) === String(button.dataset.editUser))));
  });
  document.querySelectorAll('#userManagementDialog [data-invite-user]').forEach(button => {
    button.addEventListener('click', () => resendUserInvite(button.dataset.inviteUser));
  });
  document.querySelectorAll('#userManagementDialog [data-delete-user]').forEach(button => {
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
  fillDepartmentOptions(user.departmentIds || (user.departmentId ? [user.departmentId] : []));
  form.password.value = '';
  form.password.required = false;
  passwordField?.classList.toggle('hidden', creating);
  statusField?.classList.toggle('hidden', creating);
  if (inviteHint) {
    if (creating) inviteHint.textContent = 'Nhập email Google của user. Khi lưu, hệ thống sẽ tạo tài khoản nội bộ và gửi email mời tải app.';
    else if (user.status === 'Pending') inviteHint.textContent = 'Tài khoản Google này đang yêu cầu tham gia. Chuyển trạng thái sang Active và cấp quyền; hệ thống sẽ gửi email thông báo nếu đã cấu hình mail.';
    else inviteHint.textContent = 'Email đăng nhập là định danh dùng để map Google vào quyền nội bộ.';
  }
  if (saveButton) saveButton.textContent = creating ? 'Tạo user & gửi email mời' : (user.status === 'Pending' ? 'Duyệt và cấp quyền' : 'Lưu thay đổi');
  if (user.status === 'Pending') form.status.value = 'Active';
  else form.status.value = user.status || 'Invited';
  form.role.value = user.role || 'Viewer';
  setPermissionChecks(user.permissions || []);
  syncRolePermissions();
  syncUserDepartmentVisibility();
  hideDepartmentQuickAdd();
  $('#userDialog').showModal();
  focusDialogField('#userDialog', user.id ? 'input[name="displayName"]' : 'input[name="username"]');
}

function departmentName(id) {
  return state.departments.find(department => String(department.id) === String(id))?.name || 'Phòng ban';
}

function userDepartmentChips(user = {}) {
  const ids = user.departmentIds?.length ? user.departmentIds : (user.departmentId ? [user.departmentId] : []);
  return ids.map(id => `<span class="department-chip">${escapeHtml(departmentName(id))}</span>`).join('');
}

function fillDepartmentOptions(selectedIds = selectedUserDepartmentIds()) {
  const select = $('#userDepartmentSelect');
  if (!select) return;
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : [selectedIds]).map(id => String(id || '')).filter(Boolean));
  select.innerHTML = state.departments
    .map(department => `<option value="${escapeAttr(department.id)}">${escapeHtml(department.name)}</option>`)
    .join('');
  [...select.options].forEach(option => {
    option.selected = selected.has(String(option.value));
  });
  renderDepartmentDropdown();
  renderSelectedDepartmentLabels();
}

function selectedUserDepartmentIds() {
  const select = $('#userDepartmentSelect');
  if (!select) return [];
  return [...select.selectedOptions].map(option => option.value).filter(Boolean);
}

function setSelectedDepartmentIds(ids) {
  const select = $('#userDepartmentSelect');
  if (!select) return;
  const selected = new Set((ids || []).map(id => String(id || '')).filter(Boolean));
  [...select.options].forEach(option => {
    option.selected = selected.has(String(option.value));
  });
}

function renderDepartmentDropdown() {
  const menu = $('#userDepartmentDropdown');
  if (!menu) return;
  const selected = new Set(selectedUserDepartmentIds().map(id => String(id)));
  menu.innerHTML = state.departments.length
    ? state.departments.map(department => {
      const id = String(department.id);
      const checked = selected.has(id);
      return `
        <button type="button" class="department-dropdown-option${checked ? ' is-selected' : ''}" data-toggle-user-department="${escapeAttr(id)}" role="menuitemcheckbox" aria-checked="${checked ? 'true' : 'false'}">
          <span class="department-option-check" aria-hidden="true"></span>
          <span>${escapeHtml(department.name)}</span>
        </button>
      `;
    }).join('')
    : '<div class="department-dropdown-empty">Chưa có phòng ban</div>';
  syncDepartmentDropdownButton();
}

function toggleDepartmentDropdown(event) {
  event?.stopPropagation();
  const menu = $('#userDepartmentDropdown');
  const button = $('#userDepartmentDropdownBtn');
  if (!menu || !button) return;
  renderDepartmentDropdown();
  const willOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willOpen);
  button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function closeDepartmentDropdown() {
  $('#userDepartmentDropdown')?.classList.add('hidden');
  $('#userDepartmentDropdownBtn')?.setAttribute('aria-expanded', 'false');
}

function toggleDepartmentOption(event) {
  event.stopPropagation();
  const optionButton = event.target?.closest?.('[data-toggle-user-department]');
  if (!optionButton) return;
  const id = optionButton.dataset.toggleUserDepartment;
  const selected = new Set(selectedUserDepartmentIds().map(item => String(item)));
  if (selected.has(String(id))) selected.delete(String(id));
  else selected.add(String(id));
  setSelectedDepartmentIds([...selected]);
  renderDepartmentDropdown();
  renderSelectedDepartmentLabels();
}

function syncDepartmentDropdownButton() {
  const button = $('#userDepartmentDropdownBtn');
  if (!button) return;
  const ids = selectedUserDepartmentIds();
  if (!ids.length) {
    button.textContent = 'Chọn phòng ban';
    return;
  }
  button.textContent = ids.length === 1 ? departmentName(ids[0]) : `${ids.length} phòng ban đã chọn`;
}

function renderSelectedDepartmentLabels() {
  const labels = $('#selectedDepartmentLabels');
  if (!labels) return;
  const ids = selectedUserDepartmentIds();
  labels.innerHTML = ids.length
    ? ids.map(id => `
      <span class="selected-department-label">
        ${escapeHtml(departmentName(id))}
        <button type="button" data-remove-user-department="${escapeAttr(id)}" title="Bỏ phòng ban">×</button>
      </span>
    `).join('')
    : '<span class="selected-department-empty">Chưa phân phòng ban</span>';
  syncDepartmentDropdownButton();
}

function removeSelectedDepartmentLabel(event) {
  const id = event.target?.dataset?.removeUserDepartment;
  if (!id) return;
  const select = $('#userDepartmentSelect');
  if (!select) return;
  [...select.options].forEach(option => {
    if (String(option.value) === String(id)) option.selected = false;
  });
  renderDepartmentDropdown();
  renderSelectedDepartmentLabels();
}

function syncUserDepartmentVisibility() {
  const form = $('#userForm');
  const departmentField = $('#userDepartmentDropdownBtn')?.closest('.department-field');
  const departmentLabels = $('#selectedDepartmentLabels');
  const isAdminRole = form?.role?.value === 'Admin';
  departmentField?.classList.toggle('hidden', Boolean(isAdminRole));
  departmentLabels?.classList.toggle('hidden', Boolean(isAdminRole));
  $('#toggleDepartmentQuickAddBtn')?.toggleAttribute('disabled', Boolean(isAdminRole));
  if (isAdminRole) {
    fillDepartmentOptions([]);
    closeDepartmentDropdown();
    hideDepartmentQuickAdd();
  }
}

function toggleDepartmentQuickAdd() {
  const box = $('#departmentQuickAdd');
  if (!box) return;
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) $('#departmentQuickAddName')?.focus();
}

function hideDepartmentQuickAdd() {
  $('#departmentQuickAdd')?.classList.add('hidden');
  const input = $('#departmentQuickAddName');
  if (input) input.value = '';
}

async function saveDepartmentQuickAdd() {
  const input = $('#departmentQuickAddName');
  const name = input?.value.trim();
  if (!name) return;
  const selectedIds = selectedUserDepartmentIds();
  const department = await api('/api/departments', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  state.departments = [...state.departments.filter(item => String(item.id) !== String(department.id)), department]
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name).localeCompare(String(b.name)));
  fillDepartmentOptions([...selectedIds, department.id]);
  hideDepartmentQuickAdd();
  toast('Đã thêm phòng ban');
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
    String(permission.systemId || permission.entryTypeId),
    permission
  ]));
  const columns = permissionColumns();
  const permissionRows = state.projectSystems.map(system => ({ id: system.id, name: system.name, systemId: system.id }));
  if (!permissionRows.length) {
    matrix.innerHTML = '<p class="form-hint">Tạo hệ thống trước, sau đó cấp quyền cho thành viên theo từng hệ thống.</p>';
    $('#memberPermissionDialog').showModal();
    return;
  }
  matrix.innerHTML = permissionRows.map(item => {
    const permission = existing.get(String(item.id)) || {};
    return `
      <div class="permission-type-row" ${item.systemId ? `data-system-id="${item.systemId}"` : `data-entry-type-id="${item.entryTypeId}"`}>
        <span>${escapeHtml(item.name)}<small>${escapeHtml(item.type || '')}</small></span>
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
      const permission = row.dataset.systemId
        ? { systemId: row.dataset.systemId }
        : { entryTypeId: row.dataset.entryTypeId };
      row.querySelectorAll('[data-permission-key]').forEach(input => {
        permission[input.dataset.permissionKey] = input.checked;
      });
      return permission;
    })
    .filter(permission => Object.entries(permission).some(([key, value]) => key.startsWith('can') && value));
}

async function saveMemberPermissionDraft(event) {
  event.preventDefault();
  const userId = String(event.target.userId.value || '');
  const member = state.projectMemberDraft.find(item => String(item.userId) === userId);
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
    departmentIds: form.role.value === 'Admin' ? [] : selectedUserDepartmentIds(),
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
    toast(result.inviteSent ? 'Đã gửi email mời tải app' : 'Email mời chưa được cấu hình');
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
    chevron: '<path d="m9 18 6-6-6-6"/>',
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
