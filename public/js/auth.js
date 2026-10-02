/* ---------- Google sign-in (only shown when the server has GOOGLE_CLIENT_ID) ---------- */
// authInfo = { session, by, name, email } from the server; the session is our own signed token, kept 30 days
let authInfo = (() => {
  try { const v = JSON.parse(store('bt-auth') || 'null'); return v && typeof v.session === 'string' && typeof v.by === 'string' ? v : null; }
  catch (e) { return null; }
})();
let googleClientId = '', configLoaded = false;

function isLoggedIn() {
  return !!authInfo;
}

function saveAuth(v) {
  authInfo = v;
  store('bt-auth', v ? JSON.stringify(v) : '');
  renderAuth();
  if (room) pushMe();   // the server only makes signed-in players room owner
}

function renderAuth() {
  const account = authInfo && !authInfo.guest;
  $('authWho').hidden = !authInfo;
  $('authEmail').textContent = !authInfo ? 'khách · chưa đăng nhập' : authInfo.guest ? 'khách' : (authInfo.email || authInfo.name || 'Đã đăng nhập');
  // signed in with Google: the in-game name comes from the account and is locked; guests keep editing theirs
  $('name').readOnly = account;
  $('name').title = account ? 'Tên lấy từ tài khoản đăng nhập' : '';
  if (account && authInfo.name && myName !== authInfo.name) { myName = authInfo.name; $('name').value = myName; store('bt-name', myName); if (room) pushMe(); }

  document.body.classList.toggle('guest', !authInfo);
  // achievements are for signed-in players: hide the tab, and leave it if it was open
  const achTab = document.querySelector('.tab[data-view="tab-ach"]');
  achTab.hidden = !authInfo;
  if (!authInfo && achTab.classList.contains('active')) document.querySelector('.tab[data-view="game"]').click();   // signed out: the login gate covers sidebar and board

  const gate = $('loginGate');
  if (gate) {
    if (authInfo) {
      gate.classList.add('hide');
    } else {
      gate.classList.remove('hide');
      // no GOOGLE_CLIENT_ID on the server: play as a guest under a typed name instead
      const guestForm = !googleClientId && configLoaded;
      $('gateGuest').hidden = !guestForm;
      $('gateSub').textContent = guestForm ? 'Nhập tên để tham gia chơi.' : 'Đăng nhập bằng Google để tham gia chơi và lưu thành tích.';
      if (guestForm && !$('gateName').value) $('gateName').value = myName;
    }
  }
}

// guests have no session: the server sees them by their device key, like before sign-in existed
function joinAsGuest(name) {
  const n = cleanName(name);
  if (!n) return false;
  myName = n; $('name').value = n; store('bt-name', n);
  saveAuth({ session: '', by: PLAYER_KEY, name: n, email: '', guest: true });
  return true;
}
$('gateGuest').onsubmit = e => {
  e.preventDefault();
  if (!joinAsGuest($('gateName').value)) $('gateName').focus();
};

// server answer to a Google token (or to a stored session that no longer checks out)
function onAuthResult(m) {
  if (!m) {
    if (authInfo) toast('Phiên đăng nhập đã hết hạn', 'Đăng nhập lại để giữ điểm bảng xếp hạng.');
    saveAuth(null);
    myUid = PLAYER_KEY; room.setBy(PLAYER_KEY);
    return;
  }
  saveAuth({ session: m.session, by: m.by, name: cleanName(m.name), email: String(m.email || '') });
  myUid = m.by; room.setBy(m.by);
  renderLeaderboard();
  toast('Đã đăng nhập', authInfo.email);
}

async function initGoogle() {
  renderAuth();
  try { googleClientId = (await (await fetch('/api/config')).json()).googleClientId || ''; } catch (e) {}
  configLoaded = true;
  // Google sign-in was switched on since this guest joined: ask them to sign in properly
  if (googleClientId && authInfo && authInfo.guest) { authInfo = null; store('bt-auth', ''); }
  renderAuth();
  if (!googleClientId) return;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = () => {
    google.accounts.id.initialize({ client_id: googleClientId, callback: r => room && room.auth(r.credential), ux_mode: 'popup' });
    if ($('gateGsiBtn')) {
      $('gateGsiBtn').textContent = '';
      google.accounts.id.renderButton($('gateGsiBtn'), { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', width: 260 });
    }
  };
  document.head.appendChild(s);
}

$('signOutBtn').onclick = () => {
  try { google.accounts.id.disableAutoSelect(); } catch (e) {}
  saveAuth(null);
  location.reload();
};
initGoogle();
