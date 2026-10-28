import { createServer } from 'node:http';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertConfig, defaultSettings } from './config.mjs';
import { db, getSettings, saveSettings, addCredits } from './db.mjs';
import { verifyGoogle, loginUser, logout, bearer, userFromToken, isAdmin, publicUser, verifyMedia, adminLogin } from './auth.mjs';
import { createOrder, listOrders, claimOrder, adminOrders, decideOrder } from './orders.mjs';
import { createJob, getJob, listJobs, adminJobs, mediaFile, pump } from './jobs.mjs';
import { validateStatic } from './qris.mjs';
import { listModels } from './toonflow.mjs';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const httpError = (status, message) => Object.assign(new Error(message), { status });

/* Rate limit sederhana per IP+rute (jendela 1 menit) */
const hits = new Map();
function limit(key, max) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > 60000) return hits.set(key, { at: now, n: 1 });
  if (++h.n > max) throw httpError(429, 'Terlalu banyak permintaan, tunggu sebentar');
}
setInterval(() => { const t = Date.now(); for (const [k, h] of hits) if (t - h.at > 60000) hits.delete(k); }, 60000).unref();

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (config.allowedOrigins.includes(origin) || origin === config.publicUrl)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw httpError(413, 'Permintaan terlalu besar');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw httpError(400, 'JSON tidak valid'); }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

/* Streaming video dengan dukungan Range (wajib untuk <video> di iOS Safari) */
function sendFile(req, res, file, download) {
  const { size } = statSync(file.path);
  const headers = { 'Content-Type': file.mimeType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download}"`;
  const m = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return createReadStream(file.path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  createReadStream(file.path).pipe(res);
}

function meOf(user) {
  const s = getSettings();
  return {
    user: publicUser(user),
    packages: s.packages.map(({ id, name, desc, credits }) => ({ id, name, desc, credits })),
    topups: config.qrisStatic ? s.topups : [],
    maintenance: !!s.maintenance
  };
}

function validateSettings(next) {
  const merged = { ...defaultSettings, ...next };
  for (const k of ['text', 'image', 'video']) if (typeof merged[k] !== 'object') throw httpError(400, `${k} harus objek`);
  const okList = (arr, fields) => Array.isArray(arr) && arr.length && arr.every((x) => fields.every((f) => x[f] !== undefined && x[f] !== ''));
  if (!okList(merged.packages, ['id', 'name', 'shots', 'seconds', 'credits'])) throw httpError(400, 'packages: tiap item butuh id, name, shots, seconds, credits');
  if (!okList(merged.topups, ['id', 'credits', 'price'])) throw httpError(400, 'topups: tiap item butuh id, credits, price');
  if (merged.packages.some((p) => !(p.shots >= 1 && p.shots <= 12 && p.seconds > 0 && p.credits >= 1))) throw httpError(400, 'Nilai paket tidak masuk akal');
  return merged;
}

const routes = {
  'GET /health': () => ({ ok: true }),
  'GET /config': () => ({ googleClientId: config.googleClientId, adminLogin: config.adminLoginCode.length >= 8 }),

  'POST /auth/login': async ({ req, ip }) => {
    limit(`auth:${ip}`, 10);
    const { token, user } = adminLogin(await body(req));
    return { token, ...meOf(user) };
  },

  'POST /auth/google': async ({ req, ip }) => {
    limit(`auth:${ip}`, 20);
    const { credential } = await body(req);
    const { token, user } = loginUser(await verifyGoogle(credential));
    return { token, ...meOf(user) };
  },
  'POST /auth/logout': ({ token }) => { logout(token); return { ok: true }; },
  'GET /me': ({ user }) => meOf(user),

  'GET /topups': ({ user }) => listOrders(user),
  'POST /topups': async ({ req, user, ip }) => { limit(`topup:${ip}`, 10); return createOrder(user, (await body(req)).topupId); },
  'POST /topups/:id/claim': ({ user, params }) => claimOrder(user, params.id),

  'GET /jobs': ({ user }) => listJobs(user.id),
  'POST /jobs': async ({ req, user, ip }) => { limit(`job:${ip}`, 10); return createJob(user, await body(req)); },
  'GET /jobs/:id': ({ user, params }) => getJob(user.id, params.id),

  'GET /admin/summary': () => ({
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    claimed: db.prepare("SELECT COUNT(*) n FROM orders WHERE status = 'claimed'").get().n,
    activeJobs: db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get().n,
    revenue: db.prepare("SELECT COALESCE(SUM(amount),0) n FROM orders WHERE status = 'approved'").get().n,
    qris: !!config.qrisStatic
  }),
  'GET /admin/orders': ({ url }) => adminOrders(url.searchParams.get('status') || 'claimed'),
  'POST /admin/orders/:id/approve': ({ user, params }) => decideOrder(user, params.id, true),
  'POST /admin/orders/:id/reject': ({ user, params }) => decideOrder(user, params.id, false),
  'GET /admin/users': ({ url }) => {
    const q = `%${url.searchParams.get('q') || ''}%`;
    return db.prepare('SELECT id, email, name, credits, banned, created FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created DESC LIMIT 100').all(q, q);
  },
  'POST /admin/users/:id/credits': async ({ req, user, params }) => {
    const { delta, reason } = await body(req);
    if (!Number.isInteger(delta) || !delta) throw httpError(400, 'delta harus bilangan bulat ≠ 0');
    return { credits: addCredits(Number(params.id), delta, `admin: ${String(reason || '').slice(0, 80)}`, user.email) };
  },
  'POST /admin/users/:id/ban': async ({ req, params }) => {
    const { banned } = await body(req);
    db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, Number(params.id));
    if (banned) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(params.id));
    return { ok: true };
  },
  'GET /admin/jobs': () => adminJobs(),
  'GET /admin/settings': () => getSettings(),
  'PUT /admin/settings': async ({ req }) => { const s = validateSettings(await body(req)); saveSettings(s); return s; },
  'GET /admin/models': () => listModels()
};

