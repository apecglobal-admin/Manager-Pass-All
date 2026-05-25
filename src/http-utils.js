import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map(part => {
    const [key, ...rest] = part.trim().split('=');
    return [key, decodeURIComponent(rest.join('='))];
  }));
}

export function serveStatic(req, res, publicDir) {
  const rawPath = new URL(req.url, 'http://localhost').pathname;
  const requested = rawPath === '/' ? '/index.html' : rawPath;
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(normalize(publicDir)) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
  return true;
}

export function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
