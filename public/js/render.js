/* ---------- main loop ---------- */
let lastT = performance.now(), lastListT = 0;
function simulate(now) {
  const dt = Math.min(0.05, Math.max(0, now - lastT) / 1000); lastT = now;
  mouseSteer();
  if (mode === 'local' && localGame) {
    const li = { p1: ctlDir(ctlA), p2: ctlDir(ctlB) };
    if (localGame.pz) holdInputs(localGame, li); else stepGame(localGame, li, dt, scores);
    if (localGame.ph === 'end' && localGame.timer <= 0) localGame = newGame(localSlots(), false, { map: 'random', events: true });
    setSnap(sanitizeSnap(snapshot(localGame, scores)));
  } else {
    if (mode === 'online' && !practice && (!ROOM_ID || !net || net.ph === 'lobby')) startPractice();
    if (practice) stepPractice(dt); else predictStep(dt);
  }
  return dt;
}
function frame(t) {
  const dt = simulate(t);
  syncBoardLayout();
  updateCover();
  draw(dt);
  drawMoveTarget();
  updateGutter();
  updateOverlay();
  if (t - lastListT > 250) { lastListT = t; renderList(); updateUI(); updateStatus(); }
  requestAnimationFrame(frame);
}
/* ---------- rendering ---------- */
const cv = $('cv'), ctx = cv.getContext('2d');
let T = 40, dpr = 1;
function resize() {
  const w = $('wrap').clientWidth;
  if (!w) return; // board hidden behind another editor tab
  dpr = Math.min(2, window.devicePixelRatio || 1);
  T = w / W;
  cv.width = Math.round(w * dpr); cv.height = Math.round(T * H * dpr);
  cv.style.height = (T * H) + 'px';
  document.documentElement.style.setProperty('--t', T + 'px');
}
const gutterEl = $('gutter');
let gutterRow = -1, layoutVer = -1;
// rebuild line numbers, the editor's aspect ratio and the canvas when the board size changes
function syncBoardLayout() {
  if (layoutVer === dimsVer) return;
  layoutVer = dimsVer; gutterRow = -1;
  gutterEl.textContent = '';
  for (let y = 1; y <= H; y++) { const s = document.createElement('span'); s.textContent = y; gutterEl.appendChild(s); }
  document.documentElement.style.setProperty('--board-ar', String((W + 0.9) / H));
  resize();
}
syncBoardLayout();
function updateGutter() {
  let row = -1;
  if (snap) { const me = snap.pl.find(p => p.id === (mode === 'local' ? 'p1' : myPeer)); if (me && me.x >= 0) row = Math.round(pred && mode === 'online' ? pred.y : me.y); }
  if (row === gutterRow) return;
  gutterRow = row;
  [...gutterEl.children].forEach((s, k) => s.classList.toggle('cur', k === row));
}
new ResizeObserver(resize).observe($('wrap'));
resize();
cv.addEventListener('contextmenu', onRightClick);
cv.addEventListener('pointerdown', onBoardClick);

