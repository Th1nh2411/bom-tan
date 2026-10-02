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

test('boss attacks warn first, then land', () => {
  const e = loadEngine();
  for (const kind of ['king', 'dragon', 'golem', 'wraith']) {
    const g = coop(e, 'b', 1, { boss: kind });
    const p = g.players[0];
    p.inv = 999;
    g.boss.cd = 0; g.boss.vis = true; g.boss.visT = 99;
    step(e, g, 0.02);
    assert.ok(g.boss.act && g.boss.act.cells.length, kind + ' warns');
    assert.deepEqual(e.snapshot(g, {}).wn, g.boss.act.cells);
    step(e, g, 1.1);
    assert.ok(g.bombs.some(o => o.owner === '@') || g.flames.size || g.burn.size || g.mobs.length, kind + ' lands');
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
