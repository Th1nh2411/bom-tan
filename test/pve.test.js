import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './load-engine.js';

const slots = n => Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'P' + k, color: k }));
// a co-op game in play, with the board emptied so tests decide what is where
function coop(e, mode, n = 1, opts = {}) {
  const g = e.newGame(slots(n), false, { mode, ...opts });
  g.grid = g.grid.map(c => (c === 'x' ? '.' : c));
  g.hidden = g.hidden.map(() => '');
  g.ph = 'play';
  return g;
}
const step = (e, g, secs, inputs = {}, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) e.stepGame(g, inputs, dt, {}); };
const at = (p, x, y) => { p.x = x; p.y = y; };

test('co-op modes put everyone on one team', () => {
  const e = loadEngine();
  for (const m of ['v', 'b', 'c']) {
    const g = coop(e, m, 3);
    assert.ok(g.pve && g.teams);
    assert.ok(g.players.every(p => p.team === 0));
  }
  const solo = e.newGame(slots(1), false, { mode: 'h' });
  assert.equal(solo.mode, 'b', 'a hunt with one player becomes a boss fight');
});

test('a bomb kills a monster and pays its owner; a monster touch knocks a player down', () => {
  const e = loadEngine();
  const g = coop(e, 'v', 2);
  g.brk = 99;                       // hold the waves back
  at(g.players[0], 1, 1); at(g.players[1], 9, 9);
  e.addMob(g, 'slime', e.idx(3, 1));
  g.mobs[0].wait = 99;              // stand still
  g.bombs.push({ id: ++g.bid, i: e.idx(1, 1), fx: 1, fy: 1, vx: 0, vy: 0, lock: -1, t: 0, r: 3, owner: 'p0' });
  g.players[0].inv = 5;             // survive its own bomb
  step(e, g, 0.1);
  assert.equal(g.mobs.length, 0);
  assert.equal(g.players[0].mk, 1);
  assert.equal(g.players[0].coins, e.MOB_KINDS.slime.coin);
  e.addMob(g, 'bat', e.idx(9, 9));
  g.mobs[0].wait = 99;
  step(e, g, 0.05);
  assert.ok(!g.players[1].alive && g.players[1].down > 0, 'knocked down, waiting for a rescue');
});

test('survival: waves come, the shop is open between them, and the game ends when everyone is out', () => {
  const e = loadEngine();
  const g = coop(e, 'v', 1);
  const p = g.players[0];
  step(e, g, 1.6);
  assert.equal(g.wave, 1);
  assert.ok(g.queue.length + g.spawns.length + g.mobs.length > 0);
  // clear the wave by hand: a break starts
  g.queue = []; g.spawns = []; g.mobs = [];
  step(e, g, 0.05);
  assert.ok(g.brk > 0);
  p.coins = 10;
  assert.ok(e.buyItem(g, 'p0', 'b'));
  assert.equal(p.maxB, 2);
  assert.equal(p.coins, 10 - e.SHOP.b);
  assert.ok(!e.buyItem(g, 'p0', 'h') || p.coins >= 0);
  p.alive = false; p.down = 0;
  step(e, g, 0.05);
  assert.equal(g.ph, 'end');
  assert.equal(g.winner, 'lose');
});

test('boss: takes hits from player bombs only, gets angry at half health, and the fight is won when it falls', () => {
  const e = loadEngine();
  const g = coop(e, 'b', 1);
  const b = g.boss, p = g.players[0];
  at(p, 1, 1); p.inv = 999;
  b.cd = 99; b.hp = 4; b.max = 4;
  const burn = owner => { const i = e.idx(Math.round(b.x), Math.round(b.y)); g.flames.set(i, { t: 0.5, o: new Set([owner]) }); };
  burn('@'); step(e, g, 0.02);
  assert.equal(b.hp, 4, 'its own fire does not hurt it');
  burn('p0'); step(e, g, 0.02);
  assert.equal(b.hp, 3);
  b.hitT = 0; burn('p0'); step(e, g, 0.02);
  assert.equal(b.ph, 2);
  assert.ok(g.sdOn, 'the walls close in');
  b.hitT = 0; b.hp = 1; burn('p0'); step(e, g, 0.05);
  assert.equal(g.ph, 'end');
  assert.equal(g.winner, 'win');
  assert.ok(p.dmg >= 3);
});

