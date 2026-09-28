/* ---------- snapshot changes -> sounds and shake ---------- */
let shake = 0;
function setSnap(next) {
  const prev = snap;
  snap = next;
  if (!next || !prev) return;
  if (prev.rid !== next.rid) { if (next.ph === 'count') sfx.beep(false); return; }
  if (next.ph === 'count' && prev.tm !== next.tm) sfx.beep(false);
  if (prev.ph === 'count' && next.ph === 'play') sfx.beep(true);
  if (next.ph === 'play' || prev.ph === 'play') {
    const prevCells = new Set(prev.bm.map(b => b.id));
    if (next.bm.some(b => !prevCells.has(b.id))) sfx.place();
    const prevMv = new Set(prev.bm.filter(b => b.mv).map(b => b.id));
    if (next.bm.some(b => b.mv && !prevMv.has(b.id))) sfx.kick();
    let newFl = 0; for (const i of next.fl) if (!prev.fl.has(i)) newFl++;
    if (newFl) { sfx.boom(newFl); if (!reduceMotion) shake = Math.min(1, shake + 0.35 + newFl * 0.04); }
    for (const p of next.pl) {
      const q = prev.pl.find(o => o.id === p.id);
      if (!q) continue;
      if (q.alive && p.downed) sfx.down();
      else if ((q.alive || q.downed) && !p.alive && !p.downed) sfx.death();
      else if (q.downed && p.alive) sfx.revive();
      else if (q.shield && !p.shield && p.alive) sfx.down();
      else if (!q.zb && p.zb) sfx.death();
      else if (p.alive && Math.hypot(p.x - q.x, p.y - q.y) > 2.5 && !(mode === 'online' && p.id === myPeer && pred)) sfx.teleport();
    }
    for (let i = 0; i < W * H; i++) if (POWERS.includes(prev.g[i]) && next.g[i] === '.' && !next.fl.has(i)) { sfx.pickup(); break; }
  }
  if (prev.ph !== 'end' && next.ph === 'end') {
    onRoundEnd(next);
    const me = next.pl.find(p => p.id === (mode === 'local' ? 'p1' : myPeer));
    const won = me && next.wi.includes(me.id);
    if (mode === 'local' || won) sfx.win(); else sfx.lose();
  }
}

/* ---------- hosting ---------- */
const RECONNECT_MS = 5000, missingSince = new Map();
// when the host leaves, the remaining player with the smallest peer id takes over after a short grace period
// (the server refuses a second host, so two players racing for it is harmless)
function maybeTakeOverHost() {
  if (hosting || mode !== 'online' || !room || !connected || kickedOut || !hostLeftAt || findHost()) return;
  if (Date.now() - hostLeftAt < 1500) return;
  const next = peers().map(p => p.peer).sort()[0];
  if (next === myPeer) { hostLeftAt = 0; startHosting(); toast('Bạn là chủ phòng mới', 'Chủ phòng cũ đã rời đi.'); }
}
function startHosting() {
  if (!room || !connected) return;
  hosting = true; hostGame = null; scores = {}; pred = null; hostPz = false; pzSeen.clear(); gbSeen.clear(); kicked.clear();
  mode = 'online';
  publishHost(true);
  onRoomChange();
}
function stopHosting() {
  hosting = false; hostGame = null;
  lastPubBody = lastPubGrid = '';
  if (room) room.presence({ h: null, g: null, gg: null }).catch(() => {});
}
function joinedPeers() {
  return peers().filter(p => p.kind === 'viewer' && p.presence && p.presence.j === 1 && !isKicked(p)).slice(0, 8);
}
function peerName(p) { return p.sameTab ? myName : (cleanName(p.presence.n) || 'Ẩn danh'); }
function hostStartRound() {
  const js = joinedPeers();
  if (!js.length) return;
  const taken = new Set();
  let slots = js.map(p => {
    let c = (p.presence.c | 0);
    if (c < 0 || c > 7 || taken.has(c)) c = [0,1,2,3,4,5,6,7].find(k => !taken.has(k));
    taken.add(c);
    const t = p.sameTab ? myTeam : p.presence.t;
    return { id: p.peer, uid: p.by || null, name: peerName(p), color: c, team: (t === 0 || t === 1) ? t : -1, hat: HATS[p.presence.hat] ? p.presence.hat : '' };
  });
  if (hostMode === 't') {
    for (const s of slots) if (s.team < 0) {
      const c0 = slots.filter(o => o.team === 0).length, c1 = slots.filter(o => o.team === 1).length;
      s.team = c0 <= c1 ? 0 : 1;
    }
    const c0 = slots.filter(s => s.team === 0).length;
    if (slots.length >= 2 && (c0 === 0 || c0 === slots.length)) slots.forEach((s, k) => s.team = k % 2);
    const t0 = slots.filter(s => s.team === 0), t1 = slots.filter(s => s.team === 1);
    slots = [];
    for (let k = 0; k < Math.max(t0.length, t1.length); k++) { if (t0[k]) slots.push(t0[k]); if (t1[k]) slots.push(t1[k]); }
  }
  hostGame = newGame(slots, hostMode === 't', { mode: hostMode, rule: hostDaily ? dailyRuleFor(todayVN()) : '' });
}
const clampDir = v => (v === 1 || v === -1) ? v : 0;
function hostInputs() {
  const inp = {};
  for (const p of peers()) {
    if (p.sameTab || isKicked(p)) continue;
    const pr = p.presence || {};
    const o = { dx: clampDir(pr.dx), dy: clampDir(pr.dy), b: typeof pr.b === 'number' ? pr.b : 0, bc: typeof pr.bc === 'number' ? pr.bc | 0 : -1 };
    if (typeof pr.px === 'number' && typeof pr.py === 'number') { o.px = pr.px; o.py = pr.py; o.pd = pr.pd | 0; o.tp = pr.tp | 0; o.pr = pr.pr | 0; }
    inp[p.peer] = o;
  }
  if (myPeer) inp[myPeer] = ctlDir(ctlA);
  return inp;
}

