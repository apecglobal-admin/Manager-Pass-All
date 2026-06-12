const fs = require('fs');
const file = 'd:/APEC/Work/Projects/MANAGER ALL/public/app.js';
let content = fs.readFileSync(file, 'utf8');

// The regex will find the function from definition to the closing bracket before `addEntryCredentialRow`
const regex = /function credentialDetailRows[\s\S]*?(?=function addEntryCredentialRow)/;

const newFunc = `function credentialDetailRows(entry, { canViewUsername, canRevealEntryPassword }) {
  const credentials = entry.credentials?.length
    ? entry.credentials
    : [{ id: '', entryId: entry.id, departmentId: '', username: entry.username || '' }];
  return credentials.map(credential => {
    const credentialKey = credential.id ? \`\${entry.id}:\${credential.id}\` : entry.id;
    const revealState = revealedPasswordState(credentialKey);
    const password = revealState?.password || '************';
    const countdownHtml = revealState
      ? \`<span class="reveal-countdown-compact" data-reveal-countdown="\${escapeAttr(credentialKey)}">\${revealSecondsRemaining(revealState)}(s)</span>\`
      : '';
    const usernameValue = canViewUsername ? escapeHtml(credential.username || 'Chưa có username') : 'Bị giới hạn';
    const usernameActions = canViewUsername && credential.username
      ? \`<button class="icon-btn-only" data-copy="\${escapeAttr(credential.username)}" title="Copy username">\${svgIcon('copy')}</button>\`
      : '';
    const passwordActions = canRevealEntryPassword
      ? \`\${!revealState ? \`<button class="icon-btn-only" data-reveal="\${entry.id}" data-credential-reveal="\${escapeAttr(credential.id || '')}" title="Xem mật khẩu">\${svgIcon('eye')}</button>\` : \`<button class="icon-btn-only" data-reveal="\${entry.id}" data-credential-reveal="\${escapeAttr(credential.id || '')}" title="Ẩn mật khẩu">\${svgIcon('eye-closed')}</button>\`}
         <button class="icon-btn-only" data-copy-pass="\${entry.id}" data-credential-copy="\${escapeAttr(credential.id || '')}" title="Copy mật khẩu">\${svgIcon('copy')}</button>\`
      : '<span class="risk-badge">Bị giới hạn</span>';
    return \`
      <div class="credential-detail-item">
        <div class="credential-department-title">\${escapeHtml(credentialDepartmentName(credential))}</div>
        <div class="credential-fields-row">
          <div class="credential-field-group">
            <span class="credential-field-icon">\${svgIcon('user')}</span>
            <div class="credential-field-content">
              <small>Username</small>
              <span class="credential-field-val">\${usernameValue}</span>
            </div>
            \${usernameActions}
          </div>
          <div class="credential-field-group">
            <span class="credential-field-icon">\${svgIcon('key')}</span>
            <div class="credential-field-content">
              <small>Mật khẩu</small>
              <span class="credential-field-val password-text">\${escapeHtml(password)}</span>
            </div>
            <div class="credential-field-actions">
              \${countdownHtml}
              \${passwordActions}
            </div>
          </div>
        </div>
      </div>
    \`;
  }).join('');
}

`;

content = content.replace(regex, newFunc);
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed credentialDetailRows syntax error successfully');
