/* ── Pipeline video: rencana (LLM) → gambar karakter → N klip video ──
   Kredit dipotong saat job dibuat dan dikembalikan penuh kalau gagal/ditolak.
   Tiap langkah disimpan ke DB, jadi job yang terputus (restart) dilanjutkan dari langkah terakhir. */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';
import { db, tx, applyCredits, getSettings } from './db.mjs';
import { signMedia, isAdmin } from './auth.mjs';
import * as toonflow from './toonflow.mjs';

const httpError = (status, message) => Object.assign(new Error(message), { status });
const running = new Map();

const PLAN_SYSTEM = (shots) => `Kamu sutradara video pendek vertikal (9:16) untuk aplikasi Mochi.
Ubah ide pengguna menjadi rencana produksi. Balas HANYA satu objek JSON valid tanpa teks lain:
{
  "refuse": null,
  "title": "judul singkat Bahasa Indonesia",
  "character": "deskripsi visual karakter utama dalam bahasa Inggris: spesies/usia, wajah, rambut, pakaian, warna khas",
  "style": "gaya visual dalam bahasa Inggris (mis. 3D Pixar-like, anime, watercolor, cinematic realistic)",
  "shots": [ { "caption": "keterangan adegan singkat Bahasa Indonesia", "prompt": "English video prompt: who, action, setting, camera movement, lighting" } ]
}
Aturan:
- "shots" tepat ${shots} item, berurutan membentuk cerita singkat yang utuh.
- Setiap prompt adegan menyebut ulang ciri utama karakter supaya konsisten.
- Karakter berhak cipta terkenal atau tokoh nyata → ganti jadi karakter orisinal yang mirip suasananya.
- Tolak (isi "refuse" dengan alasan singkat Bahasa Indonesia, field lain boleh kosong) bila ide mengandung: konten seksual, anak dalam konteks tidak pantas, kekerasan sadis/gore, kebencian SARA, atau tindakan ilegal berbahaya.`;

function parsePlan(raw, shots) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Rencana dari AI tidak terbaca');
  const plan = JSON.parse(m[0]);
  if (plan.refuse) return { refuse: String(plan.refuse).slice(0, 300) };
  if (!plan.character || !Array.isArray(plan.shots) || !plan.shots.length) throw new Error('Rencana dari AI tidak lengkap');
  const list = plan.shots.filter((s) => s?.prompt).slice(0, shots);
  while (list.length < shots) list.push(list[list.length - 1]);
  return { title: String(plan.title || 'Video Mochi').slice(0, 80), character: String(plan.character), style: String(plan.style || ''), shots: list };
}

export function createJob(user, { idea, packageId }) {
  const settings = getSettings();
  if (settings.maintenance) throw httpError(503, 'Studio sedang perawatan, coba lagi nanti');
  idea = String(idea || '').trim();
  if (idea.length < 5 || idea.length > 1000) throw httpError(400, 'Ceritakan idenya 5–1000 karakter');
  const pkg = settings.packages.find((p) => p.id === packageId);
  if (!pkg) throw httpError(400, 'Paket video tidak ditemukan');
  if (db.prepare("SELECT COUNT(*) n FROM jobs WHERE user_id = ? AND status IN ('queued','running')").get(user.id).n >= 2) {
    throw httpError(429, 'Maksimal 2 video diproses bersamaan. Tunggu salah satu selesai dulu ya.');
  }
  const id = randomUUID();
  const now = Date.now();
  const charged = !isAdmin(user); // admin (ADMIN_EMAILS) tidak dipotong kredit
  tx(() => {
    if (charged) applyCredits(user.id, -Number(pkg.credits), 'buat video', id);
    db.prepare("INSERT INTO jobs (id, user_id, package, idea, credits, status, step, created, updated) VALUES (?, ?, ?, ?, ?, 'queued', 'Antre', ?, ?)")
      .run(id, user.id, JSON.stringify({ ...pkg, charged }), idea, charged ? Number(pkg.credits) : 0, now, now);
  });
  pump();
  return getJob(user.id, id);
}

