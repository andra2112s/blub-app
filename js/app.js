import { BlobCharacter, SHAPES_INFO, shapePreviewPath, startIdleAnimations } from './blubbot.js';
import { createBrain, PERSONA, setPersona } from './brain.js';
import { createMusicDancer } from './music.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  stage: $('#stage'),
  svg: $('#blobSvg'),
  ground: $('#blobGround'),
  bubble: $('#bubble'),
  log: $('#log'),
  form: $('#composer'),
  input: $('#input'),
  chips: $('#chips'),
  radialMenu: $('#radialMenu'),
  panelPomodoro: $('#panelPomodoro'),
  panelPlay: $('#panelPlay'),
  panelEntertain: $('#panelEntertain'),
  powersRadial: $('#powersRadial'),
  idleRadial: $('#idleRadial'),
  pomoTime: $('#pomoTime'),
  pomoLabel: $('#pomoLabel'),
  pomoStart: $('#pomoStart'),
  pomoReset: $('#pomoReset'),
  pomoCount: $('#pomoCount'),
  btnSound: $('#btnSound'),
  btnMic: $('#btnMic'),
  btnSettings: $('#btnSettings'),
  btnInstall: $('#btnInstall'),
  settingsDlg: $('#settingsDlg'),
  installDlg: $('#installDlg'),
  installHow: $('#installHow'),
  toast: $('#toast'),
  setUrl: $('#setUrl'),
  setKey: $('#setKey'),
  setModel: $('#setModel'),
  setSys: $('#setSys'),
  setSave: $('#setSave'),
  setReset: $('#setReset'),
  obDlg: $('#obDlg'),
  obDots: $('#obDots'),
  shapeGrid: $('#shapeGrid'),
  obName: $('#obName'),
  obNext: $('#obNext'),
  obSkip: $('#obSkip'),
  btnShape: $('#btnShape'),
  btnShapes: $('#btnShapes'),
  chatSidebar: $('#chatSidebar'),
  chatClose: $('#chatClose'),
  blobTimerOverlay: $('#blobTimerOverlay'),
  blobTimerLabel: $('#blobTimerLabel'),
  blobTimerStart: $('#blobTimerStart'),
  blobTimerReset: $('#blobTimerReset'),
  blobTimerClose: $('#blobTimerClose'),
  blobTimerCount: $('#blobTimerCount')
};

/* ── Ground shadow: proper shadow physics ── */
/* On ground: shadow = blob width. Higher up: shadow grows + fades. Shrink: shadow shrinks. */
if (els.ground && els.svg) {
  const BASE_OFFSET = 115;  // px below center (ground position)
  const FLATTEN = 0.4;      // scaleY for flat-on-ground look
  const HEIGHT_GROW = 0.6;  // how much shadow grows per px of height
  const MAX_GROW = 1.8;     // max shadow enlargement when very high

  const updateGround = () => {
    const matrix = getComputedStyle(els.svg).transform;
    let tx = 0, ty = 0, sx = 1, sy = 1;
    if (matrix && matrix !== 'none') {
      const m = matrix.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)\)/);
      if (m) {
        const a = parseFloat(m[1]);
        const b = parseFloat(m[2]);
        const d = parseFloat(m[4]);
        tx = parseFloat(m[5]);
        ty = parseFloat(m[6]);
        sx = Math.sqrt(a * a + b * b);
        sy = Math.sqrt(d * d + parseFloat(m[3]) * parseFloat(m[3]));
      }
    }
    // Height above ground (ty < 0 = blob went up)
    const height = Math.max(0, -ty); // positive = how high blob is
    // Shadow physics: higher = wider + more diffuse (faded)
    const growFactor = 1 + Math.min(height / 200, MAX_GROW - 1) * HEIGHT_GROW;
    const shadowScaleX = Math.max(0.2, sx * growFactor);
    const shadowScaleY = Math.max(0.1, sy * FLATTEN * growFactor);
    // Opacity: full on ground, fades as blob rises
    const heightFade = 1 - Math.min(height / 300, 0.7);
    const shadowOpacity = Math.max(0.08, Math.min(1, sy) * heightFade);
    // Blur: more blur when higher (diffuse shadow)
    const blurAmount = 10 + Math.min(height / 30, 15);
    els.ground.style.transform =
      `translate(calc(-50% + ${tx.toFixed(1)}px), calc(-50% + ${BASE_OFFSET + Math.max(ty, 0) * 0.15}px)) scaleX(${shadowScaleX.toFixed(2)}) scaleY(${shadowScaleY.toFixed(2)})`;
    els.ground.style.opacity = shadowOpacity.toFixed(2);
    els.ground.style.filter = `blur(${blurAmount.toFixed(1)}px)`;
    requestAnimationFrame(updateGround);
  };
  requestAnimationFrame(updateGround);
}

const store = {
  get: (k, d) => localStorage.getItem(k) ?? d,
  set: (k, v) => localStorage.setItem(k, v),
  del: (k) => localStorage.removeItem(k)
};

let muted = store.get('blub.muted', '0') === '1';
let ttsVoice = null;
let recognition = null;
let deferredPrompt = null;

const brain = createBrain();

const savedPersona = store.get('blub.persona', '');
if (savedPersona) setPersona(savedPersona);

function playPop() {
  if (muted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300 + Math.random() * 120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => ctx.close();
  } catch {}
}

function playKnock() {
  if (muted) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // 1. Sharp "tink" — glass tap transient (triangle, high freq, very fast)
    const tink = ctx.createOscillator();
    const tinkGain = ctx.createGain();
    tink.type = 'triangle';
    tink.frequency.setValueAtTime(4200, now);
    tink.frequency.exponentialRampToValueAtTime(2800, now + 0.02);
    tinkGain.gain.setValueAtTime(0.35, now);
    tinkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    tink.connect(tinkGain).connect(ctx.destination);
    tink.start(now);
    tink.stop(now + 0.05);

    // 2. Resonant ring — the "glass" character (sine, sustains briefly)
    const ring = ctx.createOscillator();
    const ringGain = ctx.createGain();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(2600, now);
    ring.frequency.exponentialRampToValueAtTime(2400, now + 0.15);
    ringGain.gain.setValueAtTime(0.25, now);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    ring.connect(ringGain).connect(ctx.destination);
    ring.start(now);
    ring.stop(now + 0.2);

    // 3. High harmonic — adds brightness/clarity (sine, 2x freq)
    const harm = ctx.createOscillator();
    const harmGain = ctx.createGain();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(5200, now);
    harm.frequency.exponentialRampToValueAtTime(4800, now + 0.1);
    harmGain.gain.setValueAtTime(0.12, now);
    harmGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    harm.connect(harmGain).connect(ctx.destination);
    harm.start(now);
    harm.stop(now + 0.14);

    // 4. Noise transient — the "tap" attack (bandpass, very short)
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
    const ndata = noiseBuf.getChannelData(0);
    for (let i = 0; i < ndata.length; i++) ndata[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ndata.length, 4);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 4500;
    filter.Q.value = 3;
    noise.connect(filter).connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.04);

    // 5. Subtle body thud — low freq, very quiet (physical impact)
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(180, now);
    thud.frequency.exponentialRampToValueAtTime(80, now + 0.06);
    thudGain.gain.setValueAtTime(0.08, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    thud.connect(thudGain).connect(ctx.destination);
    thud.start(now);
    thud.stop(now + 0.1);

    tink.onended = () => ctx.close();
  } catch {}
}

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  ttsVoice =
    voices.find((v) => /^id/i.test(v.lang) && /female|wanita|damayanti|gadis/i.test(v.name)) ||
    voices.find((v) => /^id/i.test(v.lang)) ||
    null;
}

