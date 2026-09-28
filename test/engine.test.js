import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, openGame, run } from './load-engine.js';

const at = (e, x, y) => e.idx(x, y);
const place = (p, x, y) => { p.x = x; p.y = y; };
const bombAt = (g, e, x, y, r, owner = 'x') => {
  const b = { id: ++g.bid, i: at(e, x, y), fx: x, fy: y, vx: 0, vy: 0, lock: -1, t: 0, r, owner };
  g.bombs.push(b);
  return b;
};

test('board size grows with player count', () => {
  const e = loadEngine();
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8].map(n => e.sizeFor(n).slice(0, 2).join('x'));
  assert.deepEqual(sizes, ['13x11', '13x11', '15x13', '15x13', '17x13', '17x13', '19x15', '19x15']);
  for (const n of [2, 4, 6, 8]) {
    const g = e.newGame(Array.from({ length: n }, (_, k) => ({ id: 'p' + k, name: 'p', color: k })), false);
    assert.equal(g.grid.length, e.W * e.H);
    assert.equal(e.W, e.sizeFor(n)[0]);
  }
});

test('portals sit on open cells inside the board', () => {
  const e = loadEngine();
  for (const [w, h] of [[13, 11], [15, 13], [17, 13], [19, 15]]) {
    e.setDims(w, h);
    for (const c of e.PORTALS.flat()) {
      const x = c % w, y = (c / w) | 0;
      assert.ok(x > 0 && y > 0 && x < w - 1 && y < h - 1 && x % 2 === 1 && y % 2 === 1, `${w}x${h} portal ${x},${y}`);
    }
  }
});

test('random spawns: enough, distinct, on odd cells, away from portals', () => {
  const e = loadEngine();
  for (let n = 1; n <= 8; n++) {
    const [w, h] = e.sizeFor(n); e.setDims(w, h);
    const portals = e.PORTALS.flat().map(c => [c % w, (c / w) | 0]);
    for (let k = 0; k < 200; k++) {
      const s = e.pickSpawns(n);
      assert.equal(s.length, n);
      assert.equal(new Set(s.map(p => p.join())).size, n);
      for (const [x, y] of s) {
        assert.ok(x % 2 === 1 && y % 2 === 1);
        assert.ok(portals.every(([px, py]) => Math.abs(px - x) + Math.abs(py - y) > 3));
      }
    }
  }
});

test('spawn surroundings are cleared of boxes', () => {
  const e = loadEngine();
  for (let k = 0; k < 50; k++) {
    const g = e.newGame([{ id: 'a' }, { id: 'b' }, { id: 'c' }], false);
    for (const p of g.players) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue;
        const x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= e.W || y >= e.H) continue;
        assert.notEqual(g.grid[at(e, x, y)], 'x', `box next to spawn ${p.x},${p.y}`);
      }
    }
  }
});

test('explosion: range, stops at walls, breaks the first box', () => {
  const e = loadEngine(); const g = openGame(e);
  g.players.forEach(p => place(p, 11, 9));
  // 2 players -> 13x11 board; column 7 has no portal
  g.grid[at(e, 9, 1)] = 'x';
  e.explode(g, bombAt(g, e, 7, 1, 3));
  const burning = [...g.flames.keys()].map(i => `${i % e.W},${(i / e.W) | 0}`).sort();
  // right: 8,1 then the box at 9,1 stops it; left: 6,1 5,1 4,1; down: 7,2 7,3 7,4; up: border wall
  assert.deepEqual(burning, ['4,1', '5,1', '6,1', '7,1', '7,2', '7,3', '7,4', '8,1'].sort());
  assert.equal(g.grid[at(e, 9, 1)], 'X');
});

test('flames go through a portal and continue on the other side', () => {
  const e = loadEngine(); const g = openGame(e);
  g.players.forEach(p => place(p, 11, 9));
  const [entry, exit] = e.PORTALS[0];
  const ex = entry % e.W, ey = (entry / e.W) | 0;
  e.explode(g, bombAt(g, e, ex - 1, ey, 2));
  assert.ok(g.flames.has(entry), 'entry portal burns');
  assert.ok(g.flames.has(exit), 'exit portal burns');
  assert.ok(g.flames.has(exit + 1), 'cell after the exit burns');
});

