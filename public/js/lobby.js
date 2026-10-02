/* ---------- sidebar: the room panel, the player roster and the public rooms ----------
   No room yet: quick play, create a room, join by code, and the public room list.
   In a room: the mode (picked by the owner), Ready, the owner's tools, and who is in it.
   The board meanwhile is a practice field, so new players learn the keys while they wait. */
const MODE_INFO = {
  s: ['Solo', 'Mỗi người một phe. Người cuối cùng còn đứng thắng.'],
  t: ['Đội', '2 đội Đỏ và Xanh. Chạm đồng đội bị hạ trong 3 giây để cứu.'],
  z: ['Zombie', 'Một người là zombie, chạm là lây. Sống sót 90 giây để thắng.'],
  h: ['Săn boss', 'Một người ngẫu nhiên làm boss nhiều mạng, bấm E gọi quái. Cả nhóm săn nó trong 2 phút.'],
  v: ['Sinh tồn', 'Quái kéo đến theo đợt, cứ 5 đợt có boss. Giữa các đợt mua đồ bằng xu.'],
  b: ['Đánh boss', 'Cùng hạ một boss 2×2. Còn nửa máu nó nổi giận và tường bắt đầu sập.'],
  c: ['Đi ải', '10 ải, ải 5 và 10 có boss. Diệt hết quái rồi tìm cửa ra giấu dưới thùng.'],
  p: ['Sân tập', ''],
};
const MODE_GROUPS = [['Đối kháng', ['s', 't', 'z', 'h']], ['Hợp tác', ['v', 'b', 'c']]];
let roomKey = '', rosterKey = '', roomsKey = '', copiedUntil = 0;
let publicRooms = [];   // GET /api/rooms, refreshed every few seconds

function el2(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, text, act, title) { const b = el2('button', cls, text); b.dataset.act = act; if (title) b.title = title; return b; }
function avatarEl(name, color) { const a = el2('span', 'lob-av', (name.trim()[0] || '?').toUpperCase()); a.style.background = color; return a; }
const inRound = () => !!net && net.ph !== 'lobby';
const pingOf = id => id === myPeer ? myRtt : (peers().find(p => p.peer === id) || { presence: {} }).presence.rt;

