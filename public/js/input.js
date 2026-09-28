/* ---------- local player settings ---------- */
let myName = cleanName(store('bt-name')) || ('Người chơi ' + (Math.floor(Math.random() * 90) + 10));
let myColor = Number(store('bt-color'));
if (!(myColor >= 0 && myColor < 8)) myColor = Math.floor(Math.random() * 8);
let myTeam = Number(store('bt-team'));
if (!(myTeam === 0 || myTeam === 1)) myTeam = -1;
let joined = true;
$('name').value = myName;

const swWrap = $('swatches');
COLORS.forEach((c, k) => {
  const b = document.createElement('button');
  b.className = 'sw'; b.style.background = c; b.setAttribute('aria-label', 'Màu ' + (k + 1));
  b.setAttribute('aria-pressed', k === myColor ? 'true' : 'false');
  b.onclick = () => { myColor = k; store('bt-color', String(k)); [...swWrap.children].forEach((x, j) => x.setAttribute('aria-pressed', j === k ? 'true' : 'false')); pushMe(); };
  swWrap.appendChild(b);
});
$('name').addEventListener('input', () => { myName = cleanName($('name').value) || 'Ẩn danh'; store('bt-name', myName); pushMe(); });
$('joinChk').addEventListener('change', e => { joined = e.target.checked; pushMe(); });
function syncTeamBtns() { $('team0').setAttribute('aria-pressed', myTeam === 0 ? 'true' : 'false'); $('team1').setAttribute('aria-pressed', myTeam === 1 ? 'true' : 'false'); }
[0, 1].forEach(t => $('team' + t).onclick = () => { myTeam = t; store('bt-team', String(t)); syncTeamBtns(); pushMe(); });
syncTeamBtns();

/* ---------- emotes ---------- */
let emSeq = 0;
const emShow = new Map();   // player/peer id -> {k, until}
const emSeen = new Map();   // peer -> last seq
EMOTES.forEach((e, k) => {
  const b = document.createElement('button');
  b.textContent = e; b.setAttribute('aria-label', 'Thả ' + e + ' (phím ' + (k + 1) + ')');
  b.onclick = () => sendEmote(k);
  $('emotes').appendChild(b);
});
function sendEmote(k) {
  emSeq++;
  const id = mode === 'local' ? 'p1' : myPeer;
  if (id) emShow.set(id, { k, until: performance.now() + 2200 });
  sfx.pop();
  if (room && mode === 'online') { if (myPeer) emSeen.set(myPeer, emSeq); room.presence({ em: [k, emSeq] }).catch(() => {}); }
}

/* ---------- input controllers ---------- */
function makeCtl() { return { held: [], b: 0, bc: -1 }; }
const ctlA = makeCtl(), ctlB = makeCtl();
const ctlDir = c => { const d = c.held[c.held.length - 1]; return { dx: d ? d[0] : 0, dy: d ? d[1] : 0, b: c.b, bc: c.bc }; };
function press(c, key, d) { if (!c.held.some(h => h[2] === key)) c.held.push([d[0], d[1], key]); inputChanged(); }
function release(c, key) { const n = c.held.length; c.held = c.held.filter(h => h[2] !== key); if (n !== c.held.length) inputChanged(); }
function bombPress(c) { c.b++; c.bc = (c === ctlA && pred) ? idx(Math.round(pred.x), Math.round(pred.y)) : -1; inputChanged(); }

const KEYS_A = { KeyW: [0,-1], KeyS: [0,1], KeyA: [-1,0], KeyD: [1,0] };
const KEYS_B = { ArrowUp: [0,-1], ArrowDown: [0,1], ArrowLeft: [-1,0], ArrowRight: [1,0] };

addEventListener('keydown', e => {
  if (typeof isLoggedIn === 'function' && !isLoggedIn()) return;
  if (!authed) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  const local = mode === 'local';
  if (KEYS_A[e.code]) { clearMoveTarget(); press(ctlA, e.code, KEYS_A[e.code]); e.preventDefault(); }
  else if (KEYS_B[e.code]) { if (!local) clearMoveTarget(); press(local ? ctlB : ctlA, e.code, KEYS_B[e.code]); e.preventDefault(); }
  else if (e.code === 'Space') { if (!e.repeat) bombPress(ctlA); e.preventDefault(); }
  else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (e.target && e.target.tagName === 'BUTTON') return;
    if (!e.repeat) bombPress(local ? ctlB : ctlA); e.preventDefault();
  }
  else if (/^Digit[1-6]$/.test(e.code) && !e.repeat) sendEmote(Number(e.code.slice(5)) - 1);
});
addEventListener('keyup', e => {
  if (KEYS_A[e.code]) release(ctlA, e.code);
  if (KEYS_B[e.code]) { release(ctlA, e.code); release(ctlB, e.code); }
});
addEventListener('blur', () => { moveTarget = -1; mouseDir = null; ctlA.held = []; ctlB.held = []; inputChanged(); });

document.querySelectorAll('.dpad button').forEach(btn => {
  const d = btn.dataset.d.split(',').map(Number), key = 'pad' + btn.dataset.d;
  const up = () => { btn.classList.remove('on'); release(ctlA, key); };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.setPointerCapture(e.pointerId); btn.classList.add('on'); press(ctlA, key, d); });
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
});
const bombBtn = $('bombBtn');
bombBtn.addEventListener('pointerdown', e => { e.preventDefault(); bombBtn.classList.add('on'); bombPress(ctlA); });
['pointerup','pointercancel','pointerleave'].forEach(t => bombBtn.addEventListener(t, () => bombBtn.classList.remove('on')));

