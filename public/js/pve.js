/* ================= PVE: monsters, bosses, waves, campaign, boss hunt =================
   Loaded right after engine.js and shares its globals (W, H, idx, DIRS, addFlame...). The server runs it;
   browsers only draw what pveSnapshot() puts in the snapshot.
   Modes: 'v' survival waves, 'b' boss fight, 'c' campaign (10 stages), 'h' boss hunt (one player is the boss).
   In the co-op modes every player is on team 0 (the engine's team rules: no friendly fire, downed teammates
   can be rescued); monsters are team 1. */

const MOB_KINDS = {
  slime: { code: 0, sp: 1.5, hp: 1, coin: 1, brain: 'wander' },              // wanders around
  bat:   { code: 1, sp: 2.1, hp: 1, coin: 2, brain: 'chase' },               // hunts the nearest player
  ghost: { code: 2, sp: 1.3, hp: 1, coin: 2, brain: 'chase', phase: true },  // floats through boxes
  imp:   { code: 3, sp: 2.3, hp: 1, coin: 3, brain: 'smart' },               // hunts, and gets out of blast lines
  tank:  { code: 4, sp: 1.1, hp: 3, coin: 4, brain: 'chase' },               // slow, takes 3 hits
};
const BOSS_KINDS = ['king', 'dragon', 'golem', 'wraith'];
const BOSS_NAMES = { king: 'Vua Bom', dragon: 'Rồng Lửa', golem: 'Người Đá', wraith: 'Hồn Ma' };
const BOSS_CD = { king: 4.5, dragon: 3.5, golem: 5, wraith: 3 };   // seconds between attacks (x0.65 when enraged)
const SHOP = { b: 3, f: 3, s: 2, k: 4, h: 5 };                     // survival shop prices, in coins
const WAVE_BREAK = 8, HUNT_T = 120, MOB_HIT_CD = 0.6, BOSS_HIT_CD = 0.7, STAGE_CLEAR_T = 3, SKILL_CD = 10;
// campaign: mob counts are for one player and grow with the party
const STAGES = [
  { boxes: .55, mobs: { slime: 3 } },
  { boxes: .55, mobs: { slime: 4, bat: 1 } },
  { boxes: .5, mobs: { slime: 2, bat: 2, ghost: 1 } },
  { boxes: .5, mobs: { bat: 3, ghost: 2 } },
  { boxes: .2, boss: 'king' },
  { boxes: .5, mobs: { imp: 2, bat: 2, slime: 2 } },
  { boxes: .45, mobs: { tank: 2, ghost: 2, imp: 1 } },
  { boxes: .45, mobs: { imp: 3, tank: 2, bat: 1 } },
  { boxes: .4, mobs: { slime: 2, bat: 2, ghost: 2, imp: 2, tank: 2 } },
  { boxes: .2, boss: 'dragon' },
];

const pick = a => a[Math.floor(Math.random() * a.length)];
const cellOf = o => idx(Math.round(o.x), Math.round(o.y));

/* ---------- setup ---------- */
function setupPve(g, opts) {
  g.pve = true; g.mobs = []; g.mid = 0; g.spawns = []; g.queue = []; g.banner = null; g.boss = null; g.exit = -1;
  if (g.mode === 'h' && g.players.length < 2) g.mode = 'b';   // a hunt needs hunters
  g.teams = true;
  for (const p of g.players) { p.team = 0; p.coins = 0; p.mk = 0; p.dmg = 0; }
  const n = g.players.length;
  if (g.mode === 'v') { layBoxes(g, .45); g.wave = 0; g.brk = 1.5; }
  else if (g.mode === 'b') {
    layBoxes(g, .2);
    for (const p of g.players) { p.fire = Math.max(p.fire, 3); p.maxB = Math.max(p.maxB, 2); }
    spawnBoss(g, BOSS_KINDS.includes(opts.boss) ? opts.boss : pick(BOSS_KINDS), 8 + 4 * n);
  } else if (g.mode === 'c') { g.stage = Math.min(STAGES.length, Math.max(1, opts.stage | 0 || 1)); g.stars = 0; fillStage(g); }
  else if (g.mode === 'h') setupHunt(g);
}

