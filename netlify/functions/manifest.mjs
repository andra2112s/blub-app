/* Netlify Function (v2) — manifest dinamis untuk deferred deep link.
   Logic sama dengan Vercel — dibagi lewat api/manifest-core.mjs. */
import { manifestResponse } from '../../api/manifest-core.mjs';

export default async (req) => {
  const out = manifestResponse(new URL(req.url));
  return new Response(out.body, { status: out.status, headers: out.headers });
};