function recordRound(g) {
  if (!room || g.players.length < 2) return;
  const winSet = new Set(g.winnerIds);
  const rows = g.players.filter(p => p.uid).map(p => ({
    by: p.uid, n: p.name, w: winSet.has(p.id) ? 1 : 0, g: 1,
    k: g.kills.filter(([a, v]) => a === p.id && v !== p.id).length,
    s: g.kills.filter(([a, v]) => a === p.id && v === p.id).length,
    r: g.revives.filter(([a]) => a === p.id).length,
    d: p.alive || p.down > 0 ? 0 : 1
  }));
  if (rows.length) room.recordLeaderboard(rows);
}

function lobbySnap() {
  const js = joinedPeers();
  const sz = sizeFor(js.length);   // preview the board size the next round will use
  setDims(sz[0], sz[1]);
  return {
    rid: 0, md: hostMode, ph: 'lobby', tm: 0, g: emptyGrid, bm: [], fl: [], gw: W, gh: H,
    pl: js.map(p => { const t = p.sameTab ? myTeam : p.presence.t; return [p.peer, -100, -100, 1, (p.presence.c | 0) & 7, peerName(p), 2, scores[p.peer] || 0, (t === 0 || t === 1) ? t : -1, 0, 0, 0, 0, 0, 0, 0, 0, HATS[p.presence.hat] ? p.presence.hat : '']; }),
    ru: hostDaily ? dailyRuleFor(todayVN()) : '',
    w: ''
  };
}

let lastPub = 0, lastPubBody = '', lastPubGrid = '';
function publishHost(force) {
  const now = performance.now();
  const raw = hostGame ? snapshot(hostGame, scores) : lobbySnap();
  raw.pz = hostPz ? 1 : 0;
  if (hostPz) raw.pzb = hostPzBy;
  if (kicked.size) raw.kk = [...kicked];
  setSnap(sanitizeSnap(raw));
  if (!force && now - lastPub < 20) return;
  // the grid travels in its own key (gg) and only when it changes; frames where nothing changed are skipped
  const { g: grid, ...body } = raw;
  const bodyStr = JSON.stringify(body), patch = {};
  if (grid !== lastPubGrid) { patch.gg = grid; lastPubGrid = grid; }
  if (bodyStr !== lastPubBody) { patch.g = body; lastPubBody = bodyStr; }
  if (!patch.g && !patch.gg) return;
  lastPub = now; patch.h = 1;
  room.presence(patch).catch(() => {});
}