/* ---------- room panel ---------- */
function renderRoomPanel() {
  const body = $('roomBody');
  const copied = performance.now() < copiedUntil;
  const key = JSON.stringify([ROOM_ID, mode, connected, kickedOut, roomFull, isLoggedIn(), myPeer, joined, copied,
    net && [net.ph, net.md, net.ow, net.sa, net.pb, net.cs, net.cu, net.rd, net.pl.map(p => p.id)]]);
  if (key === roomKey) return;
  roomKey = key;
  const typing = body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text' ? document.activeElement.value : null;
  body.textContent = '';
  $('roomTitle').textContent = ROOM_ID ? 'phòng' : 'vào chơi';

  if (mode === 'local') {
    body.append(el2('p', 'lob-sub', 'Đang chơi 2 người trên 1 máy.'), btn('lob-cta off', 'Thoát chế độ 1 máy', 'local'));
    return;
  }
  if (!ROOM_ID || kickedOut || roomFull) {
    // no room: get into one
    let sub = 'Bạn đang ở sân tập: thử di chuyển và đặt bom. Vào một phòng để chơi cùng mọi người.';
    if (kickedOut) sub = 'Bạn đã bị mời ra khỏi phòng #' + ROOM_ID + '. Chọn phòng khác nhé.';
    if (roomFull) sub = 'Phòng #' + ROOM_ID + ' đã đầy. Chọn phòng khác nhé.';
    body.append(el2('p', 'lob-sub', sub));
    body.append(btn('lob-cta', '⚡  Chơi nhanh', 'quick', 'Vào phòng công khai đông nhất còn chỗ'));
    const row = el2('div', 'lob-row');
    row.append(btn('lob-btn', '＋ Tạo phòng', 'create'), btn('lob-btn', '＋ Tạo phòng công khai', 'create:pub'));
    body.append(row);
    const f = el2('form', 'lob-join'); f.dataset.act = 'code';
    const inp = el2('input'); inp.type = 'text'; inp.maxLength = 24; inp.autocomplete = 'off'; inp.placeholder = 'Mã phòng, vd: abc12'; inp.setAttribute('aria-label', 'Mã phòng');
    if (typing !== null) inp.value = typing;
    f.append(inp, el2('button', 'lob-btn', 'Vào'));
    body.append(f);
    if (typing !== null) inp.focus();
    body.append(btn('lob-link', '⇆  Chơi 2 người trên 1 máy', 'local'));
    return;
  }

  const md = net ? net.md : 's', owner = isOwner();
  const chips = el2('div', 'lob-chips');
  chips.append(el2('span', 'lob-mode m-' + md, MODE_INFO[md][0]));
  if (net && net.pb) chips.append(el2('span', 'lob-pub', 'công khai'));
  if (owner) chips.append(el2('span', 'lob-own-chip', '★ bạn là chủ phòng'));
  body.append(chips);

  if (!net || !connected) { body.append(el2('p', 'lob-sub', 'Đang kết nối tới phòng…')); }
  else if (inRound()) {
    const playing = net.pl.some(p => p.id === myPeer);
    body.append(el2('p', 'lob-sub', playing ? 'Đang trong ván. Chúc may mắn!' : 'Ván đang diễn ra, bạn đang xem. Hết ván sẽ được vào.'));
    if (owner) body.append(btn('lob-btn', '■ Dừng, về sảnh', 'lobby'));
  } else {
    // waiting room: everyone presses Ready; when all are ready (2+) the round starts by itself
    const nReady = net.pl.filter(p => net.rd.includes(p.id)).length, iReady = net.rd.includes(myPeer);
    let sub;
    if (net.sa > 0) sub = `Tất cả đã sẵn sàng. Vào ván sau ${net.sa} giây…`;
    else if (!isLoggedIn()) sub = 'Đăng nhập để vào chơi.';
    else if (!iReady) sub = 'Bấm "Sẵn sàng" khi bạn muốn chơi ván tới. Trong lúc chờ, cứ tập trên bàn.';
    else if (net.pl.length < 2) sub = 'Cần ít nhất 2 người sẵn sàng thì ván tự bắt đầu.' + (owner ? ' Hoặc bấm "Bắt đầu ngay".' : '');
    else sub = `Đợi những người còn lại sẵn sàng (${nReady}/${net.pl.length}).`;
    body.append(el2('p', 'lob-sub' + (net.sa > 0 ? ' go' : ''), sub));

    // mode: the owner picks, everyone sees what it means
    for (const [title, list] of MODE_GROUPS) {
      body.append(el2('div', 'lob-group', title));
      const modes = el2('div', 'lob-modes' + (owner ? '' : ' ro'));
      modes.setAttribute('role', 'radiogroup'); modes.setAttribute('aria-label', 'Chế độ ' + title.toLowerCase());
      for (const m of list) {
        const b = el2('button', 'lob-modebtn m-' + m, MODE_INFO[m][0]);
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', m === md ? 'true' : 'false');
        if (owner) b.dataset.act = 'mode:' + m; else b.disabled = true;
        modes.append(b);
      }
      body.append(modes);
    }
    body.append(el2('p', 'lob-desc', MODE_INFO[md][1]));
    if (md === 'c') {
      // campaign: start from any stage this room has reached
      const st = el2('div', 'lob-stages');
      st.append(el2('span', 'lob-group', 'Bắt đầu từ ải'));
      for (let k = 1; k <= 10; k++) {
        const b = el2('button', 'lob-stage' + (k === net.cs ? ' on' : '') + (k === 5 || k === 10 ? ' boss' : ''), String(k));
        if (k > net.cu) { b.disabled = true; b.title = 'Chưa mở: qua ải ' + (k - 1) + ' trước'; }
        else if (owner) b.dataset.act = 'stage:' + k;
        else b.disabled = k !== net.cs;
        st.append(b);
      }
      body.append(st);
    }
    if (isLoggedIn()) {
      body.append(btn('lob-cta' + (iReady ? ' off' : ''), iReady ? (net.sa > 0 ? `Vào ván sau ${net.sa}…  ·  Huỷ` : 'Huỷ sẵn sàng') : '✓  Sẵn sàng', iReady ? 'ready:0' : 'ready:1'));
      const sw = el2('label', 'lob-switch');
      sw.title = 'Vào phòng và mỗi khi hết ván thì tự sẵn sàng';
      const jc = el2('input'); jc.type = 'checkbox'; jc.checked = joined; jc.dataset.act = 'join';
      sw.append(jc, el2('span', '', 'Tự sẵn sàng ván mới'));
      body.append(sw);
    }
    if (owner) {
      const tools = el2('div', 'lob-tools');
      const pub = el2('label', 'lob-switch');
      pub.title = 'Người lạ thấy phòng này trong danh sách phòng công khai và vào được';
      const pc = el2('input'); pc.type = 'checkbox'; pc.checked = net.pb; pc.dataset.act = 'public';
      pub.append(pc, el2('span', '', 'Công khai'));
      tools.append(pub);
      if (net.sa <= 0) tools.append(btn('lob-link sm', '▶ Bắt đầu ngay', 'start', 'Không đợi mọi người: ai đã sẵn sàng thì vào'));
      body.append(tools);
    }
  }
  body.append(btn('lob-invite' + (copied ? ' done' : ''), copied ? '✓ Đã sao chép link phòng' : '＋ Mời bạn bè: sao chép link', 'invite'));
  const foot = el2('div', 'lob-row');
  foot.append(btn('lob-link sm', '← Rời phòng', 'leave'), btn('lob-link sm', '⇆ 2 người 1 máy', 'local'));
  body.append(foot);
}

