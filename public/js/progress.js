/* ---------- progress: achievements unlock hats (kept per browser) ---------- */
const HATS = {
  cap: 'Mũ lưỡi trai', beanie: 'Mũ len', crown: 'Vương miện', horns: 'Sừng quỷ', halo: 'Vòng thánh',
  bow: 'Nơ', headphones: 'Tai nghe', antenna: 'Ăng-ten', nurse: 'Mũ y tá',
  viking: 'Mũ Viking', knight: 'Mũ hiệp sĩ', wizard: 'Mũ phù thuỷ', pirate: 'Mũ hải tặc', tophat: 'Mũ chóp cao',
};
// check(ctx): ctx = { row (my end-of-round stats), won, md (mode), prog (lifetime totals), s (the final snapshot), me (my player in it) }
const ACHIEVEMENTS = [
  { id: 'first_win', name: 'Lần đầu thắng', desc: 'Thắng 1 ván', hat: 'cap', check: c => c.won },
  { id: 'veteran', name: 'Lão làng', desc: 'Chơi 30 ván', hat: 'beanie', check: c => c.prog.r >= 30, goal: () => [prog.r, 30] },
  { id: 'champion', name: 'Nhà vô địch', desc: 'Thắng 10 ván', hat: 'crown', check: c => c.prog.w >= 10, goal: () => [prog.w, 10] },
  { id: 'triple', name: 'Hat-trick', desc: 'Hạ 3 người trong 1 ván', hat: 'horns', check: c => c.md !== 'z' && c.row.k >= 3 },
  { id: 'ghost', name: 'Hồn ma báo thù', desc: 'Hạ người bằng bom thả khi đã chết', hat: 'halo', check: c => c.row.gk >= 1 },
  { id: 'pacifist', name: 'Tay không', desc: 'Thắng mà không nhặt vật phẩm nào', hat: 'bow', check: c => c.won && c.row.it === 0 },
  { id: 'survivor', name: 'Người sống sót', desc: 'Không bị lây trong chế độ zombie', hat: 'headphones', check: c => c.md === 'z' && c.won && !c.row.zb },
  { id: 'patient_zero', name: 'Bệnh nhân số 0', desc: 'Lây cho 3 người trong 1 ván zombie', hat: 'antenna', check: c => c.md === 'z' && c.row.k >= 3 },
  { id: 'medic', name: 'Cứu thương', desc: 'Cứu 2 đồng đội trong 1 ván', hat: 'nurse', check: c => c.row.rv >= 2 },
  // co-op and boss modes
  { id: 'exterminator', name: 'Thợ diệt quái', desc: 'Diệt 15 quái trong 1 ván', hat: 'viking', check: c => c.row.mk >= 15 },
  { id: 'boss_slayer', name: 'Diệt boss', desc: 'Thắng một ván Đánh boss', hat: 'knight', check: c => c.md === 'b' && c.won },
  { id: 'unbroken', name: 'Bất khuất', desc: 'Trụ qua 10 đợt trong Sinh tồn', hat: 'wizard', check: c => c.md === 'v' && c.s.wv - 1 >= 10 },
  { id: 'campaign', name: 'Phá đảo', desc: 'Qua hết 10 ải trong Đi ải', hat: 'pirate', check: c => c.md === 'c' && c.won },
  { id: 'final_boss', name: 'Trùm cuối', desc: 'Thắng khi làm boss trong Săn boss', hat: 'tophat', check: c => c.md === 'h' && c.won && !!c.me && c.me.boss },
];

let prog = (() => {
  try { const v = JSON.parse(store('bt-prog') || '{}'); return { r: v.r | 0, w: v.w | 0, a: v.a && typeof v.a === 'object' ? v.a : {}, hat: HATS[v.hat] ? v.hat : '' }; }
  catch (e) { return { r: 0, w: 0, a: {}, hat: '' }; }
})();
const saveProg = () => store('bt-prog', JSON.stringify(prog));
const hatUnlocked = h => ACHIEVEMENTS.some(a => a.hat === h && prog.a[a.id]);
let myHat = hatUnlocked(prog.hat) ? prog.hat : '';

function onRoundEnd(s) {
  if (mode !== 'online' || !s.st.length) return;
  const row = s.st.find(r => r.id === myPeer);
  if (!row) return;   // watched, did not play
  prog.r++;
  const won = s.wi.includes(myPeer);
  if (won) prog.w++;
  const ctx = { row, won, md: s.md, prog, s, me: s.pl.find(p => p.id === myPeer) };
  const fresh = ACHIEVEMENTS.filter(a => !prog.a[a.id] && a.check(ctx));
  for (const a of fresh) prog.a[a.id] = Date.now();
  saveProg();
  fresh.forEach((a, k) => setTimeout(() => toast(`Thành tích mới: ${a.name}`, `Mở khóa ${HATS[a.hat]}. Chọn mũ ở mục Bạn.`), k * 2500));
  if (fresh.length) renderProgress();
}

