import fs from 'fs';
import path from 'path';

const filesToDelete = [
  'tests',
  'original_app.js',
  'temp_app.js',
  'temp_check.js',
  'temp_diff.patch',
  'temp_diff_utf8.patch',
  'test-vendor.js',
  'fix-auth.cjs',
  'fix-bind.cjs',
  'fix-global.cjs',
  'fix-mangle.cjs',
  'fix-syntax.cjs',
  'fix-ui.cjs',
  'fix_credential_rows.ps1',
  'dev-server.err.log',
  'dev-server.log'
];

filesToDelete.forEach(fileOrFolder => {
  const p = path.resolve(fileOrFolder);
  try {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      console.log(`Deleted: ${fileOrFolder}`);
    }
  } catch (error) {
    console.error(`Error deleting ${fileOrFolder}:`, error.message);
  }
});