/* ---------- roster: who is in the room (lobby: ready marks; in a round: scores and who is out) ---------- */
function renderRoster() {
  const ol = $('plist'), s = mode === 'local' ? snap : net;
  const owner = isOwner(), lobby = !!s && s.ph === 'lobby';
  const rows = s ? s.pl.map(p => ({
    id: p.id, name: p.name, color: p.color, score: p.score, team: s.md === 't' ? p.team : -1, boss: p.boss,
    out: !lobby && !p.alive && !p.downed, downed: p.downed, rd: lobby && s.rd.includes(p.id), ms: mode === 'online' ? pingOf(p.id) : undefined,
    lost: mode === 'online' && s.ph === 'play' && p.alive && !peers().some(q => q.peer === p.id), kicked: s.kk.includes(p.id)
  })) : [];
  const watching = mode === 'online' && s ? peers().filter(p => !rows.some(r => r.id === p.peer)).length : 0;
  const key = JSON.stringify([rows, watching, owner, lobby, s && s.ow, myPeer, mode]);
  if (key === rosterKey) return;
  rosterKey = key;
  $('playersSec').hidden = mode === 'online' && !ROOM_ID;
  $('pcount').textContent = rows.length ? (lobby ? `${rows.filter(r => r.rd).length}/${rows.length}` : rows.length) : '';
  ol.textContent = '';
  if (!rows.length) { ol.append(el2('p', 'empty', 'Chưa có ai trong phòng.')); return; }
  if (!lobby) rows.sort((a, b) => (a.team - b.team) || (b.score - a.score));
  for (const r of rows) {
    const li = el2('li', 'lob-p' + (r.id === myPeer ? ' me' : '') + (r.out ? ' out' : '') + (lobby && !r.rd ? ' wait' : '') + (r.team === 0 ? ' team0' : r.team === 1 ? ' team1' : ''));
    li.append(avatarEl(r.name, r.color));
    const nm = el2('span', 'lob-nm', r.name);
    if (s.ow === r.id && mode === 'online') { const o = el2('span', 'lob-own', '★'); o.title = 'Chủ phòng'; nm.prepend(o); }
    li.append(nm);
    const em = emShow.get(r.id);
    if (em && em.until > performance.now()) li.append(el2('span', 'lob-em', EMOTES[em.k]));
    if (r.boss) li.append(el2('span', 'lob-tag boss', 'boss'));
    if (r.downed) li.append(el2('span', 'lob-tag warn', 'cần cứu!'));
    if (r.lost) li.append(el2('span', 'lob-tag warn', 'mất kết nối'));
    if (r.kicked) li.append(el2('span', 'lob-tag', 'đã kick'));
    if (r.id === myPeer && mode === 'online') li.append(el2('span', 'lob-tag', 'bạn'));
    if (typeof r.ms === 'number' && r.ms > 0) li.append(el2('span', 'lob-ms' + (r.ms > 120 ? ' bad' : r.ms > 60 ? ' meh' : ''), r.ms + 'ms'));
    if (lobby) { const rd = el2('span', 'lob-rd' + (r.rd ? ' on' : ''), r.rd ? '✓' : '…'); rd.title = r.rd ? 'Sẵn sàng' : 'Chưa sẵn sàng'; li.append(rd); }
    else { const sc = el2('span', 'lob-sc', String(r.score)); sc.title = 'Số ván thắng trong phiên này'; li.append(sc); }
    if (owner && r.id !== myPeer && !r.kicked) {
      const kb = btn('lob-kick', 'kick', 'kick:' + r.id);
      kb.dataset.name = r.name; kb.setAttribute('aria-label', 'Kick ' + r.name);
      li.append(kb);
    }
    ol.append(li);
  }
  if (watching) ol.append(el2('p', 'empty', `+ ${watching} người đang xem`));
}

