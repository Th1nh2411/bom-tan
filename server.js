// Bom Tấn server: serves public/ and the WebSocket relay on /api/ws.
// Run: npm install && npm start  ->  http://localhost:3000
import './server/env.js';   // must stay first: loads .env before anything reads process.env
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach, listRooms } from './server/relay.js';
import { authConfig } from './server/auth.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/config') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); return res.end(JSON.stringify(authConfig)); }
  if (url.pathname === '/api/rooms') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); return res.end(JSON.stringify(listRooms())); }
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!path || path.endsWith('/')) path += 'index.html';
  if (path.includes('..')) { res.writeHead(400); return res.end(); }
  try {
    const body = await readFile(join(PUBLIC, path));
    // no-cache = always revalidate, so players get a new version on reload right after a deploy
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
attach(server);
server.listen(PORT, () => console.log(`Bom Tấn chạy tại http://localhost:${PORT}`));
