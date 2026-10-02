/* ---------- overlay, lists, buttons ---------- */
function setOverlay(big, small) {
  const ov = $('overlay');
  if (!big && !small) { ov.classList.add('hide'); return; }
  ov.classList.remove('hide');
  if ($('ovBig').textContent !== big) $('ovBig').textContent = big;
  if ($('ovSmall').textContent !== small) $('ovSmall').textContent = small;
}
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
  const rows = [...s.st].sort((a, b) => b.k - a.k || b.it - a.it);
  for (const r of rows) {
    const fate = s.md === 'z' ? (r.zb === 2 ? 'zombie gốc' : r.by === '' ? 'sống sót' : r.by === '=' ? 'tự nổ, thành zombie' : 'bị ' + nameOf(r.by) + ' lây')
      : r.by === '' ? 'sống sót' : r.by === '-' ? 'bị loại' : r.by === '=' ? 'tự nổ' : r.by === '#' ? 'bị tường đè' : 'bị ' + nameOf(r.by) + ' hạ';
    line(nameOf(r.id).padEnd(w + 2), true);
    line(`${String(r.k).padStart(2)} kill  ${String(r.it).padStart(2)} đồ${r.rv ? '  ' + r.rv + ' cứu' : ''}  ${fate}\n`);
  }
  const best = rows[0];
  if (best && best.k > 0 && (rows.length < 2 || rows[1].k < best.k)) line('> MVP: ' + nameOf(best.id) + ' (' + best.k + ' kill)');
  else box.lastChild.textContent = box.lastChild.textContent.replace(/\n$/, '');
}
function winnerText(s) {
  if (s.w === 'zombies') return 'Zombie thắng!';
  if (s.w === 'humans') return 'Người sống sót thắng!';
  if (s.w.startsWith('team')) return TEAM_NAMES[Number(s.w.slice(4))] + ' thắng!';
  const p = s.pl.find(q => q.id === s.w);
  if (p && s.pl.length >= 2) return p.name + ' thắng!';
  return s.pl.length < 2 ? 'Hết ván' : 'Hòa!';
}
function updateOverlay() {
  const s = snap;
  renderStats(s);
  renderLobby();
  if (!lobbyEl.hidden) return setOverlay('', '');   // the lobby card has it all
  if (mode === 'local') {
    if (!s) return setOverlay('', '');
    if (s.ph === 'count') return setOverlay(String(s.tm || 1), 'P1: WASD + Space. P2: mũi tên + Enter.');
    if (s.ph === 'end') return setOverlay(winnerText(s), 'Ván mới bắt đầu sau vài giây');
    return setOverlay('', '');
  }
  if (kickedOut) return setOverlay('Bạn đã bị kick', 'Chủ phòng đã mời bạn ra khỏi phòng #' + ROOM_ID + '. Đổi mã phòng trên thanh địa chỉ để vào phòng khác.');
  if (roomFull) return setOverlay('Phòng đã đầy', 'Phòng #' + ROOM_ID + ' đã đủ người. Đổi mã phòng trên thanh địa chỉ để tạo phòng khác.');
  if (!connected && !s) return setOverlay('Bom Tấn', 'Đang kết nối tới phòng #' + ROOM_ID + '…');
  if (!s) return setOverlay('Bom Tấn', 'Đang tải phòng #' + ROOM_ID + '…');
  const me = s.pl.find(p => p.id === myPeer);
  if (s.ph === 'count') {
    let sub = me ? 'Sẵn sàng!' : 'Bạn đang xem ván này, ván sau sẽ vào chơi.';
    if (me && s.md === 't' && (me.team === 0 || me.team === 1)) sub = 'Bạn ở ' + TEAM_NAMES[me.team] + '. Sẵn sàng!';
    if (me && s.md === 'z') sub = me.zb ? 'Bạn là ZOMBIE! Chạm vào người khác để lây.' : 'Chạy khỏi zombie trong 90 giây. Bom chỉ làm zombie choáng 3 giây.';
    return setOverlay(String(s.tm || 1), sub);
  }
  if (s.ph === 'end') return setOverlay(winnerText(s), 'Sắp về sảnh chờ');
  setOverlay('', '');
}