function speak(text) {
  if (muted || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g, '').slice(0, 300));
  u.lang = 'id-ID';
  if (!ttsVoice) pickVoice();
  if (ttsVoice) u.voice = ttsVoice;
  u.rate = 1.05;
  u.pitch = 1.25;
  u.onstart = () => blob.talk(true);
  u.onend = () => blob.talk(false);
  speechSynthesis.speak(u);
}

let bubbleTimer = null;
function showBubble(text, ms = 2600) {
  els.bubble.textContent = text;
  els.bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => els.bubble.classList.add('hidden'), ms);
}

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  els.log.appendChild(div);
  while (els.log.children.length > 60) els.log.firstChild.remove();
  els.log.scrollTop = els.log.scrollHeight;
  return div;
}

let typingEl = null;
function showTyping(on) {
  if (on && !typingEl) {
    typingEl = document.createElement('div');
    typingEl.className = 'typing';
    typingEl.innerHTML = '<i></i><i></i><i></i>';
    els.log.appendChild(typingEl);
    els.log.scrollTop = els.log.scrollHeight;
  } else if (!on && typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

const stateHold = { sad: 5000, excite: 1600, sleepy: 6000, happy: 2600 };
function applyState(state) {
  if (!state || !stateHold && state !== 'think' && state !== 'listen') return;
  if (state === 'talk') return;
  blob.setState(state, { holdMs: stateHold[state] || 2200 });
  if (state !== 'listen' && state !== 'sleepy') {
    setTimeout(() => {
      if (blob.getState() === state) blob.setState('idle');
    }, (stateHold[state] || 2200) + 100);
  }
}

let busy = false;
async function send(rawText) {
  const text = (rawText || '').trim();
  if (!text || busy) return;
  busy = true;
  els.chatSidebar.classList.remove('hidden');
  idleAnims.stop();
  els.idleRadial.classList.add('hidden');
  els.powersRadial.classList.add('hidden');
  els.input.value = '';
  addMsg('user', text);
  showTyping(true);
  blob.setState('think');

  let res;
  try {
    res = await brain.reply(text);
  } catch {
    res = { text: 'Aduh, otak blob sempat ngambek. Coba lagi ya!', state: 'sad' };
  }

  showTyping(false);
  addMsg('bot', res.text);
  speak(res.text);
  if (res.colorId) blob.setColorById(res.colorId);
  if (res.effect) {
    const fxLabels = { burst:'💥 Burst!', comet:'☄️ Komet!', orbit:'🪐 Orbit!', swirl:'🌀 Swirl!', exclaim:'❗ Exclaim!', notify:'🔔 Notify!', peekaboo:'🫣 Peek-a-boo!' };
    showBubble(fxLabels[res.effect] || '⚡ Power!', 2200);
    console.info('[blub] triggerState', res.effect);
    if (res.effect === 'peekaboo') {
      blob.triggerPeekaboo();
    } else {
      blob.triggerState(res.effect);
    }
  } else {
    applyState(res.state);
  }

  if (!('speechSynthesis' in window) || muted) {
    const dur = Math.min(6000, Math.max(1200, res.text.length * 45));
    blob.talk(true);
    setTimeout(() => blob.talk(false), dur);
  }

  busy = false;
  idleAnims.resume();
  els.input.focus({ preventScroll: true });
}

const idlePhrases = [
  'Psst… colek aku kalau bosen.',
  `${PERSONA} ${PERSONA}~`,
  'Kamu keliatan serius banget… istirahat bentar yuk.',
  'Aku ngantuk atau kamu aja yang bikin ngantuk? 😴',
  'Halo? Masih di sana?',
  'Eh, tahu nggak kalau aku bisa inget nama kamu?'
];

function scheduleIdle() {
  setTimeout(() => {
    if (!busy && blob.getState() === 'idle') {
      showBubble(idlePhrases[Math.floor(Math.random() * idlePhrases.length)]);
    }
    scheduleIdle();
  }, 9000 + Math.random() * 15000);
}

/* ── Auto-sleep: blob falls asleep after 30s of no interaction ── */
let sleepTimer = null;
let isSleeping = false;
const SLEEP_DELAY = 30000; // 30 seconds

function resetSleepTimer() {
  if (sleepTimer) clearTimeout(sleepTimer);
  if (isSleeping) wakeUp();
  sleepTimer = setTimeout(() => {
    if (!busy && blob.getState() === 'idle') fallAsleep();
  }, SLEEP_DELAY);
}

function fallAsleep() {
  isSleeping = true;
  blob.setState('sleepy');
  const snore = document.getElementById('snore');
  if (snore) snore.classList.remove('hidden');
  showBubble('Zzz… 😴', 3000);
}

function wakeUp() {
  isSleeping = false;
  const snore = document.getElementById('snore');
  if (snore) snore.classList.add('hidden');
  if (blob.getState() === 'sleepy') blob.setState('idle');
}

// Reset sleep timer on any user interaction
['pointerdown', 'pointermove', 'keydown', 'click'].forEach(ev => {
  document.addEventListener(ev, resetSleepTimer, { passive: true });
});

function initPointer() {
  const move = (e) => {
    blob.setPointer(e.clientX / innerWidth, e.clientY / innerHeight);
    idleAnims.markUserActive();
  };
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerdown', move, { passive: true });

  function setupTilt() {
    let lastTilt = 0;
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma === null && e.beta === null) return;
      const x = e.gamma || 0;
      const y = e.beta || 0;
      const nx = Math.max(0, Math.min(1, (x + 45) / 90));
      const ny = Math.max(0, Math.min(1, (y + 45) / 90));
      const now = Date.now();
      if (now - lastTilt < 40) return;
      lastTilt = now;
      blob.setPointer(nx, ny);
      idleAnims.markUserActive();
    }, { passive: true });
  }

  if (window.DeviceOrientationEvent) {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const btn = document.createElement('button');
      btn.className = 'tilt-permission-btn';
      btn.textContent = '📱';
      btn.title = 'Aktifkan tilt HP';
      btn.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:99;width:44px;height:44px;border-radius:50%;border:none;background:var(--accent);color:#fff;font-size:1.3rem;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3);';
      btn.addEventListener('click', async () => {
        try {
          const perm = await DeviceOrientationEvent.requestPermission();
          if (perm === 'granted') { setupTilt(); toast('Tilt aktif! Putar HP buat gerakin mata blob.'); }
        } catch {}
        btn.remove();
      });
      document.body.appendChild(btn);
    } else {
      setupTilt();
    }
  }
}

