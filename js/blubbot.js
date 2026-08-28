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

/* ── Mouth shapes per expression ── */
const MOUTH_SHAPES = {
  neutre:     { type: 'line',  w: 14, h: 0 },
  attentif:   { type: 'line',  w: 14, h: 0 },
  surpris:    { type: 'open',  w: 9,  h: 11 },
  excite:     { type: 'smile', w: 18, h: 8 },
  heureux:    { type: 'smile', w: 16, h: 6 },
  hilare:     { type: 'smile', w: 20, h: 10 },
  colere:     { type: 'frown', w: 16, h: 5 },
  triste:     { type: 'frown', w: 14, h: 4 },
  effraye:    { type: 'open',  w: 11, h: 14 },
  mefiant:    { type: 'smirk', w: 14, h: 3 },
  confus:     { type: 'wavy',  w: 14, h: 2 },
  curieux:    { type: 'smile', w: 12, h: 3 },
  fier:       { type: 'smile', w: 14, h: 5 },
  timide:     { type: 'smile', w: 10, h: 3 },
  blase:      { type: 'line',  w: 14, h: 0 },
  somnolent:  { type: 'line',  w: 12, h: 0 }
};

function mouthPath(shape) {
  const { type, w, h } = shape;
  const hw = w / 2;
  switch (type) {
    case 'smile': return `M ${-hw} 0 Q 0 ${-h} ${hw} 0`;
    case 'frown': return `M ${-hw} 0 Q 0 ${h} ${hw} 0`;
    case 'line':  return `M ${-hw} 0 L ${hw} 0`;
    case 'open':  return `M ${-hw * 0.5} 0 A ${hw * 0.5} ${h} 0 1 0 ${hw * 0.5} 0 A ${hw * 0.5} ${h} 0 1 0 ${-hw * 0.5} 0`;
    case 'smirk': return `M ${-hw} 0 Q 0 ${-h} ${hw * 0.5} ${-h * 0.5}`;
    case 'wavy':  return `M ${-hw} 0 Q ${-hw * 0.5} ${h} 0 0 Q ${hw * 0.5} ${-h} ${hw} 0`;
    default:      return `M ${-hw} 0 L ${hw} 0`;
  }
}

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

function resolveEyeColor() {
  const paper = resolvePaper();
  const dark = isColorDark(paper);
  return dark ? '#d8d4e0' : paper;
}