// rebuild the breakable boxes (and what hides under them), keeping spawns and portals clear
function layBoxes(g, density) {
  const portals = PORTALS.flat();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y);
    if (g.grid[i] === '#') continue;
    g.grid[i] = '.'; g.hidden[i] = '';
    const near = g.players.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) <= 2) ||
      portals.some(c => Math.abs(c % W - x) + Math.abs(((c / W) | 0) - y) <= 1);
    if (near || Math.random() >= density) continue;
    g.grid[i] = 'x';
    if (Math.random() < 0.3) { const r = Math.random(); g.hidden[i] = r < .3 ? 'b' : r < .6 ? 'f' : r < .75 ? 's' : r < .87 ? 'k' : 'h'; }
  }
}

// a random free floor cell at least minD steps from every living player (-1: none)
function freeCell(g, minD) {
  const portals = new Set(PORTALS.flat()), cand = [];
  for (let i = 0; i < W * H; i++) {
    if (g.grid[i] !== '.' || portals.has(i) || g.bombs.some(b => b.i === i) || g.mobs.some(m => cellOf(m) === i)) continue;
    const x = i % W, y = (i / W) | 0;
    if (g.players.every(p => !p.alive || Math.abs(p.x - x) + Math.abs(p.y - y) >= minD)) cand.push(i);
  }
  if (cand.length) return pick(cand);
  return minD > 0 ? freeCell(g, minD - 2) : -1;
}
function nearestFloor(g, x, y) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < W * H; i++) {
    if (g.grid[i] !== '.') continue;
    const d = Math.hypot(i % W - x, ((i / W) | 0) - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* ---------- monsters ---------- */
function addMob(g, k, i, team = 1) {
  const x = i % W, y = (i / W) | 0;
  g.mobs.push({ id: ++g.mid, k, x, y, tx: x, ty: y, hp: MOB_KINDS[k].hp, hitT: 0, dir: 2, wait: 0, team });
}
function mobPass(g, i, m) {
  const c = g.grid[i];
  if (c === '#' || c === 'X') return false;
  if (c === 'x' && !MOB_KINDS[m.k].phase) return false;
  return !g.bombs.some(b => b.i === i);
}
// first step from start toward the nearest cell where goal(cell) holds (-1: unreachable)
function bfsStep(g, m, start, goal, avoid) {
  const prev = new Int16Array(W * H).fill(-1);
  prev[start] = start;
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c !== start && goal(c)) { let s = c; while (prev[s] !== start) s = prev[s]; return s; }
    for (const [dx, dy] of DIRS) {
      const n = c + dx + dy * W;
      if (prev[n] !== -1 || !mobPass(g, n, m) || (avoid && avoid.has(n))) continue;
      prev[n] = c; q.push(n);
    }
  }
  return -1;
}
// cells about to burn: flames, boss warnings and the blast lines of every bomb (worked out once a tick)
function danger(g) {
  if (g._danger) return g._danger;
  const d = new Set(g.flames.keys());
  if (g.boss && g.boss.act) for (const i of g.boss.act.cells) d.add(i);
  for (const b of g.bombs) {
    d.add(b.i);
    for (const [dx, dy] of DIRS) {
      let x = b.i % W, y = (b.i / W) | 0;
      for (let r = 1; r <= b.r; r++) {
        x += dx; y += dy;
        const c = g.grid[idx(x, y)];
        if (c === undefined || c === '#' || c === 'x' || c === 'X') break;
        d.add(idx(x, y));
      }
    }
  }
  return (g._danger = d);
}
function preyCells(g, m) { return new Set(g.players.filter(p => p.alive && p.team !== m.team).map(cellOf)); }
// the next cell for a monster that just reached the centre of a cell
function think(g, m) {
  const K = MOB_KINDS[m.k], here = cellOf(m);
  const open = DIRS.map(([dx, dy]) => here + dx + dy * W).filter(i => mobPass(g, i, m));
  if (!open.length) return -1;
  if (K.brain === 'smart') {
    const d = danger(g);
    if (d.has(here)) { const s = bfsStep(g, m, here, i => !d.has(i)); if (s >= 0) return s; }
    const prey = preyCells(g, m), s = bfsStep(g, m, here, i => prey.has(i), d);
    if (s >= 0) return s;
    const safe = open.filter(i => !d.has(i));
    return safe.length ? pick(safe) : -1;   // wait rather than walk into a blast
  }
  if (K.brain === 'chase') {
    const prey = preyCells(g, m), s = bfsStep(g, m, here, i => prey.has(i));
    if (s >= 0) return s;
  }
  const ahead = here + [0, 1, 0, -1][m.dir] + [-1, 0, 1, 0][m.dir] * W;
  if (open.includes(ahead) && Math.random() < 0.75) return ahead;
  return pick(open);
}
function stepMob(g, m, dt) {
  if (m.hitT > 0) m.hitT -= dt;
  if (m.wait > 0) { m.wait -= dt; return; }
  let step = MOB_KINDS[m.k].sp * dt, guard = 0;
  while (step > 1e-6 && guard++ < 4) {
    const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.abs(dx) + Math.abs(dy);
    if (d > 1e-6) {
      const s = Math.min(step, d);
      if (dx) m.x += Math.sign(dx) * s; else m.y += Math.sign(dy) * s;
      if (Math.abs(m.tx - m.x) < 1e-6) m.x = m.tx;
      if (Math.abs(m.ty - m.y) < 1e-6) m.y = m.ty;
      step -= s;
      continue;
    }
    const next = think(g, m);
    if (next < 0) { m.wait = 0.25; return; }
    m.tx = next % W; m.ty = (next / W) | 0;
    m.dir = m.tx > m.x ? 1 : m.tx < m.x ? 3 : m.ty > m.y ? 2 : 0;
  }
}
// the player behind a flame (bosses' own fire has no player behind it)
function flameOwner(g, f) {
  for (const o of f.o) { const p = g.players.find(q => q.id === o); if (p) return p; }
  return null;
}
function hitMob(g, m, f) {
  const p = flameOwner(g, f);
  if (!p || p.team === m.team || m.hitT > 0) return;
  m.hitT = MOB_HIT_CD;
  if (--m.hp > 0) return;
  m.dead = true;
  p.mk = (p.mk || 0) + 1;
  p.coins = (p.coins || 0) + MOB_KINDS[m.k].coin;
}
// a monster or a boss touched a player: same rules as a flame (lives, shield, knocked down for a rescue)
function hurt(g, p, by) {
  if (!p.alive || p.inv > 0) return;
  if (p.hp > 1) { p.hp--; p.inv = 1.2; return; }
  if (p.shield) { p.shield = false; p.inv = SHIELD_INV; return; }
  p.alive = false; p.down = DOWN_T; p.downBy = by;
}