function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.lang = 'id-ID';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (e) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) showBubble('🎤 ' + interim, 4000);
    if (final) send(final);
  };
  recognition.onend = () => {
    els.btnMic.classList.remove('on');
    if (blob.getState() === 'listen') blob.setState('idle');
    // Restore main blob from mic shape
    blob.exitMicMode();
    voiceActive = false;
  };
  recognition.onerror = () => {};
  els.btnMic.classList.remove('hidden');
  els.btnMic.addEventListener('click', () => {
    try {
      recognition.start();
      els.btnMic.classList.add('on');
      blob.setState('listen');
      showBubble('Aku mendengarkan… 🎤');
    } catch {}
  });
}

function initSound() {
  const render = () => {
    els.btnSound.classList.toggle('on', !muted);
    els.btnSound.style.opacity = muted ? '0.45' : '1';
  };
  render();
  els.btnSound.addEventListener('click', () => {
    muted = !muted;
    store.set('blub.muted', muted ? '1' : '0');
    if (muted) speechSynthesis?.cancel();
    render();
    toast(muted ? 'Suara dimatikan' : 'Suara dinyalakan');
  });
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = pickVoice;
    pickVoice();
  }
}

function initTheme() {
  const saved = store.get('blub.theme', '');
  if (saved) document.documentElement.dataset.theme = saved;
}

function initSettings() {
  const defaults = { url: '', key: '', model: '', sys: '' };
  const open = () => {
    const cfg = { ...defaults, ...JSON.parse(store.get('blub.settings', '{}')) };
    els.setUrl.value = cfg.url || '';
    els.setKey.value = cfg.key || '';
    els.setModel.value = cfg.model || '';
    els.setSys.value = cfg.sys || '';
    els.settingsDlg.showModal();
  };
  els.btnSettings.addEventListener('click', open);
  els.setSave.addEventListener('click', () => {
    store.set(
      'blub.settings',
      JSON.stringify({
        url: els.setUrl.value.trim(),
        key: els.setKey.value.trim(),
        model: els.setModel.value.trim(),
        sys: els.setSys.value.trim()
      })
    );
    els.settingsDlg.close();
    toast('Pengaturan disimpan');
  });
  els.setReset.addEventListener('click', () => {
    brain.clearAll();
    els.log.innerHTML = '';
    els.settingsDlg.close();
    toast(`Memori ${PERSONA} dihapus`);
    greet(true);
  });
  els.btnShape.addEventListener('click', () => {
    els.settingsDlg.close();
    openOnboarding(0);
  });
}

function initInstall() {
  const isStandalone =
    matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone) els.btnInstall.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    els.btnInstall.classList.add('hidden');
    deferredPrompt = null;
    toast(`${PERSONA} terpasang! 🎉`);
  });

  const how = `
        <p class="hint" style="margin-bottom:8px">${PERSONA} bisa dipasang seperti aplikasi biasa — tanpa app store.</p>
    <div class="install-step"><b>Android / Chrome:</b><span>tekan menu ⋮ lalu "Instal aplikasi".</span></div>
    <div class="install-step"><b>iPhone / Safari:</b><span>tekan tombol Share ⬆️ lalu "Add to Home Screen".</span></div>
    <div class="install-step"><b>Windows / Mac:</b><span>klik ikon install ⊕ di address bar browser.</span></div>`;
  els.installHow.innerHTML = how;

  els.btnInstall.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      els.btnInstall.classList.add('hidden');
    } else {
      els.installDlg.showModal();
    }
  });
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
}

function restoreChat() {
  try {
    const hist = JSON.parse(localStorage.getItem('blub.history') || '[]').slice(-20);
    for (const m of hist) addMsg(m.role === 'user' ? 'user' : 'bot', m.content);
  } catch {}
}

function greet(forceNew = false) {
  if (!isOnboarded()) return;
  const visited = store.get('blub.visited', '') === String(new Date().toDateString());
  const mem = brain.memory();
  const namePart = mem.name ? `, ${mem.name}` : '';
  if (forceNew || !visited) {
    setTimeout(() => {
      const msg = forceNew
        ? `Ingatan bersih! Aku ${PERSONA}. Siapa nama kamu?`
        : mem.name
          ? `Halo lagi${namePart}! Kangen nggak sama blob hitam yang satu ini?`
          : `Hai! Aku ${PERSONA} 🫧 Coba colek badanku, atau ketik sesuatu di bawah!`;
      addMsg('bot', msg);
      showBubble(mem.name ? 'Balik lagi!' : 'Halo!');
      blob.setState('happy', { holdMs: 2000 });
    }, 700);
    store.set('blub.visited', String(new Date().toDateString()));
  } else {
    showBubble(`${PERSONA}~ kamu balik!`);
  }
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

const isOnboarded = () => store.get('blub.onboarded2', '0') === '1';

const obLabels = ['Mulai', 'Lanjut', 'Mulai Ngobrol! 🎉'];
let obStep = 0;

function obRender() {
  els.obDlg.querySelectorAll('.ob-step').forEach((s) => {
    s.hidden = Number(s.dataset.step) !== obStep;
  });
  els.obDots.innerHTML = obLabels.map((_, i) => `<i class="${i === obStep ? 'on' : ''}"></i>`).join('');
  els.obNext.textContent = obLabels[obStep];
  els.obSkip.style.visibility = obStep === obLabels.length - 1 ? 'hidden' : 'visible';
  if (obStep === 1) setTimeout(() => els.obName.focus(), 80);
}

function obBuildShapeGrid() {
  const current = blob.getShape();
  els.shapeGrid.innerHTML = '';
  for (const { id, label } of SHAPES_INFO) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shape-card' + (id === current ? ' sel' : '');
    btn.innerHTML = `<svg viewBox="-75 -75 150 150"><path d="${shapePreviewPath(id)}"/></svg><span>${label}</span>`;
    btn.addEventListener('click', () => {
      els.shapeGrid.querySelectorAll('.shape-card').forEach((c) => c.classList.remove('sel'));
      btn.classList.add('sel');
      blob.setShape(id);
      playPop();
      store.set('blub.shape', id);
    });
    els.shapeGrid.appendChild(btn);
  }
}

function obFinish() {
  const name = els.obName.value.trim();
  if (name) brain.setName(name);
  store.set('blub.onboarded2', '1');
  els.obDlg.close();
  const mem = brain.memory();
  setTimeout(() => {
    addMsg(
      'bot',
      name
        ? `Siap, ${name}! Coba colek badanku, atau ketik "meledak!" buat lihat super power-ku!`
        : 'Siap! Coba colek badanku, atau ketik "meledak!" buat lihat super power-ku.'
    );
    showBubble(mem.name ? `Halo, ${mem.name}!` : `${PERSONA} ${PERSONA}~`);
    blob.setState('excite', { holdMs: 1800 });
  }, 350);
}

function openOnboarding(atStep = 0) {
  obStep = Math.min(Math.max(0, atStep), obLabels.length - 1);
  obBuildShapeGrid();
  obRender();
  els.obDlg.showModal();
}

