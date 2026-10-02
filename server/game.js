// Server-side game: the server runs public/js/engine.js for every room and streams snapshots to the players.
// Players only send controls (and their predicted position, which the engine validates), so every action
// takes one round trip to the server instead of two hops through a player's browser.
//
// engine.js is a classic browser script whose board size (W/H, portals...) is module state. All rooms share
// one engine instance; that is safe because ticks are synchronous and setDims() runs before each room's step.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
for (const f of ['engine.js', 'pve.js']) vm.runInContext(readFileSync(new URL('../public/js/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
const E = vm.runInContext('({ get W() { return W; }, get H() { return H; }, get emptyGrid() { return emptyGrid; }, setDims, sizeFor, newGame, stepGame, snapshot, ghostDrop, buyItem, STAGES, MAP_IDS })', ctx);
const MODES = ['s', 't', 'z', 'h', 'v', 'b', 'c'];
const COOP = new Set(['v', 'b', 'c']);

export const TICK_MS = 33;            // ~30 ticks a second; each tick steps the game and sends what changed (clients smooth/predict in between)
const RECONNECT_MS = 5000;           // a dropped player gets this long to come back before they are out
const OWNER_GRACE_MS = 1500;         // a reconnecting room owner keeps the room for this long
const AUTO_START_MS = 3000;          // everyone in the lobby is ready: the round starts after this countdown

export const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿]/g, '').trim().slice(0, 12);
export const nameOf = c => cleanName(c && c.p.n) || 'Ẩn danh';
const hatOf = c => (typeof c.p.hat === 'string' && /^[a-z]{1,12}$/.test(c.p.hat) ? c.p.hat : '');
const teamOf = c => (c.p.t === 0 || c.p.t === 1 ? c.p.t : -1);
const clampDir = v => (v === 1 || v === -1 ? v : 0);

// r.game: everything the server keeps about a room's game
export function newRoomGame() {
  return {
    mode: 's', g: null, gw: 15, gh: 13, scores: {}, pz: false, pzBy: '', kicked: new Set(),
    owner: null, ownerGoneAt: 0, missing: new Map(), last: 0,
    ready: new Set(), startAt: 0, startIn: -1,   // lobby: who is ready, and the auto-start countdown
    pub: false,                                   // listed in the public room list
    stage: 1, unlocked: 1,                        // campaign: start stage, and the furthest stage reached here
    map: 'random',                                // a MAPS id or 'random' (the campaign has its own maps)
    events: true,                                 // mid-round events (dark, ice, max range)
    body: null, bodyStr: '', grid: ''   // the last snapshot sent: diffs are made against it
  };
}

export function isKicked(r, peer, by) { return r.game.kicked.has(peer) || (!!by && r.game.kicked.has(by)); }
export function activeOwner(r) { const o = r.game.owner; return o && r.local.has(o) ? o : null; }

// the owner (who starts rounds, picks the mode and kicks) is the first signed-in player; when they leave,
// the next one in join order takes over after a short grace period
function ensureOwner(r, now) {
  const gs = r.game;
  if (activeOwner(r)) { gs.ownerGoneAt = 0; return; }
  if (gs.owner) {
    if (!gs.ownerGoneAt) gs.ownerGoneAt = now;
    if (now - gs.ownerGoneAt < OWNER_GRACE_MS) return;
  }
  gs.owner = null; gs.ownerGoneAt = 0;
  for (const [id, c] of r.local) if (c.p.li === 1) { gs.owner = id; break; }
}

// everyone who can play: signed in (li) and not kicked. Only ready ones get a slot in the next round.
export function lobbyPeers(r) {
  return [...r.local].filter(([id, c]) => c.p.li === 1 && !isKicked(r, id, c.by));
}
function readyPeers(r) {
  return lobbyPeers(r).filter(([id]) => r.game.ready.has(id)).slice(0, 8);
}
// "auto-ready" (presence j) ticked: ready as soon as the player is in the lobby
function autoReady(r, id) {
  const c = r.local.get(id);
  if (!r.game.g && c && c.p.j === 1 && c.p.li === 1) r.game.ready.add(id);
}
// presence changed: signing in or ticking auto-ready while in the lobby makes the player ready
export function onPresence(r, id, patch) {
  if (patch.li === 1 || patch.j === 1) autoReady(r, id);
}
export function onJoin(r, id) { autoReady(r, id); }
export function onLeave(r, id) { r.game.ready.delete(id); }
function backToLobby(r) {
  const gs = r.game;
  gs.g = null; gs.startAt = 0; gs.ready.clear();
  for (const id of r.local.keys()) autoReady(r, id);
}

function startRound(r) {
  const gs = r.game, js = readyPeers(r);
  if (!js.length) return;
  const taken = new Set();
  let slots = js.map(([id, c]) => {
    let color = c.p.c | 0;
    if (color < 0 || color > 7 || taken.has(color)) color = [0, 1, 2, 3, 4, 5, 6, 7].find(k => !taken.has(k));
    taken.add(color);
    return { id, uid: c.by || null, name: nameOf(c), color, team: teamOf(c), hat: hatOf(c), skin: c.p.bs | 0 };
  });
  if (gs.mode === 't') {
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
  gs.g = E.newGame(slots, gs.mode === 't', { mode: gs.mode, stage: gs.stage, map: gs.map, events: gs.events });
  gs.gw = E.W; gs.gh = E.H; gs.pz = false; gs.missing.clear(); gs.startAt = 0;
}

function inputsOf(r) {
  const inp = {};
  for (const [peer, c] of r.local) {
    const pr = c.p;
    const o = { dx: clampDir(pr.dx), dy: clampDir(pr.dy), b: typeof pr.b === 'number' ? pr.b : 0, bc: typeof pr.bc === 'number' ? pr.bc | 0 : -1 };
    if (typeof pr.px === 'number' && typeof pr.py === 'number') { o.px = pr.px; o.py = pr.py; o.pd = pr.pd | 0; o.tp = pr.tp | 0; o.pr = pr.pr | 0; }
    if (typeof pr.sk === 'number') o.sk = pr.sk | 0;   // skill key (the boss in boss hunt)
    inp[peer] = o;
  }
  return inp;
}

// leaderboard rows for a finished round. Co-op rounds keep each player's best wave / stage and boss kills;
// versus rounds with fewer than 2 players do not count.
function roundRows(g) {
  if (COOP.has(g.mode)) {
    const rows = g.players.filter(p => p.uid).map(p => ({ by: p.uid, n: p.name, pve: 1, wv: g.wave || 0, stg: g.mode === 'c' ? g.stage + (g.won ? 1 : 0) - 1 : 0, bk: g.mode === 'b' && g.winner === 'win' ? 1 : 0 }));
    return rows.length ? rows : null;
  }
  if (g.players.length < 2) return null;
  const win = new Set(g.winnerIds);
  const rows = g.players.filter(p => p.uid).map(p => ({
    by: p.uid, n: p.name, w: win.has(p.id) ? 1 : 0, g: 1,
    k: g.kills.filter(([a, v]) => a === p.id && v !== p.id).length,
    s: g.kills.filter(([a, v]) => a === p.id && v === p.id).length,
    r: g.revives.filter(([a]) => a === p.id).length,
    d: p.alive || p.down > 0 ? 0 : 1
  }));
  return rows.length ? rows : null;
}

function lobbySnap(r) {
  const gs = r.game, js = lobbyPeers(r).slice(0, 16);
  const sz = E.sizeFor(readyPeers(r).length);   // preview the board size the next round will use
  E.setDims(sz[0], sz[1]);
  return {
    rid: 0, md: gs.mode, ph: 'lobby', tm: 0, g: E.emptyGrid, bm: [], fl: [], gw: E.W, gh: E.H, w: '',
    pl: js.map(([id, c]) => [id, -100, -100, 1, (c.p.c | 0) & 7, nameOf(c), 2, gs.scores[id] || 0, teamOf(c), 0, 0, 0, 0, 0, 0, 0, 0, hatOf(c)])
  };
}

// recompute the snapshot; returns the message carrying what changed since the last one, or null
export function refresh(r) {
  const gs = r.game;
  let raw;
  if (gs.g) { E.setDims(gs.gw, gs.gh); raw = E.snapshot(gs.g, gs.scores); } else raw = lobbySnap(r);
  raw.pz = gs.pz ? 1 : 0;
  if (gs.pz) raw.pzb = gs.pzBy;
  if (gs.kicked.size) raw.kk = [...gs.kicked];
  raw.ow = activeOwner(r) || '';
  raw.pb = gs.pub ? 1 : 0;
  if (!gs.g) { raw.rd = [...gs.ready]; raw.sa = gs.startIn; raw.cs = gs.stage; raw.cu = gs.unlocked; raw.mp = gs.map; raw.evs = gs.events ? 1 : 0; }
  // the grid travels on its own and only when it changes
  const { g: grid, ...body } = raw;
  const bodyStr = JSON.stringify(body);
  let msg = '';
  if (grid !== gs.grid) { gs.grid = grid; msg += ',"gg":' + JSON.stringify(grid); }
  if (bodyStr !== gs.bodyStr) { gs.bodyStr = bodyStr; gs.body = body; msg += ',"b":' + bodyStr; }
  return msg ? '{"t":"g"' + msg + '}' : null;
}

// one server tick for a room: returns { msg } to send to everyone, and { rows } when a round just ended
export function tickRoom(r, now) {
  const gs = r.game;
  const dt = gs.last ? Math.min(0.05, Math.max(0, now - gs.last) / 1000) : 0;
  gs.last = now;
  ensureOwner(r, now);
  let rows = null;
  const g = gs.g;
  if (g) {
    E.setDims(gs.gw, gs.gh);
    const inputs = inputsOf(r);
    if (gs.pz) {
      // paused: keep bomb counters in sync so presses made during the pause do not fire on resume
      for (const p of g.players) { const i = inputs[p.id]; if (i) p.lastB = i.b; }
    } else {
      for (const p of g.players) {
        if (!p.alive) continue;
        if (r.local.has(p.id)) { gs.missing.delete(p.id); continue; }
        if (!gs.missing.has(p.id)) gs.missing.set(p.id, now);
        else if (now - gs.missing.get(p.id) > RECONNECT_MS) { p.alive = false; gs.missing.delete(p.id); }
      }
      E.stepGame(g, inputs, dt, gs.scores);
      if (g.justEnded) {
        rows = roundRows(g);
        if (g.mode === 'c') gs.unlocked = Math.min(E.STAGES.length, Math.max(gs.unlocked, g.stage));
      }
      if (g.ph === 'end' && g.timer <= 0) backToLobby(r);
    }
  } else {
    // everyone who can play is ready (at least 2 of them): count down, then start
    const all = lobbyPeers(r), ready = all.filter(([id]) => gs.ready.has(id));
    if (all.length >= 2 && ready.length === all.length && !gs.pz) {
      if (!gs.startAt) gs.startAt = now + AUTO_START_MS;
      if (now >= gs.startAt) startRound(r);
    } else gs.startAt = 0;
  }
  gs.startIn = !gs.g && gs.startAt ? Math.max(1, Math.ceil((gs.startAt - now) / 1000)) : -1;
  return { msg: refresh(r), rows };
}

// {t:'cmd'} messages. Anyone in the room may pause or drop a ghost bomb; the rest is for the owner.
export function command(r, me, m) {
  const gs = r.game, c = r.local.get(me);
  if (!c) return;
  if (m.c === 'pause') { gs.pz = !!m.on; if (gs.pz) gs.pzBy = nameOf(c); return; }
  if (m.c === 'ready') { if (!gs.g && c.p.li === 1) { if (m.on) gs.ready.add(me); else gs.ready.delete(me); } return; }
  if (m.c === 'buy') { if (gs.g && typeof m.item === 'string') E.buyItem(gs.g, me, m.item); return; }
  if (m.c === 'ghost') {
    if (gs.g && !gs.pz && Number.isInteger(m.cell)) { E.setDims(gs.gw, gs.gh); E.ghostDrop(gs.g, me, m.cell); }
    return;
  }
  if (me !== activeOwner(r)) return;
  if (m.c === 'mode') { if (!gs.g && MODES.includes(m.m)) gs.mode = m.m; }
  else if (m.c === 'events') { if (!gs.g) gs.events = !!m.on; }
  else if (m.c === 'map') { if (!gs.g && (m.map === 'random' || E.MAP_IDS.includes(m.map))) gs.map = m.map; }
  else if (m.c === 'stage') { const n = m.n | 0; if (!gs.g && n >= 1 && n <= gs.unlocked) gs.stage = n; }
  else if (m.c === 'start') { if (!gs.g) { gs.ready.add(me); startRound(r); } }   // the owner can start without waiting for everyone
  else if (m.c === 'lobby') { if (gs.g) backToLobby(r); }
  else if (m.c === 'public') gs.pub = !!m.on;
  else if (m.c === 'kick') kick(r, m.peer);
}

function kick(r, peer) {
  if (typeof peer !== 'string' || peer === r.game.owner) return;
  const gs = r.game, c = r.local.get(peer);
  gs.kicked.add(peer);
  if (c && c.by) gs.kicked.add(c.by);
  if (gs.g) for (const p of gs.g.players) if (p.id === peer) { p.alive = false; p.down = 0; }
  if (c) try { c.ws.close(4001, 'kicked'); } catch {}
}
