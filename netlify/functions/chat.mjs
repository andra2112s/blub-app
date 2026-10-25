/* Netlify Functions (format v2: Request → Response).
   Logic sama persis dengan Vercel — dibagi lewat api/chat-core.mjs.
   Key diisi di dashboard Netlify → Site configuration → Environment variables. */
import { handleChat } from '../../api/chat-core.mjs';

export default async (req) => {
  let body = null;
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = null; }
  }
  const ip = req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const out = await handleChat({ method: req.method, body, ip });
  return new Response(out.stream || JSON.stringify(out.json ?? {}), {
    status: out.status,
    headers: out.headers
  });
};
