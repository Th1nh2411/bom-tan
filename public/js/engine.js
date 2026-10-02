/* ================= ENGINE (pure game logic) ================= */
// The board size grows with the number of players. W/H and everything derived from them are module state:
// the host sets them when a round starts, clients adopt them from the snapshot (gw/gh).
// sizes: [W, H, portal x1, x2, portal y1, y2]
const BOARD_SIZES = [[13, 11, 3, 9, 3, 7], [15, 13, 5, 9, 3, 9], [17, 13, 5, 11, 3, 9], [19, 15, 5, 13, 3, 11]];
const sizeFor = n => BOARD_SIZES[n <= 2 ? 0 : n <= 4 ? 1 : n <= 6 ? 2 : 3];
let W = 15, H = 13, PORTALS = [], SD_ORDER = [], emptyGrid = '', dimsVer = 0;
const idx = (x, y) => y * W + x;
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
function setDims(w, h) {
  const sz = BOARD_SIZES.find(s => s[0] === w && s[1] === h);
  if (!sz || (w === W && h === H && dimsVer)) return !!sz;
  W = w; H = h; dimsVer++;
  const [, , x1, x2, y1, y2] = sz;
  PORTALS = [[idx(x1, y1), idx(x2, y2)]];
  // sudden death: the two outer rings, clockwise spiral
  SD_ORDER = [];
  for (let r = 0; r < 2; r++) {
    const x0 = 1 + r, y0 = 1 + r, xe = W - 2 - r, ye = H - 2 - r;
    for (let x = x0; x <= xe; x++) SD_ORDER.push(idx(x, y0));
    for (let y = y0 + 1; y <= ye; y++) SD_ORDER.push(idx(xe, y));
    for (let x = xe - 1; x >= x0; x--) SD_ORDER.push(idx(x, ye));
    for (let y = ye - 1; y > y0; y--) SD_ORDER.push(idx(x0, y));
  }
  emptyGrid = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) emptyGrid += (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)) ? '#' : '.';
  return true;
}
setDims(15, 13);
// Maps: which inner cells are walls. Every map keeps the portals free and the board in one piece;
// spawns go on open odd/odd cells. (x, y) inside the border; mx/my: the even column/row nearest the middle;
// cx/cy: the middle cell.
const MAPS = {
  classic: (x, y) => x % 2 === 0 && y % 2 === 0,                                        // Cổ điển: a pillar every other cell
  open: (x, y) => x % 4 === 0 && y % 4 === 0,                                           // Đấu trường: few pillars, lots of room
  cross: (x, y, mx, my) => x % 2 === 0 && y % 2 === 0 && x !== mx && y !== my,          // Ngã tư: two wide avenues through the middle
  rooms: (x, y, mx, my) => (x === mx && y % 4 !== 1) || (y === my && x % 4 !== 1) || (x % 4 === 0 && y % 4 === 0),   // Bốn phòng: four rooms with doors
  fort: (x, y, mx, my, cx, cy) => (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1) || (x % 2 === 0 && y % 2 === 0 && (Math.abs(x - cx) > 2 || Math.abs(y - cy) > 2)),   // Pháo đài: a solid block in the middle, an open ring around it
};
const MAP_IDS = Object.keys(MAPS);
// build the walls of a map into grid (boxes and floor are left to the caller); returns the map id used
function buildWalls(grid, id) {
  const mapId = MAPS[id] ? id : MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)];
  const wall = MAPS[mapId], mx = (W >> 1) & ~1, my = (H >> 1) & ~1, portals = PORTALS.flat();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (edge || (wall(x, y, mx, my, W >> 1, H >> 1) && !portals.includes(i))) grid[i] = '#';
    else if (grid[i] === '#') grid[i] = '.';
  }
  return mapId;
}
// random spawns on open odd/odd cells (never next to a pillar trap), spread apart and away from portals
function pickSpawns(n, open = () => true) {
  const portals = PORTALS.flat().map(c => [c % W, (c / W) | 0]);
  const cand = [];
  for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2)
    if (open(idx(x, y)) && portals.every(([px, py]) => Math.abs(px - x) + Math.abs(py - y) > 3)) cand.push([x, y]);
  const out = [];
  for (let minD = Math.floor((W + H) / 3); out.length < n && minD >= 0; minD--) {
    const pool = cand.filter(([x, y]) => out.every(([ox, oy]) => Math.abs(ox - x) + Math.abs(oy - y) >= minD));
    while (out.length < n && pool.length) {
      const [p] = pool.splice(Math.floor(Math.random() * pool.length), 1);
      if (out.every(([ox, oy]) => Math.abs(ox - p[0]) + Math.abs(oy - p[1]) >= minD)) out.push(p);
    }
  }
  return out;
}
const FUSE = 2.4, FLAME_T = 0.55, COUNT_T = 2.5, END_T = 6, KICK_SPEED = 9, DOWN_T = 3, REVIVE_INV = 1.2, SHIELD_INV = 1, REVIVE_DIST = 0.75;
const POWERS = 'bfskhcdop';   // h = shield: absorbs one hit, then 1s of invulnerability; c = curse (a bad item);
// d, o, p change the shape of your blasts: diagonal X, a square around the bomb, a cross that pierces boxes
const SHAPE_OF = { d: 'diag', o: 'square', p: 'pierce' }, SHAPES = ['plus', 'diag', 'square', 'pierce'];
// what hides under a box: mostly power-ups, sometimes a blast shape, now and then a curse
function rollItem() {
  const r = Math.random();
  return r < .24 ? 'b' : r < .48 ? 'f' : r < .61 ? 's' : r < .72 ? 'k' : r < .83 ? 'h' : r < .92 ? 'dop'[Math.floor(Math.random() * 3)] : 'c';
}
// Mid-round events (when the room has them on): every 20-30s one of these runs for EV_LEN seconds, after a
// EV_WARN-second warning. dark: you only see around yourself (drawn by the browsers); ice: you keep sliding
// until you hit something; max: every bomb blasts at full range.
const EVENTS = { dark: 'Tắt đèn', ice: 'Mặt băng', max: 'Bom max tầm' }, EV_LEN = 10, EV_WARN = 3, MAX_R = 8;
const nextEventIn = () => 20 + Math.random() * 10;
function tickEvent(g, dt) {
  if (!g.events) return;
  if (g.ev) {
    if ((g.evT -= dt) > 0) return;
    g.ev = null; g.evNext = nextEventIn();
    for (const p of g.players) p.slide = null;
    return;
  }
  if (g.evWarn) { if ((g.evWarnT -= dt) <= 0) { g.ev = g.evWarn; g.evWarn = null; g.evT = EV_LEN; } return; }
  if ((g.evNext -= dt) <= 0) { const ks = Object.keys(EVENTS); g.evWarn = ks[Math.floor(Math.random() * ks.length)]; g.evWarnT = EV_WARN; }
}
// curses (p.ck): 1 reversed controls, 2 slow, 3 drops bombs by itself. They last CURSE_T seconds and
// jump to anyone the cursed player touches.
const CURSE_T = 10, CURSE_NAMES = ['', 'đảo phím', 'chạy chậm', 'tự thả bom'];
// sudden death: after SD_START seconds of play, walls fill the two outer rings in a spiral, one cell per SD_STEP
const SD_START = 60, SD_STEP = 0.35;
const speedOf = p => (3.3 + 0.6 * p.spd) * (p.ck === 2 ? 0.5 : 1) * (p.zb ? 1.1 : 1);
// zombie mode: one player starts as a zombie; a touch or any bomb turns a human into one.
// Bombs only stun zombies. Humans still standing after ZOMBIE_T seconds win.
const ZOMBIE_T = 90, ZOMBIE_STUN = 3, INFECT_INV = 1.5;
function infect(g, p, by) { p.zb = true; p.inv = INFECT_INV; p.ck = 0; p.ct = 0; g.kills.push([by, p.id]); }