/* ---------- bosses: 2x2, centred on (x, y) half-way between cells ---------- */
function spawnBoss(g, kind, hp, cell) {
  const cx = cell >= 0 ? cell % W : (W >> 1), cy = cell >= 0 ? (cell / W) | 0 : (H >> 1);
  g.boss = { k: kind, x: clampB(cx - 0.5, W), y: clampB(cy - 0.5, H), hp, max: hp, ph: 1, cd: 2.5, act: null, rest: 0, hitT: 0, vis: true, visT: 4 };
  g.bossDead = false;
  g.banner = [BOSS_NAMES[kind] + ' xuất hiện!', 2.5];
}
const clampB = (v, n) => Math.min(n - 2.5, Math.max(1.5, v));
function nearestPlayer(g, x, y, team = 1) {
  let best = null, bd = 1e9;
  for (const p of g.players) if (p.alive && p.team !== team) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
  return best;
}
// what a boss attack hits: a flame on the cell, boxes burn, bombs go off
function blast(g, i) {
  const c = g.grid[i];
  if (c === undefined || c === '#' || c === 'X') return;
  if (c === 'x') { g.grid[i] = 'X'; g.burn.set(i, FLAME_T); return; }
  addFlame(g, i, '@');
  if (POWERS.includes(c)) g.grid[i] = '.';
  const b = g.bombs.find(o => o.i === i);
  if (b) explode(g, b);
}
function startAttack(g, b) {
  const enraged = b.ph === 2, cells = new Set(), targets = g.players.filter(p => p.alive && p.team === 0);
  if (!targets.length) return;
  const inside = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
  if (b.k === 'king') {
    // bombs rain down around the players
    const n = Math.min(9, 3 + targets.length + (enraged ? 2 : 0));
    for (let tries = 0; cells.size < n && tries < 80; tries++) {
      const p = pick(targets), x = Math.round(p.x) + Math.floor(Math.random() * 7) - 3, y = Math.round(p.y) + Math.floor(Math.random() * 7) - 3;
      if (inside(x, y) && g.grid[idx(x, y)] === '.' && !g.bombs.some(o => o.i === idx(x, y))) cells.add(idx(x, y));
    }
    b.act = { k: 'bombs', t: 0.9, cells: [...cells] };
  } else if (b.k === 'dragon') {
    // fire breath along the row and/or column of the nearest player
    const p = nearestPlayer(g, b.x, b.y), px = Math.round(p.x), py = Math.round(p.y);
    const row = enraged || Math.random() < 0.5, col = enraged || !row;
    if (row) for (let x = 1; x < W - 1; x++) if (g.grid[idx(x, py)] !== '#') cells.add(idx(x, py));
    if (col) for (let y = 1; y < H - 1; y++) if (g.grid[idx(px, y)] !== '#') cells.add(idx(px, y));
    b.act = { k: 'fire', t: 1.0, cells: [...cells] };
  } else if (b.k === 'golem') {
    // ground slam around up to two players, then calls in slimes
    for (const p of targets.sort(() => Math.random() - 0.5).slice(0, enraged ? 3 : 2))
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
        if (inside(x, y) && g.grid[idx(x, y)] !== '#') cells.add(idx(x, y));
      }
    b.act = { k: 'slam', t: 1.0, cells: [...cells] };
  } else if (b.k === 'wraith') {
    if (!b.vis) return;
    // a cross of fire out of the wraith, through boxes
    const cx = Math.round(b.x), cy = Math.round(b.y), len = enraged ? 7 : 5;
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (const [dx, dy] of DIRS)
      for (let r = 0; r <= len; r++) {
        const x = cx - 1 + ox + dx * r, y = cy - 1 + oy + dy * r;
        if (!inside(x, y) || g.grid[idx(x, y)] === '#') break;
        cells.add(idx(x, y));
      }
    b.act = { k: 'fire', t: 0.8, cells: [...cells] };
  }
}
function doAttack(g, b) {
  const a = b.act;
  if (a.k === 'bombs') {
    for (const i of a.cells) {
      if (isWallish(g.grid[i]) || g.bombs.some(o => o.i === i)) continue;
      const bomb = { id: ++g.bid, i, fx: i % W, fy: (i / W) | 0, vx: 0, vy: 0, lock: -1, t: 1.4, r: b.ph === 2 ? 3 : 2, owner: '@' };
      g.bombs.push(bomb);
      for (const q of g.players) if (q.alive && Math.hypot(q.x - bomb.fx, q.y - bomb.fy) < 0.95) q.pass.push(bomb.id);
    }
  } else for (const i of a.cells) blast(g, i);
  if (a.k === 'slam') for (let k = 0; k < (b.ph === 2 ? 3 : 2); k++) { const i = freeCell(g, 3); if (i >= 0) addMob(g, 'slime', i); }
}
function stepBoss(g, dt) {
  const b = g.boss;
  if (b.hitT > 0) b.hitT -= dt;
  if (b.k === 'wraith' && !b.act && (b.visT -= dt) <= 0) {
    // the wraith fades out, then shows up somewhere else
    b.vis = !b.vis; b.visT = b.vis ? 4 : 2.5;
    if (b.vis) { const i = freeCell(g, 5); if (i >= 0) { b.x = clampB(i % W - 0.5, W); b.y = clampB(((i / W) | 0) - 0.5, H); } }
  }
  if (b.vis && b.hitT <= 0) for (const [i, f] of g.flames) {
    if (Math.abs(i % W - b.x) >= 1 || Math.abs(((i / W) | 0) - b.y) >= 1) continue;
    const p = flameOwner(g, f);
    if (!p) continue;   // its own fire does not hurt it
    b.hp--; b.hitT = BOSS_HIT_CD; p.dmg = (p.dmg || 0) + 1;
    if (b.hp <= 0) return bossDown(g);
    if (b.ph === 1 && b.hp <= b.max / 2) {
      b.ph = 2; g.banner = [BOSS_NAMES[b.k] + ' nổi giận!', 2];
      if (g.mode === 'b') g.sdOn = true;   // the walls start closing in
    }
    break;
  }
  if (b.vis) for (const p of g.players) if (p.team === 0 && Math.abs(p.x - b.x) < 1.25 && Math.abs(p.y - b.y) < 1.25) hurt(g, p, '@');
  if (b.act) { if ((b.act.t -= dt) <= 0) { doAttack(g, b); b.act = null; b.rest = 1.2; } return; }
  if (b.rest > 0) { b.rest -= dt; return; }
  const p = nearestPlayer(g, b.x, b.y);
  if (p && b.vis) {
    const sp = (b.k === 'golem' ? 0.9 : 1.3) * (b.ph === 2 ? 1.35 : 1) * dt, dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
    if (d > 0.6) { b.x = clampB(b.x + dx / d * sp, W); b.y = clampB(b.y + dy / d * sp, H); }
  }
  if ((b.cd -= dt) <= 0) { b.cd = BOSS_CD[b.k] * (b.ph === 2 ? 0.65 : 1); startAttack(g, b); }
}
function bossDown(g) {
  const b = g.boss;
  g.boss = null; g.bossDead = true;
  g.banner = [BOSS_NAMES[b.k] + ' đã bị hạ!', 3];
  for (const p of g.players) if (p.alive) p.coins = (p.coins || 0) + 8;
  if (g.mode !== 'v') g.mobs = [];
  if (g.mode === 'c') g.exit = nearestFloor(g, b.x, b.y);
}

