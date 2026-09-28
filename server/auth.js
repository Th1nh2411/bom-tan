// Google sign-in, verified on the server without extra dependencies.
// The browser gets an ID token from Google Identity Services; we check its RS256 signature against
// Google's published keys, its audience (our client id), issuer and expiry, then hand back our own
// signed session so the player stays signed in for SESSION_DAYS without asking Google again.
import crypto from 'node:crypto';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
// Without SESSION_SECRET, sessions only survive until the server restarts.
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 30;
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export const authConfig = { googleClientId: CLIENT_ID };

let keys = null, keysExp = 0;
async function googleKeys() {
  if (keys && Date.now() < keysExp) return keys;
  const res = await fetch(CERTS_URL);
  const age = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  keys = (await res.json()).keys || [];
  keysExp = Date.now() + (age ? Number(age[1]) * 1000 : 3600e3);
  return keys;
}
// tests only: use locally generated keys instead of fetching Google's
export function _useKeys(k) { keys = k; keysExp = Infinity; }

const b64json = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// returns { sub, email, name } for a valid Google ID token, otherwise null
export async function verifyGoogleIdToken(token, clientId = CLIENT_ID) {
  try {
    if (!clientId || typeof token !== 'string' || token.length > 4096) return null;
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return null;
    const header = b64json(h), payload = b64json(p);
    if (header.alg !== 'RS256') return null;
    const jwk = (await googleKeys()).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    if (payload.aud !== clientId) return null;
    if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') return null;
    if (!(payload.exp * 1000 > Date.now())) return null;
    if (payload.email_verified === false || typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, email: String(payload.email || ''), name: String(payload.given_name || payload.name || '') };
  } catch {
    return null;
  }
}

// the player key other players see: stable per Google account, but not the account id itself
export const playerKeyFor = sub => 'g_' + crypto.createHash('sha256').update('bomtan:' + sub).digest('base64url').slice(0, 24);

const sign = data => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
export function makeSession(user) {
  const body = Buffer.from(JSON.stringify({ by: playerKeyFor(user.sub), name: user.name, email: user.email, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return body + '.' + sign(body);
}
// returns { by, name, email } for a valid, unexpired session, otherwise null
export function readSession(s) {
  if (typeof s !== 'string' || s.length > 2048) return null;
  const [body, mac] = s.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const v = b64json(body);
    return v.exp > Date.now() && typeof v.by === 'string' ? { by: v.by, name: String(v.name || ''), email: String(v.email || '') } : null;
  } catch {
    return null;
  }
}