function portalExit(i) { for (const [a, b] of PORTALS) { if (i === a) return b; if (i === b) return a; } return -1; }
function isWallish(c) { return c === '#' || c === 'x' || c === 'X'; }

// Daily rule: one twist per day, the same for everyone (picked from the date in Vietnam time).
const DAILY_RULES = {
  kick: 'Ai cũng có găng đá bom', fire: 'Khởi đầu với tầm nổ 4', bombs: 'Khởi đầu với 3 quả bom', fast: 'Bom nổ nhanh gấp rưỡi',
  speed: 'Ai cũng chạy nhanh', shield: 'Ai cũng có khiên', curse: 'Mùa lời nguyền: nhiều vật phẩm xấu', onebomb: 'Chỉ 1 quả bom, nhưng nổ cực xa',
};
function dailyRuleFor(dateStr) {
  let h = 0;
  for (const ch of dateStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const keys = Object.keys(DAILY_RULES);
  return keys[h % keys.length];
}
const todayVN = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
function applyRule(g) {
  for (const p of g.players) {
    if (g.rule === 'kick') p.kick = true;
    else if (g.rule === 'fire') p.fire = 4;
    else if (g.rule === 'bombs') p.maxB = 3;
    else if (g.rule === 'speed') p.spd = 3;
    else if (g.rule === 'shield') p.shield = true;
    else if (g.rule === 'onebomb') p.fire = 8;
  }
  if (g.rule === 'fast') g.fuse = FUSE / 1.5;
}

// opts.mode: 's' solo, 't' teams, 'z' zombie, or a co-op / boss mode from pve.js ('v' waves, 'b' boss,
// 'c' campaign, 'h' boss hunt); teams stays for old callers. opts.rule: a DAILY_RULES key or ''.
// opts.boxes: share of free cells that get a box (default .72); opts.stage: campaign stage;
// opts.map: a MAPS id, 'random', or nothing for the classic board; opts.events: mid-round events on
function newGame(slots, teams, opts = {}) {
  const gmode = opts.mode || (teams ? 't' : 's');
  teams = gmode === 't';
  const sz = sizeFor(Math.max(slots.length, isPve(gmode) ? 3 : 0));   // co-op boards are never the smallest one
  setDims(sz[0], sz[1]);
  const grid = new Array(W * H).fill('.');
  const hidden = new Array(W * H).fill('');
  const mapId = buildWalls(grid, opts.map || 'classic');
  const spawns = pickSpawns(slots.length, i => grid[i] === '.');
  const portalCells = PORTALS.flat();
  const keepClear = (x, y) =>
    spawns.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= 2) ||
    portalCells.some(c => Math.abs(c % W - x) + Math.abs(((c / W) | 0) - y) <= 1);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y);
    if (grid[i] !== '.' || keepClear(x, y)) continue;
    if (Math.random() < (opts.boxes ?? 0.72)) {
      grid[i] = 'x';
      if (opts.rule === 'curse' && Math.random() < 0.12) hidden[i] = 'c';
      else if (Math.random() < 0.38) hidden[i] = rollItem();
    }
  }
  const players = slots.map((s, k) => ({
    id: s.id, uid: s.uid || null, name: s.name, color: s.color, hat: s.hat || '', team: teams ? s.team : k,
    x: spawns[k][0], y: spawns[k][1], alive: true,
    maxB: 1, fire: 2, spd: 0, kick: false, shield: false, ck: 0, ct: 0, dir: 2, down: 0, downBy: null, inv: 0,
    lastB: null, lastTp: null, pass: [], lock: -1, shape: 'plus', skin: Math.min(3, Math.max(0, s.skin | 0))
  }));
  if (gmode === 'z' && players.length >= 2) {
    const z = players[Math.floor(Math.random() * players.length)];
    z.zb = true; z.z0 = true;
  }
  const g = {
    rid: Math.floor(Math.random() * 1e9), teams: !!teams, mode: gmode, map: mapId,
    events: !!opts.events, ev: null, evNext: nextEventIn(), rule: DAILY_RULES[opts.rule] ? opts.rule : '',
    ph: 'count', timer: COUNT_T, grid, hidden, bombs: [], flames: new Map(), burn: new Map(),
    players, winner: null, winnerIds: [], kills: [], revives: [], bid: 0, justEnded: false
  };
  applyRule(g);
  if (isPve(gmode) && typeof setupPve === 'function') setupPve(g, opts);
  return g;
}
const isPve = m => m === 'v' || m === 'b' || m === 'c' || m === 'h';