// sidebar profile row: avatar in the player's colour, name, account
function renderMe() {
  const av = $('meAvatar'), ini = (myName.trim()[0] || '?').toUpperCase();
  if (av.textContent !== ini) av.textContent = ini;
  av.style.background = COLORS[myColor];
  if ($('meName').textContent !== myName) $('meName').textContent = myName;
}
function renderList() {
  renderMe();
  const ol = $('plist'); ol.textContent = '';
  let rows = [];
  const s = snap, now = performance.now();
  const byOf = new Map(peers().map(p => [p.peer, p.by]));
  if (s && s.pl.length) {
    rows = s.pl.map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score, dead: s.ph !== 'lobby' && !p.alive && !p.downed, downed: p.downed, team: s.md === 't' ? p.team : -1 }));
  }
  const owner = isOwner();
  $('pcount').textContent = rows.length || '';
  if (!rows.length) { const li = document.createElement('p'); li.className = 'empty'; li.textContent = 'Chưa có ai trong phòng.'; ol.appendChild(li); return; }
  rows.sort((a, b) => (a.team - b.team) || (b.score - a.score));
  const accIds = [];
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = (r.dead ? 'dead ' : '') + (r.team === 0 ? 'team0' : r.team === 1 ? 'team1' : '');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = r.color;
    const nmw = document.createElement('span'); nmw.className = 'nmw';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.name;
    nmw.appendChild(nm);
    const uid = mode === 'online' ? byOf.get(r.id) : null;
    if (uid) {
      const an = profileNames.get(uid);
      if (an === undefined) accIds.push(uid);
      else if (an) { const ac = document.createElement('span'); ac.className = 'acc'; ac.textContent = an; nmw.appendChild(ac); }
    }
    const em = emShow.get(r.id);
    const emo = document.createElement('span'); emo.className = 'em'; emo.textContent = em && em.until > now ? EMOTES[em.k] : '';
    const tags = [];
    if (r.downed) tags.push('cần cứu!');
    if (mode === 'online' && r.id === myPeer) tags.push('bạn');
    if (mode === 'online' && s && r.id === s.ow) tags.push('chủ phòng');
    if (mode === 'online' && s && s.ph === 'play' && !r.dead && !peers().some(p => p.peer === r.id)) tags.push('mất kết nối');
    if (mode === 'online') {
      const pp = peers().find(p => p.peer === r.id), ms = r.id === myPeer ? myRtt : pp && pp.presence.rt;
      if (typeof ms === 'number' && (r.id !== myPeer || myRtt)) tags.push(ms < 5 ? '<5ms' : ms + 'ms');
    }
    if (owner && s.kk.includes(r.id)) tags.push('đã kick');
    const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = tags.join(', ');
    const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = r.score; sc.title = 'Số ván thắng trong phiên này';
    li.append(dot, nmw, emo, tg, sc);
    if (owner && r.id !== myPeer && !s.kk.includes(r.id)) {
      const kb = document.createElement('button');
      kb.className = 'kick'; kb.textContent = 'kick'; kb.dataset.kick = r.id; kb.dataset.name = r.name;
      kb.setAttribute('aria-label', 'Kick ' + r.name);
      li.appendChild(kb);
    }
    ol.appendChild(li);
  }
  resolveProfiles(accIds);
}

function kickPeer(peer) { room.cmd({ c: 'kick', peer }); }
// the list is rebuilt every 250ms, so listen on the container and act on pointerdown (a click could lose its target)
$('plist').addEventListener('pointerdown', e => {
  const b = e.target.closest('button.kick');
  if (!b || !isOwner()) return;
  e.preventDefault();
  if (confirm('Kick ' + b.dataset.name + ' khỏi phòng?')) kickPeer(b.dataset.kick);
});