function initOnboarding() {
  els.obDots.innerHTML = obLabels.map(() => '<i></i>').join('');
  els.obNext.addEventListener('click', () => {
    if (obStep < obLabels.length - 1) {
      obStep++;
      obRender();
    } else {
      obFinish();
    }
  });
  els.obSkip.addEventListener('click', () => {
    store.set('blub.onboarded2', '1');
    els.obDlg.close();
  });
  document.querySelectorAll('[data-persona]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setPersona(btn.dataset.persona);
      store.set('blub.persona', btn.dataset.persona);
      applyPersonaName();
      playPop();
    });
  });
  els.obName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      obStep = 2;
      obRender();
    }
  });
  if (!isOnboarded()) {
    setTimeout(() => openOnboarding(0), 500);
  }
  els.btnShapes.addEventListener('click', () => {
    if (els.obDlg.open) return;
    openOnboarding(0);
  });
}

const blob = new BlobCharacter(els.svg, {
  shape: store.get('blub.shape', 'cercle'),
  onPokeSound: playPop,
  onQuip: () => {
    if (Math.random() < 0.7) showBubble(brain.randomQuip(), 1800);
  }
});

const idleAnims = startIdleAnimations(els.svg, {
  onBubble: (text, ms) => showBubble(text, ms)
});

const musicDancer = createMusicDancer(els.svg, blob);
document.getElementById('musicMic')?.addEventListener('click', async () => {
  const ok = await musicDancer.startFromMic();
  document.getElementById('musicStatus').textContent = ok ? '🎶 Mendengarkan musik... Blob menari!' : '❌ Gagal akses mic. Coba lagi.';
  if (ok) idleAnims.stop();
});
document.getElementById('musicStop')?.addEventListener('click', () => {
  musicDancer.stop();
  document.getElementById('musicStatus').textContent = 'Blob menari mengikuti irama musik!';
  idleAnims.resume();
});

let menuOpen = false;

function toggleRadialMenu() {
  menuOpen = !menuOpen;
  els.radialMenu.classList.toggle('hidden', !menuOpen);
  if (menuOpen) radialRot = 0; // reset rotation on open
}

function closeRadialMenu() {
  menuOpen = false;
  els.radialMenu.classList.add('hidden');
}

/* ── Radial menu swipe-to-rotate ── */
let radialRot = 0;
let radialDragging = false;
let radialStartAngle = 0;
let radialStartRot = 0;

function getRadialCenter() {
  const rect = els.blobLauncher.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function applyRadialRot() {
  els.radialMenu.style.setProperty('--rot', radialRot.toFixed(1) + 'deg');
}

if (els.radialMenu) {
  const dragLayer = els.radialMenu.querySelector('.rm-drag');
  const onDown = (e) => {
    radialDragging = true;
    const c = getRadialCenter();
    const pt = e.touches ? e.touches[0] : e;
    radialStartAngle = Math.atan2(pt.clientY - c.y, pt.clientX - c.x);
    radialStartRot = radialRot;
    els.radialMenu.style.transition = 'none';
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!radialDragging) return;
    const c = getRadialCenter();
    const pt = e.touches ? e.touches[0] : e;
    const angle = Math.atan2(pt.clientY - c.y, pt.clientX - c.x);
    let delta = (angle - radialStartAngle) * 180 / Math.PI;
    radialRot = radialStartRot + delta;
    applyRadialRot();
    e.preventDefault();
  };
  const onUp = () => {
    if (!radialDragging) return;
    radialDragging = false;
    // Snap to nearest 45° for clean alignment
    const snapped = Math.round(radialRot / 45) * 45;
    radialRot = snapped;
    els.radialMenu.style.transition = '--rot 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
    applyRadialRot();
    setTimeout(() => { els.radialMenu.style.transition = ''; }, 350);
  };

  // Listen on drag layer (transparent, covers full screen)
  if (dragLayer) {
    dragLayer.addEventListener('pointerdown', onDown);
    dragLayer.addEventListener('touchstart', onDown, { passive: false });
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
}

function openPanel(id) {
  closeRadialMenu();
  document.querySelectorAll('.feature-panel').forEach((p) => (p.hidden = true));
  const panel = document.getElementById(id);
  if (panel) panel.hidden = false;
}

function closePanel(id) {
  const panel = document.getElementById(id);
  if (panel) panel.hidden = true;
}

function closeAllPanels() {
  document.querySelectorAll('.feature-panel').forEach((p) => (p.hidden = true));
}

// Swipe-to-rotate + Drag-and-bounce physics
// - Swipe (rotate in place) = blob spins, springs back
// - Hold & drag (move far) = blob follows finger, release = billiard bounce
// - Tap = poke
let dragStartAngle = null;
let currentRotation = 0;
let dragStartX = 0, dragStartY = 0;
let hasMoved = false;
let blobOffsetX = 0, blobOffsetY = 0; // translate from center
let lastMoveX = 0, lastMoveY = 0, lastMoveTime = 0;
let velX = 0, velY = 0; // velocity for physics
let physicsRAF = null;

function stopPhysics() {
  if (physicsRAF) { cancelAnimationFrame(physicsRAF); physicsRAF = null; }
}

function applyBlobTransform() {
  els.svg.style.transform =
    `translate(${blobOffsetX.toFixed(1)}px, ${blobOffsetY.toFixed(1)}px) rotate(${currentRotation.toFixed(1)}deg)`;
}

function startPhysics() {
  stopPhysics();
  const stageWrap = els.svg.closest('.stage-wrap') || document.querySelector('.stage-wrap');
  if (!stageWrap) return;
  const swRect = stageWrap.getBoundingClientRect();
  const svgRect = els.svg.getBoundingClientRect();
  const blobR = svgRect.width / 2;
  const stageEl = document.getElementById('stage');
  const stageRect = stageEl.getBoundingClientRect();
  const centerX = stageRect.left + stageRect.width / 2;
  const centerY = stageRect.top + stageRect.height / 2;
  const maxX = (swRect.width / 2) - blobR * 0.6;
  const maxY = (swRect.height / 2) - blobR * 0.6;
  const BOUNCE = 0.72;
  const FRICTION = 0.985;
  const SPRING = 0.04;
  const STOP_VEL = 8;
  let bounceCount = 0;

  let lastT = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 16.67, 2);
    lastT = now;

    blobOffsetX += velX * dt;
    blobOffsetY += velY * dt;
    currentRotation += velX * dt * 0.3;

    // Bounce off walls — count bounces
    if (blobOffsetX > maxX) { blobOffsetX = maxX; velX = -Math.abs(velX) * BOUNCE; playPop(); bounceCount++; }
    if (blobOffsetX < -maxX) { blobOffsetX = -maxX; velX = Math.abs(velX) * BOUNCE; playPop(); bounceCount++; }
    if (blobOffsetY > maxY) { blobOffsetY = maxY; velY = -Math.abs(velY) * BOUNCE; playPop(); bounceCount++; }
    if (blobOffsetY < -maxY) { blobOffsetY = -maxY; velY = Math.abs(velY) * BOUNCE; playPop(); bounceCount++; }

    velX *= Math.pow(FRICTION, dt);
    velY *= Math.pow(FRICTION, dt);

    const speed = Math.hypot(velX, velY);
    if (speed < STOP_VEL) {
      blobOffsetX *= Math.pow(1 - SPRING, dt);
      blobOffsetY *= Math.pow(1 - SPRING, dt);
      velX *= 0.9;
      velY *= 0.9;
    }

    applyBlobTransform();

    if (speed < 1 && Math.hypot(blobOffsetX, blobOffsetY) < 1) {
      blobOffsetX = 0; blobOffsetY = 0;
      currentRotation = Math.round(currentRotation / 360) * 360;
      applyBlobTransform();
      els.svg.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      const target = Math.round(currentRotation / 360) * 360;
      els.svg.style.transform = `translate(0,0) rotate(${target}deg)`;
      setTimeout(() => {
        els.svg.style.transition = '';
        currentRotation = target % 360;
      }, 420);
      stopPhysics();
      // Dizzy effect if bounced at least 2 times
      if (bounceCount >= 2) {
        setTimeout(() => blob.playDizzy(2000), 100);
      }
      return;
    }
    physicsRAF = requestAnimationFrame(tick);
  };
  physicsRAF = requestAnimationFrame(tick);
}