function update(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated = ? WHERE id = ?`)
    .run(...keys.map((k) => (typeof fields[k] === 'object' && fields[k] !== null ? JSON.stringify(fields[k]) : fields[k])), Date.now(), id);
}

function finishWithRefund(job, status, error) {
  const charged = JSON.parse(job.package || '{}').charged !== false;
  tx(() => {
    const res = db.prepare("UPDATE jobs SET status = ?, error = ?, step = ?, updated = ? WHERE id = ? AND status IN ('queued','running')")
      .run(status, error, status === 'refused' ? 'Ditolak' : 'Gagal', Date.now(), job.id);
    if (res.changes && charged) applyCredits(job.user_id, job.credits, status === 'refused' ? 'refund: ide ditolak' : 'refund: video gagal', job.id);
  });
}

async function withRetry(fn, tries = 2) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries || e.name === 'AbortError') throw e;
      console.warn('[studio] ulangi langkah:', e.message);
    }
  }
}

/* Gabungkan klip jadi satu MP4. Best-effort: kalau ffmpeg tidak ada/gagal,
   klip per-shot tetap tersedia — job tetap dianggap selesai. */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 120000 }, (err, _, stderr) => err ? reject(new Error(stderr || err.message)) : resolve());
  });
}

async function mergeShots(job, assets, signal) {
  const files = assets.shots.map((f) => toonflow.localPath(job.user_id, f.path));
  const outLocal = join(toonflow.localPath(job.user_id, `mochi/${job.id}`), 'final.mp4');
  const listFile = join(toonflow.localPath(job.user_id, `mochi/${job.id}`), '.concat.txt');
  try {
    writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    try { await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outLocal]); }
    catch {
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outLocal])
        .catch(() => runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', outLocal]));
    }
    signal?.throwIfAborted();
    if (!existsSync(outLocal)) return null;
    return { path: `mochi/${job.id}/final.mp4`, mimeType: 'video/mp4', mediaType: 'video' };
  } catch (e) {
    console.warn(`[studio] gabung video ${job.id} gagal (klip tetap tersedia):`, String(e.message || e).slice(0, 200));
    return null;
  } finally {
    try { unlinkSync(listFile); } catch {}
  }
}

async function runJob(job, signal) {
  const s = getSettings();
  const pkg = JSON.parse(job.package);
  const dir = toonflow.userWorkspace(job.user_id);
  const out = `mochi/${job.id}`;
  const total = pkg.shots + 2;
  let plan = job.plan ? JSON.parse(job.plan) : null;
  const assets = JSON.parse(job.assets || '{}');
  assets.shots ||= [];
  update(job.id, { status: 'running' });

  if (!plan) {
    update(job.id, { step: 'Menyusun cerita', progress: 0.05 });
    const raw = await withRetry(() => toonflow.chat({ ...s.text, system: PLAN_SYSTEM(pkg.shots), prompt: job.idea, signal }));
    plan = parsePlan(raw, pkg.shots);
    if (plan.refuse) return finishWithRefund(job, 'refused', plan.refuse);
    update(job.id, { plan, progress: 1 / total });
  }

  if (!assets.character) {
    update(job.id, { step: 'Menggambar karakter' });
    const [file] = await withRetry(() => toonflow.generateMedia(dir, 'image', {
      providerId: s.image.providerId, modelId: s.image.modelId, outputDirectory: out,
      prompt: `${plan.character}. ${plan.style}. Full body, front view, clear face, simple clean background, high detail.`,
      ...(s.image.ratio ? { ratio: s.image.ratio } : {}), ...(s.image.size ? { size: s.image.size } : {})
    }, { signal }));
    assets.character = file;
    update(job.id, { assets, progress: 2 / total });
  }

  for (let i = 0; i < pkg.shots; i++) {
    if (assets.shots[i]) continue;
    update(job.id, { step: `Membuat adegan ${i + 1}/${pkg.shots}` });
    const [file] = await withRetry(() => toonflow.generateMedia(dir, 'video', {
      providerId: s.video.providerId, modelId: s.video.modelId, outputDirectory: out,
      prompt: `${plan.shots[i].prompt}. Style: ${plan.style}.`,
      images: [{ path: assets.character.path, mimeType: assets.character.mimeType }],
      duration: Number(pkg.seconds),
      ...(s.video.ratio ? { ratio: s.video.ratio } : {}), ...(s.video.resolution ? { resolution: s.video.resolution } : {}),
      ...(s.video.generateAudio ? { generateAudio: true } : {}), ...(s.video.mode ? { mode: s.video.mode } : {})
    }, { signal }));
    assets.shots[i] = file;
    update(job.id, { assets, progress: (3 + i) / total });
  }

  if (!assets.final && assets.shots.length > 1) {
    update(job.id, { step: 'Menggabungkan video', progress: Math.min(0.98, (3 + pkg.shots) / total) });
    const final = await mergeShots(job, assets, signal);
    if (final) { assets.final = final; update(job.id, { assets }); }
  }
  update(job.id, { status: 'done', step: 'Selesai', progress: 1 });
}

/* Antrean sederhana dalam proses: maksimal MAX_CONCURRENT_JOBS berjalan bersamaan. */
export function pump() {
  while (running.size < config.maxConcurrentJobs) {
    const busy = [...running.keys()];
    const job = db.prepare(`SELECT * FROM jobs WHERE status IN ('queued','running') ${busy.length ? `AND id NOT IN (${busy.map(() => '?').join(',')})` : ''} ORDER BY created LIMIT 1`).get(...busy);
    if (!job) return;
    const ctrl = new AbortController();
    running.set(job.id, ctrl);
    runJob(job, ctrl.signal)
      .catch((e) => {
        console.error(`[studio] job ${job.id} gagal:`, e.message);
        finishWithRefund(job, 'failed', 'Maaf, pembuatan video gagal. Kredit sudah dikembalikan.');
      })
      .finally(() => { running.delete(job.id); pump(); });
  }
}

function mediaUrl(jobId, file) {
  return file ? { url: signMedia(jobId, file.path.split('/').pop()), mimeType: file.mimeType } : null;
}

function present(row) {
  const plan = row.plan ? JSON.parse(row.plan) : null;
  const assets = JSON.parse(row.assets || '{}');
  const pkg = JSON.parse(row.package);
  return {
    id: row.id, idea: row.idea, status: row.status, step: row.step, progress: row.progress, credits: row.credits,
    error: row.error, created: row.created, updated: row.updated, package: { id: pkg.id, name: pkg.name },
    title: plan?.title || '', character: mediaUrl(row.id, assets.character),
    final: mediaUrl(row.id, assets.final),
    shots: (assets.shots || []).map((f, i) => ({ caption: plan?.shots?.[i]?.caption || `Adegan ${i + 1}`, ...mediaUrl(row.id, f) }))
  };
}

export function getJob(userId, id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw httpError(404, 'Video tidak ditemukan');
  return present(row);
}

export const listJobs = (userId) => db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY created DESC LIMIT 30').all(userId).map(present);

export const adminJobs = () => db.prepare(`SELECT j.id, j.status, j.step, j.progress, j.credits, j.error, j.idea, j.created, u.email
  FROM jobs j JOIN users u ON u.id = j.user_id ORDER BY j.created DESC LIMIT 100`).all();

/* File media hanya boleh dari folder output job itu sendiri. */
export function mediaFile(jobId, name) {
  const row = db.prepare('SELECT user_id, assets FROM jobs WHERE id = ?').get(jobId);
  if (!row || !/^[\w.-]+$/.test(name)) return null;
  const a = JSON.parse(row.assets || '{}');
  const file = [a.character, a.final, ...(a.shots || [])].find((f) => f && f.path.split('/').pop() === name);
  return file ? { path: toonflow.localPath(row.user_id, file.path), mimeType: file.mimeType } : null;
}