/* ---------- public rooms ---------- */
function renderRooms() {
  const box = $('roomsBody');
  const others = publicRooms.filter(r => r.id !== ROOM_ID).slice(0, 8);
  const key = JSON.stringify(others);
  if (key === roomsKey) return;
  roomsKey = key;
  box.textContent = '';
  $('rcount').textContent = others.length || '';
  if (!others.length) { box.append(el2('p', 'empty', 'Chưa có phòng công khai nào. Bấm "Tạo phòng công khai" để người khác tìm thấy bạn.')); return; }
  const ul = el2('ul', 'lob-roomlist');
  for (const r of others) {
    const li = el2('li');
    li.dataset.act = 'room:' + r.id;
    li.title = 'Vào phòng #' + r.id;
    const info = el2('div', 'lob-ri');
    info.append(el2('b', '', r.ow ? 'Phòng của ' + r.ow : '#' + r.id), el2('span', '', `#${r.id} · ${(MODE_INFO[r.md] || MODE_INFO.s)[0]} · ${r.ph === 'play' ? 'đang chơi' : 'đang chờ'}`));
    li.append(info, el2('span', 'lob-rn' + (r.n >= 8 ? ' full' : ''), `${r.n}/8`));
    ul.append(li);
  }
  box.append(ul);
}
async function loadRooms() {
  try {
    const rows = await (await fetch('/api/rooms', { cache: 'no-store' })).json();
    if (!Array.isArray(rows)) return;
    publicRooms = rows.filter(r => r && /^[a-z0-9-]{1,24}$/.test(r.id))
      .map(r => ({ id: r.id, n: r.n | 0, md: MODE_INFO[r.md] ? r.md : 's', ph: r.ph === 'play' ? 'play' : 'lobby', ow: cleanName(r.ow) }));
    renderRooms();
  } catch (e) {}
}
setInterval(() => { if (!document.hidden) loadRooms(); }, 4000);
loadRooms();

// quick play: the busiest public room with a free slot (waiting rooms first); none: a new public room
function quickPlay() {
  const pick = publicRooms.filter(r => r.id !== ROOM_ID && r.n < 8).sort((a, b) => (a.ph === 'lobby' ? 0 : 1) - (b.ph === 'lobby' ? 0 : 1) || b.n - a.n)[0];
  if (pick) return goRoom(pick.id);
  if (ROOM_ID && isOwner()) {
    sstore('bt-pub', ROOM_ID); maybeMakePublic();
    toast('Đã mở phòng công khai', 'Chưa có phòng nào đang chờ, nên phòng này đã được mở cho mọi người.');
    return;
  }
  createRoom2(true);
}
function createRoom2(pub) {
  const id = randId(5);
  if (pub) sstore('bt-pub', id);
  goRoom(id);
}
// a room created as public (or opened by quick play) becomes public as soon as we own it
function maybeMakePublic() {
  if (!ROOM_ID || sstore('bt-pub') !== ROOM_ID || !isOwner() || !net) return;
  if (!net.pb) room.cmd({ c: 'public', on: true });
  sstore('bt-pub', '');
}