function isColorDark(rgbStr) {
  const m = rgbStr.match(/\d+/g);
  if (!m || m.length < 3) return false;
  const lum = (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
  return lum < 0.25;
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
    this.mouthEl = el('path', { fill: 'none', 'stroke-width': '3.5', 'stroke-linecap': 'round' });
    this.gFront = el('g');
    this.dotPool = [];

    this.gEyes.append(...this.eyeEls, this.mouthEl);
    svg.append(this.gBack, this.bodyEl, this.gEyes, this.gFront);

    this.engine = new BotEngine(
      100,
      'idle',
      SHAPE_BY_ID.get(this.shapeId).radii,
      EXPR_BY_ID.neutre
    );
    this.mood = 'idle';
    this.currentExpr = 'neutre';
    this.isTalking = false;
    this.holdTimer = 0;
    this.fxTimer = 0;
    this.lastPointerT = -10;
    this.lookActive = false;

    this.paperCache = resolvePaper();
    this.eyeColorCache = resolveEyeColor();
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
      this.eyeColorCache = resolveEyeColor();
      this._lastPaperRead = now;
      for (const e of this.eyeEls) e.setAttribute('fill', this.eyeColorCache);
    }

    if (this.lookActive && now - this.lastPointerT > 4) {
      this.lookActive = false;
      this.engine.setLook(null, now);
    }

    /* ── Mic mode: keep mic silhouette, gentle pulse, skip engine ── */
    if (this._micMode && !this._micMorphing) {
      const pulse = 1 + Math.sin(now * 4) * 0.04;
      this.svg.style.transform = `scale(${pulse.toFixed(3)})`;
      requestAnimationFrame(this._raf);
      return;
    }
    /* ── Timer mode: keep clock shape, skip engine ── */
    if (this._timerMode && !this._timerMorphing) {
      requestAnimationFrame(this._raf);
      return;
    }
    /* During morph animation, the morph function drives transform — skip */
    if (this._micMorphing || this._timerMorphing) {
      requestAnimationFrame(this._raf);
      return;
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

    /* ── Skip face rendering during burst, orbit, or dizzy ── */
    if (this._burstActive || this._orbitActive || this._dizzyActive) {
      requestAnimationFrame(this._raf);
      return;
    }

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
      node.setAttribute('fill', this.eyeColorCache);
    }

    /* ── Mouth: position + rotation from eye matrices, shape from expression ── */
    const visibleEyes = frame.eyes.filter((e) => e.alpha > 0.01);
    if (visibleEyes.length === 0) {
      this.mouthEl.setAttribute('d', '');
    } else {
      const eyePos = visibleEyes.map((e) => {
        const m = e.matrix.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)\)/);
        if (!m) return null;
        const a = parseFloat(m[1]), b = parseFloat(m[2]);
        const x = parseFloat(m[5]), y = parseFloat(m[6]);
        // Extract rotation angle from matrix (atan2 of b, a)
        const rot = Math.atan2(b, a) * 180 / Math.PI;
        return { x, y, a: e.alpha, rot };
      }).filter(Boolean);
      if (eyePos.length === 0) {
        this.mouthEl.setAttribute('d', '');
      } else {
        const cx = eyePos.reduce((s, p) => s + p.x, 0) / eyePos.length;
        const cy = eyePos.reduce((s, p) => s + p.y, 0) / eyePos.length + 26;
        // Average rotation of both eyes
        const avgRot = eyePos.reduce((s, p) => s + p.rot, 0) / eyePos.length;
        let mouthW = 14;
        if (eyePos.length >= 2) {
          const sep = Math.abs(eyePos[1].x - eyePos[0].x);
          mouthW = Math.max(8, Math.min(22, sep * 0.55));
        }
        let shape = MOUTH_SHAPES[this.currentExpr] || MOUTH_SHAPES.neutre;
        if (this.isTalking) {
          const phase = (Math.sin(now * 18) + 1) / 2;
          shape = { type: 'open', w: mouthW * 0.7, h: 3 + phase * 9 };
        }
        const finalShape = { ...shape, w: mouthW };
        this.mouthEl.setAttribute('d', mouthPath(finalShape));
        // Apply rotation matching eye tilt
        this.mouthEl.setAttribute('transform', `translate(${cx.toFixed(1)}, ${cy.toFixed(1)}) rotate(${avgRot.toFixed(1)})`);
        this.mouthEl.setAttribute('stroke', this.eyeColorCache);
        const mouthAlpha = Math.min(...eyePos.map((p) => p.a));
        this.mouthEl.setAttribute('opacity', mouthAlpha.toFixed(2));
      }
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
    this.currentExpr = m.expr || 'neutre';
    this._applyDomFlags(mood);
    if (holdMs > 0) {
      this.holdTimer = setTimeout(() => this.setState('idle'), holdMs);
    }
  }

  getState() {
    return this.mood;
  }

  talk(on) {
    this.isTalking = on;
    const expr = on ? 'excite' : MOOD[this.mood].expr;
    this.currentExpr = expr || 'neutre';
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

  /* ── Mic morph: blob itself turns into a microphone silhouette ── */
  static MIC_PATH =
    'M-40 -55 A40 40 0 0 1 40 -55 L40 15 L14 15 L14 70 L22 70 L22 80 L-22 80 L-22 70 L-14 70 L-14 15 L-40 15 Z';

  // Smooth cubic-bezier-ish easing (easeInOutCubic)
  static _easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  // Ease-out cubic (decelerate)
  static _easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  // Ease-in cubic (accelerate)
  static _easeIn(t) {
    return t * t * t;
  }

  enterMicMode() {
    if (this._micMode || this._micMorphing) return;
    this._micMorphing = true;
    this._micSavedBodyD = this.bodyEl.getAttribute('d');
    this._micSavedBodyOpacity = this.bodyEl.getAttribute('opacity') || '1';
    this._micSavedBodyFill = this.bodyEl.getAttribute('fill') || '#0a0a0c';

    const svg = this.svg;
    const stage = svg.closest('.stage');
    const bodyEl = this.bodyEl;
    const eyeEls = this.eyeEls;
    const mouthEl = this.mouthEl;
    const self = this;

    // Create a second path element for crossfade morph (avoids hard shape swap)
    const micBody = el('path', { fill: this._micSavedBodyFill, opacity: '0' });
    micBody.setAttribute('d', BlobCharacter.MIC_PATH);
    bodyEl.parentNode.insertBefore(micBody, bodyEl.nextSibling);

    svg.style.transition = 'none';
    svg.style.willChange = 'transform, filter';

    // Single continuous animation: shrink+glow+crossfade, then grow back
    const TOTAL_DUR = 700;
    const FLASH_AT = 0.5; // midpoint
    const t0 = performance.now();
    let flashDone = false;

    const animate = () => {
      const now = performance.now();
      const p = Math.min((now - t0) / TOTAL_DUR, 1);

      if (p < FLASH_AT) {
        // Phase 1: shrink + glow + fade blob body out + fade mic body in
        const lp = p / FLASH_AT;
        const ease = BlobCharacter._easeInOut(lp);
        const scale = 1 - ease * 0.35;
        svg.style.transform = `scale(${scale.toFixed(4)})`;
        svg.style.filter = `brightness(${(1 + ease * 1.0).toFixed(3)}) drop-shadow(0 0 ${(ease * 16).toFixed(1)}px rgba(124,92,255,${(ease*0.75).toFixed(3)}))`;
        // Crossfade bodies
        bodyEl.setAttribute('opacity', (1 - ease).toFixed(3));
        micBody.setAttribute('opacity', ease.toFixed(3));
        // Fade face
        const faceA = (1 - ease).toFixed(3);
        for (const e of eyeEls) e.setAttribute('opacity', faceA);
        if (mouthEl) mouthEl.setAttribute('opacity', faceA);
        // Hide dots gradually
        if (lp > 0.6) self._syncDots([], false);
      } else {
        // Flash at midpoint
        if (!flashDone) {
          flashDone = true;
          const flash = document.createElement('div');
          flash.className = 'power-flash';
          flash.style.background = 'radial-gradient(circle at center, rgba(124,92,255,0.4), transparent 70%)';
          flash.style.animation = 'flashBang 0.5s ease-out forwards';
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 500);
          if (stage) stage.classList.add('power');
          // Remove old blob body, mic body takes over
          bodyEl.setAttribute('opacity', '0');
          micBody.setAttribute('opacity', '1');
        }
        // Phase 2: grow back with ease-out + subtle overshoot
        const lp = (p - FLASH_AT) / (1 - FLASH_AT);
        const ease = BlobCharacter._easeOut(lp);
        const overshoot = Math.sin(lp * Math.PI) * 0.06;
        const scale = 0.65 + ease * 0.35 + overshoot;
        svg.style.transform = `scale(${scale.toFixed(4)})`;
        svg.style.filter = `brightness(${(1 + (1 - lp) * 0.4).toFixed(3)}) drop-shadow(0 0 ${((1-lp) * 10).toFixed(1)}px rgba(124,92,255,${((1-lp)*0.5).toFixed(3)}))`;
      }

      if (p >= 1) {
        self._micMode = true;
        self._micMorphing = false;
        // Swap micBody into bodyEl position so _loop can manage it
        bodyEl.setAttribute('d', BlobCharacter.MIC_PATH);
        bodyEl.setAttribute('opacity', '1');
        bodyEl.setAttribute('fill', self._micSavedBodyFill);
        micBody.remove();
        svg.style.willChange = '';
        svg.style.filter = 'drop-shadow(0 0 8px rgba(255,68,68,0.4))';
      } else {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  exitMicMode() {
    if (!this._micMode || this._micMorphing) return;
    this._micMorphing = true;
    this._micMode = false;

    const svg = this.svg;
    const stage = svg.closest('.stage');
    const bodyEl = this.bodyEl;
    const eyeEls = this.eyeEls;
    const mouthEl = this.mouthEl;
    const self = this;

    // Create a second path for crossfade (mic → blob)
    const blobBody = el('path', { fill: this._micSavedBodyFill, opacity: '0' });
    if (self._micSavedBodyD) blobBody.setAttribute('d', self._micSavedBodyD);
    bodyEl.parentNode.insertBefore(blobBody, bodyEl.nextSibling);

    svg.style.willChange = 'transform, filter';

    const TOTAL_DUR = 700;
    const FLASH_AT = 0.5;
    const t0 = performance.now();
    let flashDone = false;

    const animate = () => {
      const now = performance.now();
      const p = Math.min((now - t0) / TOTAL_DUR, 1);

      if (p < FLASH_AT) {
        // Phase 1: shrink + glow + crossfade mic→blob
        const lp = p / FLASH_AT;
        const ease = BlobCharacter._easeInOut(lp);
        const scale = 1 - ease * 0.35;
        svg.style.transform = `scale(${scale.toFixed(4)})`;
        svg.style.filter = `brightness(${(1 + ease * 0.9).toFixed(3)}) drop-shadow(0 0 ${(ease * 14).toFixed(1)}px rgba(124,92,255,${(ease*0.65).toFixed(3)}))`;
        bodyEl.setAttribute('opacity', (1 - ease).toFixed(3));
        blobBody.setAttribute('opacity', ease.toFixed(3));
      } else {
        if (!flashDone) {
          flashDone = true;
          const flash = document.createElement('div');
          flash.className = 'power-flash';
          flash.style.background = 'radial-gradient(circle at center, rgba(124,92,255,0.4), transparent 70%)';
          flash.style.animation = 'flashBang 0.5s ease-out forwards';
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 500);
          // Restore blob body
          bodyEl.setAttribute('d', self._micSavedBodyD || '');
          bodyEl.setAttribute('opacity', '1');
          bodyEl.setAttribute('fill', self._micSavedBodyFill);
          blobBody.remove();
          // Restart engine so blob animates naturally
          if (self.mood === 'idle') self.engine.setState('idle', nowSec());
        }
        // Phase 2: grow back + fade face in
        const lp = (p - FLASH_AT) / (1 - FLASH_AT);
        const ease = BlobCharacter._easeOut(lp);
        const overshoot = Math.sin(lp * Math.PI) * 0.08;
        const scale = 0.65 + ease * 0.35 + overshoot;
        svg.style.transform = `scale(${scale.toFixed(4)})`;
        svg.style.filter = `brightness(${(1 + (1 - lp) * 0.35).toFixed(3)}) drop-shadow(0 0 ${((1-lp) * 8).toFixed(1)}px rgba(124,92,255,${((1-lp)*0.4).toFixed(3)}))`;
        const faceA = Math.min(lp * 1.4, 1).toFixed(3);
        for (const e of eyeEls) e.setAttribute('opacity', faceA);
        if (mouthEl) mouthEl.setAttribute('opacity', faceA);
      }

      if (p >= 1) {
        self._micMorphing = false;
        svg.style.willChange = '';
        svg.style.transform = '';
        svg.style.filter = '';
        if (stage) stage.classList.remove('power');
        for (const e of eyeEls) e.setAttribute('opacity', '1');
        if (mouthEl) mouthEl.setAttribute('opacity', '1');
      } else {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  /* ── Timer dot-matrix morph: blob breaks into dots forming time digits ── */

  // 3x5 dot matrix font for digits, 1x5 for colon
  static DOT_FONT = {
    '0': ['111','101','101','101','111'],
    '1': ['010','110','010','010','111'],
    '2': ['111','001','111','100','111'],
    '3': ['111','001','111','001','111'],
    '4': ['101','101','111','001','001'],
    '5': ['111','100','111','001','111'],
    '6': ['111','100','111','101','111'],
    '7': ['111','001','010','010','010'],
    '8': ['111','101','111','101','111'],
    '9': ['111','101','111','001','111'],
    ':': ['0','1','0','1','0'],
  };

  static computeDotPositions(timeStr) {
    // Same scale for all screens — CSS handles desktop enlargement
    const SP = 17;    // dot spacing (fits viewBox ±158)
    const GAP = 7;    // gap between characters
    const ROWS = 5;
    // Compute total width (single dot per pixel, clean dot matrix)
    let totalW = 0;
    for (const ch of timeStr) {
      totalW += (ch === ':' ? 1 : 3) * SP + GAP;
    }
    totalW -= GAP;
    let x = -totalW / 2;
    const y0 = -(ROWS - 1) * SP / 2;
    const pts = [];
    for (const ch of timeStr) {
      const font = BlobCharacter.DOT_FONT[ch];
      if (!font) { x += 3 * SP + GAP; continue; }
      const cw = ch === ':' ? 1 : 3;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < cw; c++) {
          if (font[r][c] === '1') {
            pts.push({ x: x + c * SP, y: y0 + r * SP });
          }
        }
      }
      x += cw * SP + GAP;
    }
    return pts;
  }

  static getTimerDotRadius() {
    return 6.5;
  }

  enterTimerMode() {
    if (this._timerMode || this._timerMorphing) return;
    this._timerMorphing = true;
    this._timerSavedBodyD = this.bodyEl.getAttribute('d');
    this._timerSavedBodyOpacity = this.bodyEl.getAttribute('opacity') || '1';
    this._timerSavedBodyFill = this.bodyEl.getAttribute('fill') || '#0a0a0c';

    const svg = this.svg;
    const bodyEl = this.bodyEl;
    const eyeEls = this.eyeEls;
    const mouthEl = this.mouthEl;
    const self = this;
    const fillColor = this._timerSavedBodyFill;

    // Create dot group
    const dotsG = el('g', { class: 'timer-dots' });
    svg.appendChild(dotsG);
    this._timerDotsG = dotsG;
    this._timerDots = []; // pool: { el, startX, startY, target, active }
    this._timerCurrentTime = '';

    // Compute initial target positions for "25:00"
    const initialTime = '25:00';
    const targets = BlobCharacter.computeDotPositions(initialTime);
    this._timerCurrentTime = initialTime;

    // Create dots at random positions near center (they'll fly to targets)
    const DOT_R = BlobCharacter.getTimerDotRadius();
    for (let i = 0; i < targets.length; i++) {
      const dot = el('circle', { cx: '0', cy: '0', r: String(DOT_R), fill: fillColor });
      // Start from blob body area, spread out
      const angle = (i / targets.length) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 20 + Math.random() * 40;
      const sx = Math.cos(angle) * dist;
      const sy = Math.sin(angle) * dist;
      dot.style.transition = 'none';
      dot.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      dot.style.opacity = '0';
      dotsG.appendChild(dot);
      // Stagger delay based on horizontal position (left-to-right wave)
      const delay = (targets[i].x + 200) / 400 * 0.3; // 0..0.3s wave
      this._timerDots.push({ el: dot, startX: sx, startY: sy, target: targets[i], active: true, delay });
    }

    // Hide face + engine dots
    for (const e of eyeEls) e.setAttribute('opacity', '0');
    if (mouthEl) mouthEl.setAttribute('opacity', '0');
    this._syncDots([], false);

    svg.style.transition = 'none';
    svg.style.willChange = 'transform, filter';

    // Mark stage as timer mode (CSS enlarges SVG on desktop)
    const stage = svg.closest('.stage');
    if (stage) stage.classList.add('timer-mode');

    // Animation: body shrinks/fades while dots fly to target positions (staggered)
    // Body shrinks 1 → 0.6 in first 40%, then eases back to 1 in last 30%
    const DUR = 1200;
    const SHRINK_END = 0.4;
    const GROW_START = 0.7;
    const t0 = performance.now();

    const animate = () => {
      const now = performance.now();
      const elapsed = now - t0;
      const p = Math.min(elapsed / DUR, 1);

      // Body scale: shrink then grow back smoothly
      let scale;
      if (p < SHRINK_END) {
        const lp = p / SHRINK_END;
        scale = 1 - BlobCharacter._easeIn(lp) * 0.4;
      } else if (p < GROW_START) {
        scale = 0.6; // hold small
      } else {
        const lp = (p - GROW_START) / (1 - GROW_START);
        scale = 0.6 + BlobCharacter._easeOut(lp) * 0.4;
      }

      // Body opacity: fade out in first 50%
      const bodyOpacity = Math.max(0, 1 - BlobCharacter._easeIn(Math.min(p / 0.5, 1)));
      bodyEl.setAttribute('opacity', bodyOpacity.toFixed(3));
      svg.style.transform = `scale(${scale.toFixed(4)})`;
      svg.style.filter = `brightness(${(1 + (1 - p) * 0.4).toFixed(3)}) drop-shadow(0 0 ${((1-p) * 10).toFixed(1)}px rgba(124,92,255,${((1-p)*0.4).toFixed(3)}))`;

      // Dots: each dot has its own staggered start time
      for (const d of self._timerDots) {
        if (!d.active) continue;
        const dotStart = d.delay * DUR;
        const dotDur = DUR - dotStart;
        const dotElapsed = Math.max(0, elapsed - dotStart);
        const dotP = Math.min(dotElapsed / dotDur, 1);
        const dotEase = BlobCharacter._easeOut(dotP);
        const x = d.startX + (d.target.x - d.startX) * dotEase;
        const y = d.startY + (d.target.y - d.startY) * dotEase;
        d.el.style.transition = 'none';
        d.el.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        d.el.style.opacity = Math.min(dotP * 2.5, 1).toFixed(3);
      }

      if (p >= 1) {
        // Enable CSS transitions for smooth, fluid time updates
        for (const d of self._timerDots) {
          if (d.active) {
            d.el.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease';
          }
        }
        bodyEl.setAttribute('opacity', '0');
        // Smooth transition to final state — no abrupt reset
        svg.style.transition = 'transform 0.3s ease, filter 0.3s ease';
        svg.style.transform = 'scale(1)';
        svg.style.filter = 'drop-shadow(0 0 6px rgba(124,92,255,0.15))';
        svg.style.willChange = '';
        self._timerMode = true;
        self._timerMorphing = false;
      } else {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  // Update dot positions when time changes — smooth transition via CSS
  updateTimerDisplay(timeStr) {
    if (!this._timerMode || this._timerMorphing) return;
    if (timeStr === this._timerCurrentTime) return;
    this._timerCurrentTime = timeStr;

    const newTargets = BlobCharacter.computeDotPositions(timeStr);
    const pool = this._timerDots;
    const fillColor = this._timerSavedBodyFill;

    // Reassign existing dots to new targets
    for (let i = 0; i < pool.length; i++) {
      if (i < newTargets.length) {
        pool[i].target = newTargets[i];
        pool[i].active = true;
        pool[i].el.style.transform = `translate(${newTargets[i].x.toFixed(2)}px, ${newTargets[i].y.toFixed(2)}px)`;
        pool[i].el.style.opacity = '1';
      } else {
        // Extra dot: scatter + fade out
        pool[i].active = false;
        const sx = (Math.random() - 0.5) * 60;
        const sy = (Math.random() - 0.5) * 60;
        pool[i].el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
        pool[i].el.style.opacity = '0';
      }
    }

    // Need more dots? Create new ones at center, fade in
    for (let i = pool.length; i < newTargets.length; i++) {
      const dot = el('circle', { cx: '0', cy: '0', r: String(BlobCharacter.getTimerDotRadius()), fill: fillColor });
      dot.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease';
      const sx = (Math.random() - 0.5) * 50;
      const sy = (Math.random() - 0.5) * 50;
      dot.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      dot.style.opacity = '0';
      this._timerDotsG.appendChild(dot);
      // Trigger transition to target
      requestAnimationFrame(() => {
        dot.style.transform = `translate(${newTargets[i].x.toFixed(2)}px, ${newTargets[i].y.toFixed(2)}px)`;
        dot.style.opacity = '1';
      });
      pool.push({ el: dot, startX: sx, startY: sy, target: newTargets[i], active: true });
    }
  }

  exitTimerMode() {
    if (!this._timerMode || this._timerMorphing) return;
    this._timerMorphing = true;
    this._timerMode = false;

    const svg = this.svg;
    const bodyEl = this.bodyEl;
    const eyeEls = this.eyeEls;
    const mouthEl = this.mouthEl;
    const self = this;

    // Dots scatter back toward center + fade out (CSS transition handles it)
    for (const d of self._timerDots) {
      const sx = (Math.random() - 0.5) * 50;
      const sy = (Math.random() - 0.5) * 50;
      d.el.style.transition = 'transform 0.6s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.6s ease';
      d.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      d.el.style.opacity = '0';
    }

    // Restore blob body path
    if (self._timerSavedBodyD) bodyEl.setAttribute('d', self._timerSavedBodyD);
    bodyEl.setAttribute('fill', self._timerSavedBodyFill);

    svg.style.willChange = 'transform, filter';

    // Body grows back + fades in (starts after dots begin scattering)
    const DUR = 600;
    const DELAY = 200;
    const t0 = performance.now() + DELAY;

    const animate = () => {
      const now = performance.now();
      if (now < t0) { requestAnimationFrame(animate); return; }
      const p = Math.min((now - t0) / DUR, 1);
      const ease = BlobCharacter._easeOut(p);

      const scale = 0.5 + ease * 0.5;
      svg.style.transform = `scale(${scale.toFixed(4)})`;
      bodyEl.setAttribute('opacity', ease.toFixed(3));
      svg.style.filter = `brightness(${(1 + (1-p) * 0.3).toFixed(3)}) drop-shadow(0 0 ${((1-p) * 8).toFixed(1)}px rgba(124,92,255,${((1-p)*0.3).toFixed(3)}))`;

      // Face fades in
      const faceA = Math.min(p * 1.5, 1).toFixed(3);
      for (const e of eyeEls) e.setAttribute('opacity', faceA);
      if (mouthEl) mouthEl.setAttribute('opacity', faceA);

      if (p >= 1) {
        // Clean up dots
        if (self._timerDotsG) {
          self._timerDotsG.remove();
          self._timerDotsG = null;
        }
        self._timerDots = [];
        self._timerMorphing = false;
        svg.style.willChange = '';
        svg.style.transform = '';
        svg.style.filter = '';
        // Remove timer-mode class (restore SVG size on desktop)
        const stage = svg.closest('.stage');
        if (stage) stage.classList.remove('timer-mode');
        if (self.mood === 'idle') self.engine.setState('idle', nowSec());
        for (const e of eyeEls) e.setAttribute('opacity', '1');
        if (mouthEl) mouthEl.setAttribute('opacity', '1');
      } else {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  triggerState(fx) {
    if (!STATE_BY_ID.has(fx)) return;
    clearTimeout(this.holdTimer);
    clearTimeout(this.fxTimer);
    this.mood = 'idle';
    const stage = this.svg.closest('.stage');

    if (fx === 'burst') {
      this._shatterBurst(stage);
      return;
    }

    if (fx === 'orbit') {
      this._orbitEyes(stage);
      return;
    }

    if (stage) stage.classList.add('power');
    this.engine.setState(fx, nowSec());

    const flash = document.createElement('div');
    flash.className = 'power-flash ' + fx;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);

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

  _orbitEyes(stage) {
    const ORBIT_DUR = 3200;
    const RADIUS = 110; // orbit radius around blob center
    if (stage) stage.classList.add('power');
    this._orbitActive = true;

    // Flash
    const flash = document.createElement('div');
    flash.className = 'power-flash orbit';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);

    // Glow
    this.svg.style.transition = 'filter 0.2s';
    this.svg.style.filter = 'drop-shadow(0 0 25px rgba(124,92,255,0.8)) brightness(1.4)';

    const t0 = performance.now();
    let rafId = null;
    const origEyeData = this.eyeEls.map(e => ({
      d: e.getAttribute('d'),
      matrix: e.getAttribute('transform'),
      opacity: e.getAttribute('opacity') || '1',
      fill: e.getAttribute('fill'),
    }));

    const animate = () => {
      const now = performance.now();
      const p = (now - t0) / ORBIT_DUR;
      if (p >= 1) {
        // Restore eyes
        this.eyeEls.forEach((e, i) => {
          const o = origEyeData[i];
          e.setAttribute('d', o.d);
          e.setAttribute('transform', o.matrix);
          e.setAttribute('opacity', o.opacity);
          e.setAttribute('fill', o.fill);
        });
        if (this.mouthEl) this.mouthEl.setAttribute('opacity', '1');
        this.svg.style.filter = '';
        this.svg.style.transition = '';
        if (stage) stage.classList.remove('power');
        this._orbitActive = false;
        if (this.mood === 'idle') this.engine.setState('idle', nowSec());
        return;
      }

      // Two eyes orbit at opposite positions (180° apart), 2 full rotations
      const angle = p * Math.PI * 4;
      for (let i = 0; i < 2; i++) {
        const a = angle + (i * Math.PI);
        const x = Math.cos(a) * RADIUS;
        const y = Math.sin(a) * RADIUS;
        const eye = this.eyeEls[i];
        eye.setAttribute('d', origEyeData[i].d);
        eye.setAttribute('transform', `translate(${x.toFixed(1)}, ${y.toFixed(1)})`);
        eye.setAttribute('opacity', '1');
        eye.setAttribute('fill', this.eyeColorCache);
      }
      if (this.mouthEl) this.mouthEl.setAttribute('opacity', '0');

      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    clearTimeout(this.fxTimer);
    this.fxTimer = setTimeout(() => {
      if (rafId) cancelAnimationFrame(rafId);
    }, ORBIT_DUR + 100);
  }

  _shatterBurst(stage) {
    const svg = this.svg;
    const origOpacity = this.bodyEl.getAttribute('opacity');
    const origFill = this.bodyEl.getAttribute('fill') || '#0a0a0c';

    // Cancel any previous burst
    this._burstActive = false;
    this._burstActive = true;
    const isActive = () => this._burstActive;

    // Get blob center position on screen for particle origin
    const svgRect = svg.getBoundingClientRect();
    const cx = svgRect.left + svgRect.width / 2;
    const cy = svgRect.top + svgRect.height / 2;

    // fxLayer for particles (position: fixed, no overflow clip)
    let fx = document.getElementById('fxLayer');
    if (!fx) {
      fx = document.createElement('div');
      fx.id = 'fxLayer';
      fx.className = 'fx-layer';
      document.body.appendChild(fx);
    }

    // Particle container
    const particleLayer = document.createElement('div');
    particleLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    fx.appendChild(particleLayer);

    const NUM_CHUNKS = 14;
    const NUM_SPARKS = 35;
    const SPARK_COLORS = ['#ff6600', '#ffaa00', '#ffdd44', '#ff8822', '#ff4400', '#ffcc66'];
    const particles = [];

    // Blob chunks: dark with orange border, DOM divs (can fly off screen)
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const el = document.createElement('div');
      const r = 12 + Math.random() * 16;
      el.style.cssText = `position:fixed;width:${r*2}px;height:${r*2}px;border-radius:50%;background:#0a0a0c;border:1.5px solid #ff4400;box-shadow:0 0 8px rgba(255,68,0,0.6);left:${cx}px;top:${cy}px;transform:translate(-50%,-50%);pointer-events:none;z-index:91;`;
      fx.appendChild(el);
      const angle = (Math.PI * 2 * i) / NUM_CHUNKS + (Math.random() - 0.5) * 0.5;
      const speed = 200 + Math.random() * 150; // px per second
      particles.push({ el, angle, speed, r, type: 'chunk', gravity: 0, x: 0, y: 0 });
    }

    // Sparks: bright glowing, DOM divs
    for (let i = 0; i < NUM_SPARKS; i++) {
      const el = document.createElement('div');
      const r = 2 + Math.random() * 5;
      const color = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
      el.style.cssText = `position:fixed;width:${r*2}px;height:${r*2}px;border-radius:50%;background:${color};box-shadow:0 0 10px 3px ${color};left:${cx}px;top:${cy}px;transform:translate(-50%,-50%);pointer-events:none;z-index:91;`;
      fx.appendChild(el);
      const angle = Math.random() * Math.PI * 2;
      const speed = 300 + Math.random() * 200;
      particles.push({ el, angle, speed, r, type: 'spark', gravity: 0, x: 0, y: 0 });
    }

    // ── Timing ──
    const CHARGE_DUR = 800;
    const BANG_DUR = 900;
    const REFORM_DELAY = 1200;
    const REFORM_DUR = 400;

    const lerpColor = (from, to, t) => {
      const fp = [parseInt(from.slice(1,3),16), parseInt(from.slice(3,5),16), parseInt(from.slice(5,7),16)];
      const tp = [parseInt(to.slice(1,3),16), parseInt(to.slice(3,5),16), parseInt(to.slice(5,7),16)];
      const r = Math.round(fp[0] + (tp[0]-fp[0])*t);
      const g = Math.round(fp[1] + (tp[1]-fp[1])*t);
      const b = Math.round(fp[2] + (tp[2]-fp[2])*t);
      return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    };
    const INK = '#0a0a0c';
    const HOT = '#ff2200';

    let phase = 'charge';
    let phaseT0 = performance.now();
    let lastTime = phaseT0;
    svg.style.transition = 'none';

    const animBurst = () => {
      if (!isActive()) return;
      const now = performance.now();
      const elapsed = now - phaseT0;
      const dt = Math.min((now - lastTime) / 1000, 0.05); // seconds, capped
      lastTime = now;

      if (phase === 'charge') {
        const p = Math.min(elapsed / CHARGE_DUR, 1);
        const ease = p * p;

        const color = lerpColor(INK, HOT, ease);
        this.bodyEl.setAttribute('fill', color);

        const pulse = 1 + Math.sin(p * Math.PI * 6) * 0.04 * ease;
        svg.style.transform = `scale(${(pulse * (1 + ease * 0.1)).toFixed(3)})`;
        svg.style.filter = `brightness(${(1 + ease * 1.5).toFixed(2)}) drop-shadow(0 0 ${(ease * 20).toFixed(0)}px rgba(255,40,0,${(ease*0.8).toFixed(2)}))`;

        const faceAlpha = (1 - ease).toFixed(2);
        for (const e of this.eyeEls) e.setAttribute('opacity', faceAlpha);
        if (this.mouthEl) this.mouthEl.setAttribute('opacity', faceAlpha);

        if (p >= 1) {
          // ── BANG! ──
          phase = 'bang';
          phaseT0 = now;
          lastTime = now;

          // Flash + shockwave
          const flash = document.createElement('div');
          flash.className = 'power-flash burst';
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 600);

          if (stage) {
            const shockwave = document.createElement('div');
            shockwave.className = 'burst-shockwave';
            stage.appendChild(shockwave);
            setTimeout(() => shockwave.remove(), 700);
          }

          // Body shrinks to 0.1 instantly + hide face
          svg.style.transition = 'transform 0.1s ease-out';
          svg.style.transform = 'scale(0.1)';
          svg.style.filter = '';
          this.bodyEl.setAttribute('opacity', '0');
          for (const e of this.eyeEls) e.setAttribute('opacity', '0');
          if (this.mouthEl) this.mouthEl.setAttribute('opacity', '0');
        }
        requestAnimationFrame(animBurst);

      } else if (phase === 'bang') {
        const p = Math.min(elapsed / BANG_DUR, 1);
        const ease = 1 - Math.pow(1 - p, 1.5);

        // Animate particles (DOM, px-based, can fly off screen)
        for (const pt of particles) {
          const d = pt.speed * ease;
          pt.gravity += (pt.type === 'chunk' ? 80 : 40) * dt;
          pt.x = Math.cos(pt.angle) * d;
          pt.y = Math.sin(pt.angle) * d + pt.gravity * p;
          pt.el.style.left = (cx + pt.x).toFixed(1) + 'px';
          pt.el.style.top = (cy + pt.y).toFixed(1) + 'px';

          if (pt.type === 'spark') {
            const life = Math.min(p / 0.45, 1);
            pt.el.style.opacity = (1 - life).toFixed(2);
            const sz = pt.r * 2 * (1 - life * 0.5);
            pt.el.style.width = sz + 'px';
            pt.el.style.height = sz + 'px';
          } else {
            const life = Math.min(p / 0.75, 1);
            pt.el.style.opacity = (1 - life).toFixed(2);
          }
        }

        if (p >= 1) {
          phase = 'wait';
          phaseT0 = now;
          // Remove all particles
          for (const pt of particles) pt.el.remove();
          particleLayer.remove();
        }
        requestAnimationFrame(animBurst);

      } else if (phase === 'wait') {
        if (elapsed >= REFORM_DELAY) {
          phase = 'reform';
          phaseT0 = now;
          this.bodyEl.setAttribute('fill', origFill);
          svg.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
          svg.style.transform = 'scale(0.2)';
          this.bodyEl.setAttribute('opacity', origOpacity || '1');
          for (const e of this.eyeEls) e.setAttribute('opacity', '1');
          if (this.mouthEl) this.mouthEl.setAttribute('opacity', '1');
          requestAnimationFrame(() => {
            if (!isActive()) return;
            svg.style.transform = 'scale(1)';
          });
        }
        requestAnimationFrame(animBurst);

      } else if (phase === 'reform') {
        const p = Math.min(elapsed / REFORM_DUR, 1);
        if (p >= 1) {
          this._burstActive = false;
          svg.style.transition = '';
          svg.style.transform = '';
          svg.style.opacity = '';
          svg.style.filter = '';
          if (this.mood === 'idle') this.engine.setState('idle', nowSec());
          if (stage) stage.classList.remove('power');
        } else {
          requestAnimationFrame(animBurst);
        }
      }
    };
    requestAnimationFrame(animBurst);
  }

  playMelt() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = this.svg;
    const stage = svg.closest('.stage');
    const svgRect = svg.getBoundingClientRect();
    const svgW = svgRect.width;
    const svgH = svgRect.height;

    this.engine.setState('idle', nowSec());

    const meltGroup = document.createElementNS(NS, 'g');
    svg.append(meltGroup);

    const origD = this.bodyEl.getAttribute('d');
    const origOpacity = this.bodyEl.getAttribute('opacity') || '1';
    const bodyColor = this.bodyEl.getAttribute('fill') || '#0a0a0c';

    // More drips for better liquid effect
    const DRIP_COUNT = 14;
    const drips = [];
    for (let i = 0; i < DRIP_COUNT; i++) {
      const a = (Math.PI * 2 * i) / DRIP_COUNT + (Math.random() - 0.5) * 0.3;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('fill', bodyColor);
      path.setAttribute('opacity', '0');
      meltGroup.append(path);
      drips.push({
        el: path, angle: a,
        delay: i * 0.05 + Math.random() * 0.2,
        progress: 0,
        maxLen: 40 + Math.random() * 70,
        width: 5 + Math.random() * 8,
        wobble: Math.random() * Math.PI * 2,
      });
    }

    // Puddle/pool — dark, wide, thin
    const pool = document.createElementNS(NS, 'ellipse');
    pool.setAttribute('cx', '0');
    pool.setAttribute('cy', '90');
    pool.setAttribute('rx', '0');
    pool.setAttribute('ry', '0');
    pool.setAttribute('fill', bodyColor);
    pool.setAttribute('opacity', '0');
    meltGroup.append(pool);

    // Small bubbles rising from puddle
    const bubbles = [];
    for (let i = 0; i < 5; i++) {
      const bub = document.createElementNS(NS, 'circle');
      bub.setAttribute('cx', String(-60 + Math.random() * 120));
      bub.setAttribute('cy', '88');
      bub.setAttribute('r', String(2 + Math.random() * 3));
      bub.setAttribute('fill', this.paperCache);
      bub.setAttribute('opacity', '0');
      meltGroup.append(bub);
      bubbles.push({ el: bub, delay: 0.3 + Math.random() * 0.5, x: -60 + Math.random() * 120 });
    }

    const MELT_DUR = 5000;
    const POOL_DUR = 2000;
    const REFORM_DUR = 2500;
    const t0 = performance.now();
    const eyeOrigOpacities = this.eyeEls.map(e => e.getAttribute('opacity') || '1');

    const animate = () => {
      const elapsed = performance.now() - t0;

      if (elapsed < MELT_DUR) {
        const p = elapsed / MELT_DUR;
        const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

        // Body squashes: wide & flat, with wobble jiggle
        const jiggle = Math.sin(p * Math.PI * 8) * 3 * (1 - p);
        const scaleY = 1 - ease * 0.88;
        const scaleX = 1 + ease * 0.7 + jiggle * 0.01;
        const translateY = ease * 55;
        svg.style.transform = `translateY(${translateY}px) scale(${scaleX}, ${scaleY})`;
        svg.style.transition = 'none';

        // Eyes slide down & fade as blob melts
        for (const e of this.eyeEls) {
          const eyeY = ease * 20;
          e.setAttribute('transform', `translate(0, ${eyeY.toFixed(1)})`);
          e.setAttribute('opacity', String((1 - ease * 0.95).toFixed(2)));
        }

        // Puddle grows wide and thin
        const poolRx = ease * svgW * 0.55;
        const poolRy = ease * 10;
        pool.setAttribute('rx', String(poolRx));
        pool.setAttribute('ry', String(poolRy));
        pool.setAttribute('cy', String(90 + ease * 5));
        pool.setAttribute('opacity', String(Math.min(ease * 1.5, 0.8).toFixed(2)));

        // Drips: organic liquid shapes with wobble
        for (const d of drips) {
          const dp = Math.max(0, Math.min(1, (p - d.delay) / (1 - d.delay)));
          if (dp <= 0) continue;
          const dripEase = dp < 0.3 ? dp / 0.3 * 0.3 : 0.3 + (dp - 0.3) * 0.7 / 0.7;
          const len = d.maxLen * dripEase;
          const w = d.width * (1 + dp * 0.4);
          const baseX = Math.cos(d.angle) * 70;
          const baseY = Math.sin(d.angle) * 60;
          const tipY = baseY + len;
          // Wobble for organic liquid feel
          const wobX = Math.sin(d.wobble + dp * 6) * 4 * dp;
          const bulgeW = w * (1 + Math.sin(dp * Math.PI) * 0.7);

          const d_path = `M${baseX - bulgeW / 2 + wobX},${baseY} ` +
            `Q${baseX - w / 2 + wobX * 0.5},${baseY + len * 0.4} ` +
            `${baseX - w * 0.3 + wobX},${tipY - w} ` +
            `Q${baseX + wobX},${tipY + w * 0.9} ` +
            `${baseX + w * 0.3 + wobX},${tipY - w} ` +
            `Q${baseX + w / 2 + wobX * 0.5},${baseY + len * 0.4} ` +
            `${baseX + bulgeW / 2 + wobX},${baseY} Z`;
          d.el.setAttribute('d', d_path);
          d.el.setAttribute('opacity', String(Math.min(dp * 3, 0.92).toFixed(2)));
        }

        // Bubbles rise during melt
        for (const b of bubbles) {
          const bp = Math.max(0, Math.min(1, (p - b.delay) / (1 - b.delay)));
          if (bp <= 0) continue;
          const riseY = 88 - bp * 15;
          b.el.setAttribute('cy', String(riseY));
          b.el.setAttribute('opacity', String((Math.sin(bp * Math.PI) * 0.5).toFixed(2)));
        }

        requestAnimationFrame(animate);
      } else if (elapsed < MELT_DUR + POOL_DUR) {
        const p = (elapsed - MELT_DUR) / POOL_DUR;
        // Puddle settles, slight ripple
        const ripple = Math.sin(p * Math.PI * 3) * 2;
        const poolRx = svgW * 0.55 + p * svgW * 0.05 + ripple;
        const poolRy = 10 + p * 4;
        pool.setAttribute('rx', String(poolRx));
        pool.setAttribute('ry', String(poolRy));
        pool.setAttribute('opacity', String((0.8 + p * 0.1).toFixed(2)));

        for (const d of drips) {
          d.el.setAttribute('opacity', String((0.92 * (1 - p * 0.4)).toFixed(2)));
        }
        for (const b of bubbles) {
          b.el.setAttribute('opacity', String((0.3 * (1 - p)).toFixed(2)));
        }

        requestAnimationFrame(animate);
      } else if (elapsed < MELT_DUR + POOL_DUR + REFORM_DUR) {
        const p = (elapsed - MELT_DUR - POOL_DUR) / REFORM_DUR;
        const ease = 1 - Math.pow(1 - p, 3);

        // Blob reformed: tall again, narrow back
        const scaleY = 0.12 + ease * 0.88;
        const scaleX = 1.7 - ease * 0.7;
        const translateY = 55 * (1 - ease);
        // Pop bounce at end
        const bounce = p > 0.8 ? Math.sin((p - 0.8) * Math.PI * 5) * 0.05 : 0;
        svg.style.transform = `translateY(${translateY}px) scale(${scaleX + bounce}, ${scaleY + bounce})`;

        for (const e of this.eyeEls) {
          e.setAttribute('transform', `translate(0, ${(20 * (1 - ease)).toFixed(1)})`);
          e.setAttribute('opacity', String((0.05 + ease * 0.95).toFixed(2)));
        }

        // Puddle shrinks as blob absorbs it back
        const poolRx = svgW * 0.6 * (1 - ease * 0.95);
        const poolRy = 14 * (1 - ease);
        pool.setAttribute('rx', String(poolRx));
        pool.setAttribute('ry', String(poolRy));
        pool.setAttribute('opacity', String((0.9 * (1 - ease)).toFixed(2)));

        for (const d of drips) {
          d.el.setAttribute('opacity', String((0.5 * (1 - ease)).toFixed(2)));
        }
        for (const b of bubbles) {
          b.el.setAttribute('opacity', '0');
        }

        requestAnimationFrame(animate);
      } else {
        svg.style.transform = '';
        svg.style.transition = 'transform 0.5s ease-out';
        for (const e of this.eyeEls) {
          e.setAttribute('transform', '');
          e.setAttribute('opacity', eyeOrigOpacities.shift());
        }
        meltGroup.remove();
        if (this.mood === 'idle') this.engine.setState('idle', nowSec());
      }
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

  playDizzy(duration = 2500) {
    const DIZZY_DUR = duration;
    this._dizzyActive = true;
    const origEyeData = this.eyeEls.map(e => ({
      d: e.getAttribute('d'),
      matrix: e.getAttribute('transform'),
      opacity: e.getAttribute('opacity') || '1',
      fill: e.getAttribute('fill'),
    }));
    const t0 = performance.now();
    const NS = 'http://www.w3.org/2000/svg';

    // Swirl stars (3 stars spinning around blob head)
    const stars = [];
    for (let i = 0; i < 3; i++) {
      const star = document.createElementNS(NS, 'g');
      const s = 14 + Math.random() * 6;
      star.innerHTML = `<path d="M0 -${s} L${s*0.3} -${s*0.3} L${s} 0 L${s*0.3} ${s*0.3} L0 ${s} L-${s*0.3} ${s*0.3} L-${s} 0 L-${s*0.3} -${s*0.3} Z" fill="#ffdd44" opacity="0.9"/>`;
      star.setAttribute('opacity', '0');
      this.svg.append(star);
      stars.push({ el: star, offset: (i * Math.PI * 2) / 3, radius: 90 + Math.random() * 20, size: s });
    }

    const animate = () => {
      if (!this._dizzyActive) return;
      const now = performance.now();
      const elapsed = now - t0;
      if (elapsed >= DIZZY_DUR) {
        // Restore eyes
        this.eyeEls.forEach((e, i) => {
          const o = origEyeData[i];
          e.setAttribute('d', o.d);
          e.setAttribute('transform', o.matrix);
          e.setAttribute('opacity', o.opacity);
          e.setAttribute('fill', o.fill);
        });
        if (this.mouthEl) this.mouthEl.setAttribute('opacity', '1');
        stars.forEach(s => s.el.remove());
        this.svg.style.transform = '';
        this._dizzyActive = false;
        if (this.mood === 'idle') this.engine.setState('idle', nowSec());
        return;
      }

      const p = elapsed / DIZZY_DUR;

      // Body wobbles/shakes (dizzy stagger)
      const shakeX = Math.sin(p * Math.PI * 20) * 4 * (1 - p * 0.5);
      const shakeY = Math.cos(p * Math.PI * 18) * 3 * (1 - p * 0.5);
      const tilt = Math.sin(p * Math.PI * 10) * 8 * (1 - p * 0.5);
      this.svg.style.transform = `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(1)}px) rotate(${tilt.toFixed(1)}deg)`;

      // Eyes = pulsing circles that grow & shrink (dizzy wide eyes)
      const eyeY = -10;
      const pulseT = p * Math.PI * 8;
      const eyeR = 8 + Math.sin(pulseT) * 4 + 4; // 8..16 range, pulsing
      for (let i = 0; i < 2; i++) {
        const eye = this.eyeEls[i];
        const ex = i === 0 ? -25 : 25;
        // Draw a filled circle that grows/shrinks
        eye.setAttribute('d', `M ${-eyeR} 0 A ${eyeR} ${eyeR} 0 1 0 ${eyeR} 0 A ${eyeR} ${eyeR} 0 1 0 ${-eyeR} 0 Z`);
        eye.setAttribute('transform', `translate(${ex}, ${eyeY})`);
        eye.setAttribute('opacity', '1');
        eye.setAttribute('fill', this.eyeColorCache);
        eye.setAttribute('stroke', 'none');
      }

      // Wavy worm-like mouth (squiggly line like a worm/caterpillar)
      if (this.mouthEl) {
        const t = p * Math.PI * 10;
        const pts = [];
        for (let i = 0; i <= 20; i++) {
          const px = -18 + (i / 20) * 36;
          const py = Math.sin(t + i * 0.6) * 5 + Math.cos(t * 1.3 + i * 0.4) * 3;
          pts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`);
        }
        this.mouthEl.setAttribute('d', pts.join(' '));
        this.mouthEl.setAttribute('transform', 'translate(0, 35)');
        this.mouthEl.setAttribute('stroke', this.eyeColorCache);
        this.mouthEl.setAttribute('stroke-width', '3');
        this.mouthEl.setAttribute('stroke-linecap', 'round');
        this.mouthEl.setAttribute('fill', 'none');
        this.mouthEl.setAttribute('opacity', '1');
      }

      // Stars orbit around blob head, spinning
      const starOp = p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const sa = p * Math.PI * 6 + s.offset;
        const sx = Math.cos(sa) * s.radius;
        const sy = -80 + Math.sin(sa) * 30;
        const srot = p * 720 + i * 120;
        s.el.setAttribute('transform', `translate(${sx.toFixed(1)}, ${sy.toFixed(1)}) rotate(${srot.toFixed(1)})`);
        s.el.setAttribute('opacity', starOp.toFixed(2));
      }

      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
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
  let userActive = false;
  let userActiveTimer = null;

  function markUserActive() {
    userActive = true;
    if (currentClass) {
      const computed = getComputedStyle(svg).transform;
      svg.classList.remove('idle-anim', currentClass, ...PEEK_DIRS);
      currentClass = null;
      if (computed && computed !== 'none') {
        svg.style.transform = computed;
        svg.style.transition = 'transform 0.6s ease-out';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            svg.style.transform = '';
            svg.addEventListener('transitionend', () => { svg.style.transition = ''; }, { once: true });
          });
        });
      }
    }
    clearTimeout(userActiveTimer);
    userActiveTimer = setTimeout(() => { userActive = false; scheduleNext(2000); }, 15000);
    scheduleNext(2000);
  }

  function pickIdle() {
    if (!running || userActive) return;
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
      svg.classList.remove('idle-anim', cls);
      if (peekDir) svg.classList.remove(peekDir);
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
    resume() { running = true; scheduleNext(); },
    markUserActive
  };
}