/* ---------- survival waves ---------- */
function waveMobs(n, np) {
  if (n % 5 === 0) return [{ k: BOSS_KINDS[(n / 5 - 1) % 4], boss: true, hp: 5 + 2 * np + (n / 5) * 2 }, ...Array.from({ length: n / 5 + 1 }, () => ({ k: 'slime' }))];
  const pool = ['slime'];
  if (n >= 2) pool.push('bat');
  if (n >= 3) pool.push('ghost');
  if (n >= 4) pool.push('imp');
  if (n >= 6) pool.push('tank');
  const count = Math.min(16, 2 + n + Math.floor((np - 1) * (1 + n / 3)));
  return Array.from({ length: count }, () => ({ k: pick(pool) }));
}
// queued monsters appear one by one, each after a 1s warning on its cell
function tickSpawns(g, dt) {
  for (const s of g.spawns) s.t -= dt;
  for (const s of g.spawns.filter(s => s.t <= 0)) { if (s.boss) spawnBoss(g, s.k, s.hp, s.i); else addMob(g, s.k, s.i); }
  g.spawns = g.spawns.filter(s => s.t > 0);
  if (g.queue.length && (g.spawnT = (g.spawnT || 0) - dt) <= 0) {
    g.spawnT = 0.5;
    if (g.queue[0].boss && g.boss) return;   // one boss at a time
    const i = freeCell(g, 5);
    if (i >= 0) g.spawns.push({ ...g.queue.shift(), i, t: 1 });
  }
}
function resetStats(p) { p.maxB = 1; p.fire = 2; p.spd = 0; p.kick = false; p.shield = false; p.ck = 0; p.ct = 0; }
// players who are out come back (between waves, and on a new stage)
function respawnDead(g) {
  for (const p of g.players) {
    if (p.alive || p.down > 0) continue;
    const i = freeCell(g, 0);
    if (i < 0) continue;
    resetStats(p);
    p.alive = true; p.down = 0; p.dropped = false; p.inv = 2; p.pass = []; p.lock = -1;
    p.x = i % W; p.y = (i / W) | 0;
  }
}
function regrowBoxes(g) {
  const portals = new Set(PORTALS.flat());
  for (let i = 0; i < W * H; i++) {
    if (g.grid[i] !== '.' || portals.has(i) || Math.random() > 0.12) continue;
    const x = i % W, y = (i / W) | 0;
    if (g.players.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) <= 2) || g.bombs.some(b => b.i === i)) continue;
    g.grid[i] = 'x';
    g.hidden[i] = Math.random() < 0.35 ? pick(['b', 'f', 's', 'h']) : '';
  }
}
function stepWaves(g, dt) {
  if (g.brk > 0) {
    if ((g.brk -= dt) <= 0) { g.brk = 0; g.wave++; g.queue = waveMobs(g.wave, g.players.length); g.banner = ['Đợt ' + g.wave, 2]; }
    return;
  }
  if (g.mobs.length || g.spawns.length || g.queue.length || g.boss) return;
  g.brk = WAVE_BREAK;
  g.banner = [`Xong đợt ${g.wave}! Nghỉ ${WAVE_BREAK} giây`, 2.5];
  for (const p of g.players) if (p.alive) p.coins = (p.coins || 0) + 2;
  respawnDead(g);
  regrowBoxes(g);
}
// survival shop, open between waves
function buyItem(g, id, item) {
  if (!g.pve || g.mode !== 'v' || !(g.brk > 0) || !g.wave || !Object.hasOwn(SHOP, item)) return false;
  const p = g.players.find(q => q.id === id);
  if (!p || !p.alive || (p.coins || 0) < SHOP[item]) return false;
  p.coins -= SHOP[item];
  if (item === 'b') p.maxB = Math.min(8, p.maxB + 1);
  else if (item === 'f') p.fire = Math.min(8, p.fire + 1);
  else if (item === 's') p.spd = Math.min(5, p.spd + 1);
  else if (item === 'k') p.kick = true;
  else p.shield = true;
  return true;
}

