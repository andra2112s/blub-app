/* ── Pet System — companion ala Tamagotchi, port dari pevo PetDrives ──
   Drives 0–100 (tinggi = sehat): hunger, energy, social, rest + bond
   (kedekatan, cuma naik). Stat turun real-time; decay saat app ditutup
   dihitung dari lastTick (cap 24 jam; regen tidur cap 8 jam).
   Mood blob diturunkan dari drive terburuk — pola deriveEmotion pevo. */

import { PERSONA } from './brain.js';

const KEY = 'Mochi.pet';
const TICK_MS = 10000;
const SAVE_EVERY_TICKS = 3;
const MAX_OFFLINE_S = 86400;
const MAX_SLEEP_REGEN_S = 8 * 3600;

// Laju penurunan per jam saat bangun
const DECAY = { hunger: 10, energy: 8, social: 12, rest: 6 };
// Saat tidur: rest & energi pulih, lapar/sosial turun pelan
const SLEEP = { hunger: 4, social: 2, energyUp: 35, restUp: 45 };

const clamp = (v) => Math.max(0, Math.min(100, v));
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
/* Skala warna kontinu merah→hijau: 0 = merah, 100 = hijau */
const statColor = (v) => `hsl(${Math.round(clamp(v) * 1.2)} 72% 42%)`;

const WAKE_MSGS = [
  '*menguap dan meregang* Mmm… tidurku nyenyak! 😴✨',
  'Aku bangun! Merasa segar! Siap main? 🌟',
  '*gosok mata* Selamat pagi! Apa yang kulewatkan? 🌅',
  'Tidur siangnya luar biasa. Penuh energi! ⚡'
];

const GROGGY_MSGS = ['Ugh… apa? 😵', 'Hah? Aku ketiduran… 😪', 'Hmm… lima menit lagi… 😴'];
const FEED_MSGS = () => ['Nom nom nom! 🍖', 'Enak banget! 😋', `Makasih, ${PERSONA} suka~`, 'Nyam nyam… tambah lagi dong!'];
const PLAY_MSGS = ['Asik, main lagi! 🎾', 'Yeay! Lempar lagi! ⚡', 'Wiii seru banget!', 'Aku suka main sama kamu! 💕'];
const PET_MSGS = ['Hehe… geli! 🫳💕', 'Elus lagi dong~', 'Hangat banget tanganmu 💕', 'Purr~ 🥰'];

const COMPLAINTS = {
  exhausted: ['Duh… aku capek banget 😮‍💨', 'Badanku lemas… butuh tidur 😴'],
  hungry: ['Perutku keroncongan… 🍖', 'Aku laper… ada camilan nggak?', 'Kasih makan aku dong… 🥹'],
  lonely: ['Sepi nih… temenin dong 🥺', 'Kangen… main sama aku yuk!', 'Kamu sibuk ya? Aku di sini sendirian…'],
  tired: ['Ngantuk berat… 😪', 'Kelopak mataku berat banget…']
};

const MOODS = {
  sleep:     { icon: '💤', label: 'Tidur nyenyak' },
  exhausted: { icon: '😮‍💨', label: 'Capek banget…' },
  hungry:    { icon: '🍖', label: 'Laper berat!' },
  lonely:    { icon: '🥺', label: 'Merasa sepi' },
  tired:     { icon: '😪', label: 'Agak ngantuk' },
  excited:   { icon: '⚡', label: 'Penuh semangat!' },
  content:   { icon: '😊', label: 'Lagi senang' }
};

const STAT_META = [
  ['hunger', 'Lapar'],
  ['energy', 'Energi'],
  ['social', 'Sosial'],
  ['rest', 'Tidur'],
  ['bond', 'Bond']
];

const NEED_FACE = { sleep: 'sleepy', exhausted: 'sleepy', hungry: 'sad', lonely: 'sad', tired: 'sleepy' };
const FACE_SAFE = new Set(['idle', 'happy', 'sad', 'doubt', 'confuse', 'bored', 'sleepy', 'shy', 'proud']);

