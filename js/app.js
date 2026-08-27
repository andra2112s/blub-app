import { BlobCharacter, SHAPES_INFO, shapePreviewPath, startIdleAnimations } from './blubbot.js';
import { createBrain, PERSONA, setPersona } from './brain.js';
import { createMusicDancer } from './music.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  stage: $('#stage'),
  svg: $('#blobSvg'),
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
  setDeepseek: $('#setDeepseek'),
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
  chatClose: $('#chatClose')
};

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
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (e) => {
    const said = e.results[0][0].transcript;
    send(said);
  };
  recognition.onend = () => {
    els.btnMic.classList.remove('on');
    if (blob.getState() === 'listen') blob.setState('idle');
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
  const defaults = { url: 'https://ai.sumopod.com/v1', key: '', model: 'gpt-5-nano', sys: '', deepseekKey: '' };
  const open = () => {
    const cfg = { ...defaults, ...JSON.parse(store.get('blub.settings', '{}')) };
    els.setUrl.value = cfg.url || '';
    els.setKey.value = cfg.key || '';
    els.setModel.value = cfg.model || '';
    els.setSys.value = cfg.sys || '';
    els.setDeepseek.value = cfg.deepseekKey || '';
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
        sys: els.setSys.value.trim(),
        deepseekKey: els.setDeepseek.value.trim()
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
}

function closeRadialMenu() {
  menuOpen = false;
  els.radialMenu.classList.add('hidden');
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

let dragStartY = null;
let dragFired = false;
const DRAG_THRESHOLD = 30;

els.svg.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  dragFired = false;
  dragStartY = e.clientY;
  els.svg.setPointerCapture(e.pointerId);
});

els.svg.addEventListener('pointermove', (e) => {
  if (dragStartY === null) return;
  const dy = e.clientY - dragStartY;
  if (dy > 8 && !dragFired) {
    const pull = Math.min(dy / 120, 0.35);
    els.svg.style.transform = `translateY(${pull * 40}px) scaleY(${1 - pull * 0.12})`;
  }
  if (dy >= DRAG_THRESHOLD && !dragFired) {
    dragFired = true;
    els.svg.style.transform = '';
    if (!menuOpen) toggleRadialMenu();
    blob.poke();
    playPop();
  }
});

els.svg.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  els.svg.style.transform = '';
  if (!dragFired) {
    blob.poke();
    playPop();
  }
  dragStartY = null;
});

els.svg.addEventListener('pointercancel', () => {
  els.svg.style.transform = '';
  dragStartY = null;
});

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
  else if (f === 'pomodoro') openPanel('panelPomodoro');
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

document.querySelectorAll('#powersRadial .srm-btn[data-fx]').forEach((btn) => {
  btn.addEventListener('click', () => {
    blob.triggerState(btn.dataset.fx);
    const labels = { burst:'💥 Burst!', comet:'☄️ Komet!', orbit:'🪐 Orbit!', swirl:'🌀 Swirl!', exclaim:'❗ Exclaim!', notify:'🔔 Notify!' };
    showBubble(labels[btn.dataset.fx] || '⚡', 2200);
    els.powersRadial.classList.add('hidden');
  });
});

/* ── Idle Radial Menu ── */
$('#idleRadialBack').addEventListener('click', () => {
  els.idleRadial.classList.add('hidden');
});

const PEEK_DIRS = ['idle-peekaboo-top', 'idle-peekaboo-bottom', 'idle-peekaboo-left', 'idle-peekaboo-right'];

document.querySelectorAll('#idleRadial .srm-btn[data-idle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    idleAnims.stop();
    const svg = els.svg;
    const idleType = btn.dataset.idle;

    if (idleType === 'melt') {
      svg.classList.remove('idle-anim');
      showBubble('▶ Leleh... 💧', 2000);
      blob.playMelt();
      setTimeout(() => { idleAnims.resume(); }, 10000);
      return;
    }

    const cls = 'idle-' + idleType;
    const addClasses = [cls];
    if (cls === 'idle-peekaboo') addClasses.push(PEEK_DIRS[Math.floor(Math.random() * PEEK_DIRS.length)]);
    svg.classList.remove('idle-anim', ...PEEK_DIRS, 'idle-walk', 'idle-run', 'idle-float', 'idle-bounce', 'idle-grow', 'idle-shrink', 'idle-spin', 'idle-drift', 'idle-tilt', 'idle-jump', 'idle-sneak', 'idle-wiggle', 'idle-pulse', 'idle-wobble', 'idle-nod', 'idle-flip', 'idle-slide-l', 'idle-slide-r', 'idle-melt', 'idle-peekaboo');
    svg.classList.add('idle-anim', ...addClasses);
    showBubble('▶ ' + btn.textContent.trim(), 2000);
    svg.addEventListener('animationend', () => {
      const computed = getComputedStyle(svg).transform;
      svg.classList.remove('idle-anim', ...addClasses);
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

const APP_VERSION = 'v30';

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
