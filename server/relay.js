// Bom Tấn realtime server.
// Every browser keeps one WebSocket open here. The server runs each room's game (server/game.js) and
// streams snapshots; players' controls are read by the server only. The rest of a player's "presence"
// (name, colour, team, emotes, ping) is relayed to the others in the same room.
// Rooms live in this process's memory, so run a single instance. With REDIS_URL set, the leaderboard
// is stored in Redis (and survives restarts).
import { WebSocketServer } from 'ws';
import { createClient } from 'redis';
import { readSession, verifyGoogleIdToken, makeSession } from './auth.js';
import { TICK_MS, cleanName, nameOf, newRoomGame, isKicked, refresh, tickRoom, command, onJoin, onLeave, onPresence, lobbyPeers, activeOwner } from './game.js';

const INST = Math.random().toString(36).slice(2, 10);
const CHANNEL = 'bomtan:v1';
const LB_ALL = 'bomtan:lb:all';
const LB_KEY = by => 'bomtan:lb:' + by;
const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL || '';
const MAX_PRESENCE = 8000;

/* ---------------- helpers ---------------- */
const cleanRoom = s => (typeof s === 'string' && /^[a-z0-9-]{1,24}$/i.test(s)) ? s.toLowerCase() : null;
const cleanId = s => (typeof s === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(s)) ? s : null;
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
// Controls (movement, bombs, predicted position) are only read by the server's game, never relayed.
const CONTROLS = new Set(['dx', 'dy', 'b', 'bc', 'px', 'py', 'pd', 'tp', 'pr']);
function shared(p) {
  const o = {};
  for (const k of Object.keys(p)) if (!CONTROLS.has(k)) o[k] = p[k];
  return o;
}

/* ---------------- rooms ---------------- */
// room -> { id, local: Map(peer -> {ws, by, p}), game }
const rooms = new Map();
function getRoom(id) {
  let r = rooms.get(id);
  if (!r) { r = { id, local: new Map(), game: newRoomGame() }; rooms.set(id, r); }
  return r;
}
function dropRoomIfEmpty(r) {
  if (!r.local.size) rooms.delete(r.id);
}
function sendRaw(r, s, exceptPeer) {
  for (const [peer, c] of r.local) if (peer !== exceptPeer && c.ws.readyState === 1) c.ws.send(s);
}
const sendLocal = (r, obj, exceptPeer) => sendRaw(r, JSON.stringify(obj), exceptPeer);

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
    // another instance (e.g. during a deploy) recorded a round: refresh everyone's leaderboard
    await sub.subscribe(CHANNEL, raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.i !== INST && m.t === 'lbchg') { lbCache = null; for (const r of rooms.values()) broadcastLb(r); }
    });
    redisReady = true;
  } catch (e) {
    console.error('redis init failed, leaderboard kept in memory:', e.message);
    redisReady = false;
  }
}
const redisInit = initRedis();

