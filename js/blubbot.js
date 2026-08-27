import {
  BotEngine,
  STATE_BY_ID,
  SHAPE_BY_ID,
  BOT_SHAPES,
  EXPRESSIONS,
  REST_GAZE,
  COLOR_BY_ID,
  mixHex,
  closedPath,
  toPoints
} from './bloub-engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const nowSec = () => performance.now() / 1000;

const EXPR_BY_ID = Object.fromEntries(EXPRESSIONS.map((e) => [e.id, e]));

const INK = '#0a0a0c';

const FX_HOLD = {
  burst: 2400,
  comet: 3000,
  orbit: 3200,
  swirl: 3400,
  exclaim: 2000,
  notify: 2600
};

export const SHAPES_INFO = [
  { id: 'cercle', label: 'Bulat' },
  { id: 'galet', label: 'Cibul' },
  { id: 'squircle', label: 'Squircle' },
  { id: 'capsule', label: 'Kapsul' },
  { id: 'triangle', label: 'Segitiga' },
  { id: 'hexagone', label: 'Heksagon' },
  { id: 'nuage', label: 'Awan' },
  { id: 'goutte', label: 'Tetes' }
];

const OLD_SHAPE_MAP = {
  bulat: 'cercle',
  telur: 'goutte',
  squish: 'galet',
  tetes: 'goutte',
  bunga: 'nuage'
};

const MOOD = {
  idle:   { state: 'idle', expr: null },
  happy:  { state: 'idle', expr: 'heureux' },
  excite: { state: 'play', expr: 'hilare' },
  think:  { state: 'thinking', expr: 'curieux' },
  listen: { state: 'idle', expr: 'attentif' },
  sad:    { state: 'idle', expr: 'triste' },
  sleepy: { state: 'sleep', expr: 'somnolent' }
};

