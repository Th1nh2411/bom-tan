/* ---------- state ---------- */
let room = null, db = null, userCap = null, connected = false, myPeer = null, myUid = null, authed = true;
const profileNames = new Map(), profilePending = new Set();
function resolveProfiles(ids) {
  if (!userCap) return;
  const need = ids.filter(id => id && !profileNames.has(id) && !profilePending.has(id));
  if (!need.length) return;
  need.forEach(id => profilePending.add(id));
  userCap.profiles(need).then(ps => {
    for (const id of need) { profilePending.delete(id); profileNames.set(id, (ps && ps[id] && ps[id].name) || ''); }
    renderList(); renderLeaderboard();
  }).catch(() => need.forEach(id => profilePending.delete(id)));
}
let mode = 'online';          // 'online' | 'local'
let hosting = false;
let hostMode = 's';   // 's' solo, 't' teams, 'z' zombie
let hostGame = null;
let scores = {};
let snap = null, lastSnapObj = null, lastSnapGrid = null;
let hostPeer = null, hostLeftNotice = false;
// kick: the host keeps a ban list of player keys (per browser) and publishes it; a kicked client disconnects itself
const kicked = new Set();
let kickedOut = false, roomFull = false;
const isKicked = p => kicked.has(p.by) || kicked.has(p.peer);
let pred = null, myTp = 0;
let lb = {};                  // leaderboard cache: key -> doc

function inputChanged() {
  if (room && mode === 'online' && !hosting) { const d = ctlDir(ctlA); room.presence({ dx: d.dx, dy: d.dy, b: d.b, bc: d.bc }).catch(() => {}); }
}
function pushMe() {
  if (room) room.presence({ n: myName, c: myColor, j: joined ? 1 : null, t: myTeam }).catch(() => {});
  renderList();
}