els.svg.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  stopPhysics();
  els.svg.style.transition = 'none';
  hasMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  lastMoveX = e.clientX;
  lastMoveY = e.clientY;
  lastMoveTime = performance.now();
  velX = 0; velY = 0;
  const rect = els.svg.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  dragStartAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
  els.svg.setPointerCapture(e.pointerId);
});

els.svg.addEventListener('pointermove', (e) => {
  if (dragStartAngle === null) return;
  const rect = els.svg.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // Dial/knob rotation
  const newAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
  let delta = newAngle - dragStartAngle;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  currentRotation += delta * 180 / Math.PI;
  dragStartAngle = newAngle;

  // Track translate: offset from original drag start
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  blobOffsetX = dx;
  blobOffsetY = dy;

  // Track velocity
  const now = performance.now();
  const dtMs = now - lastMoveTime;
  if (dtMs > 0) {
    velX = (e.clientX - lastMoveX) / dtMs * 16.67;
    velY = (e.clientY - lastMoveY) / dtMs * 16.67;
  }
  lastMoveX = e.clientX;
  lastMoveY = e.clientY;
  lastMoveTime = now;

  const dist = Math.hypot(dx, dy);
  if (dist > 6) hasMoved = true;

  applyBlobTransform();
});

els.svg.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  if (!hasMoved) {
    // Tap = poke
    blobOffsetX = 0; blobOffsetY = 0;
    applyBlobTransform();
    blob.poke();
    playPop();
  } else {
    const dragDist = Math.hypot(blobOffsetX, blobOffsetY);
    if (dragDist > 20) {
      // Slingshot: velocity = drag distance * direction * power multiplier
      // Further drag = stronger launch
      const POWER = 0.15; // multiplier for slingshot force
      const angle = Math.atan2(blobOffsetY, blobOffsetX);
      const launchSpeed = dragDist * POWER;
      velX = Math.cos(angle) * launchSpeed;
      velY = Math.sin(angle) * launchSpeed;
      // Cap max velocity
      const maxV = 60;
      const vMag = Math.hypot(velX, velY);
      if (vMag > maxV) { velX = velX / vMag * maxV; velY = velY / vMag * maxV; }
      // Launch physics with bounce
      startPhysics();
    } else {
      // Swipe-rotate mode: spring back rotation to nearest 360
      blobOffsetX = 0; blobOffsetY = 0;
      const target = Math.round(currentRotation / 360) * 360;
      els.svg.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
      els.svg.style.transform = `translate(0,0) rotate(${target}deg)`;
      setTimeout(() => {
        els.svg.style.transition = '';
        currentRotation = target % 360;
        if (currentRotation > 180) currentRotation -= 360;
        if (currentRotation < -180) currentRotation += 360;
      }, 520);
    }
  }
  dragStartAngle = null;
});

els.svg.addEventListener('pointercancel', () => {
  stopPhysics();
  els.svg.style.transition = 'transform 0.3s ease';
  els.svg.style.transform = 'rotate(0deg)';
  setTimeout(() => { els.svg.style.transition = ''; }, 320);
  currentRotation = 0;
  blobOffsetX = 0; blobOffsetY = 0;
  velX = 0; velY = 0;
  dragStartAngle = null;
});

// Blob launcher icon — opens radial menu, long-press = voice, tap mic = stop
const blobLauncher = $('#blobLauncher');
const launcherBlob = blobLauncher ? blobLauncher.querySelector('.launcher-blob') : null;
const launcherMic = blobLauncher ? blobLauncher.querySelector('.launcher-mic') : null;
let voiceActive = false;

function setLauncherMode(mode) {
  if (!launcherBlob || !launcherMic) return;
  if (mode === 'mic') {
    launcherBlob.style.display = 'none';
    launcherMic.style.display = 'block';
    blobLauncher.classList.add('voice-active');
    voiceActive = true;
  } else {
    launcherBlob.style.display = 'block';
    launcherMic.style.display = 'none';
    blobLauncher.classList.remove('voice-active');
    voiceActive = false;
  }
}

function stopVoice() {
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
  els.btnMic.classList.remove('on');
  if (blob.getState() === 'listen') blob.setState('idle');
  blob.exitMicMode();
  voiceActive = false;
  showBubble('Oke! 👍', 1500);
}

if (blobLauncher) {
  let pressTimer = null;
  let longPressed = false;
  let justActivated = false;

  const startPress = () => {
    // If already in voice mode, don't start long-press timer
    if (voiceActive) return;
    longPressed = false;
    justActivated = false;
    blobLauncher.classList.add('holding');
    pressTimer = setTimeout(() => {
      longPressed = true;
      justActivated = true;
      blobLauncher.classList.remove('holding');
      // Morph the main blob into a mic (instead of swapping the launcher icon)
      blob.enterMicMode();
      voiceActive = true;
      // Activate voice
      if (recognition) {
        try {
          recognition.start();
          els.btnMic.classList.add('on');
          blob.setState('listen');
          showBubble('Aku mendengarkan… 🎤');
        } catch {}
      } else {
        showBubble('Voice tidak didukung di browser ini 😅');
        setTimeout(() => { blob.exitMicMode(); voiceActive = false; }, 1500);
      }
      // justActivated is cleared in endPress, not by a timer —
      // so the pointerup after long-press is always ignored no matter
      // how long the user keeps holding past the 2s mark.
    }, 2000);
  };

  const endPress = () => {
    blobLauncher.classList.remove('holding');
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    // Ignore pointerup that comes right after long-press activation
    if (justActivated) { justActivated = false; return; }
    if (voiceActive) {
      // Tap on mic icon = stop voice
      stopVoice();
      return;
    }
    if (!longPressed) {
      // Short tap = open radial menu
      toggleRadialMenu();
    }
  };

  blobLauncher.addEventListener('pointerdown', (e) => { e.preventDefault(); startPress(); });
  blobLauncher.addEventListener('pointerup', endPress);
  blobLauncher.addEventListener('pointercancel', () => {
    blobLauncher.classList.remove('holding');
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  });
  blobLauncher.addEventListener('pointerleave', () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; blobLauncher.classList.remove('holding'); }
  });
}

