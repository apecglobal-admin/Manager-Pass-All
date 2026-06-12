const fs = require('fs');
const file = 'd:/APEC/Work/Projects/MANAGER ALL/public/app.js';
let content = fs.readFileSync(file, 'utf8');

const regex = /return 'Bị giới hạn';\s*\}[\s\S]*?closeItemMenus\(\);\s*if \(willOpen\) wrap\?\.classList\.add\('menu-open'\);\s*\}\)\);/;

const newFunc = `return 'Bị giới hạn';
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
  document.querySelectorAll('#detailPanel .item-more-btn').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const wrap = button.closest('.item-menu-wrap');
    const willOpen = !wrap?.classList.contains('menu-open');
    closeItemMenus();
    if (willOpen) wrap?.classList.add('menu-open');
  }));`;

content = content.replace(regex, newFunc);
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed bindRowActions successfully');