const disp = new Map(), bombDisp = new Map();
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
// icons are drawn in grayscale so the board stays low-key
function fillEmoji(s, x, y) { ctx.filter = "grayscale(1) brightness(1.1)"; ctx.fillText(s, x, y); ctx.filter = "none"; }
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function drawTile(c, x, y, now) {
  const px = x * T, py = y * T;
  ctx.fillStyle = (x + y) % 2 ? '#1f1f1f' : '#242424';
  ctx.fillRect(px, py, T + 0.5, T + 0.5);
  if (c === '#') {
    ctx.fillStyle = '#181818'; ctx.fillRect(px, py, T + 0.5, T + 0.5);
    ctx.fillStyle = '#2e2e2e'; rr(px + T * .06, py + T * .06, T * .88, T * .8, T * .14); ctx.fill();
    ctx.fillStyle = '#3c3c3c'; ctx.fillRect(px + T * .18, py + T * .14, T * .64, T * .08);
  } else if (c === 'x' || c === 'X') {
    ctx.fillStyle = '#2e2c2a'; rr(px + T * .06, py + T * .1, T * .88, T * .84, T * .1); ctx.fill();
    ctx.fillStyle = c === 'X' ? '#c08a62' : '#5c5852'; rr(px + T * .06, py + T * .04, T * .88, T * .82, T * .1); ctx.fill();
    ctx.strokeStyle = c === 'X' ? '#7a4e36' : '#46433f'; ctx.lineWidth = Math.max(1, T * .05);
    ctx.beginPath();
    ctx.moveTo(px + T * .1, py + T * .32); ctx.lineTo(px + T * .9, py + T * .32);
    ctx.moveTo(px + T * .1, py + T * .6); ctx.lineTo(px + T * .9, py + T * .6);
    ctx.stroke();
  } else if (POWERS.includes(c)) {
    const bob = Math.sin(now / 250 + x + y) * T * .04;
    ctx.fillStyle = '#3c3c3c'; ctx.beginPath(); ctx.arc(px + T / 2, py + T / 2 + bob, T * .36, 0, 7); ctx.fill();
    // the curse is a bad item: a red rim so it never passes for a power-up
    ctx.strokeStyle = c === 'c' ? '#d0606e' : '#181818'; ctx.lineWidth = Math.max(1, T * (c === 'c' ? .08 : .05)); ctx.stroke();
    ctx.font = `${Math.round(T * .44)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fillEmoji({ b: '💣', f: '🔥', s: '👟', k: '🧤', h: '🛡️', c: '💀', d: '✖️', o: '🔳', p: '🗡️' }[c], px + T / 2, py + T / 2 + bob + T * .02);
  }
}

function drawPortals(now) {
  PORTALS.forEach((pair, k) => {
    for (const i of pair) {
      const cx = (i % W) * T + T / 2, cy = ((i / W) | 0) * T + T / 2;
      ctx.fillStyle = PORTAL_COLORS[k] + '55';
      ctx.beginPath(); ctx.arc(cx, cy, T * .42, 0, 7); ctx.fill();
      ctx.lineWidth = Math.max(1.5, T * .07); ctx.lineCap = 'round';
      for (let r = 0; r < 3; r++) {
        const a = now / (400 - r * 80) * (k ? -1 : 1) + r * 2.1;
        ctx.strokeStyle = r === 1 ? '#ffffff' : PORTAL_COLORS[k];
        ctx.beginPath(); ctx.arc(cx, cy, T * (.36 - r * .1), a, a + 3.6); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  });
}

function draw(dt) {
  const now = performance.now();
  shake = Math.max(0, shake - dt * 3);
  const sx = shake ? (Math.random() - .5) * T * .25 * shake : 0, sy = shake ? (Math.random() - .5) * T * .25 * shake : 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#181818'; ctx.fillRect(0, 0, W * T, H * T);
  ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
  const s = snap;
  const grid = s ? s.g : emptyGrid;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawTile(grid[idx(x, y)], x, y, now);
  drawPortals(now);
  // bomb rain warning: a pulsing crosshair where a bomb is about to land
  if (s && s.ph === 'play') for (const i of s.rw) {
    const cx = (i % W) * T + T / 2, cy = ((i / W) | 0) * T + T / 2, r = T * (.3 + Math.sin(now / 90) * .05);
    ctx.strokeStyle = 'rgba(199,127,140,.85)'; ctx.lineWidth = Math.max(1.5, T * .05);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
    ctx.moveTo(cx - r * 1.3, cy); ctx.lineTo(cx - r * .5, cy); ctx.moveTo(cx + r * .5, cy); ctx.lineTo(cx + r * 1.3, cy);
    ctx.moveTo(cx, cy - r * 1.3); ctx.lineTo(cx, cy - r * .5); ctx.moveTo(cx, cy + r * .5); ctx.lineTo(cx, cy + r * 1.3);
    ctx.stroke();
  }
  // sudden death warning: outline the next cells the closing walls will fill
  if (s && s.ph === 'play' && s.sd >= 0 && s.sd <= 5) {
    let shown = 0;
    ctx.strokeStyle = `rgba(199,127,140,${.45 + Math.sin(now / 120) * .25})`; ctx.lineWidth = Math.max(1.5, T * .06);
    for (const i of SD_ORDER) {
      if (grid[i] === '#') continue;
      ctx.strokeRect((i % W) * T + T * .08, ((i / W) | 0) * T + T * .08, T * .84, T * .84);
      if (++shown >= (s.sd === 0 ? 4 : 1)) break;
    }
  }
  if (!s) return;
  drawPveFloor(s, now);

  if (s.ev === 'ice') drawIce(s, now);
  for (const i of s.fl) drawFlame(i, s.fsk.get(i) || 0, now);

  const seenB = new Set();
  for (const b of s.bm) {
    seenB.add(b.id);
    let d = bombDisp.get(b.id);
    if (!d || Math.hypot(d.x - b.x, d.y - b.y) > 2) { d = { x: b.x, y: b.y }; bombDisp.set(b.id, d); }
    const k = Math.min(1, dt * 25); d.x += (b.x - d.x) * k; d.y += (b.y - d.y) * k;
    const cx = d.x * T + T / 2, cy = d.y * T + T / 2;
    const pulse = 1 + Math.sin(now / (b.t < 8 ? 60 : 140)) * .06;
    ctx.fillStyle = '#00000066'; ctx.beginPath(); ctx.ellipse(cx, cy + T * .3, T * .3, T * .08, 0, 0, 7); ctx.fill();
    drawBombSkin(ctx, b.sk, cx, cy + T * .04, T * .32 * pulse, T, now);
    if (b.sh) {
      // the blast shape, so you can read what is coming: ✕ diagonal, ■ square, ➤ pierce
      ctx.font = `700 ${Math.round(T * .26)}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.fillText(['', '✕', '■', '➤'][b.sh], cx, cy + T * .06);
    }
  }
  for (const id of [...bombDisp.keys()]) if (!seenB.has(id)) bombDisp.delete(id);

  drawMobs(s, dt, now);
  const seen = new Set();
  for (const p of s.pl) {
    seen.add(p.id);
    if (p.x < 0) continue;
    const isMe = mode === 'online' && p.id === myPeer;
    let d = disp.get(p.id);
    if (isMe && pred) { d = { x: pred.x, y: pred.y }; disp.set(p.id, d); }
    else {
      if (!d || Math.hypot(d.x - p.x, d.y - p.y) > 2) { d = { x: p.x, y: p.y }; disp.set(p.id, d); }
      const k = Math.min(1, dt * 22); d.x += (p.x - d.x) * k; d.y += (p.y - d.y) * k;
    }
    const dir = isMe && pred ? pred.dir : p.dir;
    if (!p.alive && !p.downed) ctx.globalAlpha = .35;
    if (p.alive && p.inv) ctx.globalAlpha = (now / 90 | 0) % 2 ? .45 : 1;
    const cx = d.x * T + T / 2, cy = d.y * T + T / 2, r = T * .34 * (p.boss ? 1.25 : 1);   // the boss in boss hunt is bigger
    if (p.downed) {
      const frac = Math.min(1, p.downT / DOWN_T), rr2 = r + T * .15;
      ctx.lineWidth = Math.max(2, T * .08);
      ctx.strokeStyle = 'rgba(22,22,30,.7)'; ctx.beginPath(); ctx.arc(cx, cy, rr2, 0, 7); ctx.stroke();
      ctx.strokeStyle = frac > .34 ? '#bfa377' : '#c77f8c';
      ctx.beginPath(); ctx.arc(cx, cy, rr2, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#00000066'; ctx.beginPath(); ctx.ellipse(cx, cy + T * .33, T * .28, T * .08, 0, 0, 7); ctx.fill();
    if (p.zb === 2) ctx.globalAlpha = .45;   // stunned zombie
    ctx.fillStyle = p.zb ? ZOMBIE_COLOR : p.color; ctx.strokeStyle = '#181818'; ctx.lineWidth = Math.max(1.5, T * .07);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); ctx.stroke();
    if (isMe) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, T * .04); ctx.beginPath(); ctx.arc(cx, cy, r + T * .08, 0, 7); ctx.stroke(); }
    if (p.hat || p.boss) drawHat(p.boss ? 'crown' : p.hat, cx, cy, r);
    if (p.ck && p.alive) {
      // cursed: a dashed ring that spins, plus a small skull
      ctx.save(); ctx.setLineDash([T * .08, T * .07]); ctx.lineDashOffset = -now / 40;
      ctx.strokeStyle = '#d0606e'; ctx.lineWidth = Math.max(1.5, T * .06);
      ctx.beginPath(); ctx.arc(cx, cy, r + T * .22, 0, 7); ctx.stroke(); ctx.restore();
      ctx.font = `${Math.round(T * .24)}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fillEmoji('💀', cx - r * .9, cy - r * .8);
    }
    if (p.shield && p.alive) { ctx.strokeStyle = '#9d9d9d'; ctx.lineWidth = Math.max(2, T * .07); ctx.beginPath(); ctx.arc(cx, cy, r + T * .15, 0, 7); ctx.stroke(); }
    if (p.kick && p.alive) { ctx.font = `${Math.round(T * .26)}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; fillEmoji('🧤', cx + r * .85, cy + r * .7); }
    const ex = [0, 1, 0, -1][dir] * r * .35, ey = [-1, 0, 1, 0][dir] * r * .3;
    if (p.alive) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx - r * .32 + ex, cy - r * .12 + ey, r * .24, 0, 7); ctx.arc(cx + r * .32 + ex, cy - r * .12 + ey, r * .24, 0, 7); ctx.fill();
      ctx.fillStyle = '#181818';
      ctx.beginPath(); ctx.arc(cx - r * .32 + ex * 1.4, cy - r * .12 + ey * 1.4, r * .11, 0, 7); ctx.arc(cx + r * .32 + ex * 1.4, cy - r * .12 + ey * 1.4, r * .11, 0, 7); ctx.fill();
    } else if (p.downed) {
      ctx.strokeStyle = '#181818'; ctx.lineWidth = Math.max(1.5, T * .05);
      for (const sxx of [-1, 1]) { const ox = cx + sxx * r * .32, oy = cy - r * .08; ctx.beginPath(); ctx.moveTo(ox - r * .16, oy); ctx.lineTo(ox + r * .16, oy); ctx.stroke(); }
    } else {
      ctx.strokeStyle = '#181818'; ctx.lineWidth = Math.max(1, T * .05);
      for (const sxx of [-1, 1]) { const ox = cx + sxx * r * .32, oy = cy - r * .12; ctx.beginPath(); ctx.moveTo(ox - r * .14, oy - r * .14); ctx.lineTo(ox + r * .14, oy + r * .14); ctx.moveTo(ox + r * .14, oy - r * .14); ctx.lineTo(ox - r * .14, oy + r * .14); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    ctx.font = `${Math.max(10, Math.round(T * .26))}px Menlo,Monaco,Consolas,"Droid Sans Mono",monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const label = p.name, tw = ctx.measureText(label).width;
    const tagBg = s.md === 't' && (p.team === 0 || p.team === 1) ? (p.team ? 'rgba(61,111,217,.92)' : 'rgba(190,60,90,.92)') : 'rgba(22,22,30,.85)';
    ctx.fillStyle = tagBg; rr(cx - tw / 2 - 5, cy - r - T * .44, tw + 10, T * .36, T * .1); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, cx, cy - r - T * .1);
    const em = emShow.get(p.id);
    const emOn = em && em.until > now;
    const bubble = emOn ? EMOTES[em.k] : (p.downed ? '🆘' : null);
    if (bubble) {
      const life = emOn ? (em.until - now) / 2200 : 0.9 + Math.sin(now / 120) * 0.05, pop = Math.min(1, (1 - life) * 8);
      const by = cy - r - T * .95 - (1 - life) * T * .2;
      ctx.fillStyle = '#3c3c3c'; ctx.strokeStyle = '#181818'; ctx.lineWidth = Math.max(1, T * .04);
      ctx.beginPath(); ctx.arc(cx, by, T * .36 * pop, 0, 7); ctx.fill(); ctx.stroke();
      ctx.font = `${Math.round(T * .42 * pop)}px ${EMOJI_FONT}`; ctx.textBaseline = 'middle';
      fillEmoji(bubble, cx, by + T * .02);
    }
  }
  for (const id of [...disp.keys()]) if (!seen.has(id)) disp.delete(id);
  if (s.bo) drawBoss(s.bo, now);
  for (const p of s.pl) if (p.boss && p.alive) {
    // lives over the boss player's head
    const d = disp.get(p.id) || p, cx = d.x * T + T / 2, cy = d.y * T + T / 2;
    ctx.font = `600 ${Math.max(10, Math.round(T * .3))}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#c77f8c'; ctx.fillText('♥'.repeat(Math.min(p.hp, 8)), cx, cy + T * .5);
  }
  if (s.ev === 'dark') drawDarkness(s, now);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // HUD: no screen shake
  drawPveHud(s, now);
  drawEventHud(s);
}

