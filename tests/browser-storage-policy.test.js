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
  assert.doesNotMatch(loginForm, /admin123456/);
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

test('user management UI exposes pending Google access requests for admin approval', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');

  assert.match(html, /<option>Pending<\/option>/);
  assert.match(app, /Yêu cầu tham gia|Yeu cau tham gia/);
  assert.match(app, /Chờ admin phê duyệt|Cho admin phe duyet/);
  assert.match(app, /Duyệt & phân quyền|Duyet & phan quyen/);
  assert.match(app, /user\.status === 'Pending'[\s\S]+form\.status\.value = 'Active'/);
  assert.match(app, /\['Invited', 'Expired'\]\.includes\(user\.status\)[\s\S]+data-invite-user/);
});

test('Google OAuth always prompts for account selection', () => {
  const app = readFileSync('public/app.js', 'utf8');

  assert.match(app, /signInWithOAuth\(\{[\s\S]+provider:\s*'google'/);
  assert.match(app, /queryParams:\s*\{[\s\S]+prompt:\s*'select_account'/);
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
  assert.doesNotMatch(projectMembersDialog, /saveProjectMembersBtn|Lưu thành viên|LÆ°u thÃ nh viÃªn/);
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
  assert.doesNotMatch(app, /detailedPermissions\?\.length\s*\|\|\s*0\}\s*quyền/);
});

test('new project members default to view-only permissions for every account type', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const defaultPermissions = app.match(/function defaultProjectMemberPermissions\(\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(defaultPermissions, /state\.entryTypes\.map/);
  assert.match(defaultPermissions, /entryTypeId:\s*type\.id/);
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
    const cancelButton = form.match(/<button[^>]*>\s*Hủy\s*<\/button>/)?.[0] || '';
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
  assert.match(permissionGrid, /Quáº£n lÃ½ phÃ¢n quyá»n|Quản lý phân quyền/);
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

test('type filters match Supabase entries that only carry a type name', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const entryMatchesSelectedType = app.match(/function entryMatchesSelectedType\(entry\) \{[\s\S]+?\n\}/)?.[0] || '';
  const renderEntries = app.match(/function renderEntries\(rows = state\.entries\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(renderEntries, /entryMatchesSelectedType/);
  assert.match(entryMatchesSelectedType, /entry\.typeId/);
  assert.match(entryMatchesSelectedType, /entry\.type/);
  assert.match(entryMatchesSelectedType, /selectedType\?\.name/);
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

test('detail view hides notes and tags when note permission is not granted', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const renderDetail = app.match(/function renderDetail\(entry\) \{[\s\S]+?\n\}/)?.[0] || '';

  assert.match(renderDetail, /canViewNotes \? escapeHtml\(entry\.notes/);
  assert.match(renderDetail, /canViewNotes \? escapeHtml\(entry\.tags\.join/);
  assert.match(renderDetail, /Bị giới hạn/);
});

test('browser UI source does not contain mojibake text', () => {
  const app = readFileSync('public/app.js', 'utf8');
  const html = readFileSync('public/index.html', 'utf8');

  assert.equal(/[ÃÄÆÏð]|áº|á»|â[^\n]*[Œœ—™–¤˜‹]/.test(`${app}\n${html}`), false);
});