test('boss attacks: every move of every boss warns first, then lands', () => {
  const e = loadEngine();
  for (const kind of ['king', 'dragon', 'golem', 'wraith']) for (const move of e.BOSS_MOVES[kind]) for (const ph of [1, 2]) {
    const g = coop(e, 'b', 2, { boss: kind });
    for (const p of g.players) p.inv = 999;
    const b = g.boss;
    b.ph = ph; b.vis = true; b.visT = 99; b.cd = 99;
    const waves = e.bossMove(g, b, move, g.players);
    assert.ok(waves.length && waves.some(w => w.cells.length || w.k === 'blink'), `${kind} ${move}: nothing to do`);
    b.act = { waves };
    const before = JSON.stringify([g.bombs.length, g.mobs.length, g.grid.join(''), b.x, b.y]);
    let warned = false;
    for (let t = 0; t < 5 && b.act; t += 1 / 60) { e.stepGame(g, {}, 1 / 60, {}); if (b.act && e.snapshot(g, {}).wn.length) warned = true; }
    assert.ok(warned || move === 'blink', `${kind} ${move}: no warning`);
    const landed = g.flames.size || g.burn.size || JSON.stringify([g.bombs.length, g.mobs.length, g.grid.join(''), b.x, b.y]) !== before;
    assert.ok(landed, `${kind} ${move}: nothing landed`);
  }
});

test('campaign: the exit opens once the monsters are gone and leads to the next stage', () => {
  const e = loadEngine();
  const g = e.newGame(slots(1), false, { mode: 'c', stage: 1 });
  g.ph = 'play';
  assert.equal(g.stage, 1);
  assert.ok(g.mobs.length >= 3);
  assert.ok(g.exit >= 0 && g.grid[g.exit] === 'x', 'the exit hides under a box');
  g.grid[g.exit] = '.';
  const p = g.players[0];
  at(p, g.exit % e.W, (g.exit / e.W) | 0);
  p.inv = 999;
  step(e, g, 0.05);
  assert.equal(g.stage, 1, 'closed while monsters are left');
  g.mobs = [];
  const rid = g.rid;
  step(e, g, 0.05);
  assert.ok(g.clearT > 0);
  step(e, g, 3.1);
  assert.equal(g.stage, 2);
  assert.notEqual(g.rid, rid);
  assert.ok(g.mobs.length >= 5);
  // stage 5 is a boss
  const g5 = e.newGame(slots(2), false, { mode: 'c', stage: 5 });
  assert.equal(g5.boss.k, 'king');
});

test('boss hunt: the boss player has several lives, summons slimes, and loses when out of lives', () => {
  const e = loadEngine();
  const g = coop(e, 'h', 3);
  const boss = g.players.find(p => p.boss), hunter = g.players.find(p => !p.boss);
  assert.equal(boss.team, 1);
  assert.equal(boss.hp, 2 + 2 * 2);
  boss.skT = 0;
  step(e, g, 0.02, { [boss.id]: { sk: 0 } });
  step(e, g, 0.02, { [boss.id]: { sk: 1 } });
  assert.ok(g.mobs.length >= 1 && g.mobs.every(m => m.team === 1));
  g.mobs = [];
  for (let k = boss.hp; k > 0; k--) {
    boss.inv = 0;
    g.flames.set(e.idx(Math.round(boss.x), Math.round(boss.y)), { t: 0.5, o: new Set([hunter.id]) });
    step(e, g, 0.02);
  }
  step(e, g, 0.05);
  assert.equal(g.winner, 'hunters');
});

const near = (e, g, p) => {
  let d = 1e9;
  for (const m of g.mobs) d = Math.min(d, Math.abs(m.x - p.x) + Math.abs(m.y - p.y));
  if (g.boss) d = Math.min(d, Math.max(0, Math.abs(g.boss.x - p.x) - 1) + Math.max(0, Math.abs(g.boss.y - p.y) - 1));
  return d;
};

test('nobody starts on top of a monster or a boss', () => {
  const e = loadEngine();
  for (let k = 0; k < 60; k++) {
    const n = 1 + (k % 4);
    const b = e.newGame(slots(n), false, { mode: 'b' });
    for (const p of b.players) assert.ok(near(e, b, p) >= 3, `boss fight: ${n} players, boss ${near(e, b, p)} steps away`);
    const c = e.newGame(slots(n), false, { mode: 'c', stage: 1 + (k % 10) });
    for (const p of c.players) assert.ok(near(e, c, p) >= 3, `campaign stage ${c.stage}: a monster ${near(e, c, p)} steps away`);
  }
});