function renderLeaderboard() {
  const box = $('lbBody'); box.textContent = '';
  const rows = Object.entries(lb).map(([key, v]) => {
    const u = typeof v.u === 'string' ? v.u : key;
    return { key, u, n: profileNames.get(u) || cleanName(v && v.n) || 'Ẩn danh', w: v.w | 0, g: v.g | 0, k: v.k | 0, s: v.s | 0, r: v.r | 0 };
  }).filter(r => r.g > 0);
  resolveProfiles(rows.map(r => r.u));
  if (!rows.length) { box.appendChild(el('p', 'empty', 'Chưa có ván nào được ghi. Ván có từ 2 người trở lên sẽ được tính.')); return; }
  rows.sort((a, b) => b.w - a.w || b.k - a.k || a.g - b.g);
  const mine = myUid ? safeKey(myUid) : null;
  const pct = r => Math.round(r.w / r.g * 100);
  // each player gets a stable colour from their id
  const avatar = r => {
    const a = el('span', 'lb-av', (r.n.trim()[0] || '?').toUpperCase());
    a.style.background = COLORS[[...r.u].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) & 7];
    return a;
  };
  // podium: the top 3 as cards
  const pod = el('div', 'lb-podium');
  rows.slice(0, 3).forEach((r, k) => {
    const c = el('div', 'lb-pod p' + (k + 1) + (r.key === mine ? ' you' : ''));
    const who = el('div', 'lb-who'); who.append(avatar(r), el('b', '', r.n));
    c.append(el('span', 'lb-medal', '#' + (k + 1)), who, el('span', 'lb-big', r.w + ' thắng'), el('span', 'lb-sub', `${r.g} ván · ${pct(r)}% · ${r.k} hạ`));
    pod.appendChild(c);
  });
  box.appendChild(pod);
  // table: top 10, plus my own row when I am further down
  const wrap = el('div', 'lb-wrap'), tbl = el('table', 'lb'), head = el('tr');
  [['#', 'rk'], ['Người chơi', 'nm'], ['Thắng'], ['Ván'], ['Tỉ lệ thắng', 'rate'], ['Hạ', 'opt'], ['Cứu', 'opt']].forEach(([t, c]) => head.appendChild(el('th', c || '', t)));
  tbl.appendChild(head);
  const addRow = (r, rank) => {
    const tr = el('tr', r.key === mine ? 'you' : '');
    const nm = el('td', 'nm'), who = el('div', 'cell'); who.append(avatar(r), el('span', 'lb-n', r.n));
    if (r.key === mine) who.append(el('span', 'lb-tag', 'bạn'));
    nm.append(who);
    const rate = el('td', 'rate'), rc = el('div', 'cell'), bar = el('span', 'bar'); bar.append(el('i')); bar.firstChild.style.width = pct(r) + '%';
    rc.append(bar, el('span', '', pct(r) + '%')); rate.append(rc);
    tr.append(el('td', 'rk', rank), nm, el('td', 'w', r.w), el('td', '', r.g), rate, el('td', 'opt', r.k), el('td', 'opt', r.r));
    tbl.appendChild(tr);
  };
  rows.slice(0, 10).forEach((r, k) => addRow(r, k + 1));
  const myRank = rows.findIndex(r => r.key === mine);
  if (myRank >= 10) { const gap = el('tr', 'gap'); gap.appendChild(el('td', '', '⋯')); gap.firstChild.colSpan = 7; tbl.appendChild(gap); addRow(rows[myRank], myRank + 1); }
  wrap.appendChild(tbl); box.appendChild(wrap);
  const worst = rows.filter(r => r.s > 0).sort((a, b) => b.s - a.s)[0];
  if (worst) box.appendChild(el('p', 'fun', `Tự nổ nhiều nhất: ${worst.n} (${worst.s} lần)`));
}