function publish(msg) {
  if (redisReady) pub.publish(CHANNEL, JSON.stringify({ ...msg, i: INST })).catch(() => {});
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
async function roundEnded(r, rows) {
  try { await recordLb(rows); } catch {}
  broadcastLb(r);
  publish({ t: 'lbchg' });
}

/* ---------------- public rooms ---------------- */
// rooms whose owner ticked "public", for the room list and quick play (GET /api/rooms)
export function listRooms() {
  const out = [];
  for (const r of rooms.values()) {
    if (!r.game.pub) continue;
    const players = lobbyPeers(r).length;
    if (!players) continue;
    const o = activeOwner(r);
    out.push({ id: r.id, n: players, md: r.game.mode, ph: r.game.g ? 'play' : 'lobby', ow: o ? nameOf(r.local.get(o)) : '' });
  }
  return out.sort((a, b) => (a.ph === 'lobby' ? 0 : 1) - (b.ph === 'lobby' ? 0 : 1) || b.n - a.n).slice(0, 30);
}

/* ---------------- game loop ---------------- */
export const LIMITS = { MSG_PER_SEC: 240, ROOM_SIZE: 16 };
let loop = null;
function tickAll() {
  const now = performance.now();
  for (const r of rooms.values()) {
    try {
      const { msg, rows } = tickRoom(r, now);
      if (msg) sendRaw(r, msg);
      if (rows) roundEnded(r, rows);
    } catch (e) { console.error('tick', r.id, e); }
  }
}

/* ---------------- connections ---------------- */
function onConnection(ws) {
  let r = null, me = null;
  let winStart = Date.now(), winCount = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async data => {
    // flood guard: a normal client sends at most ~110 messages a second
    const now = Date.now();
    if (now - winStart >= 1000) { winStart = now; winCount = 0; }
    if (++winCount > LIMITS.MSG_PER_SEC) { ws.close(1008, 'too many messages'); return; }
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') { if (typeof m.ts === 'number') ws.send(JSON.stringify({ t: 'pong', ts: m.ts })); return; }   // round-trip time for the player list
    if (m.t === 'join') {
      if (r) return;
      const roomId = cleanRoom(m.room), peer = cleanId(m.peer);
      if (!roomId || !peer) { ws.close(1008, 'bad join'); return; }
      await redisInit;
      // a signed-in player's key comes only from a valid session; nobody can claim a Google-backed key ("g_...")
      const sess = m.session ? readSession(m.session) : null;
      if (m.session && !sess) ws.send(JSON.stringify({ t: 'authfail' }));
      let by = cleanId(m.by) || peer;
      if (by.startsWith('g_')) by = peer;
      if (sess) by = sess.by;
      const room = getRoom(roomId);
      if (isKicked(room, peer, by)) { ws.close(4001, 'kicked'); dropRoomIfEmpty(room); return; }
      if (room.local.size >= LIMITS.ROOM_SIZE && !room.local.has(peer)) { ws.close(4002, 'room full'); dropRoomIfEmpty(room); return; }
      r = room; me = peer;
      const old = r.local.get(me);
      if (old && old.ws !== ws) { try { old.ws.close(4000, 'replaced'); } catch {} }
      const c = { ws, by, p: cleanPatch(m.p) || {} };
      r.local.set(me, c);
      onJoin(r, me);
      if (!r.game.body) refresh(r);
      const peers = [];
      for (const [id, x] of r.local) peers.push({ peer: id, by: x.by, p: shared(x.p) });
      // "by": the player key the server settled on for you; g/gg: the game as everyone else has it now
      ws.send(JSON.stringify({ t: 'full', peers, by: c.by, g: r.game.body, gg: r.game.grid }));
      sendLocal(r, { t: 'join', peer: me, by: c.by, p: shared(c.p) }, me);
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
      onPresence(r, me, patch);
      const out = shared(patch);
      if (Object.keys(out).length) sendLocal(r, { t: 'p', peer: me, p: out }, me);
    } else if (m.t === 'cmd') {
      command(r, me, m);
    } else if (m.t === 'auth') {
      const user = await verifyGoogleIdToken(m.token);
      if (ws.readyState !== 1) return;
      if (!user) { ws.send(JSON.stringify({ t: 'authfail' })); return; }
      const session = makeSession(user), s = readSession(session);
      c.by = s.by;
      ws.send(JSON.stringify({ t: 'authed', session, by: s.by, name: s.name, email: s.email }));
      sendLocal(r, { t: 'by', peer: me, by: c.by }, me);   // others learn the new key; the email never leaves this socket
      if (isKicked(r, me, c.by)) ws.close(4001, 'kicked');
    } else if (m.t === 'lb') {
      sendLb(ws);
    }
  });

  ws.on('close', () => {
    if (!r) return;
    const c = r.local.get(me);
    if (c && c.ws === ws) {
      r.local.delete(me);
      onLeave(r, me);
      sendLocal(r, { t: 'leave', peer: me });
      dropRoomIfEmpty(r);
    }
  });
}

export function attach(server) {
  // compress messages: snapshots repeat a lot between frames, so deflate with context takeover shrinks them a lot
  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024, perMessageDeflate: { threshold: 64, zlibDeflateOptions: { level: 6 } } });
  wss.on('connection', onConnection);
  if (!loop) loop = setInterval(tickAll, TICK_MS);
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 20000);
  wss.on('close', () => { clearInterval(ping); clearInterval(loop); loop = null; });
  return wss;
}
