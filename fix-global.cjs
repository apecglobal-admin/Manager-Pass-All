const fs = require('fs');
const file = 'd:/APEC/Work/Projects/MANAGER ALL/public/app.js';
let content = fs.readFileSync(file, 'utf8');

// The last replace wiped out parts of bindEvents from `$('#saveJsonBtn').addEventListener('click', saveJsonBackup);` to the end of the function.
// Let's restore it from a known good state or just replace the whole `bindEvents` tail.

const regex = /\$\('#exportCsvBtn'\)\.addEventListener\('click', \(\) => download\('\/api\/export\/csv\?passwords=1', 'apecglobal-export\.csv'\)\);\s*\$\('#importBtn'\)\.addEventListener\('click', \(\) => \$\('#importFile'\)\.click\(\)\);\s*function initializeTheme\(\)/;

const newContent = `$('#exportCsvBtn').addEventListener('click', () => download('/api/export/csv?passwords=1', 'apecglobal-export.csv'));
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

    const revealBtn = event.target.closest('[data-reveal]');
    if (revealBtn) {
      revealPassword(revealBtn.dataset.reveal, revealBtn.dataset.credentialReveal || '');
    }

    const copyPassBtn = event.target.closest('[data-copy-pass]');
    if (copyPassBtn) {
      copyPassword(copyPassBtn.dataset.copyPass, copyPassBtn.dataset.credentialCopy || '');
    }
  });
  bindPanelResizeActions();
  syncSidebarState();
}

function initializeTheme()`;

content = content.replace(regex, newContent);
fs.writeFileSync(file, content, 'utf8');
console.log('Restored bindEvents and injected global listener');