/* ---------- capabilities ---------- */
/* ---------- network: WebSocket room (same API shape the game used before) ---------- */
function sstore(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
const randId = n => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
const PEER_ID = (() => { let v = sstore('bt-peer'); if (!/^[A-Za-z0-9_-]{4,40}$/.test(v || '')) { v = 'p' + randId(15); sstore('bt-peer', v); } return v; })();
const PLAYER_KEY = (() => { let v = store('bt-key'); if (!/^[A-Za-z0-9_-]{4,40}$/.test(v || '')) { v = 'k' + randId(15); store('bt-key', v); } return v; })();
const ROOM_ID = (() => {
  let r = decodeURIComponent(location.hash.slice(1)).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  if (!r) { r = randId(5); history.replaceState(null, '', '#' + r); }
  return r;
})();

function createRoom(roomId, peerId, byId) {
  let ws = null, isConn = false, retry = 500;
  let peerMap = new Map(), peersArr = Object.freeze([]);
  let mine = {}, pending = null, lbFn = null;
  const connFns = [], peersFns = [];
  let denyFn = null, fatalFn = null;   // server refused our host claim / closed us for good (kicked, room full)
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws';
  const mergeP = (a, p) => { const o = { ...a }; for (const k of Object.keys(p || {})) { if (p[k] === null) delete o[k]; else o[k] = p[k]; } return o; };
  const entry = (peer, by, presence) => Object.freeze({ peer, by: by || null, isMe: peer === peerId, sameTab: peer === peerId, kind: 'viewer', guest: false, presence: Object.freeze(presence || {}), updatedAt: Date.now() });
  function emit(joined, left, updated) {
    peersArr = Object.freeze([...peerMap.values()]);
    const ch = { peers: peersArr, joined: joined || [], left: left || [], updated: updated || [] };
    for (const f of peersFns) { try { f(ch); } catch (e) { console.error(e); } }
  }
  function setConn(v) { if (isConn === v) return; isConn = v; for (const f of connFns) { try { f(v); } catch (e) {} } }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function connect() {
    try { ws = new WebSocket(url); } catch (e) { return later(); }
    ws.onopen = () => { retry = 500; send({ t: 'join', room: roomId, peer: peerId, by: byId, p: mine }); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
    ws.onclose = ev => {
      setConn(false);
      if (ev.code === 4001 || ev.code === 4002) { stopped = true; if (fatalFn) fatalFn(ev.code); return; }
      later();
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  let stopped = false;
  function later() { if (stopped) return; setTimeout(connect, retry); retry = Math.min(retry * 2, 8000); }
  function handle(m) {
    if (m.t === 'full') {
      peerMap = new Map();
      for (const e of (m.peers || [])) if (e.peer !== peerId) peerMap.set(e.peer, entry(e.peer, e.by, e.p));
      peerMap.set(peerId, entry(peerId, byId, mine));
      setConn(true);
      emit([...peerMap.values()]);
      if (lbFn) send({ t: 'lb' });
    } else if (m.t === 'join') {
      if (m.peer === peerId) return;
      const e = entry(m.peer, m.by, m.p); peerMap.set(m.peer, e); emit([e]);
    } else if (m.t === 'p') {
      const old = peerMap.get(m.peer);
      if (!old || m.peer === peerId) return;
      const e = entry(m.peer, old.by, mergeP(old.presence, m.p)); peerMap.set(m.peer, e); emit([], [], [e]);
    } else if (m.t === 'leave') {
      const old = peerMap.get(m.peer);
      if (!old || m.peer === peerId) return;
      peerMap.delete(m.peer); emit([], [old]);
    } else if (m.t === 'deny') {
      if (denyFn) denyFn(m.what);
    } else if (m.t === 'lb') {
      if (lbFn) lbFn(Array.isArray(m.rows) ? m.rows : []);
    }
  }
  // send patches as soon as they happen, but at most once per ~16ms (one frame)
  let lastFlush = 0, flushTimer = null;
  function flush() {
    flushTimer = null;
    if (!pending || !isConn) return;
    send({ t: 'p', p: pending }); pending = null; lastFlush = performance.now();
  }
  function scheduleFlush() {
    if (flushTimer) return;
    const wait = 16 - (performance.now() - lastFlush);
    if (wait <= 0) flush(); else flushTimer = setTimeout(flush, wait);
  }
  setInterval(flush, 100);
  connect();
  return {
    presence(patch) {
      // only send what changed: prediction and inputs re-send the same values every frame
      const diff = {};
      for (const k of Object.keys(patch)) {
        const v = patch[k];
        if (v === null ? k in mine : (typeof v === 'object' || mine[k] !== v)) diff[k] = v;
      }
      if (!Object.keys(diff).length) return Promise.resolve();
      mine = mergeP(mine, diff);
      pending = { ...(pending || {}), ...diff };
      scheduleFlush();
      peerMap.set(peerId, entry(peerId, byId, mine));
      peersArr = Object.freeze([...peerMap.values()]);
      return Promise.resolve();
    },
    // send everything once more (a new host never saw our earlier host-only patches)
    resync() { pending = { ...mine }; scheduleFlush(); },
    peers: () => peersArr,
    connected: () => isConn,
    onPeers(fn) { peersFns.push(fn); setTimeout(() => fn({ peers: peersArr, joined: peersArr, left: [], updated: [] }), 0); return () => { const i = peersFns.indexOf(fn); if (i >= 0) peersFns.splice(i, 1); }; },
    onConnection(fn) { connFns.push(fn); setTimeout(() => fn(isConn), 0); return () => { const i = connFns.indexOf(fn); if (i >= 0) connFns.splice(i, 1); }; },
    onLeaderboard(fn) { lbFn = fn; send({ t: 'lb' }); },
    recordLeaderboard(rows) { send({ t: 'lbrec', rows }); },
    onDeny(fn) { denyFn = fn; },
    onFatal(fn) { fatalFn = fn; },
    leave() { stopped = true; try { if (ws) ws.close(); } catch (e) {} setConn(false); }
  };
}

function initNet() {
  myUid = PLAYER_KEY;
  room = createRoom(ROOM_ID, PEER_ID, PLAYER_KEY);
  $('stRoom').textContent = 'phòng #' + ROOM_ID;
  $('lbCard').hidden = false;
  renderLeaderboard();
  room.onLeaderboard(rows => {
    const next = {};
    for (const r of rows) if (r && typeof r.by === 'string') next[r.by] = { u: r.by, n: r.n, w: r.w, g: r.g, k: r.k, s: r.s, r: r.r };
    lb = next; renderLeaderboard();
  });
  room.onConnection(c => { connected = c; updateNetText(); updateUI(); });
  // someone else became host first: step back and follow them
  room.onDeny(what => { if (what === 'host' && hosting) { stopHosting(); onRoomChange(); updateUI(); } });
  room.onFatal(code => { if (code === 4001) kickedOut = true; else roomFull = true; setSnap(null); updateUI(); });
  room.onPeers(ch => {
    const me = ch.peers.find(p => p.sameTab);
    if (me) myPeer = me.peer;
    onRoomChange();
  });
  const d = ctlDir(ctlA);
  room.presence({ n: myName, c: myColor, j: joined ? 1 : null, t: myTeam, dx: d.dx, dy: d.dy, b: d.b, bc: -1 });
}

function peers() { return room ? room.peers() : []; }
function findHost() {
  const hs = peers().filter(p => p.presence && p.presence.h === 1 && p.presence.g && typeof p.presence.g === 'object');
  hs.sort((a, b) => a.peer < b.peer ? -1 : 1);
  return hs[0] || null;
}

function onRoomChange() {
  const h = findHost();
  if (hosting && h && !h.sameTab) stopHosting();
  const prevHost = hostPeer;
  hostPeer = hosting ? myPeer : (h ? h.peer : null);
  if (!hosting && hostPeer && hostPeer !== prevHost) room.resync();
  if (prevHost && !hostPeer && !hosting) hostLeftNotice = true;
  if (hostPeer) hostLeftNotice = false;
  if (!hosting && mode === 'online' && h && (h.presence.g !== lastSnapObj || h.presence.gg !== lastSnapGrid)) {
    lastSnapObj = h.presence.g; lastSnapGrid = h.presence.gg;
    setSnap(sanitizeSnap({ ...h.presence.g, g: h.presence.gg }));
  }
  if (!h && !hosting && mode === 'online' && snap) setSnap(null);
  if (!hosting && snap && (snap.kk.includes(PLAYER_KEY) || snap.kk.includes(myPeer)) && !kickedOut) {
    kickedOut = true; room.leave(); setSnap(null); updateUI();
  }
  // emotes from everyone
  for (const p of peers()) {
    const em = p.presence && p.presence.em;
    if (!Array.isArray(em)) continue;
    const k = em[0] | 0, seq = em[1] | 0;
    if (k < 0 || k >= EMOTES.length) continue;
    if (!emSeen.has(p.peer)) { emSeen.set(p.peer, seq); continue; }
    if (emSeen.get(p.peer) !== seq) { emSeen.set(p.peer, seq); emShow.set(p.peer, { k, until: performance.now() + 2200 }); if (!p.sameTab) sfx.pop(); }
  }
  updateNetText();
  updateUI();
}

function sanitizeSnap(s) {
  if (!s || typeof s.g !== 'string' || !Array.isArray(s.pl)) return null;
  // adopt the host's board size before anything indexes the grid
  if (!setDims(s.gw | 0 || 15, s.gh | 0 || 13) || s.g.length !== W * H) return null;
  const md = s.md === 't' || s.md === 'z' ? s.md : 's';
  const teamRank = [0, 0];
  const pl = s.pl.filter(a => Array.isArray(a) && a.length >= 8).slice(0, 8).map(a => {
    const team = a[8] | 0;
    let color = COLORS[(a[4] | 0) & 7];
    if (md === 't' && (team === 0 || team === 1)) color = TEAM_SHADES[team][teamRank[team]++ % 4];
    return {
      id: String(a[0]), x: (+a[1] || 0) / 100, y: (+a[2] || 0) / 100, alive: a[3] === 1, downed: a[3] === 2,
      downT: Math.max(0, (+a[11] || 0) / 10), inv: !!a[12],
      color, name: cleanName(a[5]) || 'Ẩn danh', dir: a[6] | 0, score: a[7] | 0,
      team, spd: Math.min(5, Math.max(0, a[9] | 0)), kick: !!a[10], shield: !!a[13],
      ck: Math.min(3, Math.max(0, a[14] | 0)), ct: Math.max(0, a[15] | 0), zb: Math.min(2, Math.max(0, a[16] | 0))
    };
  });
  return {
    rid: s.rid | 0, md,
    ph: ['lobby','count','play','end'].includes(s.ph) ? s.ph : 'lobby', tm: s.tm | 0, g: s.g,
    bm: Array.isArray(s.bm) ? s.bm.filter(b => Array.isArray(b) && b.length >= 6).map(b => ({ id: b[0] | 0, i: b[1] | 0, t: b[2] | 0, x: (+b[3] || 0) / 100, y: (+b[4] || 0) / 100, mv: !!b[5] })) : [],
    fl: new Set(Array.isArray(s.fl) ? s.fl.map(n => n | 0) : []),
    pl, w: String(s.w || ''), pz: s.pz === 1, pzb: cleanName(s.pzb),
    kk: Array.isArray(s.kk) ? s.kk.filter(k => typeof k === 'string').slice(0, 64) : [],
    sd: typeof s.sd === 'number' ? s.sd | 0 : -1,
    zt: typeof s.zt === 'number' ? s.zt | 0 : -1,
    wi: Array.isArray(s.wi) ? s.wi.map(String).slice(0, 8) : [],
    rw: Array.isArray(s.rw) ? s.rw.map(n => n | 0).filter(n => n >= 0 && n < W * H).slice(0, 32) : [],
    st: Array.isArray(s.st) ? s.st.filter(a => Array.isArray(a) && a.length >= 5).slice(0, 8).map(a => ({ id: String(a[0]), k: a[1] | 0, it: a[2] | 0, rv: a[3] | 0, by: String(a[4] || ''), zb: a[5] | 0, gk: a[6] | 0 })) : []
  };
}
