/* Adapter Vercel serverless + dev-server lokal.
   Semua logic ada di chat-core.mjs — file ini cuma menerjemahkan
   req/res gaya Node ke kontrak handleChat() yang portable. */
import { handleChat } from './chat-core.mjs';

export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || 'unknown';
  const out = await handleChat({ method: req.method, body: req.body, ip });

  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);

  if (out.stream) {
    res.status(out.status);
    const reader = out.stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
    return;
  }

  res.status(out.status).json(out.json ?? {});
}
