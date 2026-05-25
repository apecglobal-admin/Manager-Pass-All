import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../src/db.js';
import { createRepositories } from '../src/repositories.js';
import { buildBackup, writeBackupFiles } from '../src/backup.js';

test('buildBackup exports all tables without plaintext passwords', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 9));
  const project = repos.projects.create({ name: 'Backup Project', description: '', status: 'Active' });
  repos.entries.create({
    projectId: project.id,
    name: 'Backup Admin',
    type: 'Admin',
    environment: 'Production',
    url: 'https://backup.local',
    username: 'backup-user',
    password: 'backup-secret-plain',
    notes: '',
    tags: ['backup'],
    status: 'Active'
  });

  const backup = buildBackup(db);
  const serialized = JSON.stringify(backup);

  assert.equal(backup.format, 'apecglobal-manager-backup');
  assert.equal(backup.tables.projects.length, 1);
  assert.equal(backup.tables.entries.length, 1);
  assert.ok(backup.tables.entries[0].password_encrypted);
  assert.equal(serialized.includes('backup-secret-plain'), false);
});

test('writeBackupFiles writes latest and timestamped JSON files', () => {
  const db = createDatabase(':memory:');
  const repos = createRepositories(db, Buffer.alloc(32, 4));
  repos.projects.create({ name: 'Written Backup', description: '', status: 'Active' });
  const dir = mkdtempSync(join(tmpdir(), 'apec-backup-'));

  const result = writeBackupFiles(db, dir);

  assert.match(result.latestPath, /latest\.json$/);
  assert.match(result.timestampedPath, /apecglobal-manager-\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(readFileSync(result.latestPath, 'utf8')).tables.projects.length, 1);
});