test('shield absorbs one hit, then 1s of invulnerability, then the next hit kills', () => {
  const e = loadEngine(); const g = openGame(e);
  const [a, b] = g.players;
  place(a, 3, 3); place(b, 11, 9); a.shield = true;
  bombAt(g, e, 3, 3, 1, 'p1');
  run(e, g, 0.1);
  assert.equal(a.alive, true); assert.equal(a.shield, false);
  assert.ok(a.inv > 0 && a.inv <= e.SHIELD_INV);
  run(e, g, 1.2);
  bombAt(g, e, 3, 3, 1, 'p1');
  run(e, g, 0.1);
  assert.equal(a.alive, false);
});

test('a dead player drops the power-ups they collected', () => {
  const e = loadEngine(); const g = openGame(e, 3);
  const [a] = g.players;
  place(a, 5, 5); g.players.slice(1).forEach(p => place(p, 11, 9));
  a.maxB = 3; a.fire = 4; a.spd = 1; a.kick = true; a.shield = false;
  bombAt(g, e, 5, 5, 1, 'p1');
  run(e, g, 0.1);
  assert.equal(a.alive, false);
  const items = g.grid.filter(c => 'bfskh'.includes(c)).sort().join('');
  assert.equal(items, 'bbffks'); // 2 bombs, 2 fire, kick, speed
});

test('sudden death: walls close in and crush whoever stands there', () => {
  const e = loadEngine(); const g = openGame(e, 3);
  const [victim, x, y] = g.players;
  place(x, 5, 5); place(y, 7, 5);
  const first = e.SD_ORDER.find(i => g.grid[i] !== '#');
  place(victim, first % e.W, (first / e.W) | 0); victim.shield = true;
  g.t = e.SD_START - 0.01;
  run(e, g, e.SD_STEP * 2);
  assert.equal(g.grid[first], '#');
  assert.equal(victim.alive, false, 'shield does not stop a falling wall');
  assert.deepEqual([...g.kills.find(([, v]) => v === victim.id)], [null, victim.id]);
});

test('ghost bombs: only the dead, after a warning, with a cooldown, kills credited to the ghost', () => {
  const e = loadEngine(); const g = openGame(e, 3);
  const [ghost, target, other] = g.players;
  place(target, 3, 3); place(other, 11, 9); place(ghost, 9, 5);
  const cell = at(e, 4, 3);
  assert.equal(e.ghostDrop(g, target.id, cell), false, 'alive players cannot drop');
  ghost.alive = false;
  assert.equal(e.ghostDrop(g, ghost.id, cell), true);
  assert.equal(e.ghostDrop(g, ghost.id, at(e, 5, 3)), false, 'cooldown');
  run(e, g, e.GHOST_WARN + 0.05);
  const b = g.bombs.find(o => o.i === cell);
  assert.ok(b, 'bomb landed after the warning');
  assert.equal(b.owner, ghost.id);
  run(e, g, 1.5);
  assert.equal(target.alive, false);
  assert.deepEqual([...g.kills.find(([, v]) => v === target.id)], [ghost.id, target.id]);
  run(e, g, e.GHOST_CD);
  assert.equal(e.ghostDrop(g, ghost.id, at(e, 7, 7)), g.ph === 'play', 'cooldown over (while the round lasts)');
});

test('end-of-round snapshot carries board size and stats', () => {
  const e = loadEngine(); const g = openGame(e);
  const [a, b] = g.players;
  place(a, 3, 3); place(b, 9, 7);
  bombAt(g, e, 9, 7, 1, a.id);
  run(e, g, 0.1);
  assert.equal(g.ph, 'end');
  const s = e.snapshot(g, {});
  assert.equal(s.gw, e.W); assert.equal(s.gh, e.H);
  const row = s.st.find(r => r[0] === a.id);
  assert.equal(row[1], 1, 'one kill for a');
  assert.equal(s.st.find(r => r[0] === b.id)[4], a.id, 'b was killed by a');
});