function blocked(g, x, y, p) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true;
  const i = idx(x, y);
  if (isWallish(g.grid[i])) return true;
  const b = g.bombs.find(o => o.i === i);
  if (b && !(p && p.pass.includes(b.id))) return true;
  return false;
}

function tryMove(g, p, dx, dy, step) {
  const horiz = dx !== 0, d = horiz ? dx : dy;
  const main = horiz ? 'x' : 'y', side = horiz ? 'y' : 'x';
  const free = (m, s) => !(horiz ? blocked(g, m, s, p) : blocked(g, s, m, p));
  const cm = Math.round(p[main]), cs = Math.round(p[side]);
  const off = p[side] - cs;
  if (Math.abs(off) > 1e-3) {
    const lanes = [cs, cs + (off > 0 ? 1 : -1)];
    for (const lane of lanes) {
      const dist = Math.abs(p[side] - lane);
      if (dist > 0.75) continue;
      if (free(cm + d, lane) && (lane === cs || free(cm, lane))) {
        const dir = Math.sign(lane - p[side]);
        p[side] = dist <= step ? lane : p[side] + dir * step;
        return;
      }
    }
    return;
  }
  p[side] = cs;
  let n = p[main] + d * step;
  if (!free(cm + d, cs)) n = d > 0 ? Math.min(n, cm) : Math.max(n, cm);
  p[main] = n;
}

/* returns true when the player was teleported */
function portalCheck(p) {
  const cx = Math.round(p.x), cy = Math.round(p.y), i = idx(cx, cy);
  if (p.lock !== -1 && p.lock !== i) p.lock = -1;
  const ex = portalExit(i);
  if (ex < 0 || p.lock === i) return false;
  if (Math.abs(p.x - cx) < 0.2 && Math.abs(p.y - cy) < 0.2) {
    p.x = ex % W; p.y = (ex / W) | 0; p.lock = ex; p.pass = [];
    return true;
  }
  return false;
}

