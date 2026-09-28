import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attach, LIMITS } from '../server/relay.js';

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

test('only the first host claim wins; a second claim is refused', async () => {
  const a = client('host1'), b = client('host1'), v = client('host1');
  await Promise.all([a.ready, b.ready, v.ready]);
  a.patch({ h: 1, g: { rid: 1 }, gg: '#' });
  await v.waitFor(m => m.t === 'p' && m.peer === a.peer && m.p.h === 1);
  b.patch({ h: 1, g: { rid: 2 }, gg: '#', n: 'B' });
  await b.waitFor(m => m.t === 'deny' && m.what === 'host');
  const fromB = await v.waitFor(m => m.t === 'p' && m.peer === b.peer);
  assert.deepEqual(fromB.p, { n: 'B' }, 'host keys stripped, the rest still relayed');
  [a, b, v].forEach(c => c.ws.close());
});

test('a host that reconnects gets its room back', async () => {
  const a = client('host2', {}, 'H'), v = client('host2');
  await Promise.all([a.ready, v.ready]);
  a.patch({ h: 1, g: { rid: 1 }, gg: '#' });
  await v.waitFor(m => m.t === 'p' && m.p.h === 1);
  a.ws.close(); await a.closed;
  const a2 = client('host2', { h: 1, g: { rid: 1 }, gg: '#' }, 'H');
  await a2.ready;
  await sleep(100);
  assert.ok(!a2.msgs.some(m => m.t === 'deny'), 'no deny for the returning host');
  [a2, v].forEach(c => c.ws.close());
});

test('controls go to the host only; everything else to everyone', async () => {
  const h = client('route'), g1 = client('route'), g2 = client('route');
  await Promise.all([h.ready, g1.ready, g2.ready]);
  h.patch({ h: 1, g: { rid: 1 }, gg: '#' });
  await g1.waitFor(m => m.t === 'p' && m.p.h === 1);
  g1.patch({ dx: 1, px: 300 });
  g1.patch({ em: [0, 1] });
  await h.waitFor(m => m.t === 'p' && m.peer === g1.peer && m.p.dx === 1);
  await g2.waitFor(m => m.t === 'p' && m.peer === g1.peer && m.p.em);
  assert.ok(!g2.msgs.some(m => m.t === 'p' && m.peer === g1.peer && 'dx' in m.p), 'other guests do not get controls');
  [h, g1, g2].forEach(c => c.ws.close());
});

test('kicked players are disconnected and cannot rejoin while that host runs the room', async () => {
  const h = client('kick'), b = client('kick', {}, 'K');
  await Promise.all([h.ready, b.ready]);
  h.patch({ h: 1, g: { rid: 1 }, gg: '#' });
  await b.waitFor(m => m.t === 'p' && m.p.h === 1);
  h.patch({ g: { rid: 1, kk: [b.by] } });
  assert.equal(await b.closed, 4001);
  const again = client('kick', {}, 'K');
  assert.equal(await again.closed, 4001);
  h.ws.close();
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

test('only the host can record leaderboard rounds', async () => {
  const h = client('lb'), g = client('lb');
  await Promise.all([h.ready, g.ready]);
  h.patch({ h: 1, g: { rid: 1 }, gg: '#' });
  await g.waitFor(m => m.t === 'p' && m.p.h === 1);
  g.send({ t: 'lbrec', rows: [{ by: 'cheater1', n: 'Cheat', w: 20, g: 1 }] });
  h.send({ t: 'lbrec', rows: [{ by: 'honest1', n: 'Honest', w: 1, g: 1 }] });
  const lb = await h.waitFor(m => m.t === 'lb' && m.rows.some(r => r.by === 'honest1'));
  assert.ok(!lb.rows.some(r => r.by === 'cheater1'));
  [h, g].forEach(c => c.ws.close());
});
