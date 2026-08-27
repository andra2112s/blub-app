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
      node.setAttribute('fill', this.eyeColorCache);
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

    if (fx === 'burst') {
      this._playBurstWithFuse(stage);
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

  _playBurstWithFuse(stage) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = this.svg;

    if (stage) stage.classList.add('power');
    svg.style.transition = '';

    const fuseG = document.createElementNS(NS, 'g');
    fuseG.setAttribute('class', 'burst-fuse');
    const fuseLine = document.createElementNS(NS, 'line');
    fuseLine.setAttribute('x1', '0');
    fuseLine.setAttribute('y1', '-120');
    fuseLine.setAttribute('x2', '0');
    fuseLine.setAttribute('y2', '-80');
    fuseLine.setAttribute('stroke', '#888');
    fuseLine.setAttribute('stroke-width', '3');
    fuseLine.setAttribute('stroke-linecap', 'round');
    fuseG.append(fuseLine);

    const spark = document.createElementNS(NS, 'circle');
    spark.setAttribute('cx', '0');
    spark.setAttribute('cy', '-120');
    spark.setAttribute('r', '5');
    spark.setAttribute('fill', '#ff6600');
    spark.setAttribute('filter', 'url(#glow)');
    fuseG.append(spark);

    const fuseGlow = document.createElementNS(NS, 'circle');
    fuseGlow.setAttribute('cx', '0');
    fuseGlow.setAttribute('cy', '-120');
    fuseGlow.setAttribute('r', '12');
    fuseGlow.setAttribute('fill', 'rgba(255,100,0,0.3)');
    fuseGlow.setAttribute('filter', 'blur(4px)');
    fuseG.push && fuseG.append(fuseGlow);

    svg.append(fuseG);

    const FUSE_DUR = 1200;
    const t0 = performance.now();

    const animFuse = () => {
      const elapsed = performance.now() - t0;
      const p = Math.min(elapsed / FUSE_DUR, 1);
      const fuseLen = 40 * (1 - p);
      const headY = -120 + 40 * p;
      const headX = Math.sin(p * 12) * 3;
      fuseLine.setAttribute('y2', String(-80 + 40 * p));
      fuseLine.setAttribute('stroke', p < 0.7 ? '#888' : '#555');
      spark.setAttribute('cy', String(headY));
      spark.setAttribute('cx', String(headX));
      spark.setAttribute('r', String(4 + Math.sin(p * 30) * 1.5));
      fuseGlow.setAttribute('cy', String(headY));
      fuseGlow.setAttribute('r', String(10 + Math.sin(p * 20) * 4));

      const flickerBright = 0.7 + Math.random() * 0.6;
      spark.setAttribute('fill', `rgba(255,${Math.floor(80 + 80 * p)},0,${flickerBright})`);

      if (p < 1) {
        requestAnimationFrame(animFuse);
      } else {
        fuseG.remove();
        this._shatterBurst(stage);
      }
    };
    requestAnimationFrame(animFuse);
  }

  _shatterBurst(stage) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = this.svg;

    const flash = document.createElement('div');
    flash.className = 'power-flash burst';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 800);

    svg.style.filter = 'brightness(2)';
    svg.style.transform = 'scale(1.3)';

    const origD = this.bodyEl.getAttribute('d');
    const origOpacity = this.bodyEl.getAttribute('opacity');

    const NUM_SHARDS = 12;
    const shardGroup = document.createElementNS(NS, 'g');
    svg.append(shardGroup);
    this.bodyEl.setAttribute('opacity', '0');

    for (const e of this.eyeEls) e.setAttribute('opacity', '0');

    const shards = [];
    for (let i = 0; i < NUM_SHARDS; i++) {
      const path = document.createElementNS(NS, 'path');
      const angle = (Math.PI * 2 * i) / NUM_SHARDS;
      const nextAngle = (Math.PI * 2 * (i + 1)) / NUM_SHARDS;
      const r1 = 40 + Math.random() * 30;
      const r2 = 40 + Math.random() * 30;
      const cx = Math.cos(angle) * r1 * 0.3;
      const cy = Math.sin(angle) * r1 * 0.3;
      const p1x = Math.cos(angle) * r1;
      const p1y = Math.sin(angle) * r1;
      const p2x = Math.cos(nextAngle) * r2;
      const p2y = Math.sin(nextAngle) * r2;
      const cp1x = Math.cos(angle + 0.3) * r1 * 0.8;
      const cp1y = Math.sin(angle + 0.3) * r1 * 0.8;
      const cp2x = Math.cos(nextAngle - 0.3) * r2 * 0.8;
      const cp2y = Math.sin(nextAngle - 0.3) * r2 * 0.8;
      path.setAttribute('d', `M${cx},${cy} Q${cp1x},${cp1y} ${p1x},${p1y} L0,0 L${p2x},${p2y} Q${cp2x},${cp2y} ${cx},${cy} Z`);
      path.setAttribute('fill', '#0a0a0c');
      path.setAttribute('stroke', 'rgba(255,100,0,0.3)');
      path.setAttribute('stroke-width', '0.5');
      shardGroup.append(path);

      const speed = 80 + Math.random() * 120;
      const spin = (Math.random() - 0.5) * 720;
      shards.push({ el: path, angle, speed, spin, dist: 0 });
    }

    const t0 = performance.now();
    const SHATTER_DUR = 800;
    const REFORM_DUR = 600;
    let phase = 'explode';

    const animShatter = () => {
      const elapsed = performance.now() - t0;

      if (phase === 'explode') {
        const p = Math.min(elapsed / SHATTER_DUR, 1);
        const ease = 1 - Math.pow(1 - p, 2);
        for (const s of shards) {
          const d = s.speed * ease;
          const dx = Math.cos(s.angle) * d;
          const dy = Math.sin(s.angle) * d + p * p * 40;
          s.dist = d;
          s.el.setAttribute('transform', `translate(${dx.toFixed(1)},${dy.toFixed(1)}) rotate(${(s.spin * ease).toFixed(1)})`);
          s.el.setAttribute('opacity', String((1 - p * 0.3).toFixed(2)));
        }
        if (p >= 1) {
          phase = 'reform';
          svg.style.transition = 'filter 0.6s, transform 0.6s';
          svg.style.filter = '';
          svg.style.transform = 'scale(1)';
        } else {
          requestAnimationFrame(animShatter);
        }
      } else if (phase === 'reform') {
        const p = Math.min((elapsed - SHATTER_DUR) / REFORM_DUR, 1);
        const ease = p * p;
        for (const s of shards) {
          const d = s.dist * (1 - ease);
          const dx = Math.cos(s.angle) * d;
          const dy = Math.sin(s.angle) * d + (1 - ease) * (1 - ease) * 40;
          s.el.setAttribute('transform', `translate(${dx.toFixed(1)},${dy.toFixed(1)}) rotate(${(s.spin * (1 - ease)).toFixed(1)})`);
          s.el.setAttribute('opacity', String((0.7 + 0.3 * ease).toFixed(2)));
        }
        if (p >= 1) {
          shardGroup.remove();
          this.bodyEl.setAttribute('opacity', origOpacity || '1');
          for (const e of this.eyeEls) e.setAttribute('opacity', '1');
          if (this.mood === 'idle') this.engine.setState('idle', nowSec());
          if (stage) stage.classList.remove('power');
        } else {
          requestAnimationFrame(animShatter);
        }
      }
    };
    requestAnimationFrame(animShatter);
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

    const DRIP_COUNT = 8;
    const drips = [];
    const angles = [];
    for (let i = 0; i < DRIP_COUNT; i++) {
      const a = (Math.PI * 2 * i) / DRIP_COUNT + (Math.random() - 0.5) * 0.4;
      angles.push(a);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('fill', this.paperCache);
      path.setAttribute('opacity', '0');
      meltGroup.append(path);
      drips.push({ el: path, angle: a, delay: i * 0.08 + Math.random() * 0.15, progress: 0, maxLen: 30 + Math.random() * 50, width: 4 + Math.random() * 6 });
    }

    const pool = document.createElementNS(NS, 'rect');
    pool.setAttribute('x', String(-svgW * 0.6));
    pool.setAttribute('y', String(80));
    pool.setAttribute('width', String(svgW * 1.2));
    pool.setAttribute('height', '0');
    pool.setAttribute('rx', '4');
    pool.setAttribute('fill', this.paperCache);
    pool.setAttribute('opacity', '0');
    meltGroup.append(pool);

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

        const scaleY = 1 - ease * 0.85;
        const scaleX = 1 + ease * 0.6;
        const translateY = ease * 50;
        svg.style.transform = `translateY(${translateY}px) scale(${scaleX}, ${scaleY})`;
        svg.style.transition = 'none';

        for (const e of this.eyeEls) {
          const eyeY = ease * 15;
          e.setAttribute('transform', `translate(0, ${eyeY.toFixed(1)})`);
          e.setAttribute('opacity', String((1 - ease * 0.9).toFixed(2)));
        }

        const poolW = ease * svgW * 0.9;
        const poolH = ease * 12;
        pool.setAttribute('y', String(80 - poolH * 0.3));
        pool.setAttribute('height', String(poolH));
        pool.setAttribute('width', String(poolW));
        pool.setAttribute('x', String(-poolW / 2));
        pool.setAttribute('opacity', String(Math.min(ease * 2, 0.85)));

        for (const d of drips) {
          const dp = Math.max(0, Math.min(1, (p - d.delay) / (1 - d.delay)));
          if (dp <= 0) continue;
          const dripEase = dp < 0.3 ? dp / 0.3 * 0.3 : 0.3 + (dp - 0.3) * 0.7 / 0.7;
          const len = d.maxLen * dripEase;
          const w = d.width * (1 + dp * 0.5);
          const baseX = Math.cos(d.angle) * 65;
          const baseY = Math.sin(d.angle) * 65;
          const tipY = baseY + len;
          const bulgeW = w * (1 + Math.sin(dp * Math.PI) * 0.6);

          const d_path = `M${baseX - bulgeW / 2},${baseY} Q${baseX - w / 2},${baseY + len * 0.4} ${baseX - w * 0.3},${tipY - w} Q${baseX},${tipY + w * 0.8} ${baseX + w * 0.3},${tipY - w} Q${baseX + w / 2},${baseY + len * 0.4} ${baseX + bulgeW / 2},${baseY} Z`;
          d.el.setAttribute('d', d_path);
          d.el.setAttribute('opacity', String(Math.min(dp * 3, 0.9).toFixed(2)));
        }

        requestAnimationFrame(animate);
      } else if (elapsed < MELT_DUR + POOL_DUR) {
        const p = (elapsed - MELT_DUR) / POOL_DUR;
        const poolW = svgW * 0.9 + p * svgW * 0.1;
        const poolH = 12 + p * 8;
        pool.setAttribute('height', String(poolH));
        pool.setAttribute('width', String(poolW));
        pool.setAttribute('x', String(-poolW / 2));
        pool.setAttribute('opacity', String((0.85 + p * 0.1).toFixed(2)));

        for (const d of drips) {
          d.el.setAttribute('opacity', String((0.9 * (1 - p * 0.5)).toFixed(2)));
        }

        requestAnimationFrame(animate);
      } else if (elapsed < MELT_DUR + POOL_DUR + REFORM_DUR) {
        const p = (elapsed - MELT_DUR - POOL_DUR) / REFORM_DUR;
        const ease = 1 - Math.pow(1 - p, 3);

        const scaleY = 0.15 + ease * 0.85;
        const scaleX = 1.6 - ease * 0.6;
        const translateY = 50 * (1 - ease);
        svg.style.transform = `translateY(${translateY}px) scale(${scaleX}, ${scaleY})`;

        for (const e of this.eyeEls) {
          e.setAttribute('transform', `translate(0, ${(15 * (1 - ease)).toFixed(1)})`);
          e.setAttribute('opacity', String((0.1 + ease * 0.9).toFixed(2)));
        }

        const poolW = svgW * (1 - ease * 0.9);
        const poolH = 20 * (1 - ease);
        pool.setAttribute('height', String(poolH));
        pool.setAttribute('width', String(poolW));
        pool.setAttribute('x', String(-poolW / 2));
        pool.setAttribute('opacity', String((0.95 * (1 - ease)).toFixed(2)));

        for (const d of drips) {
          d.el.setAttribute('opacity', String((0.45 * (1 - ease)).toFixed(2)));
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
    userActiveTimer = setTimeout(() => { userActive = false; scheduleNext(2000); }, 3000);
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
    resume() { running = true; scheduleNext(); },
    markUserActive
  };
}