function match(method, path) {
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const names = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([\\w-]+)'; }) + '$');
    const hit = path.match(re);
    if (hit) return { key, handler: routes[key], params: Object.fromEntries(names.map((n, i) => [n, hit[i + 1]])) };
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, config.publicUrl);
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
      return res.end(readFileSync(resolve(publicDir, 'admin.html')));
    }

    const media = req.method === 'GET' && url.pathname.match(/^\/media\/([\w-]+)\/([^/]+)$/);
    if (media) {
      const name = decodeURIComponent(media[2]);
      if (!verifyMedia(media[1], name, url.searchParams.get('exp'), url.searchParams.get('sig'))) throw httpError(403, 'Link media kedaluwarsa, buka ulang Studio');
      const file = mediaFile(media[1], name);
      if (!file) throw httpError(404, 'File tidak ditemukan');
      return sendFile(req, res, file, url.searchParams.has('dl') ? `mochi-${name}` : '');
    }

    const route = match(req.method, url.pathname);
    if (!route) throw httpError(404, 'Tidak ditemukan');
    const token = bearer(req);
    const ctx = { req, url, ip, token, params: route.params };
    const open = ['GET /health', 'GET /config', 'POST /auth/google', 'POST /auth/login', 'POST /auth/logout'].includes(route.key);
    if (!open) {
      ctx.user = userFromToken(token);
      if (!ctx.user) throw httpError(401, 'Silakan masuk dengan Google dulu');
      if (route.key.includes(' /admin/') && !isAdmin(ctx.user)) throw httpError(403, 'Khusus admin');
    }
    send(res, 200, await route.handler(ctx));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[studio]', req.method, url.pathname, e);
    if (!res.headersSent) send(res, status, { error: status >= 500 && !e.status ? 'Terjadi kesalahan server' : e.message });
    else res.destroy();
  }
});

assertConfig();
if (config.qrisStatic) {
  try { validateStatic(config.qrisStatic); } catch (e) { console.error('[studio] ❌ QRIS_STATIC:', e.message); }
}
server.listen(config.port, () => {
  console.log(`[studio] berjalan di :${config.port} → Toonflow ${config.toonflowUrl}`);
  pump();
});