/* ---------- campaign ---------- */
function fillStage(g) {
  const st = STAGES[g.stage - 1], n = g.players.length;
  layBoxes(g, st.boxes);
  g.mobs = []; g.spawns = []; g.queue = []; g.boss = null; g.bossDead = false; g.exitOpen = false; g.exit = -1; g.stageT = 0;
  if (st.boss) spawnBoss(g, st.boss, 10 + 5 * n);
  else {
    for (const [k, c] of Object.entries(st.mobs))
      for (let j = Math.round(c * (1 + 0.3 * (n - 1))); j > 0; j--) { const i = freeCell(g, 5); if (i >= 0) addMob(g, k, i); }
    // the exit hides under a box, like the classic
    const boxes = [];
    for (let i = 0; i < W * H; i++) if (g.grid[i] === 'x') boxes.push(i);
    g.exit = boxes.length ? pick(boxes) : freeCell(g, 3);
    if (g.exit >= 0) g.hidden[g.exit] = '';
  }
  g.banner = [`Ải ${g.stage}` + (st.boss ? ': ' + BOSS_NAMES[st.boss] : ''), 2.5];
}
function stepCampaign(g, dt) {
  if (g.clearT > 0) { if ((g.clearT -= dt) <= 0) nextStage(g); return; }
  g.stageT += dt;
  g.exitOpen = g.exit >= 0 && g.grid[g.exit] === '.' && !g.mobs.length && !g.boss;
  if (!g.exitOpen || !g.players.some(p => p.alive && cellOf(p) === g.exit)) return;
  const stars = g.stageT < 60 ? 3 : g.stageT < 120 ? 2 : 1;
  g.stars += stars;
  if (g.stage >= STAGES.length) { g.won = true; return; }
  g.clearT = STAGE_CLEAR_T;
  g.banner = [`Qua ải ${g.stage}! ${'★'.repeat(stars)}`, STAGE_CLEAR_T];
}
function nextStage(g) {
  g.stage++;
  g.rid = Math.floor(Math.random() * 1e9);   // a new board: clients restart their prediction
  g.bombs = []; g.flames.clear(); g.burn.clear(); g.drops = [];
  const spawns = pickSpawns(g.players.length);
  g.players.forEach((p, k) => {
    if (!p.alive) resetStats(p);
    p.alive = true; p.down = 0; p.dropped = false; p.inv = 1.5; p.pass = []; p.lock = -1; p.lastTp = null;
    p.x = spawns[k][0]; p.y = spawns[k][1];
  });
  fillStage(g);
}

