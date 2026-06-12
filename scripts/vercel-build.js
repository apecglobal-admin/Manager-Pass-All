#!/usr/bin/env node

/**
 * Vercel build script  
 * - Validates public directory exists
 * - Ready for deployment
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

if (!fs.existsSync(publicDir)) {
  console.error('❌ Error: public directory does not exist');
  process.exit(1);
}

const files = fs.readdirSync(publicDir);
console.log(`✓ Vercel build ready`);
console.log(`✓ public/ directory has ${files.length} items`);
process.exit(0);
