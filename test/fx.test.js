import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, openGame, run } from './load-engine.js';

// a bomb that goes off right now at (x, y)
function boom(e, g, x, y, r, extra = {}) {
  const b = { id: ++g.bid, i: e.idx(x, y), fx: x, fy: y, vx: 0, vy: 0, lock: -1, t: 0, r, owner: 'x', ...extra };
  g.bombs.push(b);
  e.stepGame(g, {}, 1 / 60, {});
  return g;
}
const burning = (e, g, x, y) => g.flames.has(e.idx(x, y));

test('blast shapes: plus, diagonal, square and pierce', () => {
  const e = loadEngine();
  let g = openGame(e); g.players.forEach(p => { p.x = 1; p.y = 1; p.inv = 99; });
  boom(e, g, 5, 5, 2, { sh: 'diag' });
  assert.ok(burning(e, g, 7, 7) && burning(e, g, 3, 3), 'diagonal cells burn, over the pillars');
  assert.ok(!burning(e, g, 6, 5) && !burning(e, g, 5, 6), 'straight cells do not');
  g = openGame(e); g.players.forEach(p => { p.x = 1; p.y = 1; p.inv = 99; });
  boom(e, g, 5, 5, 2, { sh: 'square' });
  for (const [dx, dy] of [[-1, -1], [1, 1], [-1, 1], [1, 0]]) assert.ok(burning(e, g, 5 + dx, 5 + dy) || g.grid[e.idx(5 + dx, 5 + dy)] === '#');
  assert.ok(!burning(e, g, 7, 5), 'range 2: a 3x3 square');
  g = openGame(e); g.players.forEach(p => { p.x = 1; p.y = 1; p.inv = 99; });
  g.grid[e.idx(6, 5)] = 'x'; g.grid[e.idx(7, 5)] = 'x';
  boom(e, g, 5, 5, 3, { sh: 'pierce' });
  assert.equal(g.grid[e.idx(6, 5)], 'X'); assert.equal(g.grid[e.idx(7, 5)], 'X');
  assert.ok(burning(e, g, 8, 5), 'pierce goes on through the boxes');
});

test('shape items: picking one changes your bombs, dying drops it', () => {
  const e = loadEngine();
  const g = openGame(e);
  const p = g.players[0];
  p.x = 3; p.y = 3;
  g.grid[e.idx(3, 3)] = 'd';
  e.stepGame(g, {}, 1 / 60, {});
  assert.equal(p.shape, 'diag');
  e.stepGame(g, { p0: { dx: 0, dy: 0, b: 1 } }, 1 / 60, {});
  e.stepGame(g, { p0: { dx: 0, dy: 0, b: 2 } }, 1 / 60, {});
  assert.equal(g.bombs[0].sh, 'diag');
  assert.equal(e.snapshot(g, {}).pl[0][23], 1);
});

test('events: a warning, then the event, then back to normal; max range and ice', () => {
  const e = loadEngine();
  const g = e.newGame([{ id: 'a', name: 'A', color: 0 }, { id: 'b', name: 'B', color: 1 }], false, { events: true });
  g.ph = 'play'; g.players.forEach(p => { p.inv = 1e9; });
  g.evNext = 0.01;
  e.stepGame(g, {}, 1 / 60, {});
  e.stepGame(g, {}, 1 / 60, {});
  assert.ok(g.evWarn && e.EVENTS[g.evWarn]);
  assert.equal(e.snapshot(g, {}).ew, g.evWarn);
  run(e, g, 3.1);
  assert.ok(g.ev);
  run(e, g, 10.1);
  assert.equal(g.ev, null);
  // max: full range whatever the bomb's own range
  g.grid = g.grid.map(c => (c === 'x' ? '.' : c));
  g.ev = 'max'; g.evT = 99;
  boom(e, g, 1, 1, 1);
  assert.ok(burning(e, g, 1, 1 + 4) || burning(e, g, 1 + 4, 1), 'reaches far');
  // ice: let go of the key and keep sliding until a wall
  g.ev = 'ice';
  const p = g.players[0];
  p.x = 1; p.y = 1; p.pass = [];
  g.bombs = [];
  e.stepGame(g, { a: { dx: 1, dy: 0, b: 0 } }, 1 / 60, {});
  for (let k = 0; k < 300; k++) e.stepGame(g, { a: { dx: 0, dy: 0, b: 0 } }, 1 / 60, {});
  assert.ok(p.x >= e.W - 3, 'slid across: ' + p.x);
  const off = e.newGame([{ id: 'a', name: 'A', color: 0 }], false, {});
  assert.equal(off.events, false, 'events are opt-in');
});
