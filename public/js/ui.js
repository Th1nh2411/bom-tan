/* ---------- overlay, lists, buttons ---------- */
function setOverlay(big, small) {
  const ov = $('overlay');
  if (!big && !small) { ov.classList.add('hide'); return; }
  ov.classList.remove('hide');
  if ($('ovBig').textContent !== big) $('ovBig').textContent = big;
  if ($('ovSmall').textContent !== small) $('ovSmall').textContent = small;
}
const PVE_MODES = 'vbc';
// terminal-style round summary shown under the winner text
function renderStats(s) {
  const box = $('ovStats');
  const key = s && s.ph === 'end' && s.st.length ? s.rid + ':' + JSON.stringify(s.st) : '';
  if (box.dataset.key === key) return;
  box.dataset.key = key; box.textContent = '';
  if (!key) return;
  const nameOf = id => { const p = s.pl.find(q => q.id === id); return p ? p.name : '?'; };
  const w = Math.max(...s.st.map(r => nameOf(r.id).length), 4);
  const line = (txt, bold) => { const el = document.createElement(bold ? 'b' : 'span'); el.textContent = txt; box.append(el); };
  line('$ bom --stats\n');
  if (PVE_MODES.includes(s.md)) {
    // co-op: monsters and boss damage instead of kills
    const rows = [...s.st].sort((a, b) => b.mk + b.dmg * 2 - (a.mk + a.dmg * 2));
    for (const r of rows) {
      line(nameOf(r.id).padEnd(w + 2), true);
      line(`${String(r.mk).padStart(2)} quái  ${String(r.dmg).padStart(2)} sát thương boss  ${String(r.it).padStart(2)} đồ${r.rv ? '  ' + r.rv + ' cứu' : ''}\n`);
    }
    const best = rows[0];
    if (best && rows.length > 1 && best.mk + best.dmg > 0) line('> MVP: ' + nameOf(best.id));
    else box.lastChild.textContent = box.lastChild.textContent.replace(/\n$/, '');
    return;
  }
  const rows = [...s.st].sort((a, b) => b.k - a.k || b.it - a.it);
  for (const r of rows) {
    const fate = s.md === 'z' ? (r.zb === 2 ? 'zombie gốc' : r.by === '' ? 'sống sót' : r.by === '=' ? 'tự nổ, thành zombie' : 'bị ' + nameOf(r.by) + ' lây')
      : r.by === '' ? 'sống sót' : r.by === '-' ? 'bị loại' : r.by === '=' ? 'tự nổ' : r.by === '#' ? 'bị tường đè' : r.by === '@' ? 'bị quái hạ' : 'bị ' + nameOf(r.by) + ' hạ';
    line(nameOf(r.id).padEnd(w + 2), true);
    line(`${String(r.k).padStart(2)} kill  ${String(r.it).padStart(2)} đồ${r.rv ? '  ' + r.rv + ' cứu' : ''}${r.mk ? '  ' + r.mk + ' quái' : ''}  ${fate}\n`);
  }
  const best = rows[0];
  if (best && best.k > 0 && (rows.length < 2 || rows[1].k < best.k)) line('> MVP: ' + nameOf(best.id) + ' (' + best.k + ' kill)');
  else box.lastChild.textContent = box.lastChild.textContent.replace(/\n$/, '');
}
function winnerText(s) {
  if (s.w === 'zombies') return 'Zombie thắng!';
  if (s.w === 'humans') return 'Người sống sót thắng!';
  if (s.w === 'hunters') return 'Thợ săn thắng!';
  if (s.w === 'boss') { const b = s.pl.find(p => p.boss); return (b ? b.name : 'Boss') + ' (boss) thắng!'; }
  if (s.w === 'win') return s.md === 'c' ? 'Phá đảo! ' + '★'.repeat(Math.min(30, s.sr)) : 'Hạ boss thành công!';
  if (s.w === 'lose') return s.md === 'v' ? `Trụ được ${Math.max(0, s.wv - 1)} đợt` : s.md === 'c' ? `Dừng ở ải ${s.stg}` : 'Boss thắng rồi…';
  if (s.w.startsWith('team')) return TEAM_NAMES[Number(s.w.slice(4))] + ' thắng!';
  const p = s.pl.find(q => q.id === s.w);
  if (p && s.pl.length >= 2) return p.name + ' thắng!';
  return s.pl.length < 2 ? 'Hết ván' : 'Hòa!';
}
function countText(s, me) {
  if (!me) return 'Bạn đang xem ván này, ván sau sẽ vào chơi.';
  if (s.md === 't' && (me.team === 0 || me.team === 1)) return 'Bạn ở ' + TEAM_NAMES[me.team] + '. Sẵn sàng!';
  if (s.md === 'z') return me.zb ? 'Bạn là ZOMBIE! Chạm vào người khác để lây.' : 'Chạy khỏi zombie trong 90 giây. Bom chỉ làm zombie choáng 3 giây.';
  if (s.md === 'h') return me.boss ? `Bạn là BOSS với ${me.hp} mạng! Bấm E (hoặc nút E) để gọi quái.` : 'Săn boss trong 2 phút. Đứng cạnh đồng đội bị hạ để cứu.';
  if (s.md === 'v') return 'Quái kéo đến theo đợt. Diệt quái lấy xu, mua đồ giữa các đợt.';
  if (s.md === 'b') return 'Cùng nhau hạ boss! Né các ô báo đỏ.';
  if (s.md === 'c') return `Ải ${s.stg}: diệt hết quái rồi tìm cửa ra dưới thùng.`;
  return 'Sẵn sàng!';
}
function updateOverlay() {
  const s = snap;
  renderStats(s);
  renderBoardHint();
  renderShop();
  if (mode === 'local') {
    if (!s) return setOverlay('', '');
    if (s.ph === 'count') return setOverlay(String(s.tm || 1), 'P1: WASD + Space. P2: mũi tên + Enter.');
    if (s.ph === 'end') return setOverlay(winnerText(s), 'Ván mới bắt đầu sau vài giây');
    return setOverlay('', '');
  }
  if (practice) return setOverlay('', '');   // the sidebar says what is going on; the board stays playable
  if (!s) return setOverlay('Bom Tấn', 'Đang tải phòng #' + ROOM_ID + '…');
  const me = s.pl.find(p => p.id === myPeer);
  if (s.ph === 'count') return setOverlay(String(s.tm || 1), countText(s, me));
  if (s.ph === 'end') return setOverlay(winnerText(s), 'Sắp về sảnh chờ');
  setOverlay('', '');
}

