import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('desktop auto update is configured for public GitHub releases', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const main = readFileSync('desktop/main.cjs', 'utf8');
  const workflowPath = '.github/workflows/release.yml';

  assert.equal(pkg.repository.url, 'https://github.com/apecglobal-admin/Manager-Pass-All.git');
  assert.equal(pkg.dependencies['electron-updater'].startsWith('^'), true);
  assert.deepEqual(pkg.build.publish[0], {
    provider: 'github',
    owner: 'apecglobal-admin',
    repo: 'Manager-Pass-All',
    releaseType: 'release'
  });
  assert.equal(pkg.build.win.target.some(target => target.target === 'nsis'), true);
  assert.equal(pkg.build.nsis.artifactName, 'ApecGlobal-Manager-Setup-${version}.${ext}');
  assert.equal(pkg.build.portable.artifactName, 'ApecGlobal-Manager-Portable-${version}.${ext}');
  assert.match(main, /electron-updater/);
  assert.match(main, /checkForUpdates/);
  assert.match(main, /autoDownload\s*=\s*false/);
  assert.match(main, /update-available/);
  assert.match(main, /showUpdateAvailableDialog/);
  assert.match(main, /downloadUpdate/);
  assert.match(main, /openExternal/);
  assert.match(main, /quitAndInstall/);
  assert.match(main, /function loadDesktopEnv/);
  assert.match(main, /desktopTargetUrl/);
  assert.match(main, /app\.quit\(\)/);
  assert.equal(existsSync(workflowPath), true);
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /npm run publish:win/);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});