/* ---------- board hint and shop (over the board) ---------- */
let hintKey = '';
function renderBoardHint() {
  const h = $('boardHint');
  let text = '', open = false;
  if (mode === 'online' && practice) {
    open = !ROOM_ID || kickedOut || roomFull;
    text = open ? 'Sân tập · WASD / mũi tên để đi · Space đặt bom' : (net && net.sa > 0 ? `Vào ván sau ${net.sa}…` : 'Sân tập trong lúc chờ ván mới');
  }
  const key = text + open;
  if (key === hintKey) return;
  hintKey = key;
  h.hidden = !text; h.textContent = '';
  if (!text) return;
  h.append(el2('span', '', text));
  if (open) h.append(btn('hint-btn', '☰ Chọn phòng', 'drawer'));
}
let shopKey = '';
function renderShop() {
  const box = $('shop'), s = snap;
  const me = s && mode === 'online' && !practice && s.md === 'v' && s.brk > 0 ? s.pl.find(p => p.id === myPeer) : null;
  const key = me && me.alive ? JSON.stringify([me.coins, me.maxB, me.fire, me.spd, me.kick, me.shield, s.brk]) : '';
  if (key === shopKey) return;
  shopKey = key;
  box.hidden = !key; box.textContent = '';
  if (!key) return;
  const head = el2('div', 'shop-h');
  head.append(el2('b', '', 'Cửa hàng'), el2('span', '', `🪙 ${me.coins} xu · đợt sau ${s.brk}s`));
  box.append(head);
  const items = [['b', '💣', 'Thêm bom', me.maxB >= 8], ['f', '🔥', 'Lửa xa', me.fire >= 8], ['s', '👟', 'Giày', me.spd >= 5], ['k', '🧤', 'Găng đá', me.kick], ['h', '🛡️', 'Khiên', me.shield]];
  const row = el2('div', 'shop-items');
  for (const [k, ico, name, maxed] of items) {
    const b = btn('shop-it', '', 'buy:' + k);
    b.append(el2('span', 'ico', ico), el2('span', 'nm', name), el2('span', 'pr', maxed ? 'đủ rồi' : SHOP_PRICES[k] + ' xu'));
    b.disabled = maxed || me.coins < SHOP_PRICES[k];
    row.append(b);
  }
  box.append(row);
}
const SHOP_PRICES = { b: 3, f: 3, s: 2, k: 4, h: 5 };   // same as SHOP in pve.js (the browser does not load it)

/* ---------- actions ---------- */
async function onSideAct(t, e) {
  const [act, arg] = t.dataset.act.split(':');
  if (act === 'mode') room.cmd({ c: 'mode', m: arg });
  else if (act === 'stage') room.cmd({ c: 'stage', n: +arg });
  else if (act === 'start') room.cmd({ c: 'start' });
  else if (act === 'lobby') room.cmd({ c: 'lobby' });
  else if (act === 'ready') room.cmd({ c: 'ready', on: arg === '1' });
  else if (act === 'buy') room.cmd({ c: 'buy', item: arg });
  else if (act === 'quick') quickPlay();
  else if (act === 'create') createRoom2(arg === 'pub');
  else if (act === 'room') goRoom(arg);
  else if (act === 'leave') leaveRoom();
  else if (act === 'drawer') setDrawer(true);
  else if (act === 'local') { t.blur(); if (mode === 'online') startLocal(); else stopLocal(); updateUI(); }
  else if (act === 'kick') { if (isOwner() && confirm('Kick ' + t.dataset.name + ' khỏi phòng?')) room.cmd({ c: 'kick', peer: arg }); }
  else if (act === 'invite') {
    try { await navigator.clipboard.writeText(location.href); copiedUntil = performance.now() + 2000; setTimeout(renderRoomPanel, 2050); }
    catch (err) { prompt('Gửi link này cho bạn bè:', location.href); }
    renderRoomPanel();
  }
}
// the panels are rebuilt as things change, so act on pointerdown for the roster (a click could lose its target)
for (const id of ['roomBody', 'roomsBody', 'boardHint', 'shop']) $(id).addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && t.tagName !== 'FORM' && t.tagName !== 'INPUT') onSideAct(t, e);
});
$('plist').addEventListener('pointerdown', e => {
  const t = e.target.closest('[data-act]');
  if (t) { e.preventDefault(); onSideAct(t, e); }
});
$('roomBody').addEventListener('change', e => {
  const act = e.target.dataset.act;
  if (act === 'join') { joined = e.target.checked; pushMe(); }
  else if (act === 'public') room.cmd({ c: 'public', on: e.target.checked });
});
$('roomBody').addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.querySelector('input').value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  if (id) goRoom(id);
});