// sidebar profile row: avatar in the player's colour, name, account
function renderMe() {
  const ini = (myName.trim()[0] || '?').toUpperCase(), shown = isLoggedIn() ? myName : 'Khách';
  for (const id of ['meAvatar', 'meAvatarBig']) { const av = $(id); if (av.textContent !== ini) av.textContent = ini; av.style.background = COLORS[myColor]; }
  if ($('meName').textContent !== shown) $('meName').textContent = shown;
  if ($('meBtnName').textContent !== shown) $('meBtnName').textContent = shown;
}
// bomb skins in the "Bạn" menu: a small preview of each
function renderSkins() {
  const box = $('skins'); box.textContent = '';
  BOMB_SKINS.forEach((name, k) => {
    const b = document.createElement('button');
    b.className = 'skin'; b.title = name; b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', k === mySkin ? 'true' : 'false');
    const cv2 = document.createElement('canvas'); cv2.width = cv2.height = 64;
    const g = cv2.getContext('2d'); g.scale(2, 2); drawBombSkin(g, k, 16, 18, 9, 28, 0);
    const nm = document.createElement('span'); nm.textContent = name;
    b.append(cv2, nm);
    b.onclick = () => { mySkin = k; store('bt-bomb', String(k)); renderSkins(); pushMe(); };
    box.appendChild(b);
  });
}
renderSkins();
// "Bạn" menu in the title bar: who you are, sign out, your colour
function setMeMenu(open) { $('mePanel').hidden = !open; $('meBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); }
$('meBtn').onclick = () => setMeMenu($('mePanel').hidden);
addEventListener('pointerdown', e => { if (!$('mePanel').hidden && !$('meMenu').contains(e.target)) setMeMenu(false); });
function renderList() {
  renderMe();
  renderRoster();
  renderRoomPanel();
}

// leaderboard: one board per record (versus wins, survival wave, campaign stage, bosses beaten), each with a
// podium, the top 10 (plus your own row) and a card with your rank at the top
const pctOf = r => (r.g ? Math.round(r.w / r.g * 100) : 0);
const LB_BOARDS = {
  pvp: { name: 'Đối kháng', ico: '⚔️', lead: 'Xếp theo số ván thắng. Chỉ tính ván có từ 2 người trở lên.', has: r => r.g > 0,
    sort: (a, b) => b.w - a.w || b.k - a.k || a.g - b.g, big: r => r.w + ' thắng', sub: r => `${r.g} ván · ${pctOf(r)}% · ${r.k} hạ` },
  wv: { name: 'Sinh tồn', ico: '🌊', lead: 'Đợt xa nhất từng trụ tới trong Sinh tồn.', has: r => r.wv > 0,
    sort: (a, b) => b.wv - a.wv, big: r => 'Đợt ' + r.wv, sub: () => 'kỷ lục' },
  stg: { name: 'Đi ải', ico: '🗺️', lead: 'Ải xa nhất từng qua trong Đi ải (10 là phá đảo).', has: r => r.stg > 0,
    sort: (a, b) => b.stg - a.stg, big: r => r.stg >= 10 ? 'Phá đảo' : 'Ải ' + r.stg, sub: r => r.stg + '/10 ải' },
  bk: { name: 'Diệt boss', play: 'Đánh boss', ico: '🐉', lead: 'Số ván Đánh boss đã thắng.', has: r => r.bk > 0,
    sort: (a, b) => b.bk - a.bk, big: r => r.bk + ' boss', sub: () => 'đã hạ' },
};
let lbTab = LB_BOARDS[store('bt-lbtab')] ? store('bt-lbtab') : 'pvp';
const lbAvatar = (r, cls = 'lb-av') => {
  // each player gets a stable colour from their id
  const a = el('span', cls, (r.n.trim()[0] || '?').toUpperCase());
  a.style.background = COLORS[[...r.u].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) & 7];
  return a;
};
function renderLeaderboard() {
  const box = $('lbBody'); box.textContent = '';
  const all = Object.entries(lb).map(([key, v]) => {
    const u = typeof v.u === 'string' ? v.u : key;
    return { key, u, n: profileNames.get(u) || cleanName(v && v.n) || 'Ẩn danh', w: v.w | 0, g: v.g | 0, k: v.k | 0, s: v.s | 0, r: v.r | 0, wv: v.wv | 0, stg: v.stg | 0, bk: v.bk | 0 };
  });
  resolveProfiles(all.map(r => r.u));
  const mine = myUid ? safeKey(myUid) : null, B = LB_BOARDS[lbTab];
  const rows = all.filter(B.has).sort(B.sort);
  const myRank = rows.findIndex(r => r.key === mine);
  $('lbLead').textContent = B.lead;

  // tabs
  const tabs = el('div', 'lb-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [id, b] of Object.entries(LB_BOARDS)) {
    const t = el('button', 'lb-tabbtn' + (id === lbTab ? ' on' : ''));
    t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', id === lbTab ? 'true' : 'false');
    t.append(el('span', 'ico', b.ico), el('span', '', b.name), el('span', 'n', String(all.filter(b.has).length)));
    t.onclick = () => { lbTab = id; store('bt-lbtab', id); renderLeaderboard(); };
    tabs.append(t);
  }
  box.append(tabs);

  // your rank on this board
  const me = el('div', 'lb-me');
  const meRow = myRank >= 0 ? rows[myRank] : null;
  me.append(lbAvatar(meRow || { n: myName, u: myUid || 'x' }, 'lb-av lg'));
  const mt = el('div', 'lb-me-t');
  mt.append(el('span', 'k', 'Hạng của bạn · ' + B.name));
  if (meRow) mt.append(el('b', '', `#${myRank + 1}`), el('span', 'v', `${B.big(meRow)} · ${B.sub(meRow)}`));
  else mt.append(el('b', 'none', 'Chưa có hạng'), el('span', 'v', lbTab === 'pvp' ? 'Chơi một ván đối kháng có từ 2 người để lên bảng.' : 'Chơi chế độ ' + (B.play || B.name) + ' để lên bảng.'));
  me.append(mt);
  if (meRow && myRank > 0) { const ahead = rows[myRank - 1]; me.append(el('span', 'lb-chase', `Kế trên: ${ahead.n} (${B.big(ahead)})`)); }
  box.append(me);

  if (!rows.length) { box.append(el('p', 'lb-empty', 'Chưa có ai trên bảng này. Người đầu tiên sẽ là bạn?')); return; }

  // podium: 2nd, 1st, 3rd
  const pod = el('div', 'lb-podium');
  for (const k of [1, 0, 2]) {
    const r = rows[k];
    const c = el('div', 'lb-pod p' + (k + 1) + (r ? '' : ' empty') + (r && r.key === mine ? ' you' : ''));
    if (r) {
      if (k === 0) c.append(el('span', 'lb-crown', '👑'));
      c.append(lbAvatar(r, 'lb-av xl'), el('b', 'lb-pn', r.n), el('span', 'lb-big', B.big(r)), el('span', 'lb-sub', B.sub(r)));
    }
    c.append(el('div', 'lb-step', String(k + 1)));
    pod.append(c);
  }
  box.append(pod);

  // table: top 10, plus my own row when I am further down
  const pvp = lbTab === 'pvp';
  const wrap = el('div', 'lb-wrap'), tbl = el('table', 'lb'), head = el('tr');
  const cols = pvp ? [['#', 'rk'], ['Người chơi', 'nm'], ['Thắng'], ['Ván'], ['Tỉ lệ thắng', 'rate'], ['Hạ', 'opt'], ['Cứu', 'opt']] : [['#', 'rk'], ['Người chơi', 'nm'], ['Kỷ lục']];
  cols.forEach(([t, c]) => head.appendChild(el('th', c || '', t)));
  tbl.appendChild(head);
  const addRow = (r, rank) => {
    const tr = el('tr', (r.key === mine ? 'you ' : '') + (rank <= 3 ? 'top' : ''));
    const rk = el('td', 'rk');
    rk.append(rank <= 3 ? el('span', 'lb-rank m' + rank, String(rank)) : document.createTextNode(String(rank)));
    const nm = el('td', 'nm'), who = el('div', 'cell'); who.append(lbAvatar(r), el('span', 'lb-n', r.n));
    if (r.key === mine) who.append(el('span', 'lb-tag', 'bạn'));
    nm.append(who);
    tr.append(rk, nm);
    if (pvp) {
      const rate = el('td', 'rate'), rc = el('div', 'cell'), bar = el('span', 'bar'); bar.append(el('i')); bar.firstChild.style.width = pctOf(r) + '%';
      rc.append(bar, el('span', '', pctOf(r) + '%')); rate.append(rc);
      tr.append(el('td', 'w', r.w), el('td', '', r.g), rate, el('td', 'opt', r.k), el('td', 'opt', r.r));
    } else tr.append(el('td', 'w', B.big(r)));
    tbl.appendChild(tr);
  };
  rows.slice(0, 10).forEach((r, k) => addRow(r, k + 1));
  if (myRank >= 10) { const gap = el('tr', 'gap'); gap.appendChild(el('td', '', '⋯')); gap.firstChild.colSpan = cols.length; tbl.appendChild(gap); addRow(rows[myRank], myRank + 1); }
  wrap.appendChild(tbl); box.appendChild(wrap);

  // titles for fun (versus board)
  if (pvp) {
    const titles = [['🎯', 'Sát thủ', 'k', 'hạ'], ['⛑️', 'Cứu thương', 'r', 'lần cứu'], ['💥', 'Thánh tự nổ', 's', 'lần tự nổ']]
      .map(([ico, name, f, unit]) => { const r = rows.filter(x => x[f] > 0).sort((a, b) => b[f] - a[f])[0]; return r && [ico, name, r, `${r[f]} ${unit}`]; }).filter(Boolean);
    if (titles.length) {
      const fun = el('div', 'lb-titles');
      for (const [ico, name, r, v] of titles) {
        const t = el('div', 'lb-title');
        const tx = el('div', 'lb-title-t'); tx.append(el('span', 'k', name), el('b', '', r.n), el('span', 'v', v));
        t.append(el('span', 'ico', ico), tx);
        fun.append(t);
      }
      box.append(fun);
    }
  }
}

function setNet(on, text) { $('stNet').classList.toggle('on', on); $('netText').textContent = text; }
function updateNetText() {
  if (!room) return;
  if (!connected) return setNet(false, 'đang kết nối lại…');
  const n = peers().filter(p => p.kind === 'viewer').length;
  setNet(true, 'online');
  $('stPlayers').textContent = !ROOM_ID ? 'sân tập' : n <= 1 ? 'chỉ có bạn trong phòng' : `${n} người trong phòng`;
}
function updateStatus() {
  const s = snap, room0 = mode === 'online' ? net : null;
  cv.style.cursor = canGhost() ? 'crosshair' : '';
  const mapName = s && !practice && s.ph !== 'lobby' && MAP_NAMES[s.mp] ? ' · map: ' + MAP_NAMES[s.mp].toLowerCase() : '';
  $('stMode').textContent = (mode === 'local' ? 'chế độ: 1 máy' : room0 ? 'chế độ: ' + MODE_INFO[room0.md][0].toLowerCase() : '') + mapName;
  let host = '';
  if (room0 && room0.ow) {
    const hp = peers().find(p => p.peer === room0.ow);
    host = 'chủ phòng: ' + (room0.ow === myPeer ? 'bạn' : (hp ? peerName(hp) : '…'));
  }
  $('stHost').textContent = host;
  const ph = practice ? (ROOM_ID ? 'sảnh chờ · sân tập' : 'sân tập') : !s ? '' : { lobby: 'sảnh chờ', count: 'đếm ngược', play: 'đang chơi', end: 'hết ván' }[s.ph];
  let note = ph ? '// ' + ph : '';
  if (s && !practice && s.ph === 'play') {
    if (s.md === 'v') note += s.brk > 0 ? ` · đợt ${s.wv} xong, nghỉ ${s.brk}s` : ` · đợt ${s.wv} · còn ${s.ml} quái`;
    if (s.md === 'c') note += ` · ải ${s.stg}/10 · còn ${s.ml} quái` + (s.ex && s.ex.open ? ' · cửa ra đã mở!' : '');
    if (s.md === 'b' && s.bo) note += ` · boss ${s.bo.hp}/${s.bo.max}`;
    if (s.ht >= 0) note += ` · còn ${mmss(s.ht)}`;
    const me = s.pl.find(p => p.id === myPeer);
    if (me && me.boss) note += ` · ${me.hp} mạng · E: gọi quái${s.hs > 0 ? ' sau ' + s.hs + 's' : ''}`;
    if (me && PVE_MODES.includes(s.md)) note += `${s.pl.length === 1 ? ' · ' + (me.alive ? '♥'.repeat(me.hp) : '♡') : ''} · 🪙 ${me.coins}`;
  }
  if (s && s.ph === 'play' && s.sd > 0) note += ` · bo sau ${Math.floor(s.sd / 60)}:${String(s.sd % 60).padStart(2, '0')}`;
  else if (s && s.ph === 'play' && s.sd === 0) note += ' · bo đang thu hẹp';
  if (s && !practice && s.ph === 'play' && s.zt >= 0) {
    const zs = s.pl.filter(p => p.zb).length;
    note += ` · còn ${mmss(s.zt)} · ${s.pl.length - zs} người, ${zs} zombie`;
  }
  const meP = s && s.ph === 'play' ? s.pl.find(p => p.id === (mode === 'local' ? 'p1' : myPeer)) : null;
  if (meP && meP.alive && meP.shape) note += ' · bom: ' + ['', 'chéo', 'vuông', 'xuyên'][meP.shape];
  if (meP && meP.alive && meP.ck) note += ` · bị nguyền: ${CURSE_NAMES[meP.ck]} ${meP.ct}s`;
  if (canGhost()) {
    const wait = Math.ceil((ghostReadyAt - performance.now()) / 1000);
    note += wait > 0 ? ` · thả bom sau ${wait}s` : ' · click để thả bom';
  }
  if ($('tabNote').textContent !== note) $('tabNote').textContent = note;
}

function updateUI() {
  const online = mode === 'online', paused = (online ? net && net.pz : snap && snap.pz) || coverLocal;
  $('pauseBtn').textContent = paused ? '▶' : '⏸';
  $('teamCard').hidden = !(online && net && net.md === 't' && net.ph === 'lobby');
  const me = online && !practice && snap ? snap.pl.find(p => p.id === myPeer) : null;
  $('skillBtn').hidden = !(me && me.boss);
  document.body.classList.toggle('local', !online);   // local mode needs no sign-in: the login gate steps aside
  renderRoomPanel();
  renderRoster();
}
addEventListener('hashchange', () => location.reload());
function setDrawer(open) {
  document.body.classList.toggle('drawer-open', open);
  $('drawerBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('drawerBtn').setAttribute('aria-label', open ? 'Đóng bảng điều khiển' : 'Mở bảng điều khiển');
}
$('drawerBtn').onclick = () => setDrawer(!document.body.classList.contains('drawer-open'));
$('scrim').onclick = () => setDrawer(false);
addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'Backquote') { e.preventDefault(); return setPause(false); }
  if (e.key !== 'Escape') return;
  if (!$('mePanel').hidden) return setMeMenu(false);
  if (document.body.classList.contains('drawer-open')) return setDrawer(false);
  setPause(true);
});
matchMedia('(max-width:860px)').addEventListener('change', e => { if (!e.matches) setDrawer(false); });
// touch screens have no Esc / ` keys: one button toggles the pause
$('pauseBtn').onclick = () => { setPause(!((mode === 'online' ? net && net.pz : snap && snap.pz) || coverLocal)); updateUI(); };

/* ---------- editor tabs: bom_tan.js (the board), Thành tích, Bảng xếp hạng, Hướng dẫn ---------- */
document.querySelectorAll('.tabbar .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    document.querySelectorAll('.tabbar .tab').forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    document.querySelectorAll('.info-panel').forEach(p => p.classList.toggle('active', p.id === view));
    document.body.classList.toggle('view-doc', view !== 'game');
  });
});

updateUI();
initNet();
requestAnimationFrame(frame);
