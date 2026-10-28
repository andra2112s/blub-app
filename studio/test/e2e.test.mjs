/* Uji end-to-end Studio + mock Toonflow (tanpa Google & tanpa biaya model).
   Jalankan: npm test  (di folder studio/) */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { crc16, dynamicQris, parseTlv } from '../src/qris.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'mochi-studio-'));
const tfData = join(tmp, 'toonflow').replace(/\\/g, '/');
const dbPath = join(tmp, 'studio.db');
const STUDIO = 'http://127.0.0.1:8899';
const procs = [];

const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
const merchant = tlv('00', 'ID.CO.QRIS.WWW') + tlv('01', '936000000000000000') + tlv('02', 'ID1020000000000') + tlv('03', 'UMI');
const staticBody = tlv('00', '01') + tlv('01', '11') + tlv('26', merchant) + tlv('52', '5812') + tlv('53', '360') + tlv('58', 'ID') + tlv('59', 'MOCHI TEST') + tlv('60', 'JAKARTA') + '6304';
const STATIC_QRIS = staticBody + crc16(staticBody);

function spawnNode(file, env) {
  const p = spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));
  p.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(d));
  procs.push(p);
  return p;
}

async function waitUp(url) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server tidak naik: ' + url);
}

function makeSession(email) {
  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO users (sub, email, name, created) VALUES (?, ?, ?, ?)').run('sub-' + email, email, email.split('@')[0], now);
  const { id } = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (hash, user_id, expires) VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), id, now + 864e5);
  db.close();
  return token;
}