els.radialMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.rm-btn');
  if (!btn) return;
  const f = btn.dataset.feature;
  if (f === 'chat') {
    closeRadialMenu();
    const sb = els.chatSidebar;
    const visible = !sb.classList.contains('hidden');
    if (visible) {
      sb.classList.add('hidden');
    } else {
      sb.classList.remove('hidden');
      setTimeout(() => els.input.focus(), 100);
    }
  }
  else if (f === 'pomodoro') { closeRadialMenu(); startBlobTimer(); }
  else if (f === 'play') openPanel('panelPlay');
  else if (f === 'entertain') openPanel('panelEntertain');
  else if (f === 'powers') { closeRadialMenu(); els.powersRadial.classList.remove('hidden'); }
  else if (f === 'idletest') { closeRadialMenu(); els.idleRadial.classList.remove('hidden'); }
  else if (f === 'settings') { closeRadialMenu(); els.settingsDlg.showModal(); }
  else if (f === 'music') { closeRadialMenu(); openPanel('panelMusic'); }
});

document.querySelectorAll('.btn-back').forEach((btn) => {
  btn.addEventListener('click', () => closePanel(btn.dataset.close));
});

els.chatClose.addEventListener('click', () => {
  els.chatSidebar.classList.add('hidden');
});

// Stage swipe-to-spin: swipe outside blob = 2.5D roll, faster swipe = faster spin
let stageSwipeActive = false;
let stageSwipeLastX = 0, stageSwipeLastY = 0;
let stageSwipeLastTime = 0;
let spinX = 0, spinY = 0; // 2.5D rotation angles

function applyBlobTransform3D() {
  els.svg.style.transform =
    `translate(${blobOffsetX.toFixed(1)}px, ${blobOffsetY.toFixed(1)}px) ` +
    `rotateY(${spinY.toFixed(1)}deg) rotateX(${(-spinX).toFixed(1)}deg) rotateZ(${currentRotation.toFixed(1)}deg)`;
}

els.stage.addEventListener('pointerdown', (e) => {
  // Only trigger if pointer starts OUTSIDE the blob SVG
  if (e.target === els.svg || els.svg.contains(e.target)) return;
  stageSwipeActive = true;
  stopPhysics();
  els.svg.style.transition = 'none';
  stageSwipeLastX = e.clientX;
  stageSwipeLastY = e.clientY;
  stageSwipeLastTime = performance.now();
  els.stage.setPointerCapture(e.pointerId);
});

els.stage.addEventListener('pointermove', (e) => {
  if (!stageSwipeActive) return;
  const now = performance.now();
  const dt = Math.max(now - stageSwipeLastTime, 1); // ms
  const dx = e.clientX - stageSwipeLastX;
  const dy = e.clientY - stageSwipeLastY;

  // Velocity: pixels per ms
  const speed = Math.hypot(dx, dy) / dt;
  // Faster swipe = more rotation. dx drives rotateY, dy drives rotateX.
  const power = 0.5 + speed * 1.2;
  spinY += dx * power;   // horizontal swipe = roll left/right (rotateY)
  spinX += dy * power;   // vertical swipe = roll up/down (rotateX)

  stageSwipeLastX = e.clientX;
  stageSwipeLastY = e.clientY;
  stageSwipeLastTime = now;
  applyBlobTransform3D();
});

els.stage.addEventListener('pointerup', () => {
  if (!stageSwipeActive) return;
  stageSwipeActive = false;
  // Spring back to 0
  els.svg.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
  spinX = 0; spinY = 0;
  currentRotation = Math.round(currentRotation / 360) * 360;
  els.svg.style.transform = `translate(0,0) rotateY(0deg) rotateX(0deg) rotateZ(${currentRotation}deg)`;
  setTimeout(() => {
    els.svg.style.transition = '';
    currentRotation = currentRotation % 360;
    if (currentRotation > 180) currentRotation -= 360;
    if (currentRotation < -180) currentRotation += 360;
  }, 620);
});

els.stage.addEventListener('pointercancel', () => {
  stageSwipeActive = false;
});

els.stage.addEventListener('click', (e) => {
  if (menuOpen && !e.target.closest('.rm-btn') && e.target !== els.svg) {
    closeRadialMenu();
  }
  const fromMainRadial = e.target.closest('.rm-btn');
  if (!els.idleRadial.classList.contains('hidden') && !fromMainRadial && !e.target.closest('.srm-btn') && !e.target.closest('.srm-back') && e.target !== els.svg) {
    els.idleRadial.classList.add('hidden');
  }
  if (!els.powersRadial.classList.contains('hidden') && !fromMainRadial && !e.target.closest('.srm-btn') && !e.target.closest('.srm-back') && e.target !== els.svg) {
    els.powersRadial.classList.add('hidden');
  }
});

// Document-level listener: close sub-radials when clicking outside (they're position:fixed now)
document.addEventListener('click', (e) => {
  if (e.target.closest('.srm-btn') || e.target.closest('.srm-back') || e.target.closest('.rm-btn') || e.target === els.svg || e.target.closest('#blobLauncher')) return;
  if (!els.idleRadial.classList.contains('hidden')) els.idleRadial.classList.add('hidden');
  if (!els.powersRadial.classList.contains('hidden')) els.powersRadial.classList.add('hidden');
  if (menuOpen) closeRadialMenu();
});

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  send(els.input.value);
});
els.chips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) send(chip.textContent);
});

/* ── Pomodoro Timer ── */
let pomoInterval = null;
let pomoTotal = 25 * 60;
let pomoLeft = pomoTotal;
let pomoRunning = false;
let pomoSessions = 0;
let pomoIsBreak = false;

function pomoTick() {
  if (pomoLeft <= 0) {
    clearInterval(pomoInterval);
    pomoRunning = false;
    if (!pomoIsBreak) {
      pomoSessions++;
      els.pomoCount.textContent = pomoSessions;
      pomoIsBreak = true;
      pomoLeft = pomoSessions % 4 === 0 ? 30 * 60 : 5 * 60;
      els.pomoLabel.textContent = 'Rehat ☕';
      showBubble('Waktu rehat! ☕', 4000);
      blob.triggerState('exclaim');
    } else {
      pomoIsBreak = false;
      pomoLeft = 25 * 60;
      els.pomoLabel.textContent = 'Siap mulai';
      showBubble('Rehat selesai! Siap lanjut?', 3000);
      blob.triggerState('notify');
    }
    els.pomoStart.textContent = 'Mulai';
    els.pomoReset.hidden = false;
    pomoRender();
    return;
  }
  pomoLeft--;
  pomoRender();
}

