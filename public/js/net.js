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
let localGame = null;         // 2 players on 1 machine: the game runs in this browser
let scores = {};              // local mode wins
// snap: what the board shows. net: the room as the server last sent it (sidebar, owner, ready...).
// Between rounds (and outside any room) the board shows a practice field of your own instead of the room.
let snap = null, net = null, practice = null, myRtt = 0;
let kickedOut = false, roomFull = false;
let pred = null, myTp = 0;
// the room owner (picked by the server) starts rounds, picks the mode and kicks
const isOwner = () => mode === 'online' && !!net && !!myPeer && net.ow === myPeer;
let lb = {};                  // leaderboard cache: key -> doc

function inputChanged() {
  // key presses go out at once (not batched with the per-frame position) so bombs land without delay
  if (room && mode === 'online') { const d = ctlDir(ctlA); room.presence({ dx: d.dx, dy: d.dy, b: d.b, bc: d.bc, sk: d.sk }, true).catch(() => {}); }
}
function pushMe() {
  if (room) room.presence({ n: myName, c: myColor, j: joined ? 1 : null, t: myTeam, hat: myHat || null, li: isLoggedIn() ? 1 : null }).catch(() => {});
  renderList();
}

/* ---------- capabilities ---------- */
/* ---------- network: WebSocket room (same API shape the game used before) ---------- */
function sstore(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
const randId = n => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
const PEER_ID = (() => { let v = sstore('bt-peer'); if (!/^[A-Za-z0-9_-]{4,40}$/.test(v || '')) { v = 'p' + randId(15); sstore('bt-peer', v); } return v; })();
const PLAYER_KEY = (() => { let v = store('bt-key'); if (!/^[A-Za-z0-9_-]{4,40}$/.test(v || '')) { v = 'k' + randId(15); store('bt-key', v); } return v; })();
// the room is the part of the link after #; no # means no room yet (rooms list + practice field)
const ROOM_ID = decodeURIComponent(location.hash.slice(1)).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
const goRoom = id => { location.hash = id; };
const leaveRoom = () => { location.href = location.pathname + location.search; };

// opts.session(): the signed-in session to present when (re)joining, or null
function createRoom(roomId, peerId, byId, opts = {}) {
  let ws = null, isConn = false, retry = 500;
  let peerMap = new Map(), peersArr = Object.freeze([]);
  let mine = {}, pending = null, lbFn = null, gameFn = null, gBody = null, gGrid = '';
  const connFns = [], peersFns = [];
  let fatalFn = null, rttFn = null, authFn = null, byFn = null, pendingToken = null;
  // measure the round trip to the server every 2s (shown in the player list)
  setInterval(() => { if (isConn) send({ t: 'ping', ts: performance.now() }); }, 2000);
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
    ws.onopen = () => {
      retry = 500;
      if (roomId) return send({ t: 'join', room: roomId, peer: peerId, by: byId, p: mine, session: opts.session ? opts.session() : null });
      // no room: the socket is still used for sign-in and the leaderboard
      peerMap = new Map([[peerId, entry(peerId, byId, mine)]]);
      setConn(true);
      emit([...peerMap.values()]);
      if (pendingToken) { send({ t: 'auth', token: pendingToken }); pendingToken = null; }
      if (lbFn) send({ t: 'lb' });
    };
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
      if (typeof m.by === 'string' && m.by && m.by !== byId) { byId = m.by; if (byFn) byFn(byId); }
      peerMap = new Map();
      for (const e of (m.peers || [])) if (e.peer !== peerId) peerMap.set(e.peer, entry(e.peer, e.by, e.p));
      peerMap.set(peerId, entry(peerId, byId, mine));
      if (m.g && typeof m.gg === 'string') { gBody = m.g; gGrid = m.gg; if (gameFn) gameFn(gBody, gGrid); }
      setConn(true);
      if (pendingToken) { send({ t: 'auth', token: pendingToken }); pendingToken = null; }
      emit([...peerMap.values()]);
      if (lbFn) send({ t: 'lb' });
    } else if (m.t === 'g') {
      // the server's game: only the parts that changed since the last message
      if (m.b && typeof m.b === 'object') gBody = m.b;
      if (typeof m.gg === 'string') gGrid = m.gg;
      if (gBody && gameFn) gameFn(gBody, gGrid);
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
    } else if (m.t === 'authed' || m.t === 'authfail') {
      if (authFn) authFn(m.t === 'authed' ? m : null);
    } else if (m.t === 'by') {
      // a player signed in: their player key changed
      const old = peerMap.get(m.peer);
      if (old && m.peer !== peerId) { const e = entry(m.peer, m.by, old.presence); peerMap.set(m.peer, e); emit([], [], [e]); }
    } else if (m.t === 'pong') {
      if (rttFn && typeof m.ts === 'number') rttFn(Math.max(0, Math.round(performance.now() - m.ts)));
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
    // now: send at once instead of waiting for the next ~16ms batch
    presence(patch, now) {
      // only send what changed: prediction and inputs re-send the same values every frame
      const diff = {};
      for (const k of Object.keys(patch)) {
        const v = patch[k];
        if (v === null ? k in mine : (typeof v === 'object' || mine[k] !== v)) diff[k] = v;
      }
      if (!Object.keys(diff).length) return Promise.resolve();
      mine = mergeP(mine, diff);
      pending = { ...(pending || {}), ...diff };
      if (now) flush(); else scheduleFlush();
      peerMap.set(peerId, entry(peerId, byId, mine));
      peersArr = Object.freeze([...peerMap.values()]);
      return Promise.resolve();
    },
    peers: () => peersArr,
    connected: () => isConn,
    onPeers(fn) { peersFns.push(fn); setTimeout(() => fn({ peers: peersArr, joined: peersArr, left: [], updated: [] }), 0); return () => { const i = peersFns.indexOf(fn); if (i >= 0) peersFns.splice(i, 1); }; },
    onConnection(fn) { connFns.push(fn); setTimeout(() => fn(isConn), 0); return () => { const i = connFns.indexOf(fn); if (i >= 0) connFns.splice(i, 1); }; },
    onLeaderboard(fn) { lbFn = fn; send({ t: 'lb' }); },
    onGame(fn) { gameFn = fn; },
    // room commands for the server: pause, ghost bombs, and the owner's start / lobby / mode / kick
    cmd(o) { send({ t: 'cmd', ...o }); },
    onRtt(fn) { rttFn = fn; },
    onAuth(fn) { authFn = fn; },
    onMyBy(fn) { byFn = fn; },
    // send a Google ID token to the server (now, or as soon as we are connected)
    auth(token) { if (isConn) send({ t: 'auth', token }); else pendingToken = token; },
    setBy(v) { byId = v; peerMap.set(peerId, entry(peerId, byId, mine)); peersArr = Object.freeze([...peerMap.values()]); },
    onFatal(fn) { fatalFn = fn; },
    leave() { stopped = true; try { if (ws) ws.close(); } catch (e) {} setConn(false); }
  };
}