/* remote player reports its own predicted position; host validates */
function applyReported(g, p, inp, dt) {
  const tp = inp.tp | 0;
  if (p.lastTp === null) p.lastTp = tp;
  const rx = inp.px / 100, ry = inp.py / 100;
  if (!isFinite(rx) || !isFinite(ry)) return;
  if (tp !== p.lastTp) {
    p.lastTp = tp;
    let best = -1, bd = 1e9;
    for (const c of PORTALS.flat()) {
      const ex = portalExit(c);
      const nearEntry = Math.hypot(c % W - p.x, ((c / W) | 0) - p.y);
      const nearExit = Math.hypot(ex % W - rx, ((ex / W) | 0) - ry);
      if (nearEntry < 3 && nearExit < bd) { bd = nearExit; best = c; }
    }
    if (best >= 0 && bd < 3) { const ex = portalExit(best); p.x = ex % W; p.y = (ex / W) | 0; p.lock = ex; p.pass = []; }
  }
  const dist = Math.hypot(rx - p.x, ry - p.y);
  if (dist > 1e-4) {
    const maxStep = speedOf(p) * dt * 1.8 + 0.02;
    const f = Math.min(1, maxStep / dist);
    const nx = p.x + (rx - p.x) * f, ny = p.y + (ry - p.y) * f;
    const ci = idx(Math.round(p.x), Math.round(p.y));
    const ncx = Math.round(nx), ncy = Math.round(ny);
    const onLane = Math.abs(nx - ncx) < 0.3 || Math.abs(ny - ncy) < 0.3;
    if (onLane && !(idx(ncx, ncy) !== ci && blocked(g, ncx, ncy, p))) { p.x = nx; p.y = ny; }
  }
  const i = idx(Math.round(p.x), Math.round(p.y));
  if (p.lock !== -1 && p.lock !== i) p.lock = -1;
}

// sk: the bomb skin the flame is drawn with (the first bomb to light a cell decides)
function addFlame(g, i, owner, sk = 0) {
  let f = g.flames.get(i);
  if (!f) { f = { t: 0, o: new Set(), sk }; g.flames.set(i, f); }
  f.t = FLAME_T; f.o.add(owner);
}

// b.sh: the blast shape (plus, diag, square, pierce); during the 'max' event every bomb reaches MAX_R
function explode(g, b) {
  const k = g.bombs.indexOf(b);
  if (k < 0) return;
  g.bombs.splice(k, 1);
  const sh = b.sh || 'plus', sk = b.sk | 0, reach = g.ev === 'max' ? MAX_R : b.r;
  addFlame(g, b.i, b.owner, sk);
  const bx = b.i % W, by = (b.i / W) | 0;
  if (sh === 'square') {
    // everything around the bomb: 3x3, or 5x5 from range 4 (walls stop nothing but themselves)
    const R = reach >= 4 ? 2 : 1;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = bx + dx, y = by + dy;
      if ((dx || dy) && x >= 0 && y >= 0 && x < W && y < H) blastCell(g, idx(x, y), b, sk);
    }
    return;
  }
  const pierce = sh === 'pierce';
  for (const [dx, dy] of sh === 'diag' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : DIRS) {
    // a flame that enters a portal comes out of the paired portal and keeps going (once per ray)
    let x = bx, y = by, jumped = sh === 'diag';
    for (let r = 1; r <= reach; r++) {
      x += dx; y += dy;
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      const i = idx(x, y), c = g.grid[i];
      // diagonal fire flies over the pillars inside the board (on odd cells every diagonal starts at one)
      if (c === '#') { if (sh === 'diag' && x > 0 && y > 0 && x < W - 1 && y < H - 1) continue; break; }
      if (c === 'X') { if (pierce) continue; break; }
      if (c === 'x') { g.grid[i] = 'X'; g.burn.set(i, FLAME_T); if (pierce) continue; break; }   // pierce: through every box in the line
      addFlame(g, i, b.owner, sk);
      if (POWERS.includes(c)) { g.grid[i] = '.'; if (pierce) continue; break; }
      const ob = g.bombs.find(o => o.i === i);
      if (ob) { explode(g, ob); break; }
      const ex = jumped ? -1 : portalExit(i);
      if (ex >= 0) {
        jumped = true; x = ex % W; y = (ex / W) | 0;
        addFlame(g, ex, b.owner, sk);
        const eb = g.bombs.find(o => o.i === ex);
        if (eb) { explode(g, eb); break; }
      }
    }
  }
}
// one cell of a square blast: boxes burn, items go, other bombs go off
function blastCell(g, i, b, sk) {
  const c = g.grid[i];
  if (c === '#' || c === 'X') return;
  if (c === 'x') { g.grid[i] = 'X'; g.burn.set(i, FLAME_T); return; }
  addFlame(g, i, b.owner, sk);
  if (POWERS.includes(c)) g.grid[i] = '.';
  const ob = g.bombs.find(o => o.i === i);
  if (ob) explode(g, ob);
}