let toastTimer = null;
function toast(title, body) {
  const el = $('toast');
  el.textContent = '';
  const b = document.createElement('b'); b.textContent = title;
  const p = document.createElement('span'); p.textContent = body;
  el.append(b, p); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}

// a character in the player's colour wearing the hat, for the achievement cards
function hatPreview(h) {
  const cv = document.createElement('canvas'), sz = 56, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = cv.height = sz * dpr; cv.className = 'ach-pic';
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const cx = sz / 2, cy = sz / 2 + 7, r = 15;
  g.fillStyle = '#00000055'; g.beginPath(); g.ellipse(cx, cy + r + 3, r * .8, 3, 0, 0, 7); g.fill();
  g.fillStyle = COLORS[myColor]; g.strokeStyle = '#181818'; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#181818';
  for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * r * .35, cy + 1, 2.2, 0, 7); g.fill(); }
  drawHat(h, cx, cy, r, g);
  return cv;
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function renderProgress() {
  const got = ACHIEVEMENTS.filter(a => prog.a[a.id]).length;
  $('achTitle').textContent = 'thành tích';
  const stats = $('achStats'); stats.textContent = '';
  const tile = (label, value, bar) => {
    const t = el('div', 'ach-stat'); t.append(el('span', 'k', label), el('b', 'v', value));
    if (bar !== undefined) { const m = el('span', 'bar'); m.append(el('i')); m.firstChild.style.width = bar + '%'; t.append(m); }
    stats.append(t);
  };
  tile('Đã mở khóa', `${got}/${ACHIEVEMENTS.length}`, Math.round(got / ACHIEVEMENTS.length * 100));
  tile('Thắng', prog.w);
  tile('Ván đã chơi', prog.r);
  tile('Tỉ lệ thắng', prog.r ? Math.round(prog.w / prog.r * 100) + '%' : '–');
  const ul = $('achList'); ul.textContent = '';
  // unlocked first (newest on top), then locked in list order
  const list = [...ACHIEVEMENTS].sort((a, b) => (prog.a[b.id] || 0) - (prog.a[a.id] || 0));
  for (const a of list) {
    const on = !!prog.a[a.id];
    const li = el('li', on ? 'on' : '');
    const info = el('div', 'ach-info');
    info.append(el('b', '', a.name), el('span', 'ach-desc', a.desc));
    if (!on && a.goal) {
      const [cur, max] = a.goal(), m = el('span', 'bar');
      m.append(el('i')); m.firstChild.style.width = Math.min(100, cur / max * 100) + '%';
      info.append(el('span', 'ach-goal', `${Math.min(cur, max)}/${max}`), m);
    }
    const meta = el('span', 'ach-meta');
    meta.append(el('span', '', 'Thưởng: ' + HATS[a.hat]), el('span', on ? 'ach-date' : 'ach-lock', on ? '✓ ' + new Date(prog.a[a.id]).toLocaleDateString('vi-VN') : 'chưa mở'));
    info.append(meta);
    li.append(hatPreview(a.hat), info);
    ul.appendChild(li);
  }
  const box = $('hats'); box.textContent = '';
  const opts = [''].concat(Object.keys(HATS).filter(hatUnlocked));
  for (const h of opts) {
    const b = document.createElement('button');
    b.textContent = h ? HATS[h] : 'Không đội mũ';
    b.setAttribute('aria-pressed', h === myHat ? 'true' : 'false');
    b.onclick = () => { myHat = h; prog.hat = h; saveProg(); renderProgress(); pushMe(); };
    box.appendChild(b);
  }
  $('hatsWrap').hidden = opts.length < 2;
}