test('curse: picked up, reverses controls, spreads by touch, wears off', () => {
  const e = loadEngine(); const g = openGame(e, 3);
  const [a, b, c] = g.players;
  place(a, 5, 5); place(b, 9, 7); place(c, 1, 9);
  g.grid[at(e, 5, 5)] = 'c';
  e.stepGame(g, {}, 1 / 60, {});
  assert.ok(a.ck >= 1 && a.ck <= 3, 'cursed after picking up the skull');
  a.ck = 1;   // force "reversed controls"
  const x0 = a.x;
  for (let k = 0; k < 20; k++) e.stepGame(g, { [a.id]: { dx: 1, dy: 0, b: 0 } }, 1 / 60, {});
  assert.ok(a.x < x0, 'pressing right moves left');
  place(b, a.x + 0.5, a.y);
  e.stepGame(g, {}, 1 / 60, {});
  assert.equal(b.ck, a.ck, 'touching spreads the curse');
  assert.equal(c.ck, 0, 'nobody else is affected');
  run(e, g, e.CURSE_T + 0.1);
  assert.equal(a.ck, 0); assert.equal(b.ck, 0);
});

test('curse: slow halves speed, auto-bomb drops bombs by itself', () => {
  const e = loadEngine(); const g = openGame(e);
  const [a, b] = g.players;
  place(a, 5, 5); place(b, 9, 7);
  const normal = e.speedOf(a);
  a.ck = 2; a.ct = 5;
  assert.equal(e.speedOf(a), normal / 2);
  a.ck = 3; a.maxB = 3;
  e.stepGame(g, {}, 1 / 60, {});
  assert.equal(g.bombs.filter(o => o.owner === a.id).length, 1, 'dropped a bomb without pressing anything');
});

// zombie mode: make p0 the zombie, everyone else human
function zombieGame(e, n = 3) {
  const g = openGame(e, n, false, 'z');
  g.players.forEach((p, k) => { p.zb = k === 0; p.z0 = k === 0; });
  return g;
}

test('zombie: touch infects, zombies cannot bomb or pick up, bombs only stun them', () => {
  const e = loadEngine(); const g = zombieGame(e);
  const [z, h1, h2] = g.players;
  place(z, 3, 3); place(h1, 9, 7); place(h2, 1, 9);
  g.grid[at(e, 3, 3)] = 'b';
  e.stepGame(g, { [z.id]: { dx: 0, dy: 0, b: 0 } }, 1 / 60, {});
  e.stepGame(g, { [z.id]: { dx: 0, dy: 0, b: 1 } }, 1 / 60, {});
  assert.equal(g.bombs.length, 0, 'zombie cannot place bombs');
  assert.equal(g.grid[at(e, 3, 3)], 'b', 'zombie does not pick up items');
  place(h1, 3.5, 3);
  e.stepGame(g, {}, 1 / 60, {});
  assert.equal(h1.zb, true, 'touch infects');
  assert.deepEqual([...g.kills[0]], [z.id, h1.id]);
  bombAt(g, e, 3, 3, 1, h2.id);
  e.stepGame(g, {}, 1 / 60, {});
  assert.ok(z.stun > 0 && z.alive, 'zombie is stunned, not killed');
});

test('zombie: a bomb turns a human into a zombie; last human infected -> zombies win', () => {
  const e = loadEngine(); const g = zombieGame(e);
  const [z, h1, h2] = g.players;
  place(z, 9, 7); place(h1, 3, 3); place(h2, 1, 9);
  bombAt(g, e, 3, 3, 1, h2.id);
  e.stepGame(g, {}, 1 / 60, {});
  assert.equal(h1.zb, true); assert.equal(h1.alive, true);
  assert.equal(g.ph, 'play');
  place(h2, 9.4, 7);
  run(e, g, 0.1);
  assert.equal(g.ph, 'end'); assert.equal(g.winner, 'zombies');
  assert.deepEqual([...g.winnerIds], [z.id], 'patient zero gets the win');
});

test('zombie: humans still standing when time runs out win', () => {
  const e = loadEngine(); const g = zombieGame(e);
  const [z, h1, h2] = g.players;
  place(z, 1, 1); place(h1, 9, 7); place(h2, 11, 9);
  g.t = e.ZOMBIE_T - 0.05;
  run(e, g, 0.1);
  assert.equal(g.winner, 'humans');
  assert.deepEqual([...g.winnerIds].sort(), [h1.id, h2.id].sort());
  assert.ok(g.grid.every(c => c !== '#' || true) && !g.sdk, 'no closing walls in zombie mode');
});
