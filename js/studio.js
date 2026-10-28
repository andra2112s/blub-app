/* ── Mochi Studio (klien PWA) ──
   Login Google → kredit → buat video dari ide → pantau progres → putar/unduh.
   Server: Mochi Studio di VPS (folder studio/), alamatnya dari <meta name="mochi-studio">. */

const BASE = (document.querySelector('meta[name="mochi-studio"]')?.content || '').trim().replace(/\/$/, '');
const TOKEN_KEY = 'Mochi.studioToken';
const IDEAS = ['Kucing astronot jalan-jalan di bulan', 'Robot kecil belajar masak nasi goreng', 'Naga lucu takut gelap di hutan ajaib'];
const ACTIVE = ['queued', 'running'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');

export function createStudio({ body, open, onJobDone, toast }) {
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let me = null;
  let jobs = [];
  let orders = [];
  let view = 'home';
  let order = null;
  let draft = '';
  let pkgId = '';
  let busy = false;
  let pollTimer = null;
  let gisReady = null;
  let cfgPromise = null;
  const getCfg = () => (cfgPromise ||= api('/config'));
  const known = new Map();

  async function api(path, opts = {}) {
    const res = await fetch(BASE + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) signOut();
    if (!res.ok) throw new Error(data.error || `Studio error ${res.status}`);
    return data;
  }

  function signOut() {
    token = ''; me = null; jobs = []; orders = [];
    localStorage.removeItem(TOKEN_KEY);
    render();
  }

  const isOpen = () => body.isConnected && !body.closest('[hidden]');

  function trackJobs(list) {
    for (const j of list) {
      const prev = known.get(j.id);
      if (prev && ACTIVE.includes(prev) && !ACTIVE.includes(j.status)) onJobDone?.(j);
      known.set(j.id, j.status);
    }
  }

  async function refresh() {
    token = localStorage.getItem(TOKEN_KEY) || '';
    if (!token) return;
    const [m, j, o] = await Promise.all([api('/me'), api('/jobs'), api('/topups')]);
    me = m; jobs = j; orders = o;
    trackJobs(jobs);
    if (order) order = orders.find((x) => x.id === order.id) || order;
  }

  /* Polling: cepat saat panel terbuka, lambat di latar kalau ada video diproses (buat notifikasi "sudah jadi"). */
  function schedule() {
    clearTimeout(pollTimer);
    if (!token) return;
    const activeJob = jobs.some((j) => ACTIVE.includes(j.status));
    const waitingPay = orders.some((o) => o.status === 'claimed' || o.status === 'pending');
    const ms = isOpen() ? (activeJob || waitingPay ? 4000 : 0) : activeJob ? 20000 : 0;
    if (!ms) return;
    pollTimer = setTimeout(async () => {
      try { await refresh(); if (isOpen() && !busy) render(); } catch {}
      schedule();
    }, ms);
  }

  function loadGis() {
    gisReady ||= new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisReady = null; reject(new Error('Gagal memuat Google Sign-In')); };
      document.head.appendChild(s);
    });
    return gisReady;
  }

  async function finishLogin(newToken) {
    token = newToken;
    localStorage.setItem(TOKEN_KEY, token);
    await refresh();
    render();
    toast?.(`Halo ${me.user.name.split(' ')[0]}! 🎬`);
  }

  async function hydrateLogin() {
    const slot = body.querySelector('#studioGoogle');
    const adminBox = body.querySelector('#studioAdmin');
    let cfg = { googleClientId: '', adminLogin: false };
    try { cfg = await getCfg(); } catch {}
    if (cfg.adminLogin && adminBox) adminBox.hidden = false;
    if (cfg.googleClientId && slot) {
      try {
        await loadGis();
        google.accounts.id.initialize({
          client_id: cfg.googleClientId,
          callback: async ({ credential }) => {
            try {
              const r = await api('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });
              await finishLogin(r.token);
            } catch (e) { toast?.(e.message); }
          }
        });
        google.accounts.id.renderButton(slot, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
      } catch (e) { if (!cfg.adminLogin) slot.textContent = e.message; }
    } else if (slot && !cfg.adminLogin) {
      slot.textContent = 'Login belum dikonfigurasi di server.';
    }
  }

  /* ── Tampilan ── */
  function viewLogin() {
    return `
      <div class="studio-hero">
        <div class="studio-hero-icon">🎬</div>
        <h3>Bikin video AI dari satu kalimat</h3>
        <p>Ceritakan idemu, Mochi yang menyusun cerita, menggambar karakter, dan membuat klip videonya.</p>
        <div id="studioGoogle" class="studio-google"></div>
        <div id="studioAdmin" class="studio-admin" hidden>
          <input id="adminEmail" type="email" placeholder="Email admin" autocomplete="username" />
          <input id="adminCode" type="password" placeholder="Kode rahasia" autocomplete="current-password" />
          <button class="studio-btn primary" data-act="adminlogin">Masuk sebagai admin</button>
        </div>
        <p class="studio-fine">Dengan masuk, kamu setuju video dibuat oleh AI dan konten terlarang akan ditolak otomatis.</p>
      </div>`;
  }

  function jobCard(j) {
    const pct = Math.round((j.progress || 0) * 100);
    const status = { queued: '⏳ Antre', running: '⚙️ Diproses', done: '✅ Jadi', failed: '⚠️ Gagal', refused: '🚫 Ditolak' }[j.status] || j.status;
    const shareBtn = (s) => navigator.share ? ` <button class="studio-share" data-share="${esc(s.url)}" data-name="${esc(j.title || 'mochi-video')}.mp4">↗</button>` : '';
    const media = j.final ? `
      <figure class="studio-final">
        <video src="${esc(j.final.url)}" controls playsinline preload="metadata"></video>
        <figcaption><b>📽️ Video lengkap</b><span><a href="${esc(j.final.url)}&dl=1" download>⬇︎ Unduh</a>${shareBtn(j.final)}</span></figcaption>
      </figure>
      <details class="studio-klip"><summary>${j.shots.length} klip per adegan</summary>
        <div class="studio-shots">
          ${j.shots.map((s) => `
            <figure class="studio-shot">
              <video src="${esc(s.url)}" ${j.character ? `poster="${esc(j.character.url)}"` : ''} controls playsinline preload="metadata"></video>
              <figcaption>${esc(s.caption)} <a href="${esc(s.url)}&dl=1" download>⬇︎</a>${shareBtn(s)}</figcaption>
            </figure>`).join('')}
        </div>
      </details>`
      : j.status === 'done' || j.shots.length ? `
      <div class="studio-shots">
        ${j.shots.map((s) => `
          <figure class="studio-shot">
            <video src="${esc(s.url)}" ${j.character ? `poster="${esc(j.character.url)}"` : ''} controls playsinline preload="metadata"></video>
            <figcaption>${esc(s.caption)} <a href="${esc(s.url)}&dl=1" download>⬇︎</a>${shareBtn(s)}</figcaption>
          </figure>`).join('')}
      </div>` : j.character ? `<img class="studio-char" src="${esc(j.character.url)}" alt="Karakter" />` : '';
    return `
      <article class="studio-job ${esc(j.status)}">
        <div class="studio-job-head">
          <b>${esc(j.title || j.idea.slice(0, 60))}</b>
          <span class="studio-chip">${status}</span>
        </div>
        ${ACTIVE.includes(j.status) ? `<div class="studio-bar"><i style="width:${Math.max(4, pct)}%"></i></div><div class="studio-step">${esc(j.step)} · ${pct}%</div>` : ''}
        ${j.error ? `<p class="studio-err">${esc(j.error)}</p>` : ''}
        ${media}
      </article>`;
  }

  function viewHome() {
    const { user, packages, maintenance } = me;
    pkgId = packages.some((p) => p.id === pkgId) ? pkgId : packages[0]?.id;
    const pkg = packages.find((p) => p.id === pkgId);
    const enough = user.unlimited || (pkg && user.credits >= pkg.credits);
    return `
      <div class="studio-top">
        ${user.picture ? `<img src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer" />` : ''}
        <div class="studio-who"><b>${esc(user.name)}</b><button class="studio-link" data-act="logout">Keluar</button></div>
        <span class="studio-credits">${user.unlimited ? '💎 ∞' : `💎 ${user.credits}`}</span>
        ${user.unlimited ? '' : '<button class="studio-btn ghost" data-act="topup">＋ Isi</button>'}
      </div>
      ${maintenance ? '<p class="studio-err">Studio sedang perawatan sebentar. Coba lagi nanti ya.</p>' : ''}
      <div class="studio-create">
        <textarea id="studioIdea" maxlength="1000" rows="3" placeholder="Ceritakan videomu… misal: kucing oranye jadi astronot, mendarat di bulan lalu menemukan keju raksasa">${esc(draft)}</textarea>
        <div class="studio-ideas">${IDEAS.map((i) => `<button class="studio-chip-btn" data-idea="${esc(i)}">${esc(i)}</button>`).join('')}</div>
        <div class="studio-pkgs">
          ${packages.map((p) => `
            <button class="studio-pkg ${p.id === pkgId ? 'on' : ''}" data-pkg="${esc(p.id)}">
              <b>${esc(p.name)}</b><span>${esc(p.desc || '')}</span><em>💎 ${p.credits}</em>
            </button>`).join('')}
        </div>
        ${enough
          ? `<button class="studio-btn primary" data-act="create" ${maintenance || busy ? 'disabled' : ''}>🎬 Buat Video · 💎 ${pkg.credits}</button>`
          : `<button class="studio-btn primary" data-act="topup">Kredit kurang — Isi kredit dulu</button>`}
      </div>
      <div class="studio-section">Karyaku</div>
      ${jobs.length ? jobs.map(jobCard).join('') : '<p class="studio-empty">Belum ada video. Yuk bikin yang pertama! ✨</p>'}`;
  }

  function viewTopup() {
    const statusTxt = { pending: 'Belum dibayar', claimed: 'Menunggu konfirmasi', approved: 'Berhasil ✅', rejected: 'Ditolak', expired: 'Kedaluwarsa' };
    const head = `<div class="studio-top"><button class="studio-btn ghost" data-act="home">← Kembali</button><span class="studio-credits">${me.user.unlimited ? '💎 ∞' : `💎 ${me.user.credits}`}</span></div>`;
    if (order) {
      const left = Math.max(0, Math.round((order.expires - Date.now()) / 60000));
      return `${head}
        <div class="studio-pay">
          ${order.status === 'pending' ? `
            <div class="studio-qr">${order.qrSvg}</div>
            ${order.merchant ? `<div class="studio-merchant">${esc(order.merchant)}</div>` : ''}
            <div class="studio-amount">Bayar tepat <b>${rupiah(order.amount)}</b></div>
            <button class="studio-link" data-act="copy">Salin nominal</button>
            <ol class="studio-steps">
              <li>Tap <b>Simpan QR</b>, lalu buka m-banking / GoPay / DANA / OVO → Scan QRIS → pilih dari galeri.</li>
              <li>Pastikan nominal <b>persis ${rupiah(order.amount)}</b> (3 digit terakhir itu kode unikmu).</li>
              <li>Setelah berhasil, tap <b>Saya sudah bayar</b>.</li>
            </ol>
            <div class="studio-row">
              <button class="studio-btn ghost" data-act="saveqr">💾 Simpan QR</button>
              <button class="studio-btn primary" data-act="claim">Saya sudah bayar</button>
            </div>
            <p class="studio-fine">Berlaku ±${left} menit. ${order.credits} kredit masuk setelah dicek admin.</p>`
          : `<div class="studio-hero-icon">${order.status === 'approved' ? '🎉' : order.status === 'claimed' ? '⏳' : '⌛'}</div>
             <h3>${statusTxt[order.status]}</h3>
             <p>${order.status === 'claimed' ? `Pembayaran ${rupiah(order.amount)} sedang dicek admin. Kredit otomatis masuk, halaman ini akan memperbarui sendiri.` : order.status === 'approved' ? `${order.credits} kredit sudah masuk. Selamat berkarya!` : 'Silakan buat pembayaran baru.'}</p>
             <button class="studio-btn primary" data-act="${order.status === 'approved' ? 'home' : 'neworder'}">${order.status === 'approved' ? 'Buat video' : 'Pilih paket lagi'}</button>`}
        </div>`;
    }
    return `${head}
      <div class="studio-section">Pilih paket kredit</div>
      <div class="studio-topups">
        ${me.topups.length ? me.topups.map((t) => `<button class="studio-pkg" data-topup="${esc(t.id)}"><b>💎 ${t.credits} kredit</b><em>${rupiah(t.price)}</em></button>`).join('') : '<p class="studio-empty">Top-up belum tersedia.</p>'}
      </div>
      <p class="studio-fine">Pembayaran via QRIS — semua e-wallet & m-banking.</p>
      ${orders.length ? `<div class="studio-section">Riwayat</div>
        <ul class="studio-orders">${orders.map((o) => `<li data-order="${esc(o.id)}"><span>${rupiah(o.amount)} · 💎 ${o.credits}</span><em>${statusTxt[o.status] || o.status}</em></li>`).join('')}</ul>` : ''}`;
  }

  function render() {
    if (!BASE) {
      body.innerHTML = '<div class="studio-hero"><div class="studio-hero-icon">🎬</div><h3>Studio belum disambungkan</h3><p>Admin perlu mengisi alamat server Studio di &lt;meta name="mochi-studio"&gt;.</p></div>';
      return;
    }
    const ta = body.querySelector('#studioIdea');
    if (ta) draft = ta.value;
    body.innerHTML = !token ? viewLogin()
      : !me ? '<div class="studio-hero"><div class="studio-hero-icon">⏳</div><p>Menyambungkan ke Studio…</p></div>'
      : view === 'topup' ? viewTopup() : viewHome();
    if (!token) hydrateLogin();
    schedule();
  }

  async function shareMedia(url, name) {
    const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error('Gagal mengambil file'); return r.blob(); });
    const file = new File([blob], name, { type: blob.type || 'video/mp4' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function saveQr() {
    const svg = body.querySelector('.studio-qr svg');
    if (!svg) return;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 800;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 800, 800);
    ctx.drawImage(img, 40, 40, 720, 720);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], `qris-mochi-${order.amount}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'QRIS Mochi' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function act(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { toast?.(e.message); } finally { busy = false; render(); }
  }

  body.addEventListener('click', (e) => {
    const t = e.target.closest('button, li[data-order]');
    if (!t) return;
    if (t.dataset.idea) { draft = t.dataset.idea; const ta = body.querySelector('#studioIdea'); if (ta) { ta.value = draft; ta.focus(); } return; }
    if (t.dataset.pkg) { pkgId = t.dataset.pkg; render(); return; }
    if (t.dataset.topup) return act(async () => { order = await api('/topups', { method: 'POST', body: JSON.stringify({ topupId: t.dataset.topup }) }); orders = await api('/topups'); });
    if (t.dataset.order) { order = orders.find((o) => o.id === t.dataset.order); render(); return; }
    if (t.dataset.share) { shareMedia(t.dataset.share, t.dataset.name || 'mochi-video.mp4').catch((err) => { if (err.name !== 'AbortError') toast?.(err.message); }); return; }
    const a = t.dataset.act;
    if (a === 'adminlogin') return act(async () => {
      const email = body.querySelector('#adminEmail')?.value.trim();
      const code = body.querySelector('#adminCode')?.value || '';
      if (!email || !code) throw new Error('Isi email admin dan kode rahasianya');
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, code }) });
      await finishLogin(r.token);
    });
    if (a === 'logout') return act(async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); signOut(); });
    if (a === 'topup') { view = 'topup'; order = null; render(); return; }
    if (a === 'home') { view = 'home'; order = null; act(refresh); return; }
    if (a === 'neworder') { order = null; render(); return; }
    if (a === 'copy') { navigator.clipboard?.writeText(String(order.amount)).then(() => toast?.('Nominal disalin')); return; }
    if (a === 'saveqr') { saveQr().catch((err) => toast?.(err.message)); return; }
    if (a === 'claim') return act(async () => { order = await api(`/topups/${order.id}/claim`, { method: 'POST' }); orders = await api('/topups'); });
    if (a === 'create') return act(async () => {
      const idea = (body.querySelector('#studioIdea')?.value || '').trim();
      if (idea.length < 5) throw new Error('Ceritakan idenya sedikit lebih panjang ya');
      const job = await api('/jobs', { method: 'POST', body: JSON.stringify({ idea, packageId: pkgId }) });
      draft = '';
      known.set(job.id, job.status);
      await refresh();
      toast?.('Siap! Video sedang dibuat — kamu boleh tutup Studio, nanti kukabari. 🎬');
    });
  });

  // Sesi tersimpan → muat diam-diam supaya notifikasi "video jadi" tetap jalan
  if (BASE && token) refresh().then(schedule).catch(() => {});

  return {
    enabled: !!BASE,
    async open(idea) {
      token = localStorage.getItem(TOKEN_KEY) || '';
      if (idea) { draft = idea; view = 'home'; order = null; }
      open();
      render();
      if (token) { try { await refresh(); render(); } catch (e) { toast?.(e.message); } }
    },
    onPanelClosed: schedule
  };
}