function pomoRender() {
  const m = Math.floor(pomoLeft / 60);
  const s = pomoLeft % 60;
  els.pomoTime.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

els.pomoStart.addEventListener('click', () => {
  if (pomoRunning) {
    clearInterval(pomoInterval);
    pomoRunning = false;
    els.pomoStart.textContent = 'Lanjut';
    els.pomoLabel.textContent = 'Dijeda';
  } else {
    pomoRunning = true;
    els.pomoStart.textContent = 'Jeda';
    els.pomoLabel.textContent = pomoIsBreak ? 'Rehat... ☕' : 'Fokus! 💪';
    pomoInterval = setInterval(pomoTick, 1000);
    if (!pomoIsBreak) blob.setState('excite', { holdMs: 1200 });
  }
});

els.pomoReset.addEventListener('click', () => {
  clearInterval(pomoInterval);
  pomoRunning = false;
  pomoIsBreak = false;
  pomoLeft = 25 * 60;
  pomoRender();
  els.pomoStart.textContent = 'Mulai';
  els.pomoLabel.textContent = 'Siap mulai';
  els.pomoReset.hidden = true;
});

/* ── Blob Timer Mode (blob morphs into clock) ── */
let blobTimerRunning = false;
let blobTimerInterval = null;
let blobTimerLeft = 25 * 60;
let blobTimerTotal = 25 * 60;
let blobTimerSessions = 0;
let blobTimerIsBreak = false;

function blobTimerRender() {
  const m = Math.floor(blobTimerLeft / 60);
  const s = blobTimerLeft % 60;
  const txt = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  // Update dot matrix on blob (the blob IS the timer display)
  blob.updateTimerDisplay(txt);
}

function blobTimerTick() {
  if (blobTimerLeft <= 0) {
    clearInterval(blobTimerInterval);
    blobTimerRunning = false;
    if (!blobTimerIsBreak) {
      blobTimerSessions++;
      els.blobTimerCount.textContent = blobTimerSessions;
      blobTimerIsBreak = true;
      blobTimerLeft = blobTimerSessions % 4 === 0 ? 30 * 60 : 5 * 60;
      blobTimerTotal = blobTimerLeft;
      els.blobTimerLabel.textContent = 'Rehat ☕';
      showBubble('Waktu rehat! ☕', 4000);
    } else {
      blobTimerIsBreak = false;
      blobTimerLeft = 25 * 60;
      blobTimerTotal = blobTimerLeft;
      els.blobTimerLabel.textContent = 'Siap mulai';
      showBubble('Rehat selesai! Siap lanjut?', 3000);
    }
    els.blobTimerStart.textContent = 'Mulai';
    els.blobTimerReset.hidden = false;
    blobTimerRender();
    return;
  }
  blobTimerLeft--;
  blobTimerRender();
}

function startBlobTimer() {
  if (blob._timerMode) return; // already in timer mode
  idleAnims.stop();
  blob.enterTimerMode();
  els.blobTimerOverlay.classList.remove('hidden');
  // Reset state
  blobTimerLeft = 25 * 60;
  blobTimerTotal = 25 * 60;
  blobTimerRunning = false;
  blobTimerIsBreak = false;
  els.blobTimerStart.textContent = 'Mulai';
  els.blobTimerLabel.textContent = 'Siap mulai';
  els.blobTimerReset.hidden = true;
  blobTimerRender();
}

function closeBlobTimer() {
  clearInterval(blobTimerInterval);
  blobTimerRunning = false;
  els.blobTimerOverlay.classList.add('hidden');
  blob.exitTimerMode();
  idleAnims.resume();
}

els.blobTimerStart.addEventListener('click', () => {
  if (blobTimerRunning) {
    clearInterval(blobTimerInterval);
    blobTimerRunning = false;
    els.blobTimerStart.textContent = 'Lanjut';
    els.blobTimerLabel.textContent = 'Dijeda';
  } else {
    blobTimerRunning = true;
    els.blobTimerStart.textContent = 'Jeda';
    els.blobTimerLabel.textContent = blobTimerIsBreak ? 'Rehat... ☕' : 'Fokus! 💪';
    blobTimerInterval = setInterval(blobTimerTick, 1000);
  }
});

els.blobTimerReset.addEventListener('click', () => {
  clearInterval(blobTimerInterval);
  blobTimerRunning = false;
  blobTimerIsBreak = false;
  blobTimerLeft = 25 * 60;
  blobTimerTotal = 25 * 60;
  blobTimerRender();
  els.blobTimerStart.textContent = 'Mulai';
  els.blobTimerLabel.textContent = 'Siap mulai';
  els.blobTimerReset.hidden = true;
});

els.blobTimerClose.addEventListener('click', closeBlobTimer);

/* ── Play Panel ── */
document.querySelectorAll('[data-poke]').forEach((btn) => {
  btn.addEventListener('click', () => { blob.poke(); playPop(); });
});
document.querySelectorAll('[data-color]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const map = { merah:'red', biru:'blue', hijau:'green', ungu:'purple', kuning:'yellow' };
    const id = map[btn.dataset.color] || btn.dataset.color;
    blob.setColorById(id);
    showBubble(`Warna ${btn.dataset.color}! ✨`, 2000);
    blob.triggerState('exclaim');
  });
});

/* ── Entertain Panel ── */
document.querySelectorAll('[data-ent]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const prompts = {
      joke: 'kasih joke yang lucu banget',
      motivasi: 'kasih motivasi semangat buat aku',
      fakta: 'ceritain fakta unik yang aku belum tahu',
      cerita: 'ceritain cerita pendek yang seru',
      puisi: 'buatin puisi pendek buat aku',
      tantangan: 'kasih tantangan seru buat aku'
    };
    const cmd = prompts[btn.dataset.ent] || btn.dataset.ent;
    setTimeout(() => send(cmd), 100);
  });
});

/* ── Powers Radial ── */
$('#powersRadialBack').addEventListener('click', () => {
  els.powersRadial.classList.add('hidden');
});

/* ── Comet + Meteor Shower Effect ── */
function spawnCometAndMeteors() {
  const fx = document.getElementById('fxLayer');
  if (!fx) return;

  // Delay until blob reaches top-right (~35% of 2.8s = 980ms)
  const SPAWN_DELAY = 980;

  // Main comet: large, from top-right to bottom-left
  setTimeout(() => {
    const comet = document.createElement('div');
    comet.className = 'main-comet';
    fx.appendChild(comet);
    setTimeout(() => comet.remove(), 1500);
  }, SPAWN_DELAY);

  // Trailing small comets following same direction (start after main comet)
  const NUM_TRAIL = 4 + Math.floor(Math.random() * 3); // 4-6
  for (let i = 0; i < NUM_TRAIL; i++) {
    setTimeout(() => {
      const t = document.createElement('div');
      t.className = 'main-comet-trail';
      const size = 4 + Math.random() * 6;
      t.style.width = size + 'px';
      t.style.height = size + 'px';
      t.style.animationDuration = (1.0 + Math.random() * 0.4) + 's';
      fx.appendChild(t);
      setTimeout(() => t.remove(), 1500);
    }, SPAWN_DELAY + 100 + i * 120);
  }

  // Meteor shower — small streaks, same direction, spread out (start after blob at top-right)
  const NUM_METEORS = 12 + Math.floor(Math.random() * 8); // 12-19
  for (let i = 0; i < NUM_METEORS; i++) {
    setTimeout(() => {
      const m = document.createElement('div');
      m.className = 'meteor-shower';
      const size = 3 + Math.random() * 5;
      m.style.width = size + 'px';
      m.style.height = size + 'px';
      m.style.right = (Math.random() * 50) + 'vw';
      m.style.top = (Math.random() * 40) + 'vh';
      m.style.animationDuration = (0.9 + Math.random() * 0.6) + 's';
      fx.appendChild(m);
      setTimeout(() => m.remove(), 1600);
    }, SPAWN_DELAY + 200 + i * 90 + Math.random() * 100);
  }
}