function initNet() {
  myUid = authInfo ? authInfo.by : PLAYER_KEY;
  room = createRoom(ROOM_ID, PEER_ID, myUid, { session: () => (authInfo ? authInfo.session : null) });
  room.onAuth(onAuthResult);
  room.onMyBy(by => { myUid = by; if (authInfo && authInfo.by !== by && by.startsWith('g_')) saveAuth({ ...authInfo, by }); renderLeaderboard(); });
  $('stRoom').textContent = ROOM_ID ? 'phòng #' + ROOM_ID : 'chưa vào phòng';
  $('roomBadge').textContent = ROOM_ID ? '#' + ROOM_ID : '';
  renderLeaderboard();
  room.onLeaderboard(rows => {
    const next = {};
    for (const r of rows) if (r && typeof r.by === 'string') next[r.by] = { u: r.by, n: r.n, w: r.w, g: r.g, k: r.k, s: r.s, r: r.r, wv: r.wv | 0, stg: r.stg | 0, bk: r.bk | 0 };
    lb = next; renderLeaderboard();
  });
  room.onConnection(c => { connected = c; updateNetText(); updateUI(); });
  room.onGame((b, gg) => {
    const prev = net;
    net = sanitizeSnap({ ...b, g: gg });
    if (mode === 'online') {   // local mode owns the board until it ends
      if (net && net.ph !== 'lobby') { practice = null; setSnap(net); }
      else if (!practice) startPractice();
    }
    maybeMakePublic();
    // owner, phase, mode or pause changed: show the right buttons now rather than on the next UI refresh
    if (!prev || !net || prev.ow !== net.ow || prev.ph !== net.ph || prev.md !== net.md || prev.pz !== net.pz) updateUI();
  });
  room.onRtt(ms => { myRtt = ms; room.presence({ rt: Math.round(ms / 5) * 5 }).catch(() => {}); });
  room.onFatal(code => { if (code === 4001) kickedOut = true; else roomFull = true; net = null; if (!practice && mode === 'online') startPractice(); updateUI(); });
  room.onPeers(ch => {
    const me = ch.peers.find(p => p.sameTab);
    if (me) myPeer = me.peer;
    if (practice && myPeer) practice.players[0].id = myPeer;
    onRoomChange();
  });
  const d = ctlDir(ctlA);
  room.presence({ n: myName, c: myColor, j: joined ? 1 : null, t: myTeam, hat: myHat || null, li: isLoggedIn() ? 1 : null, dx: d.dx, dy: d.dy, b: d.b, bc: -1 });
}

