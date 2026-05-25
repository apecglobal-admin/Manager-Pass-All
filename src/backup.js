import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TABLES = [
  'users',
  'projects',
  'entries',
  'tags',
  'entry_tags',
  'activity_logs',
  'settings'
];

export function buildBackup(db) {
  const tables = {};
  for (const table of TABLES) {
    tables[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }

  return {
    format: 'apecglobal-manager-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    containsPlaintextPasswords: false,
    tables
  };
}

export function writeBackupFiles(db, backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const backup = buildBackup(db);
  const json = JSON.stringify(backup, null, 2);
  const safeTimestamp = backup.exportedAt.replaceAll(':', '-').replaceAll('.', '-');
  const latestPath = join(backupDir, 'latest.json');
  const timestampedPath = join(backupDir, `apecglobal-manager-${safeTimestamp}.json`);

  writeFileSync(latestPath, json, 'utf8');
  writeFileSync(timestampedPath, json, 'utf8');

  return {
    latestPath,
    timestampedPath,
    exportedAt: backup.exportedAt,
    counts: Object.fromEntries(Object.entries(backup.tables).map(([table, rows]) => [table, rows.length]))
  };
}
