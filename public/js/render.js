/* ---------- main loop ---------- */
let lastT = performance.now(), lastListT = 0;
function simulate(now) {
  const dt = Math.min(0.05, Math.max(0, now - lastT) / 1000); lastT = now;
  mouseSteer();
  if (mode === 'local' && localGame) {
    const li = { p1: ctlDir(ctlA), p2: ctlDir(ctlB) };
    if (localGame.pz) holdInputs(localGame, li); else stepGame(localGame, li, dt, scores);
    if (localGame.ph === 'end' && localGame.timer <= 0) localGame = newGame(localSlots(), false);
    setSnap(sanitizeSnap(snapshot(localGame, scores)));
  } else {
    predictStep(dt);
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
    ctx.strokeStyle = '#181818'; ctx.lineWidth = Math.max(1, T * .05); ctx.stroke();
    ctx.font = `${Math.round(T * .44)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fillEmoji({ b: '💣', f: '🔥', s: '👟', k: '🧤', h: '🛡️', c: '💀' }[c], px + T / 2, py + T / 2 + bob + T * .02);
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

  for (const i of s.fl) {
    const x = i % W, y = (i / W) | 0, px = x * T, py = y * T;
    const flick = .85 + Math.sin(now / 40 + i) * .08;
    ctx.fillStyle = '#c08a62'; rr(px + T * .04, py + T * .04, T * .92, T * .92, T * .3); ctx.fill();
    ctx.fillStyle = '#bfa377'; rr(px + T * (.5 - .32 * flick), py + T * (.5 - .32 * flick), T * .64 * flick, T * .64 * flick, T * .22); ctx.fill();
    ctx.fillStyle = '#e6ddc8'; ctx.beginPath(); ctx.arc(px + T / 2, py + T / 2, T * .15 * flick, 0, 7); ctx.fill();
  }

  const seenB = new Set();
  for (const b of s.bm) {
    seenB.add(b.id);
    let d = bombDisp.get(b.id);
    if (!d || Math.hypot(d.x - b.x, d.y - b.y) > 2) { d = { x: b.x, y: b.y }; bombDisp.set(b.id, d); }
    const k = Math.min(1, dt * 25); d.x += (b.x - d.x) * k; d.y += (b.y - d.y) * k;
    const cx = d.x * T + T / 2, cy = d.y * T + T / 2;
    const pulse = 1 + Math.sin(now / (b.t < 8 ? 60 : 140)) * .06;
    const r = T * .32 * pulse;
    ctx.fillStyle = '#00000066'; ctx.beginPath(); ctx.ellipse(cx, cy + T * .3, T * .3, T * .08, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#111111'; ctx.beginPath(); ctx.arc(cx, cy + T * .04, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#3c3c3c'; ctx.lineWidth = Math.max(1, T * .03); ctx.stroke();
    ctx.fillStyle = '#ffffff55'; ctx.beginPath(); ctx.arc(cx - r * .35, cy - r * .3, r * .25, 0, 7); ctx.fill();
    ctx.strokeStyle = '#5a4a33'; ctx.lineWidth = Math.max(1.5, T * .06);
    ctx.beginPath(); ctx.moveTo(cx + r * .4, cy - r * .7); ctx.quadraticCurveTo(cx + r * .9, cy - r * 1.3, cx + r * .6, cy - r * 1.5); ctx.stroke();
    ctx.fillStyle = (now / 80 | 0) % 2 ? '#d6c28e' : '#b07a52';
    ctx.beginPath(); ctx.arc(cx + r * .6, cy - r * 1.5, T * .07, 0, 7); ctx.fill();
  }
  for (const id of [...bombDisp.keys()]) if (!seenB.has(id)) bombDisp.delete(id);

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
    const cx = d.x * T + T / 2, cy = d.y * T + T / 2, r = T * .34;
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
    if (p.hat) drawHat(p.hat, cx, cy, r);
    if (p.ck && p.alive) {
      // cursed: a dashed ring that spins, plus a small skull
      ctx.save(); ctx.setLineDash([T * .08, T * .07]); ctx.lineDashOffset = -now / 40;
      ctx.strokeStyle = '#9d8fbf'; ctx.lineWidth = Math.max(1.5, T * .05);
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
}
