/* ── Painted mode ("Lukis") — Mochi versi hand-painted ──
   Tiap mood adalah satu spritesheet statis (grid frame, WebP alpha) di
   assets/anim/, dirender offline oleh engine p5.brush (ClaudeAnimationBase).
   Player ini menggambar sel frame ke SATU <canvas> pakai timer sendiri —
   tidak ada APNG/dispose/blend, tidak ada elemen kedua, jadi tidak mungkin
   ada lapisan yang menumpuk. Bonus: ganti mood melanjutkan fase animasi
   yang sama (timer global), jadi transisinya mulus.
   SVG engine tetap jalan di baliknya (hidden), jadi state/poke/bentuk lain aman. */

const DIR = './assets/anim/';
// Versi frame: bump kalau loop di-render ulang — query ini melewati cache SW/browser lama.
const ANIM_V = '11';
const CELL = 320, FPS = 12;
// [jumlah frame, kolom grid]
const LOOPS = {
  idle: [48, 8], happy: [48, 8], excite: [48, 8], think: [48, 8], listen: [48, 8],
  sad: [48, 8], sleepy: [60, 10], surpris: [48, 8], scare: [48, 8], doubt: [48, 8],
  confuse: [48, 8], proud: [48, 8], shy: [48, 8], bored: [48, 8], love: [48, 8]
};
const src = (mood) => `${DIR}mochi-${mood}-sheet.webp?v=${ANIM_V}`;

export function initPainted(bot, stage) {
  const box = document.createElement('div');
  box.className = 'painted-view';
  box.setAttribute('aria-hidden', 'true');
  const cv = document.createElement('canvas');
  cv.width = cv.height = CELL;
  box.appendChild(cv);
  stage.appendChild(box);
  const ctx = cv.getContext('2d');
  const ground = stage.querySelector('.blob-ground');

  const sprite = new Image();
  let curMood = '', wantMood = 'idle';
  let frames = 48, cols = 8;
  let flashTimer = null;
  const loaded = new Set();

  const active = () => stage.classList.contains('painted');

  let lastI = -1, lastSrc = '';
  function draw() {
    if (!sprite.naturalWidth) return;
    const i = Math.floor(performance.now() / (1000 / FPS)) % frames;
    if (i === lastI && sprite.src === lastSrc) return;
    lastI = i; lastSrc = sprite.src;
    ctx.clearRect(0, 0, CELL, CELL);
    ctx.drawImage(sprite, (i % cols) * CELL, Math.floor(i / cols) * CELL, CELL, CELL, 0, 0, CELL, CELL);
  }

  /* Ikuti blob SVG (tetap ada, opacity 0 → drag/poke/klik tetap jalan):
     ukuran, posisi tanah, dan transform (drag, rotate, squash, animasi CSS)
     disalin tiap frame. Badan di frame lukis = 440/900 lebar sel, kaki di 70%
     tinggi sel; badan SVG = 200/316 lebar viewBox, dasar di +100. */
  const K = (200 / 316) / (440 / 900);          // lebar sel / lebar svg
  const DY = 100 / 316 - K * 0.2;               // geser pusat sel (× lebar svg) supaya kaki = dasar badan svg
  function sync() {
    const svg = bot.svg, w = svg.clientWidth;
    if (!w) return;
    const S = w * K, dy = w * DY;
    box.style.width = box.style.height = `${S}px`;
    box.style.left = `calc(50% - ${S / 2}px)`;
    box.style.top = `calc(50% - ${S / 2 - dy}px)`;
    box.style.transformOrigin = `50% ${S / 2 - dy}px`;
    const cs = getComputedStyle(svg);
    box.style.transform = cs.transform === 'none' ? '' : cs.transform;
    box.style.opacity = svg.style.opacity || '';
    box.style.visibility = svg.style.visibility || '';
    // dasar badan lukis datar & lebar → bayangan tanah harus lebih lebar dari badan supaya tetap kelihatan
    if (ground) ground.style.width = `${S * 0.62}px`;
  }

  function tick() {
    if (active()) { sync(); draw(); }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function use(mood) {
    const m = LOOPS[mood] ? mood : 'idle';
    wantMood = m;
    if (m === curMood) return;
    const s = src(m);
    const apply = () => {
      sprite.src = s;
      [frames, cols] = LOOPS[m];
      curMood = m;
    };
    if (loaded.has(s)) { apply(); return; }
    const pre = new Image();
    pre.onload = () => { loaded.add(s); if (wantMood === m && active()) apply(); };
    pre.src = s;   // jangan tampilkan sebelum ke-decode: hindari blank flash
  }

  function show() {
    stage.classList.add('painted');
    use(bot.mood || 'idle');
  }
  function hide() {
    stage.classList.remove('painted');
    if (ground) ground.style.width = '';
  }
  function setMood(m) { if (active()) use(m); else wantMood = LOOPS[m] ? m : 'idle'; }
  function flash(mood, ms = 900) {
    if (!active()) return;
    clearTimeout(flashTimer);
    use(mood);
    flashTimer = setTimeout(() => use(wantMood), ms);
  }
  function talk(on) { if (active()) use(on ? 'excite' : bot.mood || 'idle'); }

  /* Wrappers: semua perubahan mood/bentuk tetap lewat API BlobCharacter biasa,
     player ini cuma ikut mendengar. */
  const setShape0 = bot.setShape.bind(bot);
  bot.setShape = (id) => { setShape0(id); if (bot.getShape() === 'lukis') show(); else hide(); };
  const setState0 = bot.setState.bind(bot);
  const ALIAS = { sleep: 'sleepy', wink: 'happy' };   // mood yang dipakai app tapi tidak punya loop sendiri
  bot.setState = (m, o) => { setState0(m, o); setMood(ALIAS[m] || m); };
  const talk0 = bot.talk.bind(bot);
  bot.talk = (on) => { talk0(on); talk(on); };
  const poke0 = bot.poke.bind(bot);
  // colek saat tidur = bengong/linglung (doubt), saat bangun = kaget (surpris)
  bot.poke = () => { flash(bot.mood === 'sleepy' ? 'doubt' : 'surpris', 900); poke0(); };

  if (bot.getShape() === 'lukis') show();

  /* Alat cek dari console DevTools:
       hollow.list()          → daftar ekspresi
       hollow.play('love')    → putar satu ekspresi (otomatis pindah ke style Hollow)
       hollow.tour(3000)      → putar semua bergiliran, 3 dtk per ekspresi
       hollow.stop()          → hentikan tour, kembali idle */
  let tourTimer = null;
  window.hollow = {
    list: () => Object.keys(LOOPS),
    play(m) {
      if (!LOOPS[m]) return `tidak ada: ${m}. Pilih: ${Object.keys(LOOPS).join(', ')}`;
      if (!active()) bot.setShape('lukis');
      bot.setState(m);
      return m;
    },
    tour(ms = 3000) {
      this.stop();
      const all = Object.keys(LOOPS);
      let i = 0;
      const next = () => {
        const m = all[i++ % all.length];
        console.log(`[Hollow] ${i}/${all.length}: ${m}`);
        this.play(m);
        tourTimer = setTimeout(next, ms);
      };
      next();
    },
    stop() { clearTimeout(tourTimer); tourTimer = null; bot.setState('idle'); }
  };
  return { show, hide, setMood, flash, talk };
}