export function shapePreviewPath(id) {
  const rec = SHAPE_BY_ID.get(id);
  if (!rec) return '';
  const sil = { radii: rec.radii, rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 };
  return closedPath(toPoints(sil, 52));
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function resolvePaper() {
  const bg = getComputedStyle(document.body).backgroundColor;
  return bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#f6f4ef';
}

export class BlobCharacter {
  constructor(svg, opts = {}) {
    this.svg = svg;
    this.onPokeSound = opts.onPokeSound || (() => {});
    this.onQuip = opts.onQuip || (() => {});

    const requested = OLD_SHAPE_MAP[opts.shape] || opts.shape;
    this.shapeId = SHAPE_BY_ID.has(requested) ? requested : 'cercle';

    svg.innerHTML = '';
    svg.setAttribute('viewBox', '-158 -158 316 316');

    this.gBack = el('g');
    this.bodyEl = el('path', { fill: INK });
    this.gEyes = el('g');
    this.eyeEls = [el('path', { fill: 'none' }), el('path', { fill: 'none' })];
    this.gFront = el('g');
    this.dotPool = [];

    this.gEyes.append(...this.eyeEls);
    svg.append(this.gBack, this.bodyEl, this.gEyes, this.gFront);

    this.engine = new BotEngine(
      100,
      'idle',
      SHAPE_BY_ID.get(this.shapeId).radii,
      EXPR_BY_ID.neutre
    );
    this.mood = 'idle';
    this.holdTimer = 0;
    this.fxTimer = 0;
    this.lastPointerT = -10;
    this.lookActive = false;

    this.paperCache = resolvePaper();
    this._lastPaperRead = 0;

    this._raf = this._loop.bind(this);
    requestAnimationFrame(this._raf);
  }

  _syncDots(dots, behind) {
    const parent = behind ? this.gBack : this.gFront;
    if (this.dotsParent !== parent) {
      parent.append(...this.dotPool.filter(Boolean));
      this.dotsParent = parent;
    }
    while (this.dotPool.length < dots.length) {
      const c = el('circle');
      this.dotPool.push(c);
      parent.append(c);
    }
    for (let i = 0; i < this.dotPool.length; i++) {
      const c = this.dotPool[i];
      const d = dots[i];
      if (!d) {
        c.setAttribute('r', '0');
        continue;
      }
      c.setAttribute('cx', d.x.toFixed(1));
      c.setAttribute('cy', d.y.toFixed(1));
      c.setAttribute('r', Math.max(0.4, d.r).toFixed(2));
      c.setAttribute('opacity', d.opacity.toFixed(2));
      c.setAttribute('fill', d.color || mixHex(this.paperCache, INK, d.depth ?? 0));
    }
  }

  _loop() {
    const now = nowSec();

    if (now - this._lastPaperRead > 1) {
      this.paperCache = resolvePaper();
      this._lastPaperRead = now;
      for (const e of this.eyeEls) e.setAttribute('fill', this.paperCache);
    }

    if (this.lookActive && now - this.lastPointerT > 4) {
      this.lookActive = false;
      this.engine.setLook(null, now);
    }

    let frame;
    try {
      frame = this.engine.sample(now);
    } catch (err) {
      console.error('[blub] engine error', err);
      requestAnimationFrame(this._raf);
      return;
    }

    this.bodyEl.setAttribute('d', frame.bodyPath);
    this.bodyEl.setAttribute('opacity', frame.bodyAlpha.toFixed(2));

    for (let i = 0; i < 2; i++) {
      const eye = frame.eyes[i];
      const node = this.eyeEls[i];
      if (!eye || eye.alpha <= 0.01) {
        node.setAttribute('d', '');
        continue;
      }
      node.setAttribute('d', eye.d);
      node.setAttribute('transform', eye.matrix);
      node.setAttribute('opacity', eye.alpha.toFixed(2));
      node.setAttribute('fill', this.paperCache);
    }

    this._syncDots(frame.dots, frame.dotsBehind);

    requestAnimationFrame(this._raf);
  }

  _applyDomFlags(mood) {
    const zzz = document.getElementById('zzz');
    if (zzz) zzz.classList.toggle('hidden', mood !== 'sleepy');
    const stage = this.svg.closest('.stage');
    if (stage) stage.classList.toggle('listening', mood === 'listen');
  }

  setState(mood, { holdMs = 0 } = {}) {
    if (!MOOD[mood]) return;
    clearTimeout(this.holdTimer);
    this.mood = mood;
    const m = MOOD[mood];
    const now = nowSec();
    if (m.state && STATE_BY_ID.has(m.state)) this.engine.setState(m.state, now);
    this.engine.setExpression(m.expr ? EXPR_BY_ID[m.expr] : EXPR_BY_ID.neutre, now);
    this._applyDomFlags(mood);
    if (holdMs > 0) {
      this.holdTimer = setTimeout(() => this.setState('idle'), holdMs);
    }
  }

  getState() {
    return this.mood;
  }

  talk(on) {
    const expr = on ? 'excite' : MOOD[this.mood].expr;
    this.engine.setExpression(expr ? EXPR_BY_ID[expr] : EXPR_BY_ID.neutre, nowSec());
  }

  setPointer(nx, ny) {
    const now = nowSec();
    this.lastPointerT = now;
    const yaw = REST_GAZE.yaw + (nx * 2 - 1) * 70;
    const pitch = REST_GAZE.pitch + (0.5 - ny) * 110;
    this.engine.setLook(
      {
        yaw: Math.max(-85, Math.min(85, yaw)),
        pitch: Math.max(-60, Math.min(85, pitch)),
        mix: 0.9,
        spin: 0,
        wander: 0
      },
      now
    );
    this.lookActive = true;
  }

  poke() {
    const now = nowSec();
    this.engine.setState('wink', now);
    this.onPokeSound();
    this.onQuip();
    setTimeout(() => {
      if (this.mood === 'idle') this.engine.setState('idle', nowSec());
    }, 1500);
  }

  getShape() {
    return this.shapeId;
  }

  setShape(id) {
    const rec = SHAPE_BY_ID.get(id);
    if (!rec) return;
    this.shapeId = id;
    this.engine.setShape(rec.radii, nowSec());
  }

  triggerState(fx) {
    if (!STATE_BY_ID.has(fx)) return;
    clearTimeout(this.holdTimer);
    clearTimeout(this.fxTimer);
    this.mood = 'idle';
    const stage = this.svg.closest('.stage');
    if (stage) stage.classList.add('power');
    this.engine.setState(fx, nowSec());

    const flash = document.createElement('div');
    flash.className = 'power-flash ' + fx;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);

    if (fx === 'burst') this._spawnBurstParticles();

    if (fx === 'comet') {
      if (stage) stage.classList.add('comet-fly');
      this.fxTimer = setTimeout(() => {
        if (this.mood === 'idle') this.engine.setState('idle', nowSec());
        if (stage) { stage.classList.remove('power'); stage.classList.remove('comet-fly'); }
        this.svg.style.filter = '';
        this.svg.style.transform = '';
      }, 3000);
    } else {
      this.svg.style.transition = 'filter 0.2s, transform 0.2s';
      this.svg.style.filter = 'drop-shadow(0 0 25px rgba(124,92,255,0.8)) brightness(1.4)';
      this.svg.style.transform = 'scale(1.15)';
      this.fxTimer = setTimeout(() => {
        if (this.mood === 'idle') this.engine.setState('idle', nowSec());
        if (stage) stage.classList.remove('power');
        this.svg.style.filter = '';
        this.svg.style.transform = '';
      }, FX_HOLD[fx] || 2600);
    }
  }

  _spawnBurstParticles() {
    const NS = 'http://www.w3.org/2000/svg';
    const count = 18;
    const g = document.createElementNS(NS, 'g');
    this.svg.append(g);

    const particles = [];
    const colors = ['#ff6b35','#ff4444','#ffaa00','#ff8855','#ff2222','#ffcc00','#ff5533'];

    for (let i = 0; i < count; i++) {
      const c = document.createElementNS(NS, 'circle');
      const r = 1.5 + Math.random() * 3.5;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
      const dist = 50 + Math.random() * 80;
      const dur = 400 + Math.random() * 350;
      const delay = Math.random() * 100;
      const color = colors[i % colors.length];

      c.setAttribute('cx', '0');
      c.setAttribute('cy', '0');
      c.setAttribute('r', String(r));
      c.setAttribute('fill', color);
      c.setAttribute('opacity', '1');
      g.append(c);

      particles.push({ el: c, angle, dist, dur, delay, r });
    }

    const t0 = performance.now();
    const animate = () => {
      const elapsed = performance.now() - t0;
      let alive = false;
      for (const p of particles) {
        const t = elapsed - p.delay;
        if (t < 0) { alive = true; continue; }
        const progress = Math.min(t / p.dur, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const dx = Math.cos(p.angle) * p.dist * ease;
        const dy = Math.sin(p.angle) * p.dist * ease;
        const fade = 1 - progress;
        const scale = 1 - progress * 0.6;
        p.el.setAttribute('cx', dx.toFixed(1));
        p.el.setAttribute('cy', dy.toFixed(1));
        p.el.setAttribute('opacity', String(fade.toFixed(2)));
        p.el.setAttribute('r', String((p.r * scale).toFixed(2)));
        if (progress < 1) alive = true;
      }
      if (alive) requestAnimationFrame(animate);
      else g.remove();
    };
    requestAnimationFrame(animate);
  }

  triggerPeekaboo() {
    clearTimeout(this.holdTimer);
    clearTimeout(this.fxTimer);
    this.mood = 'idle';
    const dir = PEEK_DIRS[Math.floor(Math.random() * PEEK_DIRS.length)];
    this.svg.classList.remove('idle-anim');
    this.svg.classList.add('idle-anim', 'idle-peekaboo', dir);
    this.svg.addEventListener('animationend', () => {
      const computed = getComputedStyle(this.svg).transform;
      this.svg.classList.remove('idle-anim', 'idle-peekaboo', dir);
      if (computed && computed !== 'none') {
        this.svg.style.transform = computed;
        this.svg.style.transition = 'transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.svg.style.transform = '';
            this.svg.addEventListener('transitionend', () => {
              this.svg.style.transition = '';
            }, { once: true });
          });
        });
      }
    }, { once: true });
  }

  setColorById(colorId) {
    const c = COLOR_BY_ID.get(colorId);
    if (!c) return;
    this.bodyEl.setAttribute('fill', c.hex);
    const stage = this.svg.closest('.stage');
    if (stage) {
      stage.classList.add('color-flash');
      setTimeout(() => stage.classList.remove('color-flash'), 900);
    }
    this.svg.style.filter = `drop-shadow(0 0 20px ${c.hex}) brightness(1.5)`;
    this.svg.style.transform = 'scale(1.2)';
    setTimeout(() => {
      this.svg.style.filter = '';
      this.svg.style.transform = '';
    }, 800);
  }

  resetColor() {
    this.bodyEl.setAttribute('fill', INK);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    if (this._idleTimer) clearTimeout(this._idleTimer);
  }
}