/* ---------- client-side prediction ---------- */
let predGridStr = '', predGrid = [];
function predictStep(dt) {
  if (mode !== 'online' || hosting || !room || !snap || snap.ph !== 'play') { pred = null; return; }
  if (snap.pz) return;   // paused: hold the predicted position
  const me = snap.pl.find(p => p.id === myPeer);
  if (!me || !me.alive) { pred = null; return; }
  if (!pred || pred.rid !== snap.rid) pred = { rid: snap.rid, x: me.x, y: me.y, dir: me.dir, pass: [], lock: -1, err: 0, tpT: 0, bombs: new Set() };
  if (snap.g !== predGridStr) { predGridStr = snap.g; predGrid = snap.g.split(''); }
  const bombs = snap.bm.map(b => ({ id: b.i, i: b.i }));
  const ci = idx(Math.round(pred.x), Math.round(pred.y));
  for (const b of bombs) if (b.i === ci && !pred.bombs.has(b.i)) pred.pass.push(b.i);
  pred.bombs = new Set(bombs.map(b => b.i));
  const view = { grid: predGrid, bombs };
  const pp = { x: pred.x, y: pred.y, pass: pred.pass, lock: pred.lock };
  let d = ctlDir(ctlA);
  if (me.ck === 1) d = { ...d, dx: -d.dx, dy: -d.dy };   // reversed-controls curse
  if (me.zb === 2) d = { ...d, dx: 0, dy: 0 };             // stunned zombie
  if (d.dx || d.dy) {
    pred.dir = d.dx > 0 ? 1 : d.dx < 0 ? 3 : d.dy > 0 ? 2 : 0;
    tryMove(view, pp, d.dx, d.dy, speedOf(me) * dt);
    if (portalCheck(pp)) { myTp++; pred.tpT = 1; sfx.teleport(); }
  }
  pred.x = pp.x; pred.y = pp.y; pred.lock = pp.lock;
  const ni = idx(Math.round(pred.x), Math.round(pred.y));
  pred.pass = pp.pass.filter(i => i === ni && pred.bombs.has(i));
  // reconcile with the host
  const err = Math.hypot(me.x - pred.x, me.y - pred.y);
  const moving = !!(d.dx || d.dy);
  // after a teleport the host snapshot still shows us at the entry portal for about one round trip;
  // snapping back then would re-enter the portal and loop, so wait for the host to catch up
  if (pred.tpT > 0) { pred.tpT = err < 1.4 ? 0 : pred.tpT - dt; pred.err = 0; }
  else if (err > (moving ? 1.4 : 0.3)) pred.err += dt; else pred.err = 0;
  if (pred.tpT <= 0 && (err > 3.5 || pred.err > (moving ? 0.35 : 0.5))) { pred.x = me.x; pred.y = me.y; pred.err = 0; pred.pass = []; pred.lock = -1; }
  room.presence({ px: Math.round(pred.x * 100), py: Math.round(pred.y * 100), pd: pred.dir, tp: myTp, pr: pred.rid }).catch(() => {});
}

/* ---------- local mode ---------- */
function localSlots() { return [{ id: 'p1', name: 'P1 (WASD)', color: 0 }, { id: 'p2', name: 'P2 (Mũi tên)', color: 1 }]; }
function startLocal() { mode = 'local'; scores = {}; pred = null; hostGame = newGame(localSlots(), false); snap = null; lastSnapObj = null; updateUI(); }
function stopLocal() { mode = 'online'; hostGame = null; snap = null; onRoomChange(); }