const api = (token) => async (path, opts = {}) => {
  const res = await fetch(STUDIO + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
  return { status: res.status, data: await res.json() };
};

async function waitJob(call, id, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { data } = await call('/jobs/' + id);
    if (['done', 'failed', 'refused'].includes(data.status)) return data;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('job tidak selesai');
}

before(async () => {
  spawnNode(join(here, 'mockToonflow.mjs'), { MOCK_PORT: '3998', MOCK_DELAY: '100' });
  spawnNode(resolve(here, '..', 'src', 'server.mjs'), {
    PORT: '8899', PUBLIC_URL: STUDIO, DB_PATH: dbPath, TOONFLOW_URL: 'http://127.0.0.1:3998',
    TOONFLOW_DATA_LOCAL: tfData, TOONFLOW_DATA_REMOTE: tfData, TOONFLOW_POLL_MS: '50',
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', ADMIN_EMAILS: 'admin@test.id', ADMIN_LOGIN_CODE: 'testcode123',
    STUDIO_SECRET: 'x'.repeat(40), QRIS_STATIC: STATIC_QRIS, ALLOWED_ORIGINS: 'https://mochi.example'
  });
  await waitUp('http://127.0.0.1:3998/api/ai/models');
  await waitUp(STUDIO + '/health');
});

after(() => { procs.forEach((p) => p.kill()); try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

test('QRIS dinamis: tag 01=12, tag 54 nominal, CRC valid', () => {
  const dyn = dynamicQris(STATIC_QRIS, 25137);
  const f = parseTlv(dyn);
  assert.equal(f.find((x) => x.id === '01').value, '12');
  assert.equal(f.find((x) => x.id === '54').value, '25137');
  assert.equal(crc16(dyn.slice(0, -4)), dyn.slice(-4));
  const ids = f.map((x) => Number(x.id));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'tag terurut');
});

test('tanpa login → 401; CORS hanya origin terdaftar', async () => {
  assert.equal((await fetch(STUDIO + '/me')).status, 401);
  const good = await fetch(STUDIO + '/me', { method: 'OPTIONS', headers: { Origin: 'https://mochi.example' } });
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://mochi.example');
  const bad = await fetch(STUDIO + '/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('alur top-up: order → klaim → admin setujui → kredit masuk', async () => {
  const user = api(makeSession('user@test.id'));
  const admin = api(makeSession('admin@test.id'));
  const me = await user('/me');
  assert.equal(me.data.user.credits, 0);
  assert.equal((await user('/admin/orders')).status, 403, 'user biasa tidak boleh akses admin');

  const order = (await user('/topups', { method: 'POST', body: JSON.stringify({ topupId: 'k15' }) })).data;
  assert.ok(order.amount > 25000 && order.amount < 26000, 'nominal unik');
  assert.match(order.qrSvg, /<svg/);
  const again = (await user('/topups', { method: 'POST', body: JSON.stringify({ topupId: 'k15' }) })).data;
  assert.equal(again.id, order.id, 'order pending dipakai ulang');

  assert.equal((await user(`/topups/${order.id}/claim`, { method: 'POST' })).data.status, 'claimed');
  const pending = (await admin('/admin/orders')).data;
  assert.ok(pending.some((o) => o.id === order.id && o.amount === order.amount));
  assert.equal((await admin(`/admin/orders/${order.id}/approve`, { method: 'POST' })).data.status, 'approved');
  assert.equal((await admin(`/admin/orders/${order.id}/approve`, { method: 'POST' })).status, 409, 'tidak bisa disetujui dua kali');
  assert.equal((await user('/me')).data.user.credits, 15);
});

test('buat video: kredit dipotong, pipeline selesai, media bisa diputar dengan Range', async () => {
  const user = api(makeSession('user@test.id'));
  const before = (await user('/me')).data.user.credits;
  const created = await user('/jobs', { method: 'POST', body: JSON.stringify({ idea: 'kucing astronot jalan di bulan', packageId: 'pendek' }) });
  assert.equal(created.status, 200);
  assert.equal((await user('/me')).data.user.credits, before - 15);

  const job = await waitJob(user, created.data.id);
  assert.equal(job.status, 'done', job.error || '');
  assert.equal(job.shots.length, 3);
  assert.ok(job.character.url);

  const unsigned = await fetch(job.shots[0].url.split('?')[0]);
  assert.equal(unsigned.status, 403, 'media tanpa tanda tangan ditolak');
  const ranged = await fetch(job.shots[0].url, { headers: { Range: 'bytes=0-99' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-99/2048');
  assert.equal((await ranged.arrayBuffer()).byteLength, 100);
});

test('kredit kurang → 402, ide terlarang → ditolak & kredit kembali', async () => {
  const poor = api(makeSession('poor@test.id'));
  assert.equal((await poor('/jobs', { method: 'POST', body: JSON.stringify({ idea: 'naga terbang di kota', packageId: 'pendek' }) })).status, 402);

  const admin = api(makeSession('admin@test.id'));
  const { data: users } = await admin('/admin/users?q=poor');
  await admin(`/admin/users/${users[0].id}/credits`, { method: 'POST', body: JSON.stringify({ delta: 15, reason: 'uji' }) });
  const created = await poor('/jobs', { method: 'POST', body: JSON.stringify({ idea: 'video konten seksual', packageId: 'pendek' }) });
  const job = await waitJob(poor, created.data.id);
  assert.equal(job.status, 'refused');
  assert.equal((await poor('/me')).data.user.credits, 15, 'refund penuh');
});

test('login admin tanpa Google: kode benar + email terdaftar', async () => {
  const res = await fetch(STUDIO + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'Admin@Test.id', code: 'testcode123' }) });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.token);
  assert.equal(data.user.isAdmin, true);
  assert.equal(data.user.unlimited, true);

  const wrong = await fetch(STUDIO + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.id', code: 'salahkode' }) });
  assert.equal(wrong.status, 401);
  const outsider = await fetch(STUDIO + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'user@test.id', code: 'testcode123' }) });
  assert.equal(outsider.status, 403);
});

test('admin unlimited: kredit tidak dipotong & tidak di-refund', async () => {
  const admin = api(makeSession('admin@test.id'));
  const before = (await admin('/me')).data.user.credits;
  const created = await admin('/jobs', { method: 'POST', body: JSON.stringify({ idea: 'FAILME uji admin', packageId: 'pendek' }) });
  assert.equal(created.status, 200);
  assert.equal((await admin('/me')).data.user.credits, before, 'kredit admin tidak berkurang');
  const job = await waitJob(admin, created.data.id);
  assert.equal(job.status, 'failed');
  assert.equal((await admin('/me')).data.user.credits, before, 'refund tidak menambah kredit admin');
});

test('provider video error → job gagal setelah retry & kredit dikembalikan', async () => {
  const poor = api(makeSession('poor@test.id'));
  const created = await poor('/jobs', { method: 'POST', body: JSON.stringify({ idea: 'FAILME robot menari', packageId: 'pendek' }) });
  assert.equal((await poor('/me')).data.user.credits, 0);
  const job = await waitJob(poor, created.data.id);
  assert.equal(job.status, 'failed');
  assert.ok(job.character, 'aset yang sudah jadi tetap tersimpan');
  assert.equal((await poor('/me')).data.user.credits, 15, 'refund penuh');
});