function placeBomb(g, p, cellHint) {
  let i = idx(Math.round(p.x), Math.round(p.y));
  if (typeof cellHint === 'number' && cellHint >= 0 && cellHint < W * H) {
    const hx = cellHint % W, hy = (cellHint / W) | 0;
    if (Math.hypot(hx - p.x, hy - p.y) < 1.6 && !isWallish(g.grid[cellHint])) i = cellHint;
  }
  if (g.bombs.some(b => b.i === i)) return;
  if (g.bombs.filter(b => b.owner === p.id).length >= p.maxB) return;
  const b = { id: ++g.bid, i, fx: i % W, fy: (i / W) | 0, vx: 0, vy: 0, lock: -1, t: g.fuse || FUSE, r: p.fire, owner: p.id, sh: p.shape, sk: p.skin };
  g.bombs.push(b);
  for (const q of g.players) if (q.alive && Math.hypot(q.x - b.fx, q.y - b.fy) < 0.95) q.pass.push(b.id);
}

// a kill made by a ghost bomb (its owner is already out) counts toward the ghost-kill achievement
function creditGhost(g, id) { const q = g.players.find(o => o.id === id); if (q && !q.alive && q.down <= 0) q.ghostKills = (q.ghostKills || 0) + 1; }

// sudden death: a wall lands on cell i, crushing whatever is there (shields do not help)
function crushCell(g, i) {
  g.grid[i] = '#'; g.hidden[i] = ''; g.burn.delete(i); g.flames.delete(i);
  g.bombs = g.bombs.filter(b => b.i !== i);
  for (const p of g.players) {
    if (idx(Math.round(p.x), Math.round(p.y)) !== i) continue;
    if (p.alive) { p.alive = false; p.down = 0; p.shield = false; g.kills.push([null, p.id]); }
    else if (p.down > 0) { p.down = 0; g.kills.push([p.downBy, p.id]); }
  }
}

// ghost bombs: a player who is out for good can click a floor cell; after a 1s warning a bomb lands there,
// owned by that player (their kill, and it spares their teammates). One drop per GHOST_CD seconds each.
const GHOST_WARN = 1, GHOST_FUSE = 1.2, GHOST_CD = 5;
function ghostDrop(g, id, cell) {
  if (g.ph !== 'play' || !(cell >= 0 && cell < W * H)) return false;
  const p = g.players.find(q => q.id === id);
  if (!p || p.alive || p.down > 0) return false;
  g.drops = g.drops || [];
  if ((g.t || 0) < (p.ghostAt || -99) + GHOST_CD) return false;
  if (g.grid[cell] !== '.' || PORTALS.flat().includes(cell) || g.bombs.some(b => b.i === cell) || g.drops.some(d => d.i === cell)) return false;
  p.ghostAt = g.t || 0;
  g.drops.push({ i: cell, t: GHOST_WARN, o: id });
  return true;
}
function tickDrops(g, dt) {
  if (!g.drops || !g.drops.length) return;
  for (const d of g.drops) d.t -= dt;
  for (const d of g.drops.filter(d => d.t <= 0)) {
    if (isWallish(g.grid[d.i]) || g.bombs.some(b => b.i === d.i)) continue;
    const owner = g.players.find(q => q.id === d.o);
    const b = { id: ++g.bid, i: d.i, fx: d.i % W, fy: (d.i / W) | 0, vx: 0, vy: 0, lock: -1, t: GHOST_FUSE, r: 2, owner: d.o, sk: owner ? owner.skin : 0 };
    g.bombs.push(b);
    for (const q of g.players) if (q.alive && Math.hypot(q.x - b.fx, q.y - b.fy) < 0.95) q.pass.push(b.id);
  }
  g.drops = g.drops.filter(d => d.t > 0);
}

// scatter a dead player's power-ups onto the nearest free floor cells (BFS from where they died)
function dropItems(g, p) {
  const items = [];
  for (let k = 1; k < p.maxB; k++) items.push('b');
  for (let k = 2; k < p.fire; k++) items.push('f');
  for (let k = 0; k < p.spd; k++) items.push('s');
  if (p.kick) items.push('k');
  if (p.shield) items.push('h');
  const shapeItem = Object.keys(SHAPE_OF).find(k => SHAPE_OF[k] === p.shape);
  if (shapeItem) items.push(shapeItem);
  if (!items.length) return;
  const portals = new Set(PORTALS.flat());
  const taken = new Set(g.players.filter(q => q.alive).map(q => idx(Math.round(q.x), Math.round(q.y))));
  for (const b of g.bombs) taken.add(b.i);
  const start = idx(Math.round(p.x), Math.round(p.y));
  // prefer cells that are not burning; if the reachable area is all fire, use burning cells too
  const seen = new Set([start]), q = [start], free = [], burning = [];
  for (let h = 0; h < q.length && free.length < items.length; h++) {
    const c = q[h];
    if (g.grid[c] === '.' && !portals.has(c) && !taken.has(c)) (g.flames.has(c) ? burning : free).push(c);
    for (const [dx, dy] of DIRS) {
      const n = idx(c % W + dx, ((c / W) | 0) + dy);
      if (!seen.has(n) && !isWallish(g.grid[n])) { seen.add(n); q.push(n); }
    }
  }
  const cells = free.concat(burning);
  items.forEach((it, k) => { if (k < cells.length) g.grid[cells[k]] = it; });
}

