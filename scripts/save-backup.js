import { BACKUP_DIR, DB_PATH } from '../src/config.js';
import { createDatabase } from '../src/db.js';
import { writeBackupFiles } from '../src/backup.js';

const db = createDatabase(DB_PATH);
try {
  const result = writeBackupFiles(db, BACKUP_DIR);
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