/* ---------- pause (Esc): anyone can pause the whole room; the board is covered by a code tab ---------- */
let coverLocal = false, pzSeq = 0, hostPz = false, hostPzBy = '';   // hostPz: room-wide pause, owned by the host (lobby or in game)
const pzSeen = new Map();   // peer -> last pause-request seq the host has handled
// while paused, keep bomb counters in sync so presses made during the pause do not fire on resume
function holdInputs(g, inputs) { for (const p of g.players) { const inp = inputs[p.id]; if (inp) p.lastB = inp.b; } }
function hostPauseRequests() {
  for (const p of peers()) {
    if (p.sameTab || isKicked(p)) continue;
    const z = p.presence && p.presence.pz, seq = Array.isArray(z) ? z[1] | 0 : 0;
    const seen = pzSeen.get(p.peer);
    pzSeen.set(p.peer, seq);
    if (seen === undefined || seen === seq) continue;
    hostPz = z[0] === 1; hostPzBy = peerName(p);
    publishHost(true);
  }
}
// Esc pauses, ` resumes; each key only goes one way so a stray press never undoes the other
function setPause(want) {
  if (!want) coverLocal = false;
  if (mode === 'local' && hostGame) hostGame.pz = want;
  else if (mode === 'online' && hosting) { if (hostPz !== want) { hostPz = want; if (want) hostPzBy = myName; publishHost(true); } }
  else if (mode === 'online' && room && snap) { if (snap.pz !== want) room.presence({ pz: [want ? 1 : 0, ++pzSeq] }).catch(() => {}); }
  else if (want) coverLocal = true;   // nobody is hosting yet: cover this screen only
  updateCover();
}
function updateCover() {
  const on = coverLocal || !!(snap && snap.pz);
  const by = !coverLocal && snap && snap.pz ? snap.pzb : '';
  const pzEl = $('coverPz');
  if (pzEl.dataset.by !== by) {
    pzEl.dataset.by = by;
    pzEl.textContent = by ? '⏸ Pause bởi ' : '⏸ Pause';
    if (by) { const b = document.createElement('b'); b.textContent = by; pzEl.append(b); }
    pzEl.append(' · ` để tiếp tục');
  }
  const el = $('cover');
  if (el.hidden === !on) return;
  el.hidden = !on;
  document.body.classList.toggle('covered', on);
  document.title = on ? 'invoice.service.ts — workspace' : 'bom_tan.js — workspace';
  if (on) clearMoveTarget();
}
const FAKE_CODE = `import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { paginate, PageQuery } from '../common/pagination';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly repo: Repository<Invoice>,
  ) {}

  async findAll(query: PageQuery) {
    const qb = this.repo.createQueryBuilder('inv')
      .leftJoinAndSelect('inv.items', 'item')
      .where('inv.deletedAt IS NULL')
      .orderBy('inv.createdAt', 'DESC');
    if (query.status) qb.andWhere('inv.status = :status', { status: query.status });
    return paginate(qb, query.page ?? 1, query.limit ?? 20);
  }

  async create(dto: CreateInvoiceDto, userId: number) {
    // totals are recomputed server-side, never trusted from the client
    const subtotal = dto.items.reduce((s, i) => s + i.price * i.qty, 0);
    const tax = Math.round(subtotal * 0.1);
    const invoice = this.repo.create({ ...dto, subtotal, tax, total: subtotal + tax, createdBy: userId });
    const saved = await this.repo.save(invoice);
    this.logger.log(\`invoice \${saved.id} created by \${userId}\`);
    return saved;
  }

  async markPaid(ids: number[]) {
    if (!ids.length) return { updated: 0 };
    const res = await this.repo.update({ id: In(ids) }, { status: 'paid', paidAt: new Date() });
    return { updated: res.affected ?? 0 };
  }

  async remove(id: number) {
    const found = await this.repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException(\`invoice \${id} not found\`);
    await this.repo.softDelete(id);
  }
}`;
function highlightLine(s) {
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const re = /(\/\/.*$)|('[^']*'|`[^`]*`)|\b(import|from|export|class|const|private|readonly|new|async|await|return|if|throw|of|this)\b|\b(\d+(?:\.\d+)?)\b|(@?[A-Za-z_]\w*)(?=\s*\()|\b([A-Z]\w*)\b/g;
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    const cls = m[1] ? 'cm' : m[2] ? 'st' : m[3] ? 'kw' : m[4] ? 'nu' : m[5] ? 'fn' : 'ty';
    out += `<span class="c-${cls}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return out + esc(s.slice(last));
}
$('coverCode').innerHTML = FAKE_CODE.split('\n').map((l, k) => `<div><span class="ln">${k + 1}</span>${highlightLine(l) || ' '}</div>`).join('');
