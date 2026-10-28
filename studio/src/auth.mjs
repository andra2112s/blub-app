import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';
import { db, getSettings, applyCredits, tx } from './db.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), { status });

/* Verifikasi ID token dari Google Identity Services (tombol "Masuk dengan Google"). */
export async function verifyGoogle(credential) {
  if (typeof credential !== 'string' || credential.length > 4096) throw httpError(400, 'Token Google tidak valid');
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw httpError(401, 'Login Google gagal, coba lagi');
  const p = await res.json();
  const okIss = p.iss === 'accounts.google.com' || p.iss === 'https://accounts.google.com';
  if (!okIss || p.aud !== config.googleClientId || p.email_verified !== 'true' || Number(p.exp) * 1000 < Date.now()) {
    throw httpError(401, 'Login Google ditolak');
  }
  return { sub: p.sub, email: String(p.email).toLowerCase(), name: p.name || p.email, picture: p.picture || '' };
}

export function loginUser(profile) {
  return tx(() => {
    let user = db.prepare('SELECT * FROM users WHERE sub = ?').get(profile.sub);
    if (user) {
      db.prepare('UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?').run(profile.email, profile.name, profile.picture, user.id);
    } else {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (sub, email, name, picture, created) VALUES (?, ?, ?, ?, ?)')
        .run(profile.sub, profile.email, profile.name, profile.picture, Date.now());
      const bonus = Number(getSettings().welcomeCredits) || 0;
      if (bonus > 0) applyCredits(Number(lastInsertRowid), bonus, 'bonus pendaftaran');
    }
    user = db.prepare('SELECT * FROM users WHERE sub = ?').get(profile.sub);
    if (user.banned) throw httpError(403, 'Akun dinonaktifkan');
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (hash, user_id, expires) VALUES (?, ?, ?)').run(sha(token), user.id, Date.now() + config.sessionDays * 864e5);
    return { token, user };
  });
}

export function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE hash = ?').run(sha(token));
}

export function bearer(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+([\w-]{20,200})$/);
  return m ? m[1] : '';
}

export function userFromToken(token) {
  if (!token) return null;
  const user = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires > ?').get(sha(token), Date.now());
  return user && !user.banned ? user : null;
}

export const isAdmin = (user) => !!user && config.adminEmails.includes(user.email.toLowerCase());

/* Login khusus admin tanpa Google: email terdaftar + ADMIN_LOGIN_CODE. */
export function adminLogin({ email, code }) {
  if (config.adminLoginCode.length < 8) throw httpError(404, 'Tidak ditemukan');
  email = String(email || '').toLowerCase().trim();
  const expected = Buffer.from(config.adminLoginCode);
  const actual = Buffer.from(String(code || ''));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw httpError(401, 'Kode salah');
  if (!config.adminEmails.includes(email)) throw httpError(403, 'Email ini tidak terdaftar sebagai admin');
  return loginUser({ sub: 'admin:' + email, email, name: email.split('@')[0], picture: '' });
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, picture: user.picture, credits: user.credits, isAdmin: isAdmin(user), unlimited: isAdmin(user) };
}

/* URL media bertanda tangan: <video src> tidak bisa mengirim header Authorization. */
export function signMedia(jobId, file, ttlSec = 6 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHmac('sha256', config.secret).update(`${jobId}/${file}/${exp}`).digest('base64url');
  return `${config.publicUrl}/media/${jobId}/${encodeURIComponent(file)}?exp=${exp}&sig=${sig}`;
}

export function verifyMedia(jobId, file, exp, sig) {
  if (!(Number(exp) * 1000 > Date.now()) || typeof sig !== 'string') return false;
  const expected = Buffer.from(createHmac('sha256', config.secret).update(`${jobId}/${file}/${exp}`).digest('base64url'));
  const actual = Buffer.from(sig);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
