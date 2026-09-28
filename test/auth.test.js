import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import WebSocket from 'ws';

// must be set before server/auth.js is imported (it reads the env once)
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
const auth = await import('../server/auth.js');
const { attach } = await import('../server/relay.js');

// a stand-in for Google's signing key
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'test-key';
auth._useKeys([{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }]);

function idToken(claims = {}, key = privateKey) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = enc({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + enc({
    iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: '1234567890',
    email: 'an@gmail.com', email_verified: true, given_name: 'An', exp: Math.floor(Date.now() / 1000) + 3600, ...claims,
  });
  return body + '.' + crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url');
}

test('valid Google ID tokens are accepted, forged or wrong ones are not', async () => {
  const ok = await auth.verifyGoogleIdToken(idToken());
  assert.deepEqual(ok, { sub: '1234567890', email: 'an@gmail.com', name: 'An' });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal(await auth.verifyGoogleIdToken(idToken({}, other)), null, 'bad signature');
  assert.equal(await auth.verifyGoogleIdToken(idToken({ aud: 'someone-else' })), null, 'other app');
  assert.equal(await auth.verifyGoogleIdToken(idToken({ iss: 'evil.com' })), null, 'other issuer');
  assert.equal(await auth.verifyGoogleIdToken(idToken({ exp: 1 })), null, 'expired');
  assert.equal(await auth.verifyGoogleIdToken('not.a.token'), null);
});

test('sessions round-trip and cannot be tampered with', () => {
  const s = auth.makeSession({ sub: '42', name: 'An', email: 'an@gmail.com' });
  const v = auth.readSession(s);
  assert.equal(v.by, auth.playerKeyFor('42'));
  assert.ok(v.by.startsWith('g_') && !v.by.includes('42'));
  const [body, mac] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), by: 'g_someone' })).toString('base64url');
  assert.equal(auth.readSession(forged + '.' + mac), null);
  assert.equal(auth.readSession('garbage'), null);
});

let server, wss, url;
before(async () => {
  server = http.createServer(); wss = attach(server);
  await new Promise(r => server.listen(0, r));
  url = `ws://127.0.0.1:${server.address().port}/api/ws`;
});
after(async () => {
  for (const c of wss.clients) c.terminate();
  await new Promise(r => wss.close(r)); await new Promise(r => server.close(r));
});
function client(room, extra = {}) {
  const ws = new WebSocket(url), msgs = [];
  ws.on('message', d => msgs.push(JSON.parse(d)));
  const until = (pred, ms = 2000) => new Promise((res, rej) => {
    const t0 = Date.now(), tick = () => { const m = msgs.find(pred); if (m) return res(m); if (Date.now() - t0 > ms) return rej(new Error('timeout')); setTimeout(tick, 10); };
    tick();
  });
  const peer = 'peer' + Math.random().toString(36).slice(2, 8);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room, peer, by: 'kplain1', p: {}, ...extra })));
  return { ws, msgs, until, peer, send: o => ws.send(JSON.stringify(o)) };
}

test('signing in over the socket gives a session and tells the room the new player key', async () => {
  const a = client('auth1'), b = client('auth1');
  await a.until(m => m.t === 'full'); await b.until(m => m.t === 'full');
  a.send({ t: 'auth', token: idToken() });
  const ok = await a.until(m => m.t === 'authed');
  assert.equal(ok.email, 'an@gmail.com');
  const seen = await b.until(m => m.t === 'by' && m.peer === a.peer);
  assert.equal(seen.by, ok.by);
  assert.ok(!JSON.stringify(b.msgs).includes('an@gmail.com'), 'email is never sent to other players');
  // the next visit presents the session instead of a token
  const again = client('auth2', { session: ok.session }), watcher = client('auth2');
  await again.until(m => m.t === 'full');
  const j = await watcher.until(m => (m.t === 'join' && m.peer === again.peer) || (m.t === 'full' && m.peers.some(p => p.peer === again.peer)));
  const by = j.t === 'join' ? j.by : j.peers.find(p => p.peer === again.peer).by;
  assert.equal(by, ok.by);
  [a, b, again, watcher].forEach(c => c.ws.close());
});

test('nobody can claim a Google-backed player key without a session', async () => {
  const cheat = client('auth3', { by: 'g_stolenkey123456789012' }), w = client('auth3');
  await cheat.until(m => m.t === 'full'); await w.until(m => m.t === 'full');
  const full = await w.until(m => m.t === 'full');
  const j = full.peers.find(p => p.peer === cheat.peer) || await w.until(m => m.t === 'join' && m.peer === cheat.peer);
  assert.ok(!j.by.startsWith('g_'));
  const bad = client('auth3', { session: 'forged.session' });
  await bad.until(m => m.t === 'authfail');
  [cheat, w, bad].forEach(c => c.ws.close());
});