document.querySelectorAll('#powersRadial .srm-btn[data-fx]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const fx = btn.dataset.fx;
    blob.triggerState(fx);
    const labels = { burst:'💥 Burst!', comet:'☄️ Komet!', orbit:'🪐 Orbit!', swirl:'🌀 Swirl!', exclaim:'❗ Exclaim!', notify:'🔔 Notify!' };
    showBubble(labels[fx] || '⚡', 2200);

    // Komet power: spawn comet + meteor shower
    if (fx === 'comet') {
      spawnCometAndMeteors();
    }

    els.powersRadial.classList.add('hidden');
  });
});

/* ── Idle Radial Menu ── */
$('#idleRadialBack').addEventListener('click', () => {
  els.idleRadial.classList.add('hidden');
});

const PEEK_DIRS = ['idle-peekaboo-top', 'idle-peekaboo-bottom', 'idle-peekaboo-left', 'idle-peekaboo-right'];

const idleBadge = document.getElementById('idleBadge');
const IDLE_LABELS = {
  walk: 'Walk', run: 'Run', float: 'Float', bounce: 'Bounce', grow: 'Grow',
  shrink: 'Shrink', spin: 'Spin', drift: 'Drift', tilt: 'Tilt', jump: 'Jump',
  sneak: 'Sneak', wiggle: 'Wiggle', pulse: 'Pulse', wobble: 'Wobble', nod: 'Nod',
  flip: 'Flip', 'slide-l': 'Slide L', 'slide-r': 'Slide R', melt: 'Melt',
  peekaboo: 'Peek', knock: 'Knock',
};
function showIdleBadge(idleType) {
  if (!idleBadge) return;
  const label = IDLE_LABELS[idleType] || idleType;
  idleBadge.textContent = label;
  idleBadge.classList.remove('hidden');
  // restart animation
  idleBadge.style.animation = 'none';
  void idleBadge.offsetWidth;
  idleBadge.style.animation = '';
}
function hideIdleBadge() {
  if (idleBadge) idleBadge.classList.add('hidden');
}

document.querySelectorAll('#idleRadial .srm-btn[data-idle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    idleAnims.stop();
    const svg = els.svg;
    const idleType = btn.dataset.idle;

    if (idleType === 'melt') {
      svg.classList.remove('idle-anim');
      showBubble('Leleh... 💧', 2000);
      showIdleBadge('melt');
      blob.playMelt();
      setTimeout(() => { hideIdleBadge(); idleAnims.resume(); }, 10000);
      return;
    }

    if (idleType === 'knock') {
      svg.classList.remove('idle-anim');
      showBubble('Tok tok! 🚪', 3000);
      showIdleBadge('knock');
      svg.classList.add('idle-anim', 'idle-knock');
      const stage = els.stage;
      const knockTimes = [1680, 2200, 2720];
      knockTimes.forEach((t) => {
        setTimeout(() => {
          playKnock();
          stage.classList.add('knocking');
          const flash = document.createElement('div');
          flash.className = 'knock-flash';
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 250);
          setTimeout(() => stage.classList.remove('knocking'), 200);
        }, t);
      });
      svg.addEventListener('animationend', () => {
        svg.classList.remove('idle-anim', 'idle-knock');
        hideIdleBadge();
        idleAnims.resume();
      }, { once: true });
      return;
    }

    const cls = 'idle-' + idleType;
    const addClasses = [cls];
    if (cls === 'idle-peekaboo') addClasses.push(PEEK_DIRS[Math.floor(Math.random() * PEEK_DIRS.length)]);
    svg.classList.remove('idle-anim', ...PEEK_DIRS, 'idle-walk', 'idle-run', 'idle-float', 'idle-bounce', 'idle-grow', 'idle-shrink', 'idle-spin', 'idle-drift', 'idle-tilt', 'idle-jump', 'idle-sneak', 'idle-wiggle', 'idle-pulse', 'idle-wobble', 'idle-nod', 'idle-flip', 'idle-slide-l', 'idle-slide-r', 'idle-melt', 'idle-peekaboo', 'idle-knock');
    svg.classList.add('idle-anim', ...addClasses);
    showIdleBadge(idleType);
    svg.addEventListener('animationend', () => {
      const computed = getComputedStyle(svg).transform;
      svg.classList.remove('idle-anim', ...addClasses);
      hideIdleBadge();
      if (computed && computed !== 'none') {
        svg.style.transform = computed;
        svg.style.transition = 'transform 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            svg.style.transform = '';
            svg.addEventListener('transitionend', () => { svg.style.transition = ''; }, { once: true });
          });
        });
      }
      idleAnims.resume();
    }, { once: true });
  });
});

/* ── Keyboard ── */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (els.obDlg.open) return;
    const openPanel = document.querySelector('.feature-panel:not([hidden])');
    if (openPanel) { closeAllPanels(); return; }
    els.settingsDlg.close?.();
    els.installDlg.close?.();
    closeRadialMenu();
    els.idleRadial.classList.add('hidden');
    els.powersRadial.classList.add('hidden');
  }
});

const APP_VERSION = 'v31';

function applyPersonaName() {
  document.title = `${PERSONA} — Teman AI Interaktif`;
  document.querySelectorAll('.persona-name').forEach((n) => (n.textContent = PERSONA));
  const brand = document.querySelector('.brand-name');
  if (brand) brand.textContent = PERSONA.toLowerCase();
  document.querySelectorAll('[data-persona]').forEach((b) => {
    b.classList.toggle('sel', b.dataset.persona === PERSONA);
  });
}

function injectManifest() {
  const abs = (p) => new URL(p, location.href).href;
  const manifest = {
    name: `${PERSONA} — Teman AI Interaktif`,
    short_name: PERSONA,
    description: `Avatar blob animasi ${PERSONA} yang bisa ngobrol, punya super power, dan menemanimu. Bisa dipasang di HP maupun PC.`,
    lang: 'id',
    start_url: abs(location.pathname),
    scope: abs('./'),
    display: 'standalone',
    background_color: '#f6f4ef',
    theme_color: '#f6f4ef',
    icons: [
      { src: abs('icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: abs('icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: abs('icons/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  const link = document.querySelector('link[rel="manifest"]');
  if (link) link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
}

initPointer();
initSound();
initMic();
initTheme();
initSettings();
initInstall();
initOnboarding();
restoreChat();
greet();
registerSW();
scheduleIdle();

console.info('[blub] build', APP_VERSION, '| persona:', PERSONA);
applyPersonaName();
injectManifest();
// cache heal handled by inline script in index.html (runs before any cached JS)
setTimeout(() => toast(`${PERSONA} ${APP_VERSION} siap`), 400);
