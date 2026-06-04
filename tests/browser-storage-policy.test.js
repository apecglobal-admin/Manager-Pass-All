import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('browser code does not persist application data in cookies or Web Storage', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const supabaseClient = readFileSync('public/supabase-client.js', 'utf8');
  const browserCode = `${app}\n${supabaseClient}`;

  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie/.test(browserCode), false);
  assert.match(supabaseClient, /persistSession:\s*false/);
});

test('login form does not ship with default admin credentials', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const loginForm = html.match(/<form id="loginForm"[\s\S]+?<\/form>/)?.[0] || '';

  assert.doesNotMatch(loginForm, /value="admin"/);
  assert.doesNotMatch(loginForm, /admin123/);
  assert.match(loginForm, /autocomplete="username"/);
  assert.match(loginForm, /autocomplete="current-password"/);
});

test('frontend data CRUD goes through API endpoints instead of direct Supabase table writes', () => {
  const app = readFileSync('public/app.js', 'utf8');

  assert.equal(/state\.supabase\s*\.\s*from\s*\(\s*['"`](projects|entries|activity_logs|vaults)['"`]\s*\)/.test(app), false);
  assert.match(app, /api\(id \? `\/api\/projects\/\$\{id\}` : '\/api\/projects'/);
  assert.match(app, /api\(id \? `\/api\/entries\/\$\{id\}` : '\/api\/entries'/);
  assert.match(app, /api\(`\/api\/projects\/\$\{id\}`,\s*\{\s*method:\s*'DELETE'/);
  assert.match(app, /api\(`\/api\/entries\/\$\{id\}`,\s*\{\s*method:\s*'DELETE'/);
});

test('frontend supports a configured API origin for Capacitor runtime', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const supabaseClient = readFileSync('public/supabase-client.js', 'utf8');
  const staticConfig = readFileSync('public/config.js', 'utf8');
  const serverConfig = readFileSync('src/config.js', 'utf8');

  assert.match(serverConfig, /function resolvePublicApiBaseUrl/);
  assert.match(serverConfig, /process\.env\.APP_ALLOWED_ORIGINS/);
  assert.doesNotMatch(serverConfig, /NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(staticConfig, /window\.APECGLOBAL_CONFIG/);
  assert.match(staticConfig, /apiBaseUrl/);
  assert.match(app, /const runtimeConfig = window\.APECGLOBAL_CONFIG \|\| \{\}/);
  assert.match(app, /function apiUrl\(path\)/);
  assert.match(app, /fetch\(apiUrl\(path\),/);
  assert.match(supabaseClient, /function runtimeUrl\(path\)/);
  assert.match(supabaseClient, /script\.src = runtimeUrl\('\/vendor\/supabase\.js'\)/);
});

test('user management UI exposes pending Google access requests for admin approval', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');

  assert.match(html, /<option>Pending<\/option>/);
  assert.match(app, /Yêu cầu tham gia|YÃªu cáº§u tham gia|Yeu cau tham gia/);
  assert.match(app, /Chờ admin phê duyệt|Chá» admin phÃª duyá»‡t|Cho admin phe duyet/);
  assert.match(app, /Duyệt & phân quyền|Duyá»‡t & phÃ¢n quyá»n|Duyet & phan quyen/);
  assert.match(app, /user\.status === 'Pending'[\s\S]+form\.status\.value = 'Active'/);
  assert.match(app, /\['Invited', 'Expired'\]\.includes\(user\.status\)[\s\S]+data-invite-user/);
});

test('Google OAuth always prompts for account selection', () => {
  const app = readFileSync('public/app.js', 'utf8');

  assert.match(app, /signInWithOAuth\(\{[\s\S]+provider:\s*'google'/);
  assert.match(app, /queryParams:\s*\{[\s\S]+prompt:\s*'select_account'/);
});

test('frontend exposes light mix and dark theme modes without Web Storage', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(html, /data-theme="dark"/);
  assert.match(html, /id="themeMenuBtn"/);
  assert.match(html, /id="themeMenu"/);
  assert.match(html, /<span class="theme-menu-caret" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(html, /class="theme-menu-caret">[^<]+<\/span>/);
  const themePicker = html.match(/<div class="theme-picker"[\s\S]+?<\/div>\s*<div id="currentUserTopbar"/)?.[0] || '';
  const themeMenu = html.match(/<div id="themeMenu"[\s\S]+?<\/div>/)?.[0] || '';
  assert.match(themePicker, /id="mixColorPopover"/);
  assert.match(themePicker, /id="mixColorPopover" class="mix-color-popover hidden"/);
  assert.doesNotMatch(themeMenu, /class="theme-colors"/);
  assert.match(html, /data-theme-option="light"/);
  assert.match(html, /data-theme-option="mix"/);
  assert.match(html, /data-theme-option="dark"/);
  assert.match(html, /id="mixAccentColor" type="color"/);
  assert.match(html, /id="mixAccent2Color" type="color"/);
  assert.match(app, /THEME_MODES\s*=\s*new Set\(\['light', 'mix', 'dark'\]\)/);
  assert.match(app, /themeMenuBtn'\)\?\.addEventListener\('click'/);
  assert.match(app, /toggleThemeMenu/);
  assert.match(app, /openMixColorPopover/);
  assert.match(app, /closeMixColorPopover/);
  assert.match(app, /themeDisplayName/);
  assert.match(app, /applyUserThemePreferences/);
  assert.match(app, /api\('\/api\/me\/preferences'/);
  assert.match(app, /updateMixThemeColor/);
  assert.match(app, /rootStyle\.setProperty\('--accent'/);
  assert.match(app, /MIX_THEME_VARIABLES/);
  assert.match(app, /document\.documentElement\.dataset\.theme/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /:root\[data-theme="mix"\]/);
  assert.match(css, /\.theme-menu/);
  assert.match(css, /\.theme-menu button\.active/);
  assert.doesNotMatch(css, /\.theme-picker\.mix-active \.theme-colors/);
  assert.doesNotMatch(css, /\.theme-menu \.theme-colors/);
  assert.match(css, /\.mix-color-popover/);
  assert.match(css, /\.mix-color-popover\.hidden/);
  const themeButtonCss = css.match(/\.theme-menu-btn\s*\{[^}]+\}/)?.[0] || '';
  const themeCaretCss = css.match(/\.theme-menu-caret\s*\{[^}]+\}/)?.[0] || '';
  const themeCaretBeforeCss = css.match(/\.theme-menu-caret::before\s*\{[^}]+\}/)?.[0] || '';
  assert.match(themeButtonCss, /display:\s*inline-flex/);
  assert.match(themeButtonCss, /align-items:\s*center/);
  assert.match(themeCaretCss, /display:\s*inline-flex/);
  assert.match(themeCaretCss, /align-items:\s*center/);
  assert.match(themeCaretBeforeCss, /border-right:/);
  assert.match(themeCaretBeforeCss, /border-bottom:/);
  assert.match(themeCaretBeforeCss, /transform:\s*rotate\(45deg\)/);
});

test('frontend loads dynamic account types instead of hard-coded type source', () => {
  const app = readFileSync('public/app.js', 'utf8');

  assert.equal(/const\s+TYPES\s*=/.test(app), false);
  assert.match(app, /api\('\/api\/entry-types'\)/);
  assert.match(app, /state\.entryTypes/);
  assert.match(app, /typeId/);
});

test('project form manages project members and detailed project type permissions', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');

  const userDialog = html.match(/<dialog id="userDialog">[\s\S]+?<\/dialog>/)?.[0] || '';
  const projectDialog = html.match(/<dialog id="projectDialog">[\s\S]+?<\/dialog>/)?.[0] || '';
  const projectMembersDialog = html.match(/<dialog id="projectMembersDialog">[\s\S]+?<\/dialog>/)?.[0] || '';
  assert.doesNotMatch(userDialog, /detailedPermissionMatrix|projectMemberMatrix/);
  assert.doesNotMatch(projectDialog, /projectMemberSelect|projectMemberList|projectMembersSection/);
  assert.match(projectMembersDialog, /id="projectMemberSelect"/);
  assert.match(projectMembersDialog, /id="projectMemberList"/);
  assert.match(html, /id="memberPermissionDialog"/);
  assert.match(app, /data-project-members/);
  assert.match(app, /openProjectMembersDialog/);
  assert.match(app, /loadProjectMembers/);
  assert.doesNotMatch(projectMembersDialog, /saveProjectMembersBtn|LÆ°u thÃ nh viÃªn|LÃ†Â°u thÃƒÂ nh viÃƒÂªn/);
  assert.doesNotMatch(app, /saveProjectMembers/);
  assert.match(app, /openMemberPermissionDialog/);
  assert.match(app, /saveMemberPermissionDraft/);
  assert.doesNotMatch(app, /state\.users\.map\(user => \{[\s\S]+state\.entryTypes\.map/);
  assert.match(app, /canViewUsername/);
  assert.match(app, /canRevealPassword/);
  assert.match(app, /canDelete/);
});

test('project members are saved from the member permission dialog', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const addMember = app.match(/function addSelectedProjectMember\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const renderOptions = app.match(/function renderProjectMemberOptions\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const savePermissions = app.match(/async function saveMemberPermissionDraft\(event\) \{[\s\S]+?\n\}/)?.[0] || '';
  const removeMember = app.match(/async function removeProjectMember\(userId\) \{[\s\S]+?\n\}/)?.[0] || '';
  const persistMembers = app.match(/async function persistProjectMembers\(\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(addMember, /openMemberPermissionDialog\(member\.userId\)/);
  assert.match(addMember, /defaultProjectMemberPermissions\(\)/);
  assert.match(renderOptions, /user\.role !== 'Admin'/);
  assert.match(savePermissions, /persistProjectMembers\(\)/);
  assert.match(removeMember, /persistProjectMembers\(\)/);
  assert.match(persistMembers, /api\(`\/api\/projects\/\$\{projectId\}\/members`/);
  assert.doesNotMatch(app, /detailedPermissions\?\.length\s*\|\|\s*0\}\s*quyá»n/);
});

test('new project members default to view-only permissions for every project system', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const defaultPermissions = app.match(/function defaultProjectMemberPermissions\(\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(defaultPermissions, /state\.projectSystems\.map/);
  assert.match(defaultPermissions, /systemId:\s*system\.id/);
  assert.match(defaultPermissions, /canViewEntry:\s*true/);
  assert.match(defaultPermissions, /canViewUrl:\s*false/);
  assert.match(defaultPermissions, /canViewUsername:\s*false/);
  assert.match(defaultPermissions, /canRevealPassword:\s*false/);
  assert.match(defaultPermissions, /canViewNotes:\s*false/);
  assert.match(defaultPermissions, /canCreate:\s*false/);
  assert.match(defaultPermissions, /canEdit:\s*false/);
  assert.match(defaultPermissions, /canDelete:\s*false/);
});

test('dialog cancel buttons close without submitting dialog forms', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const dialogForms = html.match(/<form[^>]+method="dialog"[\s\S]+?<\/form>/g) || [];

  assert.ok(dialogForms.length > 0);
  for (const form of dialogForms) {
    const cancelButton = form.match(/<button[^>]*>\s*(Hủy|Há»§y)\s*<\/button>/)?.[0] || '';
    assert.match(cancelButton, /type="button"/);
    assert.match(cancelButton, /data-close-dialog/);
  }
  assert.match(app, /document\.querySelectorAll\('\[data-close-dialog\]'\)/);
  assert.match(app, /\.closest\('dialog'\)\?\.close\(\)/);
});

test('frontend treats Admin as full permission even without explicit permission array', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const canFunction = app.match(/function can\(permission\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(canFunction, /state\.currentUser\?\.role === 'Admin'/);
  assert.match(canFunction, /state\.currentUser\?\.permissions\?\.includes\(permission\)/);
});

test('global user permission UI only exposes permission management', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const permissionGrid = html.match(/<div class="permission-grid">[\s\S]+?<\/div>/)?.[0] || '';

  assert.match(permissionGrid, /value="users\.manage"/);
  assert.match(permissionGrid, /Quản lý phân quyền|QuÃ¡ÂºÂ£n lÃƒÂ½ phÃƒÂ¢n quyÃ¡Â»Ân|Quáº£n lÃ½ phÃ¢n quyá»n/);
  for (const removedPermission of [
    'projects.write',
    'entries.write',
    'entries.delete',
    'passwords.reveal',
    'import.export',
    'backup.save',
    'settings.manage'
  ]) {
    assert.doesNotMatch(permissionGrid, new RegExp(`value="${removedPermission.replace('.', '\\.')}"`));
    assert.doesNotMatch(app, new RegExp(`['"]${removedPermission.replace('.', '\\.')}['"]`));
  }
  assert.match(app, /Manager:\s*\['users\.manage'\]/);
});

test('entry actions use project-scoped permissions instead of global account permissions', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const renderHeader = app.match(/function renderHeader\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const openEntryDialog = app.match(/async function openEntryDialog\(entry = \{\}\) \{[\s\S]+?\n\}/)?.[0] || '';
  const deleteEntry = app.match(/async function deleteEntry\(id\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.doesNotMatch(app, /can\('entries\.write'\)\s*\|\|\s*entry\.permissions\?\.canEdit/);
  assert.doesNotMatch(app, /can\('entries\.delete'\)\s*\|\|\s*entry\.permissions\?\.canDelete/);
  assert.doesNotMatch(app, /can\('passwords\.reveal'\)\s*\|\|\s*entry\.permissions\?\.canRevealPassword/);
  assert.doesNotMatch(renderHeader, /can\('entries\.write'\)/);
  assert.doesNotMatch(openEntryDialog, /can\('entries\.write'\)/);
  assert.doesNotMatch(deleteEntry, /can\('entries\.delete'\)/);
  assert.match(renderHeader, /canCreateEntry/);
  assert.match(openEntryDialog, /canCreateEntry|entry\.permissions\?\.canEdit/);
  assert.match(deleteEntry, /entry\??\.permissions\?\.canDelete/);
  assert.match(app, /entry\.permissions\?\.canEdit/);
  assert.match(app, /entry\.permissions\?\.canDelete/);
  assert.match(app, /entry\.permissions\?\.canRevealPassword/);
});

test('copying an allowed password does not reveal it in the UI', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const copyPassword = app.match(/async function copyPassword\(id\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.doesNotMatch(copyPassword, /revealPassword\(id\)/);
  assert.doesNotMatch(copyPassword, /state\.revealCache\.set/);
  assert.match(copyPassword, /\/api\/entries\/\$\{id\}\/reveal-password/);
  assert.match(copyPassword, /copyText\(password/);
});

test('account list is filtered by project systems instead of account types', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const visibleEntries = app.match(/function visibleEntries\(rows = state\.entries\) \{[\s\S]+?\n\}/)?.[0] || '';
  const renderEntries = app.match(/function renderEntries\(rows = state\.entries\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(renderEntries, /visibleEntries/);
  assert.match(visibleEntries, /entryMatchesSelectedSystem/);
  assert.doesNotMatch(visibleEntries, /entryMatchesSelectedType/);
  assert.match(app, /systemForEntry/);
  assert.match(app, /data-system-filter/);
});

test('entry type mapping stays internal while system management remains visible', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');
  const saveEntryType = app.match(/async function saveEntryType\(event\) \{[\s\S]+?\n\}/)?.[0] || '';
  const deleteEntryType = app.match(/async function deleteEntryType\(id\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.doesNotMatch(html, /id="addEntryTypeBtn"/);
  assert.doesNotMatch(html, /id="typeFilters"/);
  assert.match(html, /id="entryTypeSelect" hidden/);
  assert.match(html, /id="projectSystemDialog"/);
  assert.match(html, /id="manageSystemTypesBtn"/);
  assert.match(html, /id="entryTypeDialog"/);
  assert.doesNotMatch(app, /prompt\('T[eÃƒÂª]n lo[áº¡a]i account m[á»›o]i'/);
  assert.match(saveEntryType, /\/api\/entry-types/);
  assert.match(saveEntryType, /method: id \? 'PATCH' : 'POST'/);
  assert.match(saveEntryType, /await loadEntryTypes\(\)/);
  assert.match(saveEntryType, /renderEntryTypeManager\(\)/);
  assert.match(app, /data-delete-entry-type/);
  assert.match(app, /refreshProjectSystemTypeSelect/);
  assert.match(deleteEntryType, /method: 'DELETE'/);
  assert.match(deleteEntryType, /\/api\/entry-types\/\$\{id\}/);
  assert.match(deleteEntryType, /await loadEntryTypes\(\)/);
  assert.match(deleteEntryType, /renderEntryTypeManager\(\)/);
  assert.match(css, /--strong-text:\s*#f8fafc/);
  assert.match(css, /\.type-manager-card strong[\s\S]+color: var\(--strong-text\)/);
  assert.match(css, /--surface-panel-strong:\s*rgba\(15, 23, 42, \.72\)/);
  assert.match(css, /\.type-manager-card[\s\S]+background: var\(--surface-panel-strong\)/);
});

test('edit form resolves delegated entry type by name without requiring create permission', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const entryTypeIdForEntry = app.match(/function entryTypeIdForEntry\(entry = \{\}\) \{[\s\S]+?\n\}/)?.[0] || '';
  const openEntryDialog = app.match(/async function openEntryDialog\(entry = \{\}\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(entryTypeIdForEntry, /entry\.typeId/);
  assert.match(entryTypeIdForEntry, /entry\.type/);
  assert.match(entryTypeIdForEntry, /state\.entryTypes\.find/);
  assert.match(openEntryDialog, /\/api\/entries\/\$\{entry\.id\}\/edit/);
  assert.match(openEntryDialog, /formEntry\.id \? entryTypeIdForEntry\(formEntry\) : firstCreatableEntryTypeId\(\)/);
});

test('system-based account flow treats account type as metadata', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const entryTypeOptionsForEntry = app.match(/function entryTypeOptionsForEntry\(entry = \{\}\) \{[\s\S]+?\n\}/)?.[0] || '';
  const syncEntryTypeWithSystem = app.match(/function syncEntryTypeWithSystem\(\{ force = false \} = \{\}\) \{[\s\S]+?\n\}/)?.[0] || '';
  const renderProjectSystemTypeOptions = app.match(/function renderProjectSystemTypeOptions\(selectedType = 'Web'\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(html, /id="projectSystemTypeSelect"/);
  assert.match(html, /id="manageSystemTypesBtn"/);
  assert.doesNotMatch(html, /name="customType"/);
  assert.match(html, /<input name="systemId" id="entrySystemSelect" type="hidden">/);
  assert.match(entryTypeOptionsForEntry, /state\.projectSystems\.length\) return state\.entryTypes/);
  assert.match(syncEntryTypeWithSystem, /system\.type/);
  assert.match(syncEntryTypeWithSystem, /matchingType/);
  assert.doesNotMatch(app, /entrySystemSelect'\)\?\.addEventListener\('change'/);
  assert.match(app, /data\.typeId = data\.typeId \|\| entryTypeIdForSystem\(data\.systemId\)/);
  assert.match(app, /DEFAULT_SYSTEM_TYPES/);
  assert.match(app, /state\.entryTypes\.filter/);
  assert.match(app, /configuredTypes/);
  assert.match(app, /configured\.isActive !== false/);
  assert.doesNotMatch(app, /state\.projectSystems\.map\(system => system\.type\)/);
  assert.doesNotMatch(renderProjectSystemTypeOptions, /__custom__/);
  assert.doesNotMatch(app, /data\.type === '__custom__'/);
  assert.doesNotMatch(app, /customType/);
});

test('project system dialog only edits one system and closes after save', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const projectSystemDialog = html.match(/<dialog id="projectSystemDialog">[\s\S]+?<\/dialog>/)?.[0] || '';
  const saveProjectSystem = app.match(/async function saveProjectSystem\(event\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.doesNotMatch(projectSystemDialog, /projectSystemList/);
  assert.doesNotMatch(projectSystemDialog, /DANH S[ÁAÃ]/);
  assert.match(saveProjectSystem, /projectSystemDialog'\)\?\.close\(\)/);
  assert.doesNotMatch(saveProjectSystem, /renderProjectSystemManager\(\)/);
});

test('new accounts are created from the active project system', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const canCreateEntry = app.match(/function canCreateEntry\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const firstCreatableSystemId = app.match(/function firstCreatableSystemId\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const loadProjectSystems = app.match(/async function loadProjectSystems\(projectId = state\.selectedProjectId\) \{[\s\S]+?\n\}/)?.[0] || '';
  const renderSystemSubmenu = app.match(/function renderSystemSubmenu\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const openEntryDialog = app.match(/async function openEntryDialog\(entry = \{\}\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(canCreateEntry, /!state\.selectedSystemId\) return false/);
  assert.match(firstCreatableSystemId, /state\.selectedSystemId && state\.projectSystems\.some/);
  assert.doesNotMatch(firstCreatableSystemId, /state\.projectSystems\[0\]/);
  assert.match(loadProjectSystems, /state\.projectSystemsByProjectId\[String\(projectId\)\] = systems/);
  assert.match(loadProjectSystems, /state\.selectedSystemId = systems\[0\]\.id/);
  assert.doesNotMatch(renderSystemSubmenu, /data-system-filter="All"|Táº¥t cáº£ há»‡ thá»‘ng|TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ hÃ¡Â»â€¡ thÃ¡Â»â€˜ng/);
  assert.match(openEntryDialog, /!state\.selectedSystemId/);
  assert.match(openEntryDialog, /form\.systemId\.value = formEntry\.id \? \(formEntry\.systemId \|\| formEntry\.projectSystemId \|\| ''\) : firstCreatableSystemId\(\)/);
});

test('project sidebar stays project-only while systems render in the middle column', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const renderProjects = app.match(/function renderProjects\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const renderSystemSections = app.match(/function renderSystemSections\(rows = state\.entries\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(app, /projectSystemsByProjectId: \{\}/);
  assert.doesNotMatch(html, /id="addSystemBtn"/);
  assert.doesNotMatch(app, /addSystemBtn/);
  assert.doesNotMatch(renderProjects, /data-toggle-project-systems|renderSystemSubmenu|project-expand-btn/);
  assert.doesNotMatch(app, /function renderSystemSubmenu/);
  assert.doesNotMatch(app, /data-edit-system-sidebar|data-delete-system-sidebar/);
  assert.match(renderSystemSections, /state\.projectSystems\.map/);
  assert.match(renderSystemSections, /data-system-filter="\$\{system\.id\}"/);
  assert.match(renderSystemSections, /data-edit-system="\$\{system\.id\}"/);
  assert.match(renderSystemSections, /data-delete-system="\$\{system\.id\}"/);
  assert.doesNotMatch(renderSystemSections, /renderSystemAccountCards|data-select="\$\{entry\.id\}"/);
  assert.doesNotMatch(app, /function renderSystemAccountCards/);
  assert.match(app, /function renderSystemDetail\(system = currentSystem\(\)\)/);
  assert.match(app, /renderSystemDetail\(currentSystem\(\)\)/);
  assert.match(app, /function activateProjectForSystemAction\(projectId\)/);
  assert.match(app, /openProjectSystemDialog\(system\)/);
  assert.match(app, /deleteProjectSystem\(systemId\)/);
});

test('admin can drag projects and systems to persist custom order', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');
  const renderProjects = app.match(/function renderProjects\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const renderSystemSections = app.match(/function renderSystemSections\(rows = state\.entries\) \{[\s\S]+?\n\}/)?.[0] || '';
  const bindProjectDragActions = app.match(/function bindProjectDragActions\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const bindSystemDragActions = app.match(/function bindSystemDragActions\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const persistProjectOrder = app.match(/async function persistProjectOrder\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const persistSystemOrder = app.match(/async function persistSystemOrder\(projectId\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(renderProjects, /draggable="\$\{isAdmin\(\) \? 'true' : 'false'\}"/);
  assert.match(renderProjects, /data-drag-project/);
  assert.match(renderSystemSections, /data-drag-system/);
  assert.match(bindProjectDragActions, /text\/project-id/);
  assert.match(bindProjectDragActions, /moveItemBefore\(state\.projects, draggedId, targetId\)/);
  assert.match(bindSystemDragActions, /text\/system-id/);
  assert.match(bindSystemDragActions, /persistSystemOrder\(projectId\)/);
  assert.match(persistProjectOrder, /\/api\/projects\/reorder/);
  assert.match(persistSystemOrder, /\/api\/projects\/\$\{projectId\}\/systems\/reorder/);
  assert.match(css, /\.draggable-row/);
  assert.match(css, /\.drop-target/);
});

test('bulk delete controls are limited to accounts', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');
  const renderProjects = app.match(/function renderProjects\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const renderSystemSubmenu = app.match(/function renderSystemSubmenu\(project = currentProject\(\)\) \{[\s\S]+?\n\}/)?.[0] || '';
  const deleteSelectedEntries = app.match(/async function deleteSelectedEntries\(\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.doesNotMatch(html, /id="deleteSelectedProjectsBtn"/);
  assert.doesNotMatch(html, /id="deleteSelectedSystemsBtn"/);
  assert.match(html, /id="deleteSelectedEntriesBtn"/);
  assert.doesNotMatch(html, /id="toggleProjectDeleteModeBtn"/);
  assert.doesNotMatch(html, /id="toggleSystemDeleteModeBtn"/);
  assert.match(html, /id="toggleEntryDeleteModeBtn"/);
  assert.doesNotMatch(app, /selectedProjectIds: new Set\(\)/);
  assert.doesNotMatch(app, /selectedSystemKeys: new Set\(\)/);
  assert.match(app, /selectedEntryIds: new Set\(\)/);
  assert.doesNotMatch(app, /bulkProjectMode: false/);
  assert.doesNotMatch(app, /bulkSystemMode: false/);
  assert.match(app, /bulkEntryMode: false/);
  assert.doesNotMatch(renderProjects, /data-select-project/);
  assert.doesNotMatch(renderSystemSubmenu, /data-select-system/);
  assert.doesNotMatch(app, /data-select-project|data-select-system/);
  assert.doesNotMatch(app, /function toggleProjectDeleteMode\(\)/);
  assert.doesNotMatch(app, /function toggleSystemDeleteMode\(\)/);
  assert.match(app, /function toggleEntryDeleteMode\(\)/);
  assert.doesNotMatch(app, /Chá»n xÃ³a dá»± Ã¡n|ChÃ¡Â»Ân xÃƒÂ³a dÃ¡Â»Â± ÃƒÂ¡n/);
  assert.doesNotMatch(app, /Há»§y chá»n dá»± Ã¡n|HÃ¡Â»Â§y chÃ¡Â»Ân dÃ¡Â»Â± ÃƒÂ¡n/);
  assert.match(deleteSelectedEntries, /\/api\/entries\/\$\{id\}/);
  assert.doesNotMatch(css, /\.bulk-sidebar-actions/);
  assert.match(css, /\.bulk-check/);
});

test('dashboard panels expose desktop mouse resize controls without browser storage', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(html, /id="sidebarResizeHandle"/);
  assert.match(html, /id="detailResizeHandle"/);
  assert.match(html, /aria-label="[^"]*danh sách dự án|aria-label="[^"]*danh sÃ¡ch dá»± Ã¡n/);
  assert.match(html, /aria-label="[^"]*chi tiết account|aria-label="[^"]*chi tiáº¿t account/);

  assert.match(app, /sidebarWidth:\s*280/);
  assert.match(app, /detailPanelWidth:\s*520/);
  assert.match(app, /const PANEL_MIN_WIDTH\s*=\s*10/);
  assert.doesNotMatch(app, /const SIDEBAR_MAX_WIDTH/);
  assert.doesNotMatch(app, /const DETAIL_MAX_WIDTH/);
  assert.match(app, /function maxSidebarWidth\(\)/);
  assert.match(app, /function maxDetailWidth\(\)/);
  assert.match(app, /window\.innerWidth - PANEL_MIN_WIDTH - PANEL_MIN_WIDTH/);
  assert.match(app, /window\.innerWidth - sidebarWidth - PANEL_MIN_WIDTH/);
  assert.match(app, /function bindPanelResizeActions\(\)/);
  assert.match(app, /function updatePanelWidths\(\)/);
  assert.match(app, /--project-sidebar-width/);
  assert.match(app, /--detail-panel-width/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pointermove/);
  assert.match(app, /pointerup/);
  assert.match(app, /sidebarHandle\.disabled = state\.sidebarCollapsed/);
  assert.match(app, /function applyUserPanelLayoutPreferences/);
  assert.match(app, /function currentPanelLayoutPreferences/);
  assert.match(app, /function savePanelLayoutPreferences/);
  assert.match(app, /panelLayout:\s*\{/);
  assert.match(app, /api\('\/api\/me\/preferences'/);
  assert.match(app, /schedulePanelLayoutPreferenceSave\(\)/);

  assert.match(css, /--project-sidebar-width:\s*clamp\(220px, 20vw, 320px\)/);
  assert.match(css, /--project-sidebar-collapsed-width:\s*56px/);
  assert.match(css, /--detail-panel-width:\s*min\(520px, 42vw\)/);
  assert.match(css, /\.panel-resize-handle/);
  assert.match(css, /\.sidebar-resize-handle/);
  assert.match(css, /\.detail-resize-handle/);
  assert.match(css, /\.content-body:has\(\.detail-aside\.open\)\s*\{[^}]*grid-template-columns:\s*minmax\(10px, 1fr\) var\(--detail-panel-width\)/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]+\.panel-resize-handle\s*\{\s*display:\s*none/);
});
test('project member UI keeps Supabase UUID identifiers as strings', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const addSelectedProjectMember = app.match(/function addSelectedProjectMember\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const collectDetailedPermissions = app.match(/function collectDetailedPermissions\(\) \{[\s\S]+?\n\}/)?.[0] || '';
  const saveMemberPermissionDraft = app.match(/async function saveMemberPermissionDraft\(event\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.doesNotMatch(addSelectedProjectMember, /Number\(/);
  assert.doesNotMatch(collectDetailedPermissions, /Number\(row\.dataset\.entryTypeId\)/);
  assert.doesNotMatch(saveMemberPermissionDraft, /Number\(/);
  assert.match(addSelectedProjectMember, /String\(select\?\.value/);
  assert.match(saveMemberPermissionDraft, /String\(event\.target\.userId\.value/);
});

test('empty and restricted account states use permission-aware copy', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const renderEntries = app.match(/function renderEntries\(rows = state\.entries\) \{[\s\S]+?\n\}/)?.[0] || '';
  const entryListSubtitle = app.match(/function entryListSubtitle\(entry\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.doesNotMatch(app, /No user/);
  assert.match(renderEntries, /renderSystemSections\(rows\)/);
  assert.match(app, /function entryListSubtitle\(entry\)/);
  assert.match(app, /Bạn chưa có quyền xem tài khoản trong dự án này|Báº¡n chÆ°a cÃ³ quyá»n xem tÃ i khoáº£n trong dá»± Ã¡n nÃ y/);
  assert.match(app, /Chưa có tài khoản trong dự án|ChÆ°a cÃ³ tÃ i khoáº£n trong dá»± Ã¡n/);
  assert.match(entryListSubtitle, /Bị giới hạn|Bá»‹ giá»›i háº¡n/);
  assert.match(entryListSubtitle, /Chưa có username|ChÆ°a cÃ³ username/);
});

test('detail view hides notes and tags when note permission is not granted', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const renderDetail = app.match(/function renderDetail\(entry\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(renderDetail, /canViewNotes \? escapeHtml\(entry\.notes/);
  assert.match(renderDetail, /canViewNotes \? escapeHtml\(entry\.tags\.join/);
  assert.match(renderDetail, /Bị giới hạn|Bá»‹ giá»›i háº¡n/);
});

test('browser UI source does not contain mojibake text', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');

  assert.equal(/[ÃƒÃ„Ã†ÃÃ°]|Ã¡Âº|Ã¡Â»|Ã¢[^\n]*[Å’Å“â€”â„¢â€“Â¤Ëœâ€¹]/.test(`${app}\n${html}`), false);
});
