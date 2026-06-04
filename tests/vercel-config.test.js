import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Vercel deploy uses public assets and a serverless API handler', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const apiEntry = readFileSync('api/index.js', 'utf8');
  const server = readFileSync('src/server.js', 'utf8');

  assert.equal(vercel.outputDirectory, 'public');
  assert.equal(vercel.buildCommand, 'npm run vercel:build');
  assert.equal(vercel.functions['api/index.js'].maxDuration, 30);
  assert.deepEqual(vercel.rewrites, [
    { source: '/api/(.*)', destination: '/api/index.js' },
    { source: '/runtime-config.js', destination: '/api/index.js' },
    { source: '/vendor/supabase.js', destination: '/api/index.js' }
  ]);
  assert.equal(pkg.scripts.build, 'npm run vercel:build');
  assert.equal(pkg.scripts['vercel:build'], 'node --test');
  assert.equal(pkg.engines.node, '22.x');
  assert.match(apiEntry, /createVercelHandler/);
  assert.match(apiEntry, /export default function handleVercelRequest/);
  assert.match(apiEntry, /handler \|\|= createVercelHandler\(\)/);
  assert.match(server, /export function createVercelHandler/);
  assert.match(server, /statelessSessions:\s*true/);
});

test('Vercel login page loads dynamic runtime config before Supabase client', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const server = readFileSync('src/server.js', 'utf8');

  const runtimeConfigIndex = html.indexOf('src="/runtime-config.js');
  const supabaseClientIndex = html.indexOf('src="/supabase-client.js');

  assert.ok(runtimeConfigIndex > -1);
  assert.ok(supabaseClientIndex > -1);
  assert.ok(runtimeConfigIndex < supabaseClientIndex);
  assert.equal(html.includes('src="/config.js"'), false);
  assert.match(server, /pathname === '\/runtime-config\.js'/);
});