function peers() { return room ? room.peers() : []; }
function onRoomChange() {
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

const MODES = ['s', 't', 'z', 'h', 'v', 'b', 'c', 'p'];
const nums = (a, max, lim = 64) => Array.isArray(a) ? a.map(n => n | 0).filter(n => n >= 0 && n < max).slice(0, lim) : [];
function sanitizeSnap(s) {
  if (!s || typeof s.g !== 'string' || !Array.isArray(s.pl)) return null;
  const lobby = s.ph === 'lobby';
  // adopt the server's board size before anything indexes the grid (a lobby has no board: the practice field keeps its own)
  if (!lobby && (!setDims(s.gw | 0 || 15, s.gh | 0 || 13) || s.g.length !== W * H)) return null;
  const md = MODES.includes(s.md) ? s.md : 's';
  const teamRank = [0, 0];
  const pl = s.pl.filter(a => Array.isArray(a) && a.length >= 8).slice(0, 16).map(a => {
    const team = a[8] | 0;
    let color = COLORS[(a[4] | 0) & 7];
    if (md === 't' && (team === 0 || team === 1)) color = TEAM_SHADES[team][teamRank[team]++ % 4];
    return {
      id: String(a[0]), x: (+a[1] || 0) / 100, y: (+a[2] || 0) / 100, alive: a[3] === 1, downed: a[3] === 2,
      downT: Math.max(0, (+a[11] || 0) / 10), inv: !!a[12],
      color, name: cleanName(a[5]) || 'Ẩn danh', dir: a[6] | 0, score: a[7] | 0,
      team, spd: Math.min(5, Math.max(0, a[9] | 0)), kick: !!a[10], shield: !!a[13],
      ck: Math.min(3, Math.max(0, a[14] | 0)), ct: Math.max(0, a[15] | 0), zb: Math.min(2, Math.max(0, a[16] | 0)), hat: HATS[a[17]] ? a[17] : '',
      coins: Math.max(0, a[18] | 0), hp: Math.max(0, a[19] | 0), boss: a[20] === 1, maxB: a[21] | 0, fire: a[22] | 0
    };
  });
  const cells = lobby ? 0 : W * H;
  const bo = Array.isArray(s.bo) && s.bo.length >= 8 ? s.bo : null;
  return {
    rid: s.rid | 0, md, gw: s.gw | 0, gh: s.gh | 0,
    ph: ['lobby','count','play','end'].includes(s.ph) ? s.ph : 'lobby', tm: s.tm | 0, g: lobby ? '' : s.g,
    bm: Array.isArray(s.bm) ? s.bm.filter(b => Array.isArray(b) && b.length >= 6).map(b => ({ id: b[0] | 0, i: b[1] | 0, t: b[2] | 0, x: (+b[3] || 0) / 100, y: (+b[4] || 0) / 100, mv: !!b[5] })) : [],
    fl: new Set(Array.isArray(s.fl) ? s.fl.map(n => n | 0) : []),
    pl, w: String(s.w || ''), pz: s.pz === 1, pzb: cleanName(s.pzb), ow: typeof s.ow === 'string' ? s.ow : '', pb: s.pb === 1,
    rd: Array.isArray(s.rd) ? s.rd.map(String).slice(0, 16) : [], sa: typeof s.sa === 'number' ? s.sa | 0 : -1,
    cs: Math.max(1, s.cs | 0), cu: Math.max(1, s.cu | 0),
    kk: Array.isArray(s.kk) ? s.kk.filter(k => typeof k === 'string').slice(0, 64) : [],
    sd: typeof s.sd === 'number' ? s.sd | 0 : -1,
    zt: typeof s.zt === 'number' ? s.zt | 0 : -1,
    ru: DAILY_RULES[s.ru] ? s.ru : '',
    wi: Array.isArray(s.wi) ? s.wi.map(String).slice(0, 8) : [],
    rw: nums(s.rw, cells, 32),
    st: Array.isArray(s.st) ? s.st.filter(a => Array.isArray(a) && a.length >= 5).slice(0, 8).map(a => ({ id: String(a[0]), k: a[1] | 0, it: a[2] | 0, rv: a[3] | 0, by: String(a[4] || ''), zb: a[5] | 0, gk: a[6] | 0, mk: a[7] | 0, dmg: a[8] | 0 })) : [],
    // co-op and boss modes (pve.js)
    mb: Array.isArray(s.mb) ? s.mb.filter(m => Array.isArray(m) && m.length >= 7).slice(0, 40).map(m => ({ id: m[0] | 0, k: Math.min(4, Math.max(0, m[1] | 0)), x: (+m[2] || 0) / 100, y: (+m[3] || 0) / 100, dir: m[4] & 3, hp: m[5] | 0, hit: !!m[6] })) : [],
    bo: bo && { k: Math.min(3, Math.max(0, bo[0] | 0)), x: (+bo[1] || 0) / 100, y: (+bo[2] || 0) / 100, hp: bo[3] | 0, max: Math.max(1, bo[4] | 0), ph: bo[5] === 2 ? 2 : 1, vis: !!bo[6], hit: !!bo[7] },
    wn: nums(s.wn, cells, 400), sw: nums(s.sw, cells),
    wv: s.wv | 0, brk: s.brk | 0, stg: s.stg | 0, sr: s.sr | 0, ml: s.ml | 0,
    ex: Array.isArray(s.ex) && (s.ex[0] | 0) >= 0 && (s.ex[0] | 0) < cells ? { i: s.ex[0] | 0, open: s.ex[1] === 1 } : null,
    bn: String(s.bn || '').slice(0, 60), ht: typeof s.ht === 'number' ? s.ht | 0 : -1, hs: s.hs | 0
  };
}