/* ---------- bomb skins: the bomb and the fire it makes ---------- */
const BOMB_SKINS = ['Bom cổ điển', 'Bóng nước', 'Pháo hoa', 'Bí ngô'];
// g: any 2d context (the board, or a small preview), (cx, cy): centre, r: body radius, t: cell size
function drawBombSkin(g, sk, cx, cy, r, t, now) {
  const lw = Math.max(1, t * .03), spark = (now / 80 | 0) % 2;
  g.save();
  if (sk === 1) {            // water balloon
    const wob = 1 + Math.sin(now / 160) * .05;
    g.fillStyle = '#6fa8dc'; g.strokeStyle = '#3d6f9e'; g.lineWidth = lw;
    g.beginPath(); g.ellipse(cx, cy + r * .1, r * .95 / wob, r * 1.05 * wob, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#3d6f9e'; g.beginPath(); g.moveTo(cx - r * .18, cy - r * 1.1); g.lineTo(cx + r * .18, cy - r * 1.1); g.lineTo(cx, cy - r * .85); g.closePath(); g.fill();
    g.fillStyle = '#ffffff88'; g.beginPath(); g.ellipse(cx - r * .35, cy - r * .3, r * .18, r * .3, -.4, 0, 7); g.fill();
  } else if (sk === 2) {     // firework rocket
    g.fillStyle = '#c75a64'; g.strokeStyle = '#6e2a32'; g.lineWidth = lw;
    rrOn(g, cx - r * .55, cy - r * .7, r * 1.1, r * 1.6, r * .15); g.fill(); g.stroke();
    g.fillStyle = '#f0e6c8'; g.fillRect(cx - r * .55, cy - r * .25, r * 1.1, r * .2); g.fillRect(cx - r * .55, cy + r * .3, r * 1.1, r * .2);
    g.fillStyle = '#d6b45e'; g.beginPath(); g.moveTo(cx - r * .65, cy - r * .7); g.lineTo(cx + r * .65, cy - r * .7); g.lineTo(cx, cy - r * 1.35); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = spark ? '#ffe08a' : '#ff9a5a'; g.beginPath(); g.arc(cx, cy + r * 1.05, t * .07, 0, 7); g.fill();
  } else if (sk === 3) {     // pumpkin
    g.fillStyle = '#d9822b'; g.strokeStyle = '#8a4a14'; g.lineWidth = lw;
    for (const ox of [-.45, .45, 0]) { g.beginPath(); g.ellipse(cx + r * ox, cy + r * .1, r * .62, r * .9, 0, 0, 7); g.fill(); g.stroke(); }
    g.fillStyle = '#5c7a3a'; g.fillRect(cx - r * .1, cy - r * 1.15, r * .22, r * .4);
    g.fillStyle = '#2a1a0a'; g.beginPath(); g.moveTo(cx - r * .45, cy - r * .05); g.lineTo(cx - r * .2, cy - r * .3); g.lineTo(cx - r * .05, cy - r * .05); g.moveTo(cx + r * .45, cy - r * .05); g.lineTo(cx + r * .2, cy - r * .3); g.lineTo(cx + r * .05, cy - r * .05); g.fill();
  } else {                   // classic bomb
    g.fillStyle = '#111111'; g.strokeStyle = '#3c3c3c'; g.lineWidth = lw;
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#ffffff55'; g.beginPath(); g.arc(cx - r * .35, cy - r * .3, r * .25, 0, 7); g.fill();
    g.strokeStyle = '#5a4a33'; g.lineWidth = Math.max(1.5, t * .06);
    g.beginPath(); g.moveTo(cx + r * .4, cy - r * .7); g.quadraticCurveTo(cx + r * .9, cy - r * 1.3, cx + r * .6, cy - r * 1.5); g.stroke();
    g.fillStyle = spark ? '#d6c28e' : '#b07a52'; g.beginPath(); g.arc(cx + r * .6, cy - r * 1.5, t * .07, 0, 7); g.fill();
  }
  g.restore();
}
function rrOn(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const FLAME_COLORS = [['#c08a62', '#bfa377', '#e6ddc8'], ['#4f86b8', '#8ec0e8', '#eaf6ff'], ['#3a2a4a', '#6a4a8a', '#fff2c8'], ['#7d5a9d', '#e0904a', '#ffe0a8']];
function drawFlame(i, sk, now) {
  const x = i % W, y = (i / W) | 0, px = x * T, py = y * T, [a, b, c] = FLAME_COLORS[sk] || FLAME_COLORS[0];
  const flick = .85 + Math.sin(now / 40 + i) * .08;
  ctx.fillStyle = a; rr(px + T * .04, py + T * .04, T * .92, T * .92, T * .3); ctx.fill();
  ctx.fillStyle = b; rr(px + T * (.5 - .32 * flick), py + T * (.5 - .32 * flick), T * .64 * flick, T * .64 * flick, T * .22); ctx.fill();
  if (sk === 2) {
    // firework: coloured sparks popping
    const cols = ['#ff7a8a', '#ffe08a', '#8ae0ff', '#b8ff8a', '#e08aff'];
    for (let k = 0; k < 5; k++) {
      const a2 = (i * 37 + k * 72 + now / 6) % 360 / 57.3, d = T * (.12 + ((now / 300 + k * .2 + i) % 1) * .3);
      ctx.fillStyle = cols[(k + i) % 5]; ctx.beginPath(); ctx.arc(px + T / 2 + Math.cos(a2) * d, py + T / 2 + Math.sin(a2) * d, T * .05, 0, 7); ctx.fill();
    }
  } else if (sk === 1) {
    // water: a few droplets
    ctx.fillStyle = c;
    for (let k = 0; k < 3; k++) { const a2 = i * 2.1 + k * 2.09 + now / 400; ctx.beginPath(); ctx.arc(px + T / 2 + Math.cos(a2) * T * .22, py + T / 2 + Math.sin(a2) * T * .22, T * .06, 0, 7); ctx.fill(); }
  } else { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px + T / 2, py + T / 2, T * .15 * flick, 0, 7); ctx.fill(); }
}

/* ---------- mid-round events ---------- */
const EVENT_LABELS = { dark: '🌑 Tắt đèn', ice: '❄️ Mặt băng', max: '💥 Bom max tầm' };
function drawIce(s, now) {
  ctx.fillStyle = 'rgba(140,190,235,.13)'; ctx.fillRect(0, 0, W * T, H * T);
  ctx.strokeStyle = 'rgba(230,245,255,.25)'; ctx.lineWidth = Math.max(1, T * .03);
  ctx.beginPath();
  for (let i = 0; i < W * H; i++) if (s.g[i] === '.' && (i * 7) % 5 === 0) { const x = (i % W) * T, y = ((i / W) | 0) * T; ctx.moveTo(x + T * .2, y + T * .7); ctx.lineTo(x + T * .5, y + T * .4); }
  ctx.stroke();
}
// darkness: you see around yourself (and your team), lit fuses and fire; anyone watching sees everything
let darkCv = null;
function drawDarkness(s, now) {
  const myIds = mode === 'local' ? ['p1', 'p2'] : [myPeer];
  const me = s.pl.find(p => myIds.includes(p.id));
  if (!me || (!me.alive && !me.downed)) return;
  const ally = s.md !== 's' && s.md !== 'z' && s.md !== 'p';
  const lights = [];
  for (const p of s.pl) {
    if (!p.alive && !p.downed) continue;
    if (!(myIds.includes(p.id) || (ally && p.team === me.team))) continue;
    const d = myIds.includes(p.id) && p.id === myPeer && pred ? pred : disp.get(p.id) || p;
    lights.push([d.x, d.y, 2.6]);
  }
  for (const b of s.bm) lights.push([b.x, b.y, 0.9]);
  for (const i of s.fl) lights.push([i % W, (i / W) | 0, 0.8]);
  const w = W * T, h = H * T;
  if (!darkCv) darkCv = document.createElement('canvas');
  if (darkCv.width !== Math.ceil(w) || darkCv.height !== Math.ceil(h)) { darkCv.width = Math.ceil(w); darkCv.height = Math.ceil(h); }
  const g = darkCv.getContext('2d');
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(6,6,10,.94)'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out';
  for (const [x, y, R] of lights) {
    const cx = x * T + T / 2, cy = y * T + T / 2, rad = R * T;
    const gr = g.createRadialGradient(cx, cy, rad * .35, cx, cy, rad);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill();
  }
  ctx.drawImage(darkCv, 0, 0, w, h);
}
function drawEventHud(s) {
  if (s.ph !== 'play' || (!s.ev && !s.ew)) return;
  const bw = W * T, fs = Math.max(11, Math.round(T * .3));
  ctx.font = `600 ${fs}px ${UI_FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const text = s.ev ? `${EVENT_LABELS[s.ev]} · ${s.et}s` : `⚠ Sắp tới: ${EVENT_LABELS[s.ew]} · ${s.et}`;
  const tw = ctx.measureText(text).width, x = T * .3, y = H * T - T * .5;
  ctx.fillStyle = s.ev ? 'rgba(44,93,138,.92)' : 'rgba(150,110,40,.92)'; rr(x, y - fs * .85, tw + fs * 1.2, fs * 1.7, fs * .5); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(text, x + fs * .6, y);
}

/* ---------- co-op and boss modes: monsters, bosses, warnings, the exit, banners ---------- */
const MOB_COLORS = ['#8fac7a', '#9d8fbf', '#d8d4e8', '#c77f8c', '#86adc0'];
const BOSS_COLORS = ['#3a3a3a', '#c08a62', '#8a8f96', '#b9b0d8'];
const BOSS_LABELS = ['Vua Bom', 'Rồng Lửa', 'Người Đá', 'Hồn Ma'];
const UI_FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';   // text on the board (the emoji font spaces Vietnamese oddly)
const mobDisp = new Map();
function drawPveFloor(s, now) {
  // the exit door (campaign): dark while monsters are left, glowing once it opens
  if (s.ex) {
    const x = (s.ex.i % W) * T, y = ((s.ex.i / W) | 0) * T;
    ctx.fillStyle = '#151515'; rr(x + T * .14, y + T * .08, T * .72, T * .86, T * .1); ctx.fill();
    ctx.strokeStyle = s.ex.open ? '#8fac7a' : '#4a4a4a'; ctx.lineWidth = Math.max(2, T * .07); ctx.stroke();
    if (s.ex.open) {
      ctx.fillStyle = `rgba(143,172,122,${.35 + Math.sin(now / 150) * .2})`; rr(x + T * .2, y + T * .14, T * .6, T * .74, T * .08); ctx.fill();
      ctx.fillStyle = '#e6f0dc'; ctx.font = `700 ${Math.round(T * .4)}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⇧', x + T / 2, y + T / 2 + Math.sin(now / 200) * T * .05);
    }
  }
  // boss attack warnings: the cells that are about to be hit
  if (s.wn.length) {
    const a = .28 + Math.sin(now / 70) * .14;
    ctx.fillStyle = `rgba(199,90,100,${a})`; ctx.strokeStyle = 'rgba(230,120,130,.8)'; ctx.lineWidth = Math.max(1, T * .04);
    for (const i of s.wn) { const x = (i % W) * T, y = ((i / W) | 0) * T; ctx.fillRect(x + 1, y + 1, T - 2, T - 2); ctx.strokeRect(x + T * .1, y + T * .1, T * .8, T * .8); }
  }
  // monsters about to appear
  for (const i of s.sw) {
    const cx = (i % W) * T + T / 2, cy = ((i / W) | 0) * T + T / 2, r = T * (.18 + ((now / 400) % 1) * .22);
    ctx.strokeStyle = 'rgba(157,143,191,.9)'; ctx.lineWidth = Math.max(1.5, T * .05);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, T * .38, 0, 7); ctx.setLineDash([T * .1, T * .08]); ctx.stroke(); ctx.setLineDash([]);
  }
}
function drawMobs(s, dt, now) {
  const seen = new Set();
  for (const m of s.mb) {
    seen.add(m.id);
    let d = mobDisp.get(m.id);
    if (!d || Math.hypot(d.x - m.x, d.y - m.y) > 2) { d = { x: m.x, y: m.y }; mobDisp.set(m.id, d); }
    const k = Math.min(1, dt * 22); d.x += (m.x - d.x) * k; d.y += (m.y - d.y) * k;
    drawMob(m, d.x * T + T / 2, d.y * T + T / 2, now);
  }
  for (const id of [...mobDisp.keys()]) if (!seen.has(id)) mobDisp.delete(id);
}
function drawMob(m, cx, cy, now) {
  const r = T * .32;
  ctx.save();
  ctx.fillStyle = '#00000055'; ctx.beginPath(); ctx.ellipse(cx, cy + T * .32, T * .26, T * .07, 0, 0, 7); ctx.fill();
  ctx.fillStyle = m.hit ? '#ffffff' : MOB_COLORS[m.k]; ctx.strokeStyle = '#181818'; ctx.lineWidth = Math.max(1.5, T * .06);
  if (m.k === 0) {            // slime: a squishy dome
    const sq = 1 + Math.sin(now / 160 + m.id) * .08;
    ctx.beginPath(); ctx.ellipse(cx, cy + r * .45, r * 1.1 * sq, r * 1.05 / sq, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (m.k === 1) {     // bat: flapping wings
    const f = Math.sin(now / 70 + m.id) * .5;
    ctx.beginPath();
    for (const sd of [-1, 1]) { ctx.moveTo(cx + sd * r * .5, cy); ctx.lineTo(cx + sd * r * 1.5, cy - r * (.6 + f)); ctx.lineTo(cx + sd * r * 1.1, cy + r * .35); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * .75, 0, 7); ctx.fill(); ctx.stroke();
  } else if (m.k === 2) {     // ghost: a floating sheet
    ctx.globalAlpha = .8;
    const bob = Math.sin(now / 300 + m.id) * T * .05, base = cy + r * .85 + bob;
    ctx.beginPath(); ctx.arc(cx, cy - r * .15 + bob, r, Math.PI, 0); ctx.lineTo(cx + r, base);
    for (let k = 0; k < 4; k++) ctx.lineTo(cx + r - (k + .5) * r / 2, base - (k % 2 ? 0 : r * .25)), ctx.lineTo(cx + r - (k + 1) * r / 2, base);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (m.k === 3) {     // imp: horns
    ctx.beginPath();
    for (const sd of [-1, 1]) { ctx.moveTo(cx + sd * r * .35, cy - r * .65); ctx.lineTo(cx + sd * r * .8, cy - r * 1.35); ctx.lineTo(cx + sd * r * .85, cy - r * .35); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * .85, 0, 7); ctx.fill(); ctx.stroke();
  } else {                    // tank: an armoured block, one pip per hit left
    rr(cx - r, cy - r, r * 2, r * 2, r * .35); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#181818';
    for (let k = 0; k < m.hp; k++) ctx.fillRect(cx - r * .62 + k * r * .45, cy + r * .45, r * .3, r * .22);
  }
  const ex = [0, 1, 0, -1][m.dir] * r * .25, ey = [-1, 0, 1, 0][m.dir] * r * .2;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - r * .3 + ex, cy - r * .05 + ey, r * .2, 0, 7); ctx.arc(cx + r * .3 + ex, cy - r * .05 + ey, r * .2, 0, 7); ctx.fill();
  ctx.fillStyle = '#181818'; ctx.beginPath(); ctx.arc(cx - r * .3 + ex * 1.4, cy - r * .05 + ey * 1.4, r * .09, 0, 7); ctx.arc(cx + r * .3 + ex * 1.4, cy - r * .05 + ey * 1.4, r * .09, 0, 7); ctx.fill();
  ctx.restore();
}
function drawBoss(b, now) {
  const cx = (b.x + .5) * T, cy = (b.y + .5) * T, R = T * .92 * (1 + Math.sin(now / (b.ph === 2 ? 90 : 220)) * .03);
  ctx.save();
  ctx.globalAlpha = b.vis ? 1 : .18;   // the wraith fades out between appearances
  ctx.fillStyle = '#00000066'; ctx.beginPath(); ctx.ellipse(cx, cy + R * .95, R * .8, R * .18, 0, 0, 7); ctx.fill();
  ctx.fillStyle = b.hit ? '#ffffff' : BOSS_COLORS[b.k]; ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(2, T * .08);
  if (b.k === 0) {            // Vua Bom: a giant bomb with a crown and a lit fuse
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff33'; ctx.beginPath(); ctx.arc(cx - R * .4, cy - R * .35, R * .2, 0, 7); ctx.fill();
    ctx.fillStyle = '#bfa377'; ctx.beginPath();
    ctx.moveTo(cx - R * .55, cy - R * .78); ctx.lineTo(cx - R * .55, cy - R * 1.25); ctx.lineTo(cx - R * .28, cy - R * 1.0); ctx.lineTo(cx, cy - R * 1.35);
    ctx.lineTo(cx + R * .28, cy - R * 1.0); ctx.lineTo(cx + R * .55, cy - R * 1.25); ctx.lineTo(cx + R * .55, cy - R * .78); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = (now / 80 | 0) % 2 ? '#d6c28e' : '#c77f8c'; ctx.beginPath(); ctx.arc(cx + R * .85, cy - R * .7, T * .1, 0, 7); ctx.fill();
  } else if (b.k === 1) {     // Rồng Lửa: a spiky head
    ctx.beginPath();
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, rr2 = k % 2 ? R : R * 1.22; ctx.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e6ddc8'; ctx.beginPath(); ctx.ellipse(cx, cy + R * .45, R * .45, R * .22, 0, 0, 7); ctx.fill();
  } else if (b.k === 2) {     // Người Đá: a cracked stone block
    rr(cx - R, cy - R, R * 2, R * 2, R * .25); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#5a5e64'; ctx.lineWidth = Math.max(1.5, T * .05); ctx.beginPath();
    ctx.moveTo(cx - R * .7, cy - R * .2); ctx.lineTo(cx - R * .3, cy + R * .1); ctx.lineTo(cx - R * .45, cy + R * .6);
    ctx.moveTo(cx + R * .5, cy - R * .8); ctx.lineTo(cx + R * .25, cy - R * .4); ctx.stroke();
  } else {                    // Hồn Ma: a big sheet
    const base = cy + R * .9;
    ctx.beginPath(); ctx.arc(cx, cy - R * .1, R, Math.PI, 0); ctx.lineTo(cx + R, base);
    for (let k = 0; k < 6; k++) ctx.lineTo(cx + R - (k + .5) * R / 3, base - (k % 2 ? 0 : R * .25)), ctx.lineTo(cx + R - (k + 1) * R / 3, base);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // eyes: red and frowning when enraged
  const ang = b.ph === 2;
  ctx.fillStyle = ang ? '#e07a86' : '#fff';
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sd * R * .35, cy - R * .1, R * .17, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#111';
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sd * R * .33, cy - R * .07, R * .08, 0, 7); ctx.fill(); }
  if (ang) { ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(2, T * .07); ctx.beginPath(); for (const sd of [-1, 1]) { ctx.moveTo(cx + sd * R * .55, cy - R * .42); ctx.lineTo(cx + sd * R * .15, cy - R * .25); } ctx.stroke(); }
  ctx.restore();
}
function drawPveHud(s, now) {
  const bw = W * T;
  if (s.bo) {
    // boss health bar along the top
    const w = Math.min(bw * .6, T * 9), x = (bw - w) / 2, y = T * .22, h = Math.max(6, T * .2);
    ctx.fillStyle = 'rgba(17,17,17,.85)'; rr(x - 4, y - 4, w + 8, h + 8 + T * .34, 4); ctx.fill();
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x, y + T * .34, w, h);
    ctx.fillStyle = s.bo.ph === 2 ? '#c75a64' : '#c08a62'; ctx.fillRect(x, y + T * .34, w * s.bo.hp / s.bo.max, h);
    ctx.fillStyle = '#e8e8e8'; ctx.font = `600 ${Math.max(10, Math.round(T * .27))}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(BOSS_LABELS[s.bo.k] + (s.bo.ph === 2 ? ' · nổi giận' : '') + (s.bo.vis ? '' : ' · đang ẩn'), bw / 2, y - 1);
  }
  if (s.bn && s.ph === 'play') {
    // event banner: wave, stage, boss phase...
    const fs = Math.max(13, Math.round(T * .5)), y = H * T * .3;
    ctx.font = `700 ${fs}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(s.bn).width;
    ctx.fillStyle = 'rgba(17,17,17,.78)'; rr(bw / 2 - tw / 2 - fs * .8, y - fs * .9, tw + fs * 1.6, fs * 1.8, fs * .4); ctx.fill();
    ctx.fillStyle = '#f0e6c8'; ctx.fillText(s.bn, bw / 2, y);
  }
}