const IDLE_CLASSES = [
  'idle-walk', 'idle-run', 'idle-float', 'idle-bounce',
  'idle-grow', 'idle-shrink', 'idle-spin', 'idle-drift',
  'idle-tilt', 'idle-jump', 'idle-sneak', 'idle-wiggle',
  'idle-pulse', 'idle-wobble', 'idle-nod', 'idle-flip',
  'idle-slide-l', 'idle-slide-r', 'idle-melt', 'idle-peekaboo'
];

const PEEK_DIRS = ['idle-peekaboo-top', 'idle-peekaboo-bottom', 'idle-peekaboo-left', 'idle-peekaboo-right'];

const IDLE_BUBBLES = [
  'Hmm...', '*stretch*', 'Yawn~', 'Woah!', 'Hehe~',
  '*baca buku*', '*goyang-goyang*', '*lompat*', 'Aku bosan nih...',
  'Mau lihat ajaib?', '*duduk manis*', '*berdiri*', '*jalan-jalan*',
  'Ciluk.. baa!', 'Hilaaang~', '*sembunyi*', '*muncul lagi*'
];

export function startIdleAnimations(svg, opts = {}) {
  const { onBubble, onPoke } = opts;
  let running = true;
  let currentClass = null;

  function pickIdle() {
    if (!running) return;
    if (svg.closest('.stage')?.querySelector('.feature-panel:not([hidden])') ||
        svg.closest('.stage')?.classList.contains('power') ||
        svg.closest('.stage')?.classList.contains('color-flash')) {
      scheduleNext(3000);
      return;
    }

    const cls = IDLE_CLASSES[Math.floor(Math.random() * IDLE_CLASSES.length)];
    if (currentClass) svg.classList.remove('idle-anim', currentClass);
    if (svg.style.filter || svg.style.transform) {
      scheduleNext(2000);
      return;
    }

    let peekDir = '';
    if (cls === 'idle-peekaboo') {
      peekDir = PEEK_DIRS[Math.floor(Math.random() * PEEK_DIRS.length)];
      svg.classList.add('idle-anim', cls, peekDir);
    } else {
      svg.classList.add('idle-anim', cls);
    }
    currentClass = cls;

    if (onBubble && (cls === 'idle-peekaboo' || Math.random() < 0.35)) {
      const q = cls === 'idle-peekaboo' ? 'Ciluk.. baa!' : IDLE_BUBBLES[Math.floor(Math.random() * IDLE_BUBBLES.length)];
      const delay = cls === 'idle-peekaboo' ? 1800 : 0;
      setTimeout(() => onBubble(q, 2400), delay);
    }

    svg.addEventListener('animationend', function onEnd() {
      const computed = getComputedStyle(svg).transform;
      svg.classList.remove('idle-anim', cls, peekDir);
      currentClass = null;
      if (computed && computed !== 'none') {
        svg.style.transform = computed;
        svg.style.transition = 'transform 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            svg.style.transform = '';
            svg.addEventListener('transitionend', () => {
              svg.style.transition = '';
            }, { once: true });
          });
        });
      }
      scheduleNext();
    }, { once: true });

    scheduleNext(8000);
  }

  function scheduleNext(delay) {
    if (opts.timer) clearTimeout(opts.timer);
    const ms = delay || (5000 + Math.random() * 12000);
    opts.timer = setTimeout(pickIdle, ms);
  }

  scheduleNext(3000);

  return {
    stop() {
      running = false;
      clearTimeout(opts.timer);
      if (currentClass) {
        const computed = getComputedStyle(svg).transform;
        svg.classList.remove('idle-anim', currentClass, ...PEEK_DIRS);
        currentClass = null;
        if (computed && computed !== 'none') {
          svg.style.transform = computed;
          svg.style.transition = 'transform 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              svg.style.transform = '';
              svg.addEventListener('transitionend', () => {
                svg.style.transition = '';
              }, { once: true });
            });
          });
        }
      }
    },
    resume() { running = true; scheduleNext(); }
  };
}
