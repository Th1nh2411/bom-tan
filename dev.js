// Local test server: serves public/ and the same WebSocket relay on /api/ws.
// Run: npm install && npm run dev  ->  http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { attach } from './api/ws.js';

const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!path || path.endsWith('/')) path += 'index.html';
  if (path.includes('..')) { res.writeHead(400); return res.end(); }
  try {
    const body = await readFile(join('public', path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
attach(server);
server.listen(PORT, () => console.log(`Bom Tấn chạy tại http://localhost:${PORT}`));
