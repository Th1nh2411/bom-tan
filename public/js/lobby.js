/* ---------- lobby card: the main menu (signed out) and the waiting room (between rounds) ----------
   One card over the stage instead of text on the dimmed board: who is in the room, the mode, and the
   one thing to do next (sign in / start the round / wait). Rebuilt only when what it shows changes. */
const MODE_INFO = {
  s: ['Solo', 'Mỗi người một phe. Người cuối cùng còn đứng thắng.'],
  t: ['Đội', '2 đội Đỏ và Xanh. Chạm đồng đội bị hạ trong 3 giây để cứu.'],
  z: ['Zombie', 'Một người là zombie, chạm là lây. Sống sót 90 giây để thắng.'],
};
const lobbyEl = $('lobby');
let lobbyKey = '', copiedUntil = 0;
let publicRooms = [];   // GET /api/rooms, refreshed while the card is up

function lobbyVisible() {
  if (mode !== 'online' || kickedOut || roomFull) return false;
  if (!isLoggedIn()) return true;
  return !!snap && snap.ph === 'lobby';
}

function el2(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function avatarEl(name, color) { const a = el2('span', 'lob-av', (name.trim()[0] || '?').toUpperCase()); a.style.background = color; return a; }

function rosterRows() {
  const s = snap, rt = new Map(peers().map(p => [p.peer, p.presence.rt]));
  const rows = s ? s.pl.map(p => ({ id: p.id, name: p.name, color: p.color, team: p.team, ms: p.id === myPeer ? myRtt : rt.get(p.id), rd: s.rd.includes(p.id) })) : [];
  const watching = peers().filter(p => !rows.some(r => r.id === p.peer)).length;
  return { rows, watching };
}

function playerChip(r) {
  const li = el2('li', 'lob-p' + (r.id === myPeer ? ' me' : ''));
  li.append(avatarEl(r.name, r.color));
  const nm = el2('span', 'lob-nm', r.name);
  li.append(nm);
  if (snap && r.id === snap.ow) { const o = el2('span', 'lob-own', '★'); o.title = 'Chủ phòng'; nm.prepend(o); }
  if (r.id === myPeer) li.append(el2('span', 'lob-tag', 'bạn'));
  if (typeof r.ms === 'number' && r.ms > 0) li.append(el2('span', 'lob-ms' + (r.ms > 120 ? ' bad' : r.ms > 60 ? ' meh' : ''), r.ms + 'ms'));
  const rd = el2('span', 'lob-rd' + (r.rd ? ' on' : ''), r.rd ? '✓' : '…');
  rd.title = r.rd ? 'Sẵn sàng' : 'Chưa sẵn sàng';
  li.append(rd);
  if (!r.rd) li.classList.add('wait');
  return li;
}

function renderLobby() {
  const show = lobbyVisible();
  const loggedIn = isLoggedIn();
  const { rows, watching } = show ? rosterRows() : { rows: [], watching: 0 };
  const copied = performance.now() < copiedUntil;
  const key = !show ? '' : JSON.stringify([loggedIn, googleClientId, configLoaded, typeof google !== 'undefined', connected, snap && [snap.ow, snap.md, snap.sa, snap.pb], myPeer, joined, myTeam, copied, watching, rows, publicRooms]);
  if (key === lobbyKey) return;
  lobbyKey = key;
  // keep what the player is typing across a rebuild
  const typing = lobbyEl.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text' ? document.activeElement.value : null;
  lobbyEl.hidden = !show;
  document.body.classList.toggle('in-lobby', show);
  if (!show) return;
  const card = lobbyEl.firstElementChild;
  card.textContent = '';

  const md = snap ? snap.md : 's', owner = isOwner();
  const ownerRow = snap && rows.find(r => r.id === snap.ow);
  const eyebrow = el2('div', 'lob-eyebrow');
  eyebrow.append(el2('span', '', 'phòng #' + ROOM_ID));
  if (loggedIn && snap && snap.pb) eyebrow.append(el2('span', 'lob-pub', 'công khai'));
  if (loggedIn) eyebrow.append(el2('span', 'lob-mode m-' + md, MODE_INFO[md][0]));
  card.append(eyebrow);

  if (!loggedIn) {
    // main menu: get the player in with as few steps as possible
    card.append(el2('h2', 'lob-title', 'Bom Tấn'));
    const others = peers().filter(p => !p.isMe).length;
    card.append(el2('p', 'lob-sub', others ? `${others} người đang ở trong phòng này. Vào chơi cùng họ!` : 'Game đặt bom tối đa 8 người, chơi ngay trên trình duyệt.'));
    if (googleClientId) {
      const g = el2('div', 'lob-gsi'); g.id = 'lobbyGsi';
      card.append(g);
      try { google.accounts.id.renderButton(g, { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', width: 300 }); }
      catch (e) { const b = el2('button', 'lob-cta', 'Đăng nhập bằng Google'); b.dataset.act = 'signin'; g.append(b); }
      card.append(el2('p', 'lob-note', 'Đăng nhập để vào chơi online và giữ thành tích khi đổi máy.'));
    } else if (configLoaded) {
      const f = el2('form', 'lob-join'); f.dataset.act = 'guest';
      const inp = el2('input'); inp.type = 'text'; inp.maxLength = 12; inp.autocomplete = 'off'; inp.placeholder = 'Tên của bạn'; inp.value = myName; inp.setAttribute('aria-label', 'Tên trong game');
      const b = el2('button', 'lob-cta', 'Vào chơi'); b.type = 'submit';
      f.append(inp, b);
      card.append(f);
      if (typing !== null) { inp.value = typing; inp.focus(); }
    }
    const alt = el2('div', 'lob-alt');
    const lb = el2('button', 'lob-link', '⇆  Chơi 2 người trên 1 máy'); lb.dataset.act = 'local';
    alt.append(lb);
    card.append(alt);
    card.append(roomsSection());
    card.append(keysHint());
    return;
  }

  // waiting room: everyone presses Ready; when all are ready (2+ players) the round starts by itself
  const me = rows.find(r => r.id === myPeer), iReady = !!(me && me.rd);
  const nReady = rows.filter(r => r.rd).length;
  card.append(el2('h2', 'lob-title', 'Sảnh chờ'));
  let sub;
  if (snap.sa > 0) sub = `Tất cả đã sẵn sàng. Vào ván sau ${snap.sa} giây…`;
  else if (!iReady) sub = 'Bấm "Sẵn sàng" khi bạn muốn chơi ván tới.';
  else if (rows.length < 2) sub = 'Cần ít nhất 2 người sẵn sàng thì ván mới tự bắt đầu. Mời thêm bạn bè nhé.';
  else sub = `Đợi những người còn lại sẵn sàng (${nReady}/${rows.length}).`;
  card.append(el2('p', 'lob-sub' + (snap.sa > 0 ? ' go' : ''), sub));

  // mode: the owner picks, everyone sees what it means
  const modes = el2('div', 'lob-modes' + (owner ? '' : ' ro'));
  modes.setAttribute('role', 'radiogroup'); modes.setAttribute('aria-label', 'Chế độ chơi');
  for (const m of ['s', 't', 'z']) {
    const b = el2('button', 'lob-modebtn m-' + m);
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', m === md ? 'true' : 'false');
    if (owner) b.dataset.act = 'mode:' + m; else b.disabled = true;
    b.append(el2('b', '', MODE_INFO[m][0]));
    modes.append(b);
  }
  card.append(modes);
  card.append(el2('p', 'lob-desc', MODE_INFO[md][1]));

  // roster
  const head = el2('div', 'lob-head');
  head.append(el2('span', '', 'Người chơi'), el2('span', 'lob-count', `${nReady}/${rows.length} sẵn sàng` + (watching ? ` · ${watching} đang xem` : '')));
  const jt = el2('label', 'lob-switch');
  jt.title = 'Hết ván thì tự sẵn sàng cho ván sau';
  const jc = el2('input'); jc.type = 'checkbox'; jc.checked = joined; jc.dataset.act = 'join';
  jt.append(jc, el2('span', '', 'Tự sẵn sàng'));
  head.append(jt);
  card.append(head);
  if (md === 't') {
    const cols = el2('div', 'lob-teams');
    [0, 1].forEach(t => {
      const col = el2('div', 'lob-team t' + t);
      const th = el2('div', 'lob-team-h');
      const inTeam = rows.filter(r => r.team === t);
      th.append(el2('span', '', `${TEAM_NAMES[t]} · ${inTeam.length}`));
      if (myTeam !== t) { const jb = el2('button', 'lob-link sm', 'Vào đội'); jb.dataset.act = 'team:' + t; th.append(jb); }
      col.append(th);
      const ul = el2('ul', 'lob-roster');
      inTeam.forEach(r => ul.append(playerChip(r)));
      col.append(ul);
      cols.append(col);
    });
    card.append(cols);
    const free = rows.filter(r => r.team !== 0 && r.team !== 1);
    if (free.length) {
      const ul = el2('ul', 'lob-roster');
      free.forEach(r => ul.append(playerChip(r)));
      card.append(el2('div', 'lob-free', 'Chưa chọn đội, sẽ được xếp tự động:'), ul);
    }
  } else {
    const ul = el2('ul', 'lob-roster');
    rows.forEach(r => ul.append(playerChip(r)));
    card.append(ul);
  }
  const inv = el2('button', 'lob-invite' + (copied ? ' done' : ''), copied ? '✓ Đã sao chép link phòng' : '＋ Mời bạn bè: sao chép link');
  inv.dataset.act = 'invite';
  card.append(inv);

  // the next step: one big Ready toggle for everyone
  const go = el2('button', 'lob-cta big' + (iReady ? ' off' : ''), iReady ? (snap.sa > 0 ? `Vào ván sau ${snap.sa}…  ·  Huỷ` : 'Huỷ sẵn sàng') : '✓  Sẵn sàng');
  go.dataset.act = iReady ? 'ready:0' : 'ready:1';
  card.append(go);
  if (!connected) { const w = el2('div', 'lob-wait'); w.append(el2('i'), el2('span', '', 'Đang kết nối lại…')); card.append(w); }

  // owner tools: start without waiting, list the room publicly
  if (owner) {
    const tools = el2('div', 'lob-tools');
    const pub = el2('label', 'lob-switch');
    const pc = el2('input'); pc.type = 'checkbox'; pc.checked = snap.pb; pc.dataset.act = 'public';
    pub.append(pc, el2('span', '', 'Phòng công khai'));
    pub.title = 'Người lạ thấy phòng này trong danh sách phòng công khai và vào được';
    tools.append(pub);
    if (snap.sa <= 0) { const st = el2('button', 'lob-link sm', '▶ Bắt đầu ngay'); st.dataset.act = 'start'; st.title = 'Không đợi mọi người: chỉ ai đã sẵn sàng vào chơi'; tools.append(st); }
    card.append(tools);
  }
  const alt = el2('div', 'lob-alt');
  const lb = el2('button', 'lob-link', '⇆  Chơi 2 người trên 1 máy'); lb.dataset.act = 'local';
  alt.append(lb);
  card.append(alt);
  card.append(roomsSection());
  card.append(keysHint());
}

// public rooms: quick play plus a short list of rooms waiting for players
function roomsSection() {
  const box = el2('div', 'lob-rooms');
  const h = el2('div', 'lob-head');
  h.append(el2('span', '', 'Phòng công khai'));
  const q = el2('button', 'lob-quick', '⚡ Chơi nhanh'); q.dataset.act = 'quick';
  q.title = 'Vào phòng công khai đông nhất còn chỗ';
  h.append(q);
  box.append(h);
  const others = publicRooms.filter(r => r.id !== ROOM_ID).slice(0, 5);
  if (!others.length) { box.append(el2('p', 'lob-empty', 'Chưa có phòng công khai nào khác. Bật "Phòng công khai" để người khác tìm thấy bạn.')); return box; }
  const ul = el2('ul', 'lob-roomlist');
  for (const r of others) {
    const li = el2('li');
    const info = el2('div', 'lob-ri');
    info.append(el2('b', '', r.ow ? 'Phòng của ' + r.ow : '#' + r.id), el2('span', '', `#${r.id} · ${MODE_INFO[r.md] ? MODE_INFO[r.md][0] : 'Solo'} · ${r.ph === 'play' ? 'đang chơi' : 'đang chờ'}`));
    const n = el2('span', 'lob-rn' + (r.n >= 8 ? ' full' : ''), `${r.n}/8`);
    const b = el2('button', 'lob-link sm', r.n >= 8 ? 'Xem' : 'Vào'); b.dataset.act = 'room:' + r.id;
    li.append(info, n, b);
    ul.append(li);
  }
  box.append(ul);
  return box;
}

async function loadRooms() {
  if (lobbyEl.hidden && lobbyVisible() === false) return;
  try {
    const rows = await (await fetch('/api/rooms', { cache: 'no-store' })).json();
    if (Array.isArray(rows)) { publicRooms = rows.filter(r => r && /^[a-z0-9-]{1,24}$/.test(r.id)).map(r => ({ id: r.id, n: r.n | 0, md: r.md, ph: r.ph === 'play' ? 'play' : 'lobby', ow: cleanName(r.ow) })); renderLobby(); }
  } catch (e) {}
}
setInterval(() => { if (lobbyVisible()) loadRooms(); }, 4000);
loadRooms();

// quick play: the busiest public room with a free slot (waiting rooms first); none: open this room (or a new one) to the public
function quickPlay() {
  const pick = publicRooms.filter(r => r.id !== ROOM_ID && r.n < 8).sort((a, b) => (a.ph === 'lobby' ? 0 : 1) - (b.ph === 'lobby' ? 0 : 1) || b.n - a.n)[0];
  if (pick) { location.hash = pick.id; return; }
  const alone = peers().filter(p => !p.isMe).length === 0;
  if (isOwner() || alone) {
    sstore('bt-pub', ROOM_ID); maybeMakePublic();
    toast('Đã mở phòng công khai', 'Chưa có phòng nào đang chờ, nên phòng này đã được mở cho mọi người. Đợi người vào nhé.');
  } else {
    const id = randId(5);
    sstore('bt-pub', id);
    location.hash = id;
  }
}
// a room opened by quick play becomes public as soon as we own it
function maybeMakePublic() {
  if (sstore('bt-pub') !== ROOM_ID || !isOwner() || !snap) return;
  if (!snap.pb) room.cmd({ c: 'public', on: true });
  sstore('bt-pub', '');
}

function keysHint() {
  const d = el2('div', 'lob-keys');
  for (const [k, t] of [['WASD', 'di chuyển'], ['Space', 'đặt bom'], ['1–6', 'biểu cảm'], ['Esc', 'tạm dừng']]) {
    const s = el2('span'); s.append(el2('kbd', '', k), ' ' + t); d.append(s);
  }
  return d;
}

lobbyEl.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.tagName === 'FORM') return;
  const [act, arg] = t.dataset.act.split(':');
  if (act === 'mode') room.cmd({ c: 'mode', m: arg });
  else if (act === 'start') room.cmd({ c: 'start' });
  else if (act === 'ready') room.cmd({ c: 'ready', on: arg === '1' });
  else if (act === 'quick') quickPlay();
  else if (act === 'room') location.hash = arg;
  else if (act === 'local') { t.blur(); startLocal(); updateUI(); }
  else if (act === 'team') { myTeam = +arg; store('bt-team', arg); syncTeamBtns(); pushMe(); }
  else if (act === 'signin') { try { google.accounts.id.prompt(); } catch (err) {} }
  else if (act === 'invite') {
    try { await navigator.clipboard.writeText(location.href); copiedUntil = performance.now() + 2000; setTimeout(renderLobby, 2050); }
    catch (err) { prompt('Gửi link này cho bạn bè:', location.href); }
    renderLobby();
  }
});
lobbyEl.addEventListener('change', e => {
  const act = e.target.dataset.act;
  if (act === 'join') { joined = e.target.checked; $('joinChk').checked = joined; pushMe(); }
  else if (act === 'public') room.cmd({ c: 'public', on: e.target.checked });
});
lobbyEl.addEventListener('submit', e => {
  e.preventDefault();
  const inp = e.target.querySelector('input');
  if (!joinAsGuest(inp.value)) inp.focus();
});
