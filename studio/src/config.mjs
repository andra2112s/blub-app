/* ── Konfigurasi Mochi Studio ──
   Rahasia & infrastruktur dari environment (.env di VPS).
   Model, paket, dan harga disimpan di DB dan diubah lewat halaman admin. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (val && !(m[1] in process.env)) process.env[m[1]] = val;
  }
} catch {}

const env = process.env;
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(env.PORT || 8787),
  publicUrl: (env.PUBLIC_URL || 'http://localhost:8787').replace(/\/$/, ''),
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  // Jalur login khusus admin tanpa Google (opsional; nonaktif kalau < 8 karakter)
  adminLoginCode: env.ADMIN_LOGIN_CODE || '',
  secret: env.STUDIO_SECRET || '',
  dbPath: env.DB_PATH || resolve(root, 'data', 'studio.db'),
  toonflowUrl: (env.TOONFLOW_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
  // Volume data Toonflow seperti terlihat dari container Studio, dan dari container Toonflow
  toonflowDataLocal: env.TOONFLOW_DATA_LOCAL || '/toonflow-data',
  toonflowDataRemote: env.TOONFLOW_DATA_REMOTE || '/app/data',
  qrisStatic: (env.QRIS_STATIC || '').trim(),
  orderTtlMin: Number(env.ORDER_TTL_MIN || 30),
  maxConcurrentJobs: Number(env.MAX_CONCURRENT_JOBS || 2),
  sessionDays: 30
};

export const defaultSettings = {
  text: { providerId: '', modelId: '' },
  image: { providerId: '', modelId: '', ratio: '9:16', size: '' },
  video: { providerId: '', modelId: '', ratio: '9:16', resolution: '', generateAudio: false, mode: '' },
  packages: [
    { id: 'pendek', name: 'Video Pendek', desc: '3 adegan × 5 detik', shots: 3, seconds: 5, credits: 15 },
    { id: 'cerita', name: 'Cerita 30 Detik', desc: '6 adegan × 5 detik', shots: 6, seconds: 5, credits: 30 }
  ],
  topups: [
    { id: 'k15', credits: 15, price: 25000 },
    { id: 'k50', credits: 50, price: 75000 },
    { id: 'k120', credits: 120, price: 160000 }
  ],
  welcomeCredits: 0,
  maintenance: false
};

export function assertConfig() {
  const missing = [];
  if (!config.googleClientId) missing.push('GOOGLE_CLIENT_ID');
  if (config.secret.length < 32) missing.push('STUDIO_SECRET (min 32 karakter)');
  if (!config.adminEmails.length) missing.push('ADMIN_EMAILS');
  if (missing.length) console.warn('[studio] ⚠️ Env belum lengkap:', missing.join(', '));
  if (!config.qrisStatic) console.warn('[studio] ⚠️ QRIS_STATIC kosong — top-up kredit dinonaktifkan');
}
