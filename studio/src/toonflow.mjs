/* ── Klien API internal Toonflow (hanya dari jaringan internal Docker) ──
   Diverifikasi terhadap Toonflow v2.0.7:
   - POST /api/ai/generate              → SSE teks (providerId, modelId, context)
   - POST /api/ai/media/generate        → { taskId } bila taskId dikirim (async)
   - POST /api/ai/media/tasks/status    → hasil task; task berhenti bila tidak dicek >120 dtk
   - GET  /api/ai/models, /api/ai/media/models
   Workspace di mode server wajib berada di <data>/workspaces/. */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { config } from './config.mjs';

const POLL_MS = Number(process.env.TOONFLOW_POLL_MS || 5000);

async function call(path, body, { method = 'POST', signal, timeout = 60000 } = {}) {
  const res = await fetch(config.toonflowUrl + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
  });
  const json = await res.json().catch(() => null);
  if (!json || json.code !== 200) throw new Error(`Toonflow ${path}: ${json?.message || res.status}`);
  return json.data;
}

/* Workspace per pengguna. Dibuat dari sisi Studio (volume yang sama), dikirim ke Toonflow dengan path miliknya. */
export function userWorkspace(userId) {
  const name = `mochiU${userId}`;
  mkdirSync(join(config.toonflowDataLocal, 'workspaces', name), { recursive: true });
  return posix.join(config.toonflowDataRemote, 'workspaces', name);
}

export const localPath = (userId, rel) => join(config.toonflowDataLocal, 'workspaces', `mochiU${userId}`, ...rel.split('/'));

export async function chat({ providerId, modelId, system, prompt, signal }) {
  const res = await fetch(config.toonflowUrl + '/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, modelId, context: { systemPrompt: system, messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] } }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000)
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => null);
    throw new Error(`Toonflow teks: ${j?.message || res.status}`);
  }
  let text = '';
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.type === 'text') text += ev.delta;
      else if (ev.type === 'error') throw new Error(`Toonflow teks: ${ev.message}`);
      else if (ev.type === 'done') {
        const parts = ev.message?.content;
        if (Array.isArray(parts)) text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('') || text;
      }
    }
  }
  return text;
}

/* Jalankan satu generate media sampai selesai. Mengembalikan [{ path, mimeType, mediaType }] relatif terhadap workspace. */
export async function generateMedia(directory, mediaType, request, { signal, timeoutMs = 30 * 60000 } = {}) {
  const taskId = randomUUID();
  await call('/api/ai/media/generate', { directory, mediaType, taskId, ...request }, { signal });
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      signal?.throwIfAborted();
      const [item] = await call('/api/ai/media/tasks/status', { directory, taskIds: [taskId] }, { signal });
      if (!item?.result) continue;
      if (item.result.code !== 200) throw new Error(item.result.message || 'Generate gagal');
      if (!item.result.data?.length) throw new Error('Generate tidak menghasilkan file');
      return item.result.data;
    }
    throw new Error('Generate melebihi batas waktu');
  } catch (e) {
    call('/api/ai/media/tasks/cancel', { directory, taskIds: [taskId] }).catch(() => {});
    throw e;
  }
}

export const listModels = async () => ({
  text: await call('/api/ai/models', null, { method: 'GET' }).catch((e) => ({ error: e.message })),
  media: await call('/api/ai/media/models', null, { method: 'GET' }).catch((e) => ({ error: e.message }))
});