function setNet(on, text) { $('stNet').classList.toggle('on', on); $('netText').textContent = text; }
function updateNetText() {
  if (!room) return;
  if (!connected) return setNet(false, 'đang kết nối lại…');
  const n = peers().filter(p => p.kind === 'viewer').length;
  setNet(true, 'online');
  $('stPlayers').textContent = n <= 1 ? 'chỉ có bạn trong phòng' : `${n} người trong phòng`;
}
function updateStatus() {
  const s = snap;
  cv.style.cursor = canGhost() ? 'crosshair' : '';
  $('stMode').textContent = mode === 'local' ? 'chế độ: 1 máy' : ('chế độ: ' + MODE_NAMES[s ? s.md : 's'].toLowerCase());
  let host = '';
  if (mode === 'online' && s && s.ow) {
    const hp = peers().find(p => p.peer === s.ow);
    host = 'chủ phòng: ' + (s.ow === myPeer ? 'bạn' : (hp ? peerName(hp) : '…'));
  }
  $('stHost').textContent = host;
  const ph = !s ? '' : { lobby: 'sảnh chờ', count: 'đếm ngược', play: 'đang chơi', end: 'hết ván' }[s.ph];
  let note = ph ? '// ' + ph : '';
  if (s && s.ph === 'play' && s.sd > 0) note += ` · bo sau ${Math.floor(s.sd / 60)}:${String(s.sd % 60).padStart(2, '0')}`;
  else if (s && s.ph === 'play' && s.sd === 0) note += ' · bo đang thu hẹp';
  if (s && s.ph === 'play' && s.zt >= 0) {
    const zs = s.pl.filter(p => p.zb).length;
    note += ` · còn ${mmss(s.zt)} · ${s.pl.length - zs} người, ${zs} zombie`;
  }
  const meP = s && s.ph === 'play' ? s.pl.find(p => p.id === (mode === 'local' ? 'p1' : myPeer)) : null;
  if (meP && meP.alive && meP.ck) note += ` · bị nguyền: ${CURSE_NAMES[meP.ck]} ${meP.ct}s`;
  if (canGhost()) {
    const wait = Math.ceil((ghostReadyAt - performance.now()) / 1000);
    note += wait > 0 ? ` · thả bom sau ${wait}s` : ' · click để thả bom';
  }
  if ($('tabNote').textContent !== note) $('tabNote').textContent = note;
}

function updateUI() {
  $('pauseBtn').textContent = (snap && snap.pz) || coverLocal ? '▶' : '⏸';
  const online = mode === 'online';
  // mode, ready and start live on the lobby card; mid-round the owner can stop from here
  $('lobbyBtn').hidden = !(isOwner() && !!snap && snap.ph !== 'lobby');
  $('localBtn').lastChild.textContent = online ? 'Chơi 2 người trên 1 máy' : 'Thoát chế độ 1 máy';
  $('teamCard').hidden = !(online && snap && snap.md === 't');
  document.body.classList.toggle('local', !online);   // local mode needs no sign-in: the login gate steps aside
}
$('inviteBtn').onclick = async () => {
  const btn = $('inviteBtn').lastChild, link = location.href;
  try { await navigator.clipboard.writeText(link); btn.textContent = 'Đã sao chép link phòng #' + ROOM_ID; }
  catch (e) { prompt('Gửi link này cho bạn bè:', link); }
  setTimeout(() => { btn.textContent = 'Sao chép link mời'; }, 2000);
};
addEventListener('hashchange', () => location.reload());
$('lobbyBtn').onclick = () => room.cmd({ c: 'lobby' });
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
  if (document.body.classList.contains('drawer-open')) return setDrawer(false);
  setPause(true);
});
matchMedia('(max-width:860px)').addEventListener('change', e => { if (!e.matches) setDrawer(false); });
// drop focus so player 2's Enter (bomb) does not click this button again and leave local mode
$('localBtn').onclick = () => { $('localBtn').blur(); if (mode === 'online') startLocal(); else stopLocal(); updateUI(); };
$('gateExitBtn').onclick = () => { $('gateExitBtn').blur(); stopLocal(); updateUI(); };
$('gateLocalBtn').onclick = () => { $('gateLocalBtn').blur(); setDrawer(false); startLocal(); updateUI(); };
// touch screens have no Esc / ` keys: one button toggles the pause
$('pauseBtn').onclick = () => { setPause(!((snap && snap.pz) || coverLocal)); updateUI(); };

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
