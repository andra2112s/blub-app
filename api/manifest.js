/* Adapter Vercel serverless + dev-server lokal untuk manifest dinamis.
   Diserve lewat rewrite /manifest.json → /api/manifest. */
import { manifestResponse } from './manifest-core.mjs';

export default function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const out = manifestResponse(url);
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.status(out.status).end(out.body);
}