// hats are small canvas drawings on top of the player's head (cx, cy = centre, r = body radius)
function drawHat(h, cx, cy, r, g = ctx) {
  const top = cy - r;
  g.save();
  g.lineWidth = Math.max(1, r * .12); g.strokeStyle = '#181818';
  const poly = (pts, fill) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = fill; g.fill(); g.stroke(); };
  if (h === 'cap') {
    g.fillStyle = '#454545'; g.beginPath(); g.arc(cx, top + r * .38, r * .7, Math.PI, 0); g.fill(); g.stroke();
    g.fillRect(cx, top + r * .3, r * .95, r * .16); g.strokeRect(cx, top + r * .3, r * .95, r * .16);
  } else if (h === 'beanie') {
    g.fillStyle = '#c77f8c'; g.beginPath(); g.arc(cx, top + r * .4, r * .66, Math.PI, 0); g.fill(); g.stroke();
    g.fillStyle = '#e0c1c6'; g.beginPath(); g.arc(cx, top - r * .3, r * .18, 0, 7); g.fill(); g.stroke();
  } else if (h === 'crown') {
    poly([[cx - r * .6, top + r * .3], [cx - r * .6, top - r * .35], [cx - r * .3, top - r * .05], [cx, top - r * .45], [cx + r * .3, top - r * .05], [cx + r * .6, top - r * .35], [cx + r * .6, top + r * .3]], '#c9b27a');
  } else if (h === 'horns') {
    poly([[cx - r * .55, top + r * .3], [cx - r * .75, top - r * .45], [cx - r * .2, top + r * .15]], '#a3606c');
    poly([[cx + r * .55, top + r * .3], [cx + r * .75, top - r * .45], [cx + r * .2, top + r * .15]], '#a3606c');
  } else if (h === 'halo') {
    g.strokeStyle = '#c9b27a'; g.lineWidth = Math.max(1.5, r * .16);
    g.beginPath(); g.ellipse(cx, top - r * .3, r * .55, r * .18, 0, 0, 7); g.stroke();
  } else if (h === 'bow') {
    poly([[cx, top + r * .1], [cx - r * .6, top - r * .25], [cx - r * .6, top + r * .45]], '#b98fb0');
    poly([[cx, top + r * .1], [cx + r * .6, top - r * .25], [cx + r * .6, top + r * .45]], '#b98fb0');
    g.fillStyle = '#9d8fbf'; g.beginPath(); g.arc(cx, top + r * .1, r * .16, 0, 7); g.fill(); g.stroke();
  } else if (h === 'headphones') {
    g.strokeStyle = '#3c3c3c'; g.lineWidth = Math.max(1.5, r * .16);
    g.beginPath(); g.arc(cx, cy, r * 1.02, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    g.fillStyle = '#5a5a5a'; g.lineWidth = Math.max(1, r * .1); g.strokeStyle = '#181818';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * r * .95, cy - r * .1, r * .2, r * .32, 0, 0, 7); g.fill(); g.stroke(); }
  } else if (h === 'antenna') {
    g.strokeStyle = '#9d9d9d'; g.lineWidth = Math.max(1, r * .1);
    g.beginPath(); g.moveTo(cx, top + r * .1); g.lineTo(cx + r * .2, top - r * .6); g.stroke();
    g.fillStyle = '#c77f8c'; g.strokeStyle = '#181818'; g.beginPath(); g.arc(cx + r * .2, top - r * .65, r * .17, 0, 7); g.fill(); g.stroke();
  } else if (h === 'nurse') {
    poly([[cx - r * .55, top + r * .3], [cx - r * .45, top - r * .2], [cx + r * .45, top - r * .2], [cx + r * .55, top + r * .3]], '#e6e6e6');
    g.fillStyle = '#c77f8c';
    g.fillRect(cx - r * .07, top - r * .1, r * .14, r * .34); g.fillRect(cx - r * .17, top + r * .0, r * .34, r * .14);
  } else if (h === 'viking') {
    poly([[cx - r * .55, top + r * .25], [cx - r * 1.0, top - r * .45], [cx - r * .75, top + r * .2]], '#e6ddc8');
    poly([[cx + r * .55, top + r * .25], [cx + r * 1.0, top - r * .45], [cx + r * .75, top + r * .2]], '#e6ddc8');
    g.fillStyle = '#8a8f96'; g.beginPath(); g.arc(cx, top + r * .4, r * .68, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#5a5e64'; g.fillRect(cx - r * .68, top + r * .3, r * 1.36, r * .14);
  } else if (h === 'knight') {
    g.fillStyle = '#b8bcc2'; g.beginPath(); g.arc(cx, top + r * .5, r * .72, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#181818'; g.fillRect(cx - r * .45, top + r * .28, r * .9, r * .09);
    poly([[cx - r * .08, top - r * .2], [cx + r * .1, top - r * .75], [cx + r * .4, top - r * .55], [cx + r * .12, top - r * .15]], '#c77f8c');
  } else if (h === 'wizard') {
    poly([[cx - r * .75, top + r * .3], [cx + r * .1, top - r * 1.05], [cx + r * .75, top + r * .3]], '#7c6fa8');
    g.fillStyle = '#c9b27a'; g.beginPath(); g.arc(cx - r * .05, top - r * .2, r * .1, 0, 7); g.arc(cx + r * .25, top + r * .1, r * .07, 0, 7); g.fill();
  } else if (h === 'pirate') {
    poly([[cx - r * .85, top + r * .25], [cx - r * .5, top - r * .35], [cx, top - r * .15], [cx + r * .5, top - r * .35], [cx + r * .85, top + r * .25]], '#2a2a2a');
    g.fillStyle = '#e6e6e6'; g.beginPath(); g.arc(cx, top + r * .02, r * .13, 0, 7); g.fill();
  } else if (h === 'tophat') {
    g.fillStyle = '#222'; g.fillRect(cx - r * .45, top - r * .75, r * .9, r * .95); g.strokeRect(cx - r * .45, top - r * .75, r * .9, r * .95);
    g.fillRect(cx - r * .75, top + r * .12, r * 1.5, r * .18); g.strokeRect(cx - r * .75, top + r * .12, r * 1.5, r * .18);
    g.fillStyle = '#c77f8c'; g.fillRect(cx - r * .45, top - r * .02, r * .9, r * .14);
  }
  g.restore();
}

renderProgress();
