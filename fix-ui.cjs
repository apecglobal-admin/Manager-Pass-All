const fs = require('fs');
const file = 'd:/APEC/Work/Projects/MANAGER ALL/public/app.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Restore the lost functions correctly and apply the new tick logic.
const regexCountdown = /function revealedPasswordState[\s\S]*?setInterval\(tick, 1000\)\);\s*\}/;

const newCountdown = `function revealedPasswordState(cacheKey) {
  const revealState = state.revealCache.get(cacheKey);
  if (!revealState) return null;
  if (revealState.expiresAt <= Date.now()) {
    state.revealCache.delete(cacheKey);
    clearRevealTimer(cacheKey);
    return null;
  }
  return revealState;
}

function revealedPassword(cacheKey) {
  return revealedPasswordState(cacheKey)?.password || '';
}

function revealSecondsRemaining(revealState) {
  return Math.max(0, Math.ceil((revealState.expiresAt - Date.now()) / 1000));
}

function setRevealedPassword(cacheKey, password) {
  state.revealCache.set(cacheKey, {
    password: password || '',
    expiresAt: Date.now() + PASSWORD_REVEAL_DURATION_MS
  });
  renderEntries();
  startRevealCountdown(cacheKey);
}

function clearRevealTimer(cacheKey) {
  const timer = state.revealTimers.get(cacheKey);
  if (timer) clearInterval(timer);
  state.revealTimers.delete(cacheKey);
}

function startRevealCountdown(cacheKey) {
  clearRevealTimer(cacheKey);
  const tick = () => {
    const revealState = revealedPasswordState(cacheKey);
    if (!revealState) {
      state.revealCache.delete(cacheKey);
      clearRevealTimer(cacheKey);
      renderEntries();
      return;
    }
    document.querySelectorAll('[data-reveal-countdown]').forEach(label => {
      const currentCacheKey = label.dataset.revealCountdown;
      const currentRevealState = revealedPasswordState(currentCacheKey);
      if (currentRevealState) {
        label.textContent = \`\${revealSecondsRemaining(currentRevealState)}(s)\`;
      }
    });
  };
  tick();
  state.revealTimers.set(cacheKey, setInterval(tick, 1000));
}`;

content = content.replace(regexCountdown, newCountdown);

// 2. Remove the eye-closed button from credentialDetailRows
const regexRow = /const passwordActions = canRevealEntryPassword\s*\?\s*\`\$\{\!revealState \? \`\<button class=\"icon-btn-only\" data-reveal=\"\$\{entry\.id\}\" data-credential-reveal=\"\$\{escapeAttr\(credential\.id \|\| \'\'\)\}\" title=\"Xem mật khẩu\"\>\$\{svgIcon\(\'eye\'\)\}\<\/button\>\` \: \`\<button class=\"icon-btn-only\" data-reveal=\"\$\{entry\.id\}\" data-credential-reveal=\"\$\{escapeAttr\(credential\.id \|\| \'\'\)\}\" title=\"Ẩn mật khẩu\"\>\$\{svgIcon\(\'eye-closed\'\)\}\<\/button\>\`\}\s*\<button class=\"icon-btn-only\" data-copy-pass=\"\$\{entry\.id\}\" data-credential-copy=\"\$\{escapeAttr\(credential\.id \|\| \'\'\)\}\" title=\"Copy mật khẩu\"\>\$\{svgIcon\(\'copy\'\)\}\<\/button\>\`\s*\: \'\<span class=\"risk-badge\"\>Bị giới hạn\<\/span\>\';/g;

const newRow = `const passwordActions = canRevealEntryPassword
      ? \`\${!revealState ? \`<button class="icon-btn-only" data-reveal="\${entry.id}" data-credential-reveal="\${escapeAttr(credential.id || '')}" title="Xem mật khẩu">\${svgIcon('eye')}</button>\` : ''}
         <button class="icon-btn-only" data-copy-pass="\${entry.id}" data-credential-copy="\${escapeAttr(credential.id || '')}" title="Copy mật khẩu">\${svgIcon('copy')}</button>\`
      : '<span class="risk-badge">Bị giới hạn</span>';`;

content = content.replace(regexRow, newRow);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed UI issues and restored state gracefully!');