test('players come back away from monsters, and monsters do not appear on a player', () => {
  const e = loadEngine();
  for (let k = 0; k < 30; k++) {
    const g = coop(e, 'v', 2);
    g.brk = 99;
    // monsters everywhere on the left half
    for (let y = 1; y < e.H - 1; y += 2) for (let x = 1; x < e.W / 2; x += 2) { e.addMob(g, 'slime', e.idx(x, y)); g.mobs[g.mobs.length - 1].wait = 99; }
    const [a, b] = g.players;
    a.alive = false; a.down = 0;
    b.x = e.W - 2; b.y = e.H - 2; b.inv = 99;
    e.respawnDead(g);
    assert.ok(a.alive);
    assert.ok(near(e, g, a) >= 3, `came back ${near(e, g, a)} steps from a monster`);
  }
  // a player standing on a spawn warning when it runs out: the monster appears elsewhere
  const g = coop(e, 'v', 1);
  g.brk = 99;
  const p = g.players[0];
  p.inv = 99;
  g.spawns = [{ k: 'slime', i: e.idx(Math.round(p.x), Math.round(p.y)), t: 0.01 }];
  step(e, g, 0.05);
  assert.ok(g.mobs.every(m => Math.abs(m.x - p.x) + Math.abs(m.y - p.y) >= 3));
  step(e, g, 1.2);
  assert.equal(g.mobs.length, 1);
  assert.ok(near(e, g, p) >= 3);
});

test('monster boards stay open: few boxes, and they do not pile up between waves', () => {
  const e = loadEngine();
  const share = g => g.grid.filter(c => c === 'x').length / g.grid.filter(c => c !== '#').length;
  for (let k = 1; k <= 10; k++) assert.ok(share(e.newGame(slots(2), false, { mode: 'c', stage: k })) <= 0.35, 'stage ' + k);
  const g = coop(e, 'v', 1);
  g.players[0].inv = 1e9;
  for (let w = 0; w < 30; w++) {   // 30 breaks in a row
    g.queue = []; g.spawns = []; g.mobs = []; g.brk = 0;
    step(e, g, 0.02);
  }
  assert.ok(share(g) <= 0.27, 'box share after 30 waves: ' + share(g).toFixed(2));
});

test('every map keeps the board in one piece, the portals open and room to spawn', () => {
  const e = loadEngine();
  for (const map of ['classic', 'open', 'cross', 'rooms', 'fort']) for (const n of [1, 3, 5, 8]) {
    const g = e.newGame(slots(n), false, { map });
    assert.equal(g.map, map);
    const open = i => g.grid[i] !== '#';
    for (const c of e.PORTALS.flat()) assert.ok(open(c), `${map}: portal on a wall`);
    for (const p of g.players) assert.ok(open(e.idx(p.x, p.y)), `${map}: spawn on a wall`);
    // flood fill from the first player over everything that is not a wall (boxes can be blown up)
    const start = e.idx(g.players[0].x, g.players[0].y), seen = new Set([start]), q = [start];
    for (let h = 0; h < q.length; h++) for (const d of [1, -1, e.W, -e.W]) { const nb = q[h] + d; if (open(nb) && !seen.has(nb)) { seen.add(nb); q.push(nb); } }
    assert.equal(seen.size, g.grid.filter(c => c !== '#').length, `${map} with ${n} players: cut in pieces`);
  }
  const r = e.newGame(slots(2), false, { map: 'random' });
  assert.ok(['classic', 'open', 'cross', 'rooms', 'fort'].includes(r.map));
  assert.equal(e.newGame(slots(2), false).map, 'classic', 'no map asked: the classic board');
  // campaign stages use their own maps
  const c = e.newGame(slots(2), false, { mode: 'c', stage: 4 });
  assert.equal(c.map, 'rooms');
});

test('the boss walks around walls and breaks the boxes it walks into', () => {
  const e = loadEngine();
  for (let k = 0; k < 20; k++) {
    const g = e.newGame(slots(2), false, { mode: 'b', map: ['classic', 'rooms', 'fort'][k % 3] });
    g.ph = 'play';
    const b = g.boss;
    b.cd = 1e9;
    for (const p of g.players) p.inv = 1e9;
    assert.notEqual(g.grid[e.idx(b.x, b.y)], '#', 'starts on an open cell');
    for (let t = 0; t < 8; t += 1 / 60) {
      e.stepGame(g, {}, 1 / 60, {});
      if (!g.boss) break;
      const c = e.idx(Math.round(b.x), Math.round(b.y)), d = e.idx(b.tx, b.ty);
      assert.notEqual(g.grid[c], '#', `inside a wall at ${b.x},${b.y}`);
      assert.notEqual(g.grid[d], '#');
      assert.notEqual(g.grid[d], 'x', 'a box it walks into breaks first');
    }
  }
});
