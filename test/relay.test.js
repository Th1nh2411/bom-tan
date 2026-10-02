import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attach, LIMITS, listRooms } from '../server/relay.js';

let server, wss, url;
before(async () => {
  server = http.createServer();
  wss = attach(server);
  await new Promise(r => server.listen(0, r));
  url = `ws://127.0.0.1:${server.address().port}/api/ws`;
});
after(async () => {
  for (const c of wss.clients) c.terminate();
  await new Promise(r => wss.close(r));
  await new Promise(r => server.close(r));
});

let seq = 0;
// a test client: joins a room, records every message, and can wait for one that matches
function client(room, p = {}, name = 'c' + ++seq) {
  const ws = new WebSocket(url), msgs = [], waiters = [];
  const c = { ws, msgs, peer: 'peer' + name, by: 'key' + name };
  c.closed = new Promise(r => ws.on('close', code => r(code)));
  ws.on('message', d => { const m = JSON.parse(d); msgs.push(m); for (const w of waiters.slice()) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } });
  c.waitFor = (pred, ms = 1500) => new Promise((res, rej) => {
    const hit = msgs.find(pred); if (hit) return res(hit);
    const w = { pred, res }; waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout waiting for message')); } }, ms);
  });
  c.send = o => ws.send(JSON.stringify(o));
  c.patch = p => c.send({ t: 'p', p });
  c.ready = new Promise(r => ws.on('open', () => { c.send({ t: 'join', room, peer: c.peer, by: c.by, p }); r(); }))
    .then(() => c.waitFor(m => m.t === 'full'));
  c.ready.catch(() => {});   // refused clients never get 'full'; tests that expect that await `closed` instead
  return c;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const me = { li: 1, j: 1 };   // a signed-in player who joins rounds
// the latest game state a client has seen: the 'full' snapshot, then every 'g' diff applied on top
function game(c) {
  let b = null, gg = '';
  for (const m of c.msgs) {
    if (m.t === 'full') { b = m.g; gg = m.gg; }
    else if (m.t === 'g') { if (m.b) b = m.b; if (m.gg) gg = m.gg; }
  }
  return b && { ...b, g: gg };
}
async function until(c, pred, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    const g = game(c);
    if (g && pred(g)) return g;
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for game state');
    await sleep(10);
  }
}
const player = (g, id) => g.pl.find(p => p[0] === id);

test('the server runs the room: joiners get the game, the first signed-in player owns the room', async () => {
  const guest = client('own1', { j: 1 }), a = client('own1', me), b = client('own1', me);
  await Promise.all([guest.ready, a.ready, b.ready]);
  const full = a.msgs.find(m => m.t === 'full');
  assert.equal(typeof full.gg, 'string');
  const g = await until(b, g => g.ow === a.peer && g.pl.length === 2);
  assert.equal(g.ph, 'lobby');
  assert.ok(!player(g, guest.peer), 'players who have not signed in only watch');
  // only the owner's commands count
  b.send({ t: 'cmd', c: 'start' });
  await sleep(100);
  assert.equal(game(b).ph, 'lobby');
  a.send({ t: 'cmd', c: 'mode', m: 'z' });
  a.send({ t: 'cmd', c: 'start' });
  const started = await until(b, g => g.ph === 'count');
  assert.equal(started.md, 'z');
  assert.equal(started.pl.length, 2);
  // the owner leaves: after a short grace period the next signed-in player takes over
  a.ws.close();
  await until(b, g => g.ow === b.peer);
  [guest, b].forEach(c => c.ws.close());
});

test('controls drive the server game and are never relayed; the rest of presence is', async () => {
  const a = client('ctl', me), b = client('ctl', me);
  await Promise.all([a.ready, b.ready]);
  await until(a, g => g.ow === a.peer && g.pl.length === 2);
  a.send({ t: 'cmd', c: 'map', map: 'classic' });   // the step below assumes the classic pillars
  await until(a, g => g.mp === 'classic');
  a.send({ t: 'cmd', c: 'start' });
  const g0 = await until(b, g => g.ph === 'play', 5000);
  // spawns are on open cells with no boxes nearby, so a step away from the outer wall is always free
  const x0 = player(g0, b.peer)[1];
  b.patch({ dx: x0 <= 100 ? 1 : -1, em: [0, 1] });
  await a.waitFor(m => m.t === 'p' && m.peer === b.peer && m.p.em);
  assert.ok(!a.msgs.some(m => m.t === 'p' && 'dx' in m.p), 'controls are not sent to other players');
  await until(a, g => Math.abs(player(g, b.peer)[1] - x0) >= 50);
  [a, b].forEach(c => c.ws.close());
});