export function createPet({ store, blob, showBubble, playPop, emotion, isBusy, toast }) {
  let d = { hunger: 80, energy: 85, social: 70, rest: 80, bond: 0 };
  let sleeping = false;
  let bornAt = Date.now();
  let stats = { feeds: 0, plays: 0, pets: 0, sleeps: 0 };
  let lastTick = Date.now();
  let tickCount = 0;
  let lastComplain = 0;
  let lastPokeGain = 0;
  let lastSleepPoke = 0;
  let mood = 'content';
  let forcedFace = null;
  let wakeGraceUntil = 0; // setelah bangun: wajah ngantuk tidak dipaksa ulang
  let panelEl = null;
  let hudEl = null;

  function save() {
    store.set(KEY, JSON.stringify({ d, sleeping, bornAt, stats, lastTick: Date.now() }));
  }

  function applyElapsed(sec) {
    const h = sec / 3600;
    if (sleeping) {
      const regenH = Math.min(h, MAX_SLEEP_REGEN_S / 3600);
      d.rest = clamp(d.rest + SLEEP.restUp * regenH);
      d.energy = clamp(d.energy + SLEEP.energyUp * regenH);
      d.hunger = clamp(d.hunger - SLEEP.hunger * h);
      d.social = clamp(d.social - SLEEP.social * h);
      const extraH = h - regenH;
      if (extraH > 0) {
        d.energy = clamp(d.energy - DECAY.energy * extraH);
        d.rest = clamp(d.rest - DECAY.rest * extraH);
      }
    } else {
      for (const k of Object.keys(DECAY)) d[k] = clamp(d[k] - DECAY[k] * h);
    }
  }

  function load() {
    try {
      const s = JSON.parse(store.get(KEY, ''));
      if (!s || !s.d) return;
      d = { ...d, ...s.d };
      sleeping = !!s.sleeping;
      bornAt = s.bornAt || Date.now();
      stats = { ...stats, ...(s.stats || {}) };
      const elapsedS = Math.min(Math.max(0, (Date.now() - (s.lastTick || Date.now())) / 1000), MAX_OFFLINE_S);
      applyElapsed(elapsedS);
    } catch {}
  }

  function computeMood() {
    if (sleeping) return 'sleep';
    if (d.rest < 15 || d.energy < 8) return 'exhausted';
    if (d.hunger < 25) return 'hungry';
    if (d.social < 25) return 'lonely';
    if (d.energy < 30 || d.rest < 30) return 'tired';
    if (d.hunger > 70 && d.energy > 70 && d.social > 60) return 'excited';
    return 'content';
  }

  function applyFace() {
    const need = NEED_FACE[mood];
    // Habis dibangunin: biarkan blob terjaga walau masih capek/ngantuk
    if (need === 'sleepy' && Date.now() < wakeGraceUntil) return;
    if (need) {
      if (FACE_SAFE.has(blob.getState())) {
        blob.setState(need);
        forcedFace = need;
      }
    } else if (forcedFace && blob.getState() === forcedFace) {
      blob.setState('idle');
      forcedFace = null;
    }
  }

  function updateHud() {
    if (!hudEl) return;
    const moodIco = hudEl.querySelector('.pet-hud-mood');
    if (moodIco) moodIco.textContent = MOODS[mood].icon;
    hudEl.querySelectorAll('[data-hud]').forEach((bar) => {
      const v = Math.round(d[bar.dataset.hud] ?? 0);
      bar.style.width = v + '%';
      bar.style.background = statColor(v);
      bar.closest('.pet-hud-act')?.classList.toggle('alert', v < 25 && mood !== 'sleep');
    });
    const need = mood !== 'sleep' && ['hunger', 'energy', 'social', 'rest'].some((k) => d[k] < 25);
    hudEl.classList.toggle('need', need);
  }

  function el(id) { return document.getElementById(id); }

  function render() {
    if (!panelEl || panelEl.hidden) return;
    const m = MOODS[mood];
    const icon = el('petMoodIcon'), moodEl = el('petMood'), sub = el('petSub');
    if (icon) icon.textContent = m.icon;
    if (moodEl) moodEl.textContent = m.label;
    if (sub) {
      const days = Math.max(1, Math.ceil((Date.now() - bornAt) / 86400000));
      sub.textContent = `Bersama ${days} hari · ${stats.feeds}× makan · ${stats.plays}× main`;
    }
    for (const [k] of STAT_META) {
      const bar = el('petBar-' + k), val = el('petVal-' + k);
      if (!bar) continue;
      const v = Math.round(d[k]);
      bar.style.width = v + '%';
      bar.style.background = k === 'bond' ? '' : statColor(v);
      bar.className = 'pet-fill' + (k === 'bond' ? ' bond' : '');
      if (val) val.textContent = v;
    }
    const sbtn = panelEl.querySelector('[data-care="sleep"]');
    if (sbtn) sbtn.textContent = sleeping ? '☀️ Bangunin' : '😴 Tidurin';
  }

  function maybeComplain(now) {
    if (sleeping || mood === 'content' || mood === 'excited') return;
    if (isBusy && isBusy()) return;
    if (now - lastComplain < 60000 || Math.random() > 0.5) return;
    if (!FACE_SAFE.has(blob.getState())) return;
    showBubble(rnd(COMPLAINTS[mood] || []), 3200);
    lastComplain = now;
  }

  function tick() {
    const now = Date.now();
    const elapsedS = Math.max(0, (now - lastTick) / 1000);
    lastTick = now;
    applyElapsed(Math.min(elapsedS, 3600));
    if (sleeping) emotion.markInteraction('sleep'); // tidur = merasa diperhatikan
    mood = computeMood();
    applyFace();
    updateHud();
    maybeComplain(now);
    if (++tickCount % SAVE_EVERY_TICKS === 0) save();
    render();
  }

  /* ── Aksi perawatan ── */
  // Reaksi aksi pet wajib terlihat walau panel bottom-sheet terbuka — bubble di
  // stage tertutup backdrop panel (z-30 < stage), jadi pakai toast (z-60).
  const notify = toast || showBubble;
  function refuse(msg) { showBubble(msg, 2600); notify(msg); }

  // Emoji terbang dari tombol perawatan ke badan blob — level body (fixed,
  // z-45: di atas backdrop & panel) supaya selalu terlihat.
  function fly(emoji, fromEl) {
    const blobSvg = document.getElementById('blobSvg');
    const target = blobSvg?.getBoundingClientRect();
    if (!target) return;
    const start = fromEl?.getBoundingClientRect();
    const sx = start && start.width ? start.left + start.width / 2 : innerWidth / 2;
    const sy = start && start.height ? start.top + start.height / 2 : innerHeight * 0.75;
    const tx = target.left + target.width / 2;
    const ty = target.top + target.height * 0.35;
    const s = document.createElement('span');
    s.className = 'pet-fly';
    s.textContent = emoji;
    document.body.appendChild(s);
    s.animate([
      { transform: `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(1.4)`, opacity: 0 },
      { transform: `translate(${(sx + tx) / 2}px, ${Math.min(sy, ty) - 50}px) translate(-50%, -50%) scale(1.2)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${tx}px, ${ty}px) translate(-50%, -50%) scale(0.4)`, opacity: 0 }
    ], { duration: 850, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' }).onfinish = () => s.remove();
  }

  // Blob kelihatan "mengunyah" — mulut buka-tutup cepat beberapa kali
  function chew() {
    blob.talk(true);
    setTimeout(() => blob.talk(false), 320);
    setTimeout(() => blob.talk(true), 520);
    setTimeout(() => blob.talk(false), 840);
  }

  function gainBond(n) { d.bond = clamp(d.bond + n); }

  function afterCare() {
    emotion.markInteraction('care');
    mood = computeMood();
    applyFace();
    updateHud();
    render();
    save();
  }

  function feed(fromEl) {
    if (sleeping) return refuse('Shh… aku masih tidur. Bangunin dulu ya 💤');
    if (d.hunger >= 95) return refuse('Kenyang banget! Nanti aja ya 🤰');
    d.hunger = clamp(d.hunger + 30);
    d.energy = clamp(d.energy + 4);
    gainBond(2);
    stats.feeds++;
    fly('🍖', fromEl);
    playPop();
    if (navigator.vibrate) navigator.vibrate(20);
    blob.setState('excite', { holdMs: 1600 });
    const msg = rnd(FEED_MSGS());
    showBubble(msg, 2600);
    notify(msg);
    chew();
    afterCare();
  }

  function play(fromEl) {
    if (sleeping) return refuse('Shh… aku masih tidur 💤');
    if (d.energy < 15) {
      blob.setState('sleepy', { holdMs: 2000 });
      return refuse('Capek banget… mainnya nanti ya 😪');
    }
    d.social = clamp(d.social + 15);
    d.energy = clamp(d.energy - 12);
    d.hunger = clamp(d.hunger - 8);
    gainBond(2);
    stats.plays++;
    fly('🎾', fromEl);
    playPop();
    if (navigator.vibrate) navigator.vibrate(20);
    blob.setState('excite', { holdMs: 2200 });
    const msg = rnd(PLAY_MSGS);
    showBubble(msg, 2600);
    notify(msg);
    afterCare();
  }

  function petHim(fromEl) {
    if (sleeping) return refuse('Zzz… 💤');
    d.social = clamp(d.social + 8);
    gainBond(1);
    stats.pets++;
    fly('💕', fromEl);
    blob.setState('happy', { holdMs: 2000 });
    const msg = rnd(PET_MSGS);
    showBubble(msg, 2600);
    notify(msg);
    afterCare();
  }

  function wake(byPoke = false) {
    if (!sleeping) return;
    sleeping = false;
    wakeGraceUntil = Date.now() + 90000;
    forcedFace = null;
    gainBond(1);
    blob.setState(byPoke ? 'doubt' : 'happy', { holdMs: 2500 });
    showBubble(byPoke ? rnd(GROGGY_MSGS) : rnd(WAKE_MSGS), 3500);
    mood = computeMood();
    updateHud();
    render();
    save();
  }

  function toggleSleep() {
    if (sleeping) {
      wake();
    } else {
      sleeping = true;
      stats.sleeps++;
      blob.setState('sleepy');
      showBubble('Selamat malam… 😴💤');
      mood = computeMood();
      updateHud();
      render();
      save();
    }
  }

  /* ── Hook dari app: chat & colek ikut nambah sosial ── */
  function onChat() {
    d.social = clamp(d.social + 2);
    gainBond(0.5);
    mood = computeMood();
    updateHud();
  }

  function onPoke() {
    // Blob tidur: tap 2x cepat untuk bangunin (1x = cuma bergumam)
    if (sleeping) {
      const now = Date.now();
      if (now - lastSleepPoke < 800) {
        wake(true);
      } else {
        lastSleepPoke = now;
        showBubble('Zzz… 💤', 1500);
      }
      return;
    }
    const now = Date.now();
    if (now - lastPokeGain < 3000) return;
    lastPokeGain = now;
    d.social = clamp(d.social + 0.5);
    mood = computeMood();
  }

  function init(panel, hud) {
    panelEl = panel;
    hudEl = hud;
    load();
    mood = computeMood();
    if (sleeping && FACE_SAFE.has(blob.getState())) blob.setState('sleepy');
    else applyFace();
    updateHud();
    lastTick = Date.now();
    setInterval(tick, TICK_MS);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
    render();
  }

  return {
    init, render,
    feed, play, petHim, toggleSleep,
    onChat, onPoke,
    isSleeping: () => sleeping,
    getMood: () => mood
  };
}