function bombBlocked(g, x, y, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true;
  const i = idx(x, y);
  if (isWallish(g.grid[i])) return true;
  if (g.bombs.some(o => o !== b && o.i === i)) return true;
  if (g.players.some(p => p.alive && idx(Math.round(p.x), Math.round(p.y)) === i)) return true;
  return false;
}

function slideBomb(g, b, dt) {
  let rem = KICK_SPEED * dt, guard = 0;
  while (rem > 1e-6 && (b.vx || b.vy) && guard++ < 12) {
    const cx = Math.round(b.fx), cy = Math.round(b.fy);
    const ahead = (cx - b.fx) * b.vx + (cy - b.fy) * b.vy;
    if (ahead > 1e-6) {
      const s = Math.min(rem, ahead);
      b.fx += b.vx * s; b.fy += b.vy * s; rem -= s;
      continue;
    }
    const here = idx(cx, cy);
    if (Math.abs(ahead) < 1e-6) {
      if (b.lock !== -1 && b.lock !== here) b.lock = -1;
      const ex = portalExit(here);
      if (ex >= 0 && b.lock !== here) {
        const exx = ex % W, exy = (ex / W) | 0;
        if (!g.bombs.some(o => o !== b && o.i === ex)) { b.fx = exx; b.fy = exy; b.i = ex; b.lock = ex; continue; }
      }
    }
    if (bombBlocked(g, cx + b.vx, cy + b.vy, b)) { b.fx = cx; b.fy = cy; b.vx = 0; b.vy = 0; break; }
    const s = Math.min(rem, 0.5);
    b.fx += b.vx * s; b.fy += b.vy * s; rem -= s;
  }
  b.i = idx(Math.round(b.fx), Math.round(b.fy));
  if (b.lock !== -1 && b.lock !== b.i) b.lock = -1;
}