test('the owner can kick; kicked players cannot rejoin, and the round result goes to the leaderboard', async () => {
  const h = client('kick', me), b = client('kick', me, 'K');
  await Promise.all([h.ready, b.ready]);
  await until(h, g => g.ow === h.peer && g.pl.length === 2);
  b.send({ t: 'cmd', c: 'kick', peer: h.peer });   // not the owner: ignored
  h.send({ t: 'cmd', c: 'start' });
  await until(h, g => g.ph === 'play', 5000);
  h.send({ t: 'cmd', c: 'kick', peer: b.peer });
  assert.equal(await b.closed, 4001);
  const end = await until(h, g => g.ph === 'end');
  assert.deepEqual(end.wi, [h.peer]);
  const again = client('kick', me, 'K');
  assert.equal(await again.closed, 4001);
  h.send({ t: 'lb' });
  const lb = await h.waitFor(m => m.t === 'lb' && m.rows.some(r => r.by === h.by));
  assert.equal(lb.rows.find(r => r.by === h.by).w, 1);
  h.ws.close();
});

test('the round starts by itself once everyone is ready; afterwards auto-ready players are ready again', async () => {
  const a = client('ready', me), b = client('ready', { li: 1 });   // b has auto-ready off
  await Promise.all([a.ready, b.ready]);
  let g = await until(a, g => g.ow === a.peer && g.pl.length === 2);
  assert.deepEqual(g.rd, [a.peer], 'auto-ready on join');
  assert.equal(g.sa, -1, 'not everyone is ready: no countdown');
  b.send({ t: 'cmd', c: 'ready', on: true });
  await until(a, g => g.sa > 0);
  b.send({ t: 'cmd', c: 'ready', on: false });
  await until(a, g => g.sa === -1);
  b.send({ t: 'cmd', c: 'ready', on: true });
  g = await until(a, g => g.ph === 'count', 5000);
  assert.equal(g.pl.length, 2);
  a.send({ t: 'cmd', c: 'lobby' });
  g = await until(b, g => g.ph === 'lobby');
  assert.deepEqual(g.rd, [a.peer], 'back in the lobby only auto-ready players are ready');
  [a, b].forEach(c => c.ws.close());
});

test('the owner can list the room publicly', async () => {
  const a = client('pubroom', me), b = client('pubroom', me);
  await Promise.all([a.ready, b.ready]);
  await until(a, g => g.ow === a.peer);
  b.send({ t: 'cmd', c: 'public', on: true });   // not the owner: ignored
  await sleep(100);
  assert.ok(!listRooms().some(r => r.id === 'pubroom'));
  a.send({ t: 'cmd', c: 'public', on: true });
  await until(b, g => g.pb === 1);
  const row = listRooms().find(r => r.id === 'pubroom');
  assert.equal(row.n, 2);
  assert.equal(row.ow, 'Ẩn danh');
  [a, b].forEach(c => c.ws.close());
});

test('co-op rounds run on the server: monsters come, the owner picks only unlocked stages', async () => {
  const a = client('coop', me), b = client('coop', { li: 1 });
  await Promise.all([a.ready, b.ready]);
  await until(a, g => g.ow === a.peer);
  a.send({ t: 'cmd', c: 'stage', n: 3 });   // not reached yet: ignored
  a.send({ t: 'cmd', c: 'mode', m: 'q' });   // not a mode: ignored
  a.send({ t: 'cmd', c: 'mode', m: 'c' });
  let g = await until(a, g => g.md === 'c');
  assert.equal(g.cs, 1);
  assert.equal(g.cu, 1);
  a.send({ t: 'cmd', c: 'mode', m: 'v' });
  a.send({ t: 'cmd', c: 'start' });
  g = await until(a, g => g.ph === 'play' && (g.mb.length > 0 || g.sw.length > 0), 8000);
  assert.equal(g.md, 'v');
  assert.equal(g.pl.length, 1, 'only the ready owner plays');
  a.send({ t: 'cmd', c: 'buy', item: 'b' });   // no break yet: nothing happens, nothing breaks
  b.send({ t: 'cmd', c: 'lobby' });            // not the owner
  await sleep(100);
  assert.equal(game(a).ph, 'play');
  [a, b].forEach(c => c.ws.close());
});

test('rooms are capped', async () => {
  const cs = Array.from({ length: LIMITS.ROOM_SIZE }, () => client('full'));
  await Promise.all(cs.map(c => c.ready));
  const extra = client('full');
  assert.equal(await extra.closed, 4002);
  cs.forEach(c => c.ws.close());
});

test('flooding closes the connection', async () => {
  const c = client('flood');
  await c.ready;
  for (let k = 0; k < LIMITS.MSG_PER_SEC + 20; k++) c.patch({ px: k });
  assert.equal(await c.closed, 1008);
});
