// Bom Tấn realtime relay.
// Every browser keeps one WebSocket open here. The server only relays "presence"
// patches between players in the same room; the game itself runs in the host's browser.
// Vercel may put players of one room on different function instances, so instances
// forward traffic to each other through Redis pub/sub when a room is split.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createClient } from 'redis';

const INST = Math.random().toString(36).slice(2, 10);
const CHANNEL = 'bomtan:v1';
const LB_ALL = 'bomtan:lb:all';
const LB_KEY = by => 'bomtan:lb:' + by;
const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL || '';
const MAX_PRESENCE = 8000;

/* ---------------- helpers ---------------- */
const cleanRoom = s => (typeof s === 'string' && /^[a-z0-9-]{1,24}$/i.test(s)) ? s.toLowerCase() : null;
const cleanId = s => (typeof s === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(s)) ? s : null;
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').trim().slice(0, 12);
const smallInt = v => Math.max(0, Math.min(20, Number.isFinite(+v) ? Math.floor(+v) : 0));

function merge(base, patch) {
  const o = { ...base };
  for (const k of Object.keys(patch)) { if (patch[k] === null) delete o[k]; else o[k] = patch[k]; }
  return o;
}
function cleanPatch(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const keys = Object.keys(p);
  if (keys.length > 24 || keys.some(k => !/^[A-Za-z_][A-Za-z0-9_]{0,15}$/.test(k))) return null;
  if (JSON.stringify(p).length > MAX_PRESENCE) return null;
  return p;
}

/* ---------------- rooms ---------------- */
// room -> { local: Map(peer -> {ws, by, p}), remote: Map(peer -> {inst, by, p, seen}), insts: Map(inst -> lastSeen), hb, lastHello }
const rooms = new Map();
function getRoom(id) {
  let r = rooms.get(id);
  if (!r) {
    r = { id, local: new Map(), remote: new Map(), insts: new Map(), hb: null, lastHello: 0 };
    r.hb = setInterval(() => heartbeat(r), 3000);
    rooms.set(id, r);
  }
  return r;
}
function dropRoomIfEmpty(r) {
  if (r.local.size) return;
  clearInterval(r.hb);
  rooms.delete(r.id);
}
function sendLocal(r, obj, exceptPeer) {
  const s = JSON.stringify(obj);
  for (const [peer, c] of r.local) if (peer !== exceptPeer && c.ws.readyState === 1) c.ws.send(s);
}
function hasRemote(r) {
  const now = Date.now();
  for (const t of r.insts.values()) if (now - t < 10000) return true;
  return false;
}
function heartbeat(r) {
  const now = Date.now();
  for (const [peer, e] of r.remote) if (now - e.seen > 12000) { r.remote.delete(peer); sendLocal(r, { t: 'leave', peer }); }
  for (const [i, t] of r.insts) if (now - t > 12000) r.insts.delete(i);
  publish({ t: 'hb', room: r.id, peers: [...r.local.keys()] });
}
function maybeHello(r) {
  const now = Date.now();
  if (now - r.lastHello < 2000) return;
  r.lastHello = now;
  publish({ t: 'hello', room: r.id });
}

/* ---------------- redis (optional) ---------------- */
let pub = null, redisReady = false;
const memLb = new Map();
async function initRedis() {
  if (!REDIS_URL) return;
  try {
    pub = createClient({ url: REDIS_URL });
    pub.on('error', e => console.error('redis:', e.message));
    const sub = pub.duplicate();
    sub.on('error', () => {});
    await pub.connect();
    await sub.connect();
    await sub.subscribe(CHANNEL, onBus);
    redisReady = true;
  } catch (e) {
    console.error('redis init failed, running single-instance:', e.message);
    redisReady = false;
  }
}
const redisInit = initRedis();

function publish(msg) {
  if (redisReady) pub.publish(CHANNEL, JSON.stringify({ ...msg, i: INST })).catch(() => {});
}

function onBus(raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (m.i === INST) return;
  const r = rooms.get(m.room);
  if (!r) return;
  r.insts.set(m.i, Date.now());
  switch (m.t) {
    case 'hello':
      for (const [peer, c] of r.local) publish({ t: 'join', room: r.id, peer, by: c.by, p: c.p });
      break;
    case 'join': {
      if (r.local.has(m.peer)) break;
      const p = cleanPatch(m.p) || {};
      r.remote.set(m.peer, { inst: m.i, by: m.by, p, seen: Date.now() });
      sendLocal(r, { t: 'join', peer: m.peer, by: m.by, p });
      break;
    }
    case 'p': {
      const e = r.remote.get(m.peer), patch = cleanPatch(m.p);
      if (!patch) break;
      if (!e) { maybeHello(r); break; }
      e.p = merge(e.p, patch); e.seen = Date.now();
      sendLocal(r, { t: 'p', peer: m.peer, p: patch });
      break;
    }
    case 'leave':
      if (r.remote.delete(m.peer)) sendLocal(r, { t: 'leave', peer: m.peer });
      break;
    case 'hb': {
      const listed = new Set(Array.isArray(m.peers) ? m.peers : []);
      for (const [peer, e] of r.remote) {
        if (e.inst !== m.i) continue;
        if (listed.has(peer)) e.seen = Date.now();
        else { r.remote.delete(peer); sendLocal(r, { t: 'leave', peer }); }
      }
      for (const peer of listed) if (!r.remote.has(peer) && !r.local.has(peer)) { maybeHello(r); break; }
      break;
    }
    case 'lbchg':
      broadcastLb(r);
      break;
  }
}