/* inputs: { [id]: {dx, dy, b, bc?, px?, py?, pd?, tp?, pr?} }  scores: mutable {id: wins} */
function stepGame(g, inputs, dt, scores) {
  g.justEnded = false;
  if (g.ph === 'count') {
    for (const p of g.players) { const inp = inputs[p.id]; if (inp) p.lastB = inp.b; }
    g.timer -= dt;
    if (g.timer <= 0) g.ph = 'play';
    return;
  }
  if (g.ph !== 'play') { g.timer -= dt; return; }

  for (const p of g.players) {
    if (!p.alive) { if (p.down > 0 && inputs[p.id]) p.lastB = inputs[p.id].b; continue; }
    if (p.inv > 0) p.inv = Math.max(0, p.inv - dt);
    if (p.stun > 0) { p.stun = Math.max(0, p.stun - dt); if (inputs[p.id]) p.lastB = inputs[p.id].b; continue; }   // stunned zombie
    const inp = inputs[p.id] || { dx: 0, dy: 0, b: p.lastB };
    let dx = inp.dx | 0, dy = inp.dy | 0;
    if (dx && dy) dy = 0;
    // ice: with no key held you keep sliding the way you last went
    if (g.ev === 'ice') { if (dx || dy) p.slide = [dx, dy]; else if (p.slide) [dx, dy] = p.slide; }
    const sx = p.x, sy = p.y;
    if (p.ct > 0 && (p.ct -= dt) <= 0) { p.ct = 0; p.ck = 0; }
    if (p.ck === 1) { dx = -dx; dy = -dy; }   // remote players already send reversed positions; this covers local ones and kicks
    const remote = typeof inp.px === 'number' && inp.pr === g.rid;
    if (remote) {
      applyReported(g, p, inp, dt);
      if (inp.pd >= 0 && inp.pd <= 3) p.dir = inp.pd | 0;
    } else if (dx || dy) {
      p.dir = dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
      tryMove(g, p, dx, dy, speedOf(p) * dt);
      portalCheck(p);
      if (p.slide && p.x === sx && p.y === sy) p.slide = null;   // slid into a wall: stop
    }
    if (p.lastB === null) p.lastB = inp.b;
    else if (inp.b !== p.lastB) { p.lastB = inp.b; if (!p.zb) placeBomb(g, p, inp.bc); }
    if (p.ck === 3 && !p.zb && (p.autoT = (p.autoT || 0) - dt) <= 0) { p.autoT = 0.5; placeBomb(g, p); }

    // kick
    if (p.kick && (dx || dy)) {
      const cx = Math.round(p.x), cy = Math.round(p.y);
      if (Math.abs(p.x - cx) < 0.3 && Math.abs(p.y - cy) < 0.3) {
        const b = g.bombs.find(o => o.i === idx(cx + dx, cy + dy) && !o.vx && !o.vy);
        if (b && !p.pass.includes(b.id) && !bombBlocked(g, cx + 2 * dx, cy + 2 * dy, b)) { b.vx = dx; b.vy = dy; b.lock = -1; }
      }
    }

    const ci = idx(Math.round(p.x), Math.round(p.y));
    p.pass = p.pass.filter(id => { const b = g.bombs.find(o => o.id === id); return b && b.i === ci; });
    const c = p.zb ? '.' : g.grid[ci];   // zombies do not pick things up
    if (POWERS.includes(c)) p.picks = (p.picks || 0) + 1;
    if (c === 'b') { if (g.rule !== 'onebomb') p.maxB = Math.min(8, p.maxB + 1); g.grid[ci] = '.'; }
    else if (c === 'f') { p.fire = Math.min(8, p.fire + 1); g.grid[ci] = '.'; }
    else if (c === 's') { p.spd = Math.min(5, p.spd + 1); g.grid[ci] = '.'; }
    else if (c === 'k') { p.kick = true; g.grid[ci] = '.'; }
    else if (c === 'h') { p.shield = true; g.grid[ci] = '.'; }
    else if (c === 'c') { p.ck = 1 + Math.floor(Math.random() * 3); p.ct = CURSE_T; p.autoT = 0; g.grid[ci] = '.'; }
    else if (SHAPE_OF[c]) { p.shape = SHAPE_OF[c]; g.grid[ci] = '.'; }
  }
  // curses spread by touch
  for (const a of g.players) if (a.alive && a.ck) for (const b of g.players)
    if (b !== a && b.alive && !b.ck && !b.zb && Math.hypot(a.x - b.x, a.y - b.y) < 0.8) { b.ck = a.ck; b.ct = a.ct; b.autoT = 0; }
  if (g.mode === 'z') for (const z of g.players) if (z.zb && !z.stun) for (const h of g.players)
    if (!h.zb && h.inv <= 0 && Math.hypot(z.x - h.x, z.y - h.y) < 0.75) infect(g, h, z.id);

  for (const b of g.bombs) if (b.vx || b.vy) slideBomb(g, b, dt);
  for (const b of g.bombs) b.t -= dt;
  for (const b of g.bombs.slice()) if (b.t <= 0) explode(g, b);

  const teamOf = id => { const q = g.players.find(x => x.id === id); return q ? q.team : -999; };
  for (const p of g.players) {
    if (p.alive) {
      if (p.inv > 0) continue;
      const f = g.flames.get(idx(Math.round(p.x), Math.round(p.y)));
      if (!f) continue;
      let killer = null;
      for (const o of f.o) {
        if (o === p.id) { if (killer === null) killer = o; continue; }
        if (!g.teams || teamOf(o) !== p.team) { killer = o; break; }
      }
      if (killer === null) continue;
      if (g.mode === 'z' && p.zb) { p.stun = ZOMBIE_STUN; p.inv = ZOMBIE_STUN + 1; continue; }
      if (p.hp > 1) { p.hp--; p.inv = 1.2; continue; }   // the boss in boss hunt has several lives
      if (p.shield) { p.shield = false; p.inv = SHIELD_INV; continue; }
      if (g.mode === 'z') { infect(g, p, killer); continue; }
      p.alive = false;
      if (g.teams) { p.down = DOWN_T; p.downBy = killer; }   // knocked down, teammates have 3s to rescue
      else { g.kills.push([killer, p.id]); creditGhost(g, killer); }
    } else if (p.down > 0) {
      const saver = g.players.find(q => q.alive && q.team === p.team && Math.hypot(q.x - p.x, q.y - p.y) < REVIVE_DIST);
      if (saver) { p.alive = true; p.down = 0; p.inv = REVIVE_INV; p.pass = []; g.revives.push([saver.id, p.id]); }
      else { p.down -= dt; if (p.down <= 0) { p.down = 0; g.kills.push([p.downBy, p.id]); } }
    }
  }
  if (g.teams) {
    // a team with nobody standing cannot rescue anyone
    const standing = new Set(g.players.filter(p => p.alive).map(p => p.team));
    for (const p of g.players) if (p.down > 0 && !standing.has(p.team)) { p.down = 0; g.kills.push([p.downBy, p.id]); }
  }

  if (g.pve) stepPve(g, inputs, dt);   // monsters and bosses (pve.js)

  for (const [i, f] of g.flames) { f.t -= dt; if (f.t <= 0) g.flames.delete(i); }
  for (const [i, t] of g.burn) {
    if (t - dt <= 0) { g.burn.delete(i); g.grid[i] = g.hidden[i] || '.'; g.hidden[i] = ''; }
    else g.burn.set(i, t - dt);
  }

  g.t = (g.t || 0) + dt;
  tickEvent(g, dt);
  if ((g.t >= SD_START && (g.mode === 's' || g.mode === 't')) || g.sdOn) {
    g.sdAcc = (g.sdAcc || 0) + dt; g.sdk = g.sdk || 0;
    while (g.sdAcc >= SD_STEP && g.sdk < SD_ORDER.length) {
      const i = SD_ORDER[g.sdk++];
      if (g.grid[i] === '#') continue;   // pillars are already walls: skip them for free
      g.sdAcc -= SD_STEP;
      crushCell(g, i);
    }
  }
  tickDrops(g, dt);

  // anyone dead for good (not a downed teammate waiting for rescue) drops what they picked up
  for (const p of g.players) if (!p.alive && p.down <= 0 && !p.dropped) { p.dropped = true; dropItems(g, p); }

  const alive = g.players.filter(p => p.alive);
  let over = false, winners = [];
  if (g.pve) {
    const r = pveResult(g);
    if (r) { over = true; g.winner = r.w; winners = r.winners; }
  } else if (g.mode === 'z') {
    const humans = g.players.filter(p => !p.zb);
    if (g.players.length >= 2 && !humans.length) { over = true; g.winner = 'zombies'; winners = g.players.filter(p => p.z0); }
    else if (g.t >= ZOMBIE_T || g.players.length < 2) { over = true; g.winner = 'humans'; winners = humans; }
  } else if (g.teams) {
    const startTeams = new Set(g.players.map(p => p.team));
    const aliveTeams = new Set(alive.map(p => p.team));
    over = startTeams.size >= 2 ? aliveTeams.size <= 1 : alive.length === 0;
    if (over && aliveTeams.size === 1 && startTeams.size >= 2) {
      const t = [...aliveTeams][0];
      g.winner = 'team' + t; winners = g.players.filter(p => p.team === t);
    }
  } else {
    over = g.players.length >= 2 ? alive.length <= 1 : alive.length === 0;
    if (over && alive[0]) { g.winner = alive[0].id; if (g.players.length >= 2) winners = [alive[0]]; }
  }
  if (over) {
    for (const w of winners) scores[w.id] = (scores[w.id] || 0) + 1;
    g.winnerIds = winners.map(w => w.id);
    g.ph = 'end'; g.timer = END_T; g.justEnded = true;
  }
}

