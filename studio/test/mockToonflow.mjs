/* Mock API Toonflow untuk uji lokal tanpa biaya model.
   Meniru kontrak v2.0.7: /api/ai/generate (SSE), /api/ai/media/generate (+taskId),
   /api/ai/media/tasks/status, /api/ai/media/tasks/cancel, /api/ai/models, /api/ai/media/models.
   File hasil ditulis ke <directory>/<outputDirectory>/ seperti Toonflow asli. */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.MOCK_PORT || 3999);
const delay = Number(process.env.MOCK_DELAY || 300);
const failVideo = process.env.MOCK_FAIL_VIDEO === '1';
const tasks = new Map();
const ok = (data) => ({ code: 200, data, message: 'ok' });

const body = async (req) => { const c = []; for await (const x of req) c.push(x); return JSON.parse(Buffer.concat(c).toString() || '{}'); };

createServer(async (req, res) => {
  const json = (d, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ai/models') return json(ok([{ providerId: 'mock', modelId: 'mock-llm' }]));
  if (url.pathname === '/api/ai/media/models') return json(ok([{ providerId: 'mock', modelId: 'mock-image', type: 'image' }, { providerId: 'mock', modelId: 'mock-video', type: 'video' }]));
  const b = await body(req);

  if (url.pathname === '/api/ai/generate') {
    const idea = b.context.messages[0].content;
    const shots = Number(b.context.systemPrompt.match(/tepat (\d+) item/)?.[1] || 3);
    const plan = /seksual|gore/i.test(idea)
      ? { refuse: 'Ide ini melanggar pedoman konten.' }
      : { refuse: null, title: 'Uji ' + idea.slice(0, 20), character: 'a cute orange cat astronaut', style: '3D cartoon',
          shots: Array.from({ length: shots }, (_, i) => ({ caption: `Adegan ${i + 1}`, prompt: `${idea} — shot ${i + 1}` })) };
    const text = 'Berikut rencananya:\n' + JSON.stringify(plan);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < text.length; i += 40) res.write(`data: ${JSON.stringify({ type: 'text', delta: text.slice(i, i + 40) })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', message: { content: [{ type: 'text', text }] } })}\n\n`);
    return res.end();
  }

  if (url.pathname === '/api/ai/media/generate') {
    if (!b.directory?.startsWith('/') && !/^[A-Z]:/i.test(b.directory)) return json({ code: 400, data: null, message: '工作目录必须是绝对路径' }, 400);
    if (b.mediaType === 'video' && !b.images?.length) return json({ code: 400, data: null, message: 'no reference' }, 400);
    const task = { result: null };
    tasks.set(b.taskId, task);
    setTimeout(() => {
      if (b.mediaType === 'video' && (failVideo || b.prompt.includes('FAILME'))) { task.result = { code: 500, data: null, message: 'provider down' }; return; }
      const ext = b.mediaType === 'image' ? 'png' : 'mp4';
      const rel = `${b.outputDirectory || 'assets/generated'}/${b.mediaType}${randomUUID()}.${ext}`;
      mkdirSync(join(b.directory, b.outputDirectory || 'assets/generated'), { recursive: true });
      writeFileSync(join(b.directory, rel), Buffer.alloc(2048, b.mediaType === 'image' ? 1 : 2));
      task.result = ok([{ path: rel, mimeType: b.mediaType === 'image' ? 'image/png' : 'video/mp4', mediaType: b.mediaType }]);
    }, delay);
    return json(ok({ taskId: b.taskId }));
  }

  if (url.pathname === '/api/ai/media/tasks/status') {
    return json(ok(b.taskIds.map((id) => {
      const t = tasks.get(id);
      if (!t) return { taskId: id, result: { code: 404, data: null, message: 'not found' } };
      return { taskId: id, ...(t.result ? { result: t.result } : {}) };
    })));
  }
  if (url.pathname === '/api/ai/media/tasks/cancel') return json(ok(null));
  json({ code: 404, data: null, message: 'not found' }, 404);
}).listen(port, () => console.log(`[mock toonflow] :${port}`));
