/* Logic manifest dinamis untuk deferred deep linking (dipakai adapter
   Vercel + Netlify). Saat user datang lewat QR gift (?gift=..&from=..),
   frontend menukar <link rel="manifest"> ke /manifest.json?... supaya
   PWA yang terpasang membawa token gift di start_url-nya — token ikut
   sampai setelah install walau storage browser terisolasi. */

const esc = (s) => String(s ?? '').replace(/[^\p{L}\p{N} ._'-]/gu, '').trim().slice(0, 24);

export function buildManifest(url) {
  const base = url.searchParams.get('base') || '/';
  const safeBase = base.startsWith('/') && !base.startsWith('//') ? base : '/';
  const from = esc(url.searchParams.get('from'));
  const persona = esc(url.searchParams.get('persona')) || 'Mochi';

  const start = new URL(safeBase, 'https://x');
  start.searchParams.set('gift', '1');
  if (from) start.searchParams.set('from', from);

  return {
    // id wajib sama dengan id implisit manifest statis (start_url "./"
    // resolve ke base path) supaya PWA hasil QR dikenali app yang sama.
    id: safeBase,
    name: `${persona} — Teman AI Interaktif`,
    short_name: persona,
    description:
      `Avatar blob animasi ${persona} yang bisa ngobrol, merespons sentuhan, dan menemanimu. Bisa dipasang di HP maupun PC.`,
    lang: 'id',
    dir: 'ltr',
    start_url: start.pathname + start.search,
    scope: safeBase,
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f4ef',
    theme_color: '#f6f4ef',
    categories: ['lifestyle', 'entertainment'],
    icons: [
      { src: safeBase + 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: safeBase + 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: safeBase + 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}

export function manifestResponse(url) {
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(buildManifest(url))
  };
}