/* ---------- right-click to walk: BFS to the clicked cell, steer ctlA one cell at a time ---------- */
let moveTarget = -1, mouseDir = null;
function clearMoveTarget() { moveTarget = -1; setMouseDir(null); }
function setMouseDir(d) {
  const same = d && mouseDir ? d[0] === mouseDir[0] && d[1] === mouseDir[1] : d === mouseDir;
  if (same) return;
  mouseDir = d;
  ctlA.held = ctlA.held.filter(h => h[2] !== 'mouse');
  if (d) ctlA.held.push([d[0], d[1], 'mouse']);
  inputChanged();
}
function myPos() {
  if (!snap || (snap.ph !== 'play' && snap.ph !== 'count')) return null;
  if (mode === 'online' && !hosting) return pred ? { x: pred.x, y: pred.y } : null;
  const me = snap.pl.find(p => p.id === (mode === 'local' ? 'p1' : myPeer));
  return me && me.alive ? { x: me.x, y: me.y } : null;
}
function pathNext(start, goal, avoidPortals) {
  const bombs = new Set(snap.bm.map(b => b.i)), portals = new Set(PORTALS.flat());
  const prev = new Int16Array(W * H).fill(-1);
  prev[start] = start;
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c === goal) break;
    for (const [dx, dy] of DIRS) {
      const x = c % W + dx, y = ((c / W) | 0) + dy, n = idx(x, y);
      if (x < 0 || y < 0 || x >= W || y >= H || prev[n] !== -1) continue;
      if (isWallish(snap.g[n]) || bombs.has(n) || (avoidPortals && portals.has(n) && n !== goal)) continue;
      prev[n] = c; q.push(n);
    }
  }
  if (prev[goal] === -1) return -1;
  let c = goal;
  while (prev[c] !== start) c = prev[c];
  return c;
}
function mouseSteer() {
  if (moveTarget < 0) return;
  const pos = myPos();
  if (!pos) { if (!snap || snap.ph !== 'count') clearMoveTarget(); return; }
  const cx = Math.round(pos.x), cy = Math.round(pos.y), here = idx(cx, cy);
  const tx = moveTarget % W, ty = (moveTarget / W) | 0;
  if (here === moveTarget) {
    // walk to the centre of the goal cell, then stop
    const ox = tx - pos.x, oy = ty - pos.y;
    if (Math.abs(ox) > 0.12) return setMouseDir([Math.sign(ox), 0]);
    if (Math.abs(oy) > 0.12) return setMouseDir([0, Math.sign(oy)]);
    return clearMoveTarget();
  }
  let next = pathNext(here, moveTarget, true);
  if (next < 0) next = pathNext(here, moveTarget, false);
  if (next < 0) return clearMoveTarget();
  setMouseDir([next % W - cx, ((next / W) | 0) - cy]);
}
/* ---------- ghost bombs: dead players left-click the board ---------- */
let ghostSeq = 0, ghostReadyAt = 0;
const gbSeen = new Map();   // host: peer -> last ghost-bomb request seq handled
function canGhost() {
  if (mode !== 'online' || !snap || snap.ph !== 'play' || snap.pz) return false;
  const me = snap.pl.find(p => p.id === myPeer);
  return !!(me && !me.alive && !me.downed);
}
function hostGhostRequests() {
  for (const p of peers()) {
    if (p.sameTab || isKicked(p)) continue;
    const z = p.presence && p.presence.gb, seq = Array.isArray(z) ? z[1] | 0 : 0;
    const seen = gbSeen.get(p.peer);
    gbSeen.set(p.peer, seq);
    if (seen === undefined || seen === seq || !hostGame || hostPz) continue;
    ghostDrop(hostGame, p.peer, z[0] | 0);
  }
}
function onBoardClick(e) {
  if (e.button !== 0 || !canGhost()) return;
  const r = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  if (performance.now() < ghostReadyAt) return;
  const cell = idx(x, y);
  if (snap.g[cell] !== '.' || PORTALS.flat().includes(cell) || snap.bm.some(b => b.i === cell)) return;
  ghostReadyAt = performance.now() + GHOST_CD * 1000;
  if (hosting && hostGame) ghostDrop(hostGame, myPeer, cell);
  else room.presence({ gb: [cell, ++ghostSeq] }).catch(() => {});
}
function onRightClick(e) {
  e.preventDefault();
  if (!snap) return;
  const r = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
  if (x < 0 || y < 0 || x >= W || y >= H || snap.g[idx(x, y)] === '#') return;
  moveTarget = idx(x, y);
  mouseSteer();
}
function drawMoveTarget() {
  if (moveTarget < 0) return;
  const cx = (moveTarget % W) * T + T / 2, cy = ((moveTarget / W) | 0) * T + T / 2;
  const r = T * (.3 + Math.sin(performance.now() / 150) * .04);
  ctx.strokeStyle = '#8fac7a'; ctx.lineWidth = Math.max(1.5, T * .06);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
}