function snapshot(g, scores) {
  return {
    rid: g.rid, md: g.mode || (g.teams ? 't' : 's'), gw: W, gh: H, ru: g.rule || '', mp: g.map || 'classic',
    ph: g.ph, tm: Math.ceil(Math.max(0, g.timer)),
    g: g.grid.join(''),
    bm: g.bombs.map(b => [b.id, b.i, Math.round(b.t * 10), Math.round(b.fx * 100), Math.round(b.fy * 100), (b.vx || b.vy) ? 1 : 0, b.sk | 0, SHAPES.indexOf(b.sh || 'plus')]),
    fl: [...g.flames.keys()],
    fs: [...g.flames.values()].map(f => f.sk | 0),
    ev: g.ev || '', ew: g.evWarn || '', et: Math.ceil(g.ev ? g.evT : g.evWarn ? g.evWarnT : 0),
    pl: g.players.map(p => [p.id, Math.round(p.x * 100), Math.round(p.y * 100), p.alive ? 1 : (p.down > 0 ? 2 : 0), p.color, p.name, p.dir, scores[p.id] || 0, p.team, p.spd, p.kick ? 1 : 0, Math.round(p.down * 10), p.inv > 0 ? 1 : 0, p.shield ? 1 : 0, p.ck || 0, Math.ceil(p.ct || 0), p.zb ? (p.stun > 0 ? 2 : 1) : 0, p.hat || '',
      p.coins || 0, p.hp || 0, p.boss ? 1 : 0, p.maxB, p.fire, SHAPES.indexOf(p.shape || 'plus'), p.skin | 0]),
    w: g.winner || '', pz: g.pz ? 1 : 0,
    sd: g.ph === 'play' && (g.mode === 's' || g.mode === 't') ? Math.max(0, Math.ceil(SD_START - (g.t || 0))) : -1,
    zt: g.ph === 'play' && g.mode === 'z' ? Math.max(0, Math.ceil(ZOMBIE_T - (g.t || 0))) : -1,
    wi: g.ph === 'end' ? g.winnerIds : undefined,
    rw: (g.drops || []).map(d => d.i),
    // end-of-round stats: [id, kills, pickups, revives, how they died: '' alive, '=' own bomb, '#' crushed, else killer id]
    st: g.ph !== 'end' ? undefined : g.players.map(p => {
      const death = g.kills.find(([, v]) => v === p.id);
      const by = !death ? (p.alive ? '' : '-') : death[0] === null ? '#' : death[0] === p.id ? '=' : String(death[0]);
      return [p.id, g.kills.filter(([a, v]) => a === p.id && v !== p.id).length, p.picks || 0, g.revives.filter(([a]) => a === p.id).length, by,
        p.z0 ? 2 : p.zb ? 1 : 0, p.ghostKills || 0, p.mk || 0, p.dmg || 0];
    }),
    ...(g.pve ? pveSnapshot(g) : {})
  };
}
/* ================= END ENGINE ================= */