/* ---------------- leaderboard ---------------- */
let lbCache = null, lbCacheAt = 0;
async function readLb() {
  if (lbCache && Date.now() - lbCacheAt < 2000) return lbCache;
  let rows = [];
  if (redisReady) {
    const ids = (await pub.sMembers(LB_ALL)).slice(0, 500);
    const multi = pub.multi();
    ids.forEach(id => multi.hGetAll(LB_KEY(id)));
    const res = ids.length ? await multi.exec() : [];
    rows = ids.map((by, k) => ({ by, ...(res[k] || {}) }));
  } else {
    rows = [...memLb.entries()].map(([by, v]) => ({ by, ...v }));
  }
  rows = rows.map(r => ({ by: r.by, n: cleanName(r.n), w: +r.w || 0, g: +r.g || 0, k: +r.k || 0, s: +r.s || 0, r: +r.r || 0 }))
    .filter(r => r.g > 0)
    .sort((a, b) => b.w - a.w || b.k - a.k || a.g - b.g)
    .slice(0, 30);
  lbCache = rows; lbCacheAt = Date.now();
  return rows;
}
async function recordLb(rows) {
  if (!Array.isArray(rows)) return;
  const list = rows.slice(0, 8).map(r => ({
    by: cleanId(r && r.by), n: cleanName(r && r.n),
    w: smallInt(r.w), g: smallInt(r.g), k: smallInt(r.k), s: smallInt(r.s), r: smallInt(r.r), d: smallInt(r.d)
  })).filter(r => r.by);
  if (!list.length) return;
  if (redisReady) {
    const multi = pub.multi();
    for (const r of list) {
      const key = LB_KEY(r.by);
      multi.sAdd(LB_ALL, r.by);
      if (r.n) multi.hSet(key, 'n', r.n);
      for (const f of ['w', 'g', 'k', 's', 'r', 'd']) if (r[f]) multi.hIncrBy(key, f, r[f]);
    }
    await multi.exec();
  } else {
    for (const r of list) {
      const cur = memLb.get(r.by) || {};
      const next = { n: r.n || cur.n || '' };
      for (const f of ['w', 'g', 'k', 's', 'r', 'd']) next[f] = (cur[f] || 0) + r[f];
      memLb.set(r.by, next);
    }
  }
  lbCache = null;
}
async function sendLb(ws) {
  try { const rows = await readLb(); if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'lb', rows })); } catch {}
}
async function broadcastLb(r) {
  try { const rows = await readLb(); sendLocal(r, { t: 'lb', rows }); } catch {}
}

/* ---------------- connections ---------------- */
function onConnection(ws) {
  let r = null, me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async data => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'join') {
      if (r) return;
      const roomId = cleanRoom(m.room), peer = cleanId(m.peer);
      if (!roomId || !peer) { ws.close(1008, 'bad join'); return; }
      await redisInit;
      r = getRoom(roomId); me = peer;
      const old = r.local.get(me);
      if (old && old.ws !== ws) { try { old.ws.close(4000, 'replaced'); } catch {} }
      const c = { ws, by: cleanId(m.by) || me, p: cleanPatch(m.p) || {} };
      r.local.set(me, c);
      r.remote.delete(me);
      const peers = [];
      for (const [id, x] of r.local) peers.push({ peer: id, by: x.by, p: x.p });
      for (const [id, x] of r.remote) if (!r.local.has(id)) peers.push({ peer: id, by: x.by, p: x.p });
      ws.send(JSON.stringify({ t: 'full', peers }));
      sendLocal(r, { t: 'join', peer: me, by: c.by, p: c.p }, me);
      publish({ t: 'hello', room: roomId });
      publish({ t: 'join', room: roomId, peer: me, by: c.by, p: c.p });
      return;
    }
    if (!r) return;
    const c = r.local.get(me);
    if (!c || c.ws !== ws) return;
    if (m.t === 'p') {
      const patch = cleanPatch(m.p);
      if (!patch) return;
      const next = merge(c.p, patch);
      if (JSON.stringify(next).length > MAX_PRESENCE) return;
      c.p = next;
      sendLocal(r, { t: 'p', peer: me, p: patch }, me);
      if (hasRemote(r)) publish({ t: 'p', room: r.id, peer: me, by: c.by, p: patch });
    } else if (m.t === 'lb') {
      sendLb(ws);
    } else if (m.t === 'lbrec') {
      try { await recordLb(m.rows); } catch {}
      broadcastLb(r);
      publish({ t: 'lbchg', room: r.id });
    }
  });

  ws.on('close', () => {
    if (!r) return;
    const c = r.local.get(me);
    if (c && c.ws === ws) {
      r.local.delete(me);
      sendLocal(r, { t: 'leave', peer: me });
      publish({ t: 'leave', room: r.id, peer: me });
      dropRoomIfEmpty(r);
    }
  });
}

export function attach(server) {
  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
  wss.on('connection', onConnection);
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 20000);
  wss.on('close', () => clearInterval(ping));
  return wss;
}

const server = http.createServer((req, res) => {
  res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Bom Tấn: endpoint này chỉ nhận kết nối WebSocket.');
});
attach(server);

export default server;