/* ---------- boss hunt: one player is the boss ---------- */
function setupHunt(g) {
  const boss = pick(g.players), n = g.players.length - 1;
  boss.boss = true; boss.team = 1; boss.hp = 2 + 2 * n;
  boss.maxB = 3; boss.fire = 4; boss.spd = 1; boss.kick = true; boss.skT = 3;
  for (const p of g.players) if (p !== boss) { p.fire = 3; p.maxB = 2; }
  layBoxes(g, .55);
  g.banner = [boss.name + ' là BOSS!', 3];
}
// the boss player's skill key (E): call in slimes that fight on their side
function huntSkill(g, inputs, dt) {
  const b = g.players.find(p => p.boss);
  if (!b) return;
  if (b.skT > 0) b.skT -= dt;
  const inp = inputs[b.id], sk = inp ? inp.sk | 0 : 0;
  if (b.lastSk === undefined) { b.lastSk = sk; return; }
  if (sk === b.lastSk) return;
  b.lastSk = sk;
  if (!b.alive || b.skT > 0) return;
  b.skT = SKILL_CD;
  const here = cellOf(b);
  for (const n of DIRS.map(([dx, dy]) => here + dx + dy * W).filter(i => g.grid[i] === '.').slice(0, 2)) addMob(g, 'slime', n, 1);
}

