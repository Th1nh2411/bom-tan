/* ---------- Google sign-in (only shown when the server has GOOGLE_CLIENT_ID) ---------- */
// authInfo = { session, by, name, email } from the server; the session is our own signed token, kept 30 days
let authInfo = (() => {
  try { const v = JSON.parse(store('bt-auth') || 'null'); return v && typeof v.session === 'string' && typeof v.by === 'string' ? v : null; }
  catch (e) { return null; }
})();
let googleClientId = '';

function isLoggedIn() {
  return !!authInfo;
}

function saveAuth(v) {
  authInfo = v;
  store('bt-auth', v ? JSON.stringify(v) : '');
  renderAuth();
}

function renderAuth() {
  $('authBox').hidden = !googleClientId && !authInfo;
  $('gsiBtn').hidden = !!authInfo;
  $('authHint').hidden = !!authInfo;
  $('authWho').hidden = !authInfo;
  if (authInfo) $('authEmail').textContent = authInfo.email || authInfo.name || 'Đã đăng nhập';

  const gate = $('loginGate');
  if (gate) {
    if (authInfo) {
      gate.classList.add('hide');
    } else {
      gate.classList.remove('hide');
      if (!googleClientId && $('gateGsiBtn') && !$('gateGsiBtn').hasChildNodes()) {
        const demoBtn = document.createElement('button');
        demoBtn.className = 'b run';
        demoBtn.style.padding = '8px 16px';
        demoBtn.style.fontSize = '14px';
        demoBtn.style.cursor = 'pointer';
        demoBtn.textContent = '🚀 Đăng nhập trải nghiệm (Demo)';
        demoBtn.onclick = () => {
          saveAuth({ session: 'demo-session', by: PLAYER_KEY, name: myName || 'Người chơi', email: 'demo@bomtan.local' });
        };
        $('gateGsiBtn').appendChild(demoBtn);
      }
    }
  }
}

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
  // replace the auto-generated nickname with the Google first name
  if (/^Người chơi \d+$/.test(myName) && authInfo.name) { myName = authInfo.name; $('name').value = myName; store('bt-name', myName); pushMe(); }
  renderLeaderboard();
  toast('Đã đăng nhập', authInfo.email);
}

async function initGoogle() {
  renderAuth();
  try { googleClientId = (await (await fetch('/api/config')).json()).googleClientId || ''; } catch (e) { return; }
  renderAuth();
  if (!googleClientId) return;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = () => {
    google.accounts.id.initialize({ client_id: googleClientId, callback: r => room && room.auth(r.credential), ux_mode: 'popup' });
    if ($('gsiBtn')) google.accounts.id.renderButton($('gsiBtn'), { theme: 'filled_black', size: 'medium', text: 'signin_with', shape: 'rectangular', width: 240 });
    if ($('gateGsiBtn')) {
      $('gateGsiBtn').textContent = '';
      google.accounts.id.renderButton($('gateGsiBtn'), { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', width: 280 });
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