/* ---------- tick, result, snapshot ---------- */
function stepPve(g, inputs, dt) {
  g._danger = null;
  if (g.banner && (g.banner[1] -= dt) <= 0) g.banner = null;
  if (g.mode === 'h') huntSkill(g, inputs, dt);
  tickSpawns(g, dt);
  for (const m of g.mobs) {
    stepMob(g, m, dt);
    const f = g.flames.get(cellOf(m));
    if (f) hitMob(g, m, f);
    if (!m.dead) for (const p of g.players) if (p.team !== m.team && Math.hypot(p.x - m.x, p.y - m.y) < 0.7) hurt(g, p, '@');
  }
  g.mobs = g.mobs.filter(m => !m.dead);
  if (g.boss) stepBoss(g, dt);
  if (g.mode === 'v') stepWaves(g, dt);
  else if (g.mode === 'c') stepCampaign(g, dt);
}

function pveResult(g) {
  const out = p => !p.alive && p.down <= 0;
  if (g.mode === 'h') {
    const boss = g.players.find(p => p.boss), hunters = g.players.filter(p => !p.boss);
    if (!boss.alive) return { w: 'hunters', winners: hunters };
    if (hunters.every(out) || (g.t || 0) >= HUNT_T) return { w: 'boss', winners: [boss] };
    return null;
  }
  if (g.players.every(out)) return { w: 'lose', winners: [] };
  if ((g.mode === 'b' && g.bossDead) || (g.mode === 'c' && g.won)) return { w: 'win', winners: g.players.slice() };
  return null;
}

function pveSnapshot(g) {
  const b = g.boss, hb = g.mode === 'h' ? g.players.find(p => p.boss) : null;
  return {
    mb: g.mobs.map(m => [m.id, MOB_KINDS[m.k].code, Math.round(m.x * 100), Math.round(m.y * 100), m.dir, m.hp, m.hitT > 0 ? 1 : 0]),
    bo: b ? [BOSS_KINDS.indexOf(b.k), Math.round(b.x * 100), Math.round(b.y * 100), b.hp, b.max, b.ph, b.vis ? 1 : 0, b.hitT > 0 ? 1 : 0] : null,
    wn: b && b.act ? b.act.cells : [],
    sw: g.spawns.map(s => s.i),
    wv: g.wave || 0, brk: g.mode === 'v' && g.wave ? Math.ceil(g.brk || 0) : 0,
    stg: g.stage || 0, sr: g.stars || 0,
    ex: g.exit >= 0 && g.grid[g.exit] === '.' ? [g.exit, g.exitOpen ? 1 : 0] : null,
    ml: g.mobs.length + g.spawns.length + g.queue.length + (b ? 1 : 0),
    bn: g.banner ? g.banner[0] : '',
    ht: hb ? Math.max(0, Math.ceil(HUNT_T - (g.t || 0))) : -1,
    hs: hb ? Math.max(0, Math.ceil(hb.skT || 0)) : 0,
  };
}
/* ================= END PVE ================= */
