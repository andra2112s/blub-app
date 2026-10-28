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

const INK = '#14141e';

const FX_HOLD = {
  burst: 2400,
  comet: 3000,
  orbit: 3200,
  swirl: 3400,
  exclaim: 2000,
  notify: 2600,
  glow: 4000
};

export const SHAPES_INFO = [
  { id: 'galet', label: 'Cibul' },
  { id: 'squircle', label: 'Squircle' },
  { id: 'triangle', label: 'Segitiga' },
  { id: 'hexagone', label: 'Heksagon' },
  { id: 'nuage', label: 'Awan' },
  { id: 'mochi3d', label: 'Mochi' },
  { id: 'ghost3d', label: 'Hantu' },
  { id: 'lukis', label: 'Hollow' }
];

const OLD_SHAPE_MAP = {
  bulat: 'cercle',
  telur: 'goutte',
  squish: 'galet',
  tetes: 'goutte',
  bunga: 'nuage'
};

const MOOD = {
  idle:    { state: 'idle',      expr: null },
  happy:   { state: 'idle',      expr: 'heureux' },
  excite:  { state: 'play',      expr: 'hilare' },
  think:   { state: 'thinking',  expr: 'curieux' },
  listen:  { state: 'idle',      expr: 'attentif' },
  sad:     { state: 'idle',      expr: 'triste' },
  sleepy:  { state: 'sleep',     expr: 'somnolent' },
  surpris: { state: 'alert',     expr: 'surpris' },
  scare:   { state: 'wide',      expr: 'effraye' },
  doubt:   { state: 'idle',      expr: 'mefiant' },
  confuse: { state: 'idle',      expr: 'confus' },
  proud:   { state: 'idle',      expr: 'fier' },
  shy:     { state: 'idle',      expr: 'timide' },
  bored:   { state: 'idle',      expr: 'blase' }
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

/* Override bentuk mata per ekspresi — menggantikan kapsul engine yang
   terlalu kaku (robot) atau terlalu tipis (coretan) untuk ekspresi ini.
   Dipakai dengan matriks posisi/rotasi engine apa adanya. */
const EYE_D_OVERRIDE = {
  // Menangis: mata terpejam melengkung — stroke ujung bulat
  triste:  { d: 'M -8.5 -2 Q 0 9 8.5 -2', w: 5.5 },
  // Senang/tertawa: mata tertutup ∩∩ gemuk (gaya ^_^), ujung bulat
  heureux: { d: 'M -10 3 Q 0 -7 10 3', w: 6 },
  hilare:  { d: 'M -10 3 Q 0 -12 10 3', w: 6 },
  // Bosan: garis mata hampir lurus, melengkung tipis ke atas
  blase:   { d: 'M -10 2 Q 0 -3 10 2', w: 5 }
};

function mouthPath(shape) {
  const { type, w, h } = shape;
  const hw = w / 2;
  switch (type) {
    case 'smile': return `M ${-hw} 0 Q 0 ${h} ${hw} 0`;
    case 'frown': return `M ${-hw} 0 Q 0 ${-h} ${hw} 0`;
    case 'line':  return `M ${-hw} 0 Q 0 1.5 ${hw} 0`;
    case 'open':  return `M ${-hw * 0.5} 0 A ${hw * 0.5} ${h} 0 1 0 ${hw * 0.5} 0 A ${hw * 0.5} ${h} 0 1 0 ${-hw * 0.5} 0`;
    case 'smirk': return `M ${-hw} 0 Q 0 ${h} ${hw * 0.5} ${h * 0.5}`;
    case 'wavy':  return `M ${-hw} 0 Q ${-hw * 0.5} ${h} 0 0 Q ${hw * 0.5} ${-h} ${hw} 0`;
    default:      return `M ${-hw} 0 L ${hw} 0`;
  }
}

export function shapePreviewPath(id) {
  const rec = SHAPE_BY_ID.get(id);
  if (!rec) return id === 'lukis' ? 'M0 -58C38 -58 64 -34 64 -2C64 30 36 52 0 52C-36 52 -64 30 -64 -2C-64 -34 -38 -58 0 -58Z' : '';
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

// Menghitung warna yang lebih gelap dari warna badan (mempertahankan saturasi & hue, bukan hitam)
function shadeHex(hex, factor = 0.45) {
  const parse = (h) => {
    let clean = (h || '#14141e').replace(/^#/, '');
    if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
    const v = parseInt(clean, 16);
    return isNaN(v) ? [20, 20, 30] : [v >> 16 & 255, v >> 8 & 255, v & 255];
  };
  const [r, g, b] = parse(hex);
  const dr = Math.round(Math.max(10, r * factor));
  const dg = Math.round(Math.max(10, g * factor));
  const db = Math.round(Math.max(12, b * factor));
  return `#${[dr, dg, db].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// Menghitung varian lebih terang dari warna badan (tint ke arah putih, mempertahankan hue)
function tintHex(hex, factor = 0.5) {
  let clean = (hex || '#14141e').replace(/^#/, '');
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
  const v = parseInt(clean, 16);
  const [r, g, b] = isNaN(v) ? [20, 20, 30] : [v >> 16 & 255, v >> 8 & 255, v & 255];
  const t = (x) => Math.round(x + (255 - x) * factor);
  return `#${[t(r), t(g), t(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

let _blobUid = 0;

export class BlobCharacter {
  constructor(svg, opts = {}) {
    this.svg = svg;
    // Suffixe unique par instance : les ids de defs (gradients, clip) sont
    // globaux au document, sans suffixe deux blobs se voleraient leurs defs.
    this._uid = ++_blobUid;
    const U = (id) => `${id}-${this._uid}`;
    this._u = U;
    this.onPokeSound = opts.onPokeSound || (() => {});
    this.onBurstSound = opts.onBurstSound || (() => {});
    this.onQuip = opts.onQuip || (() => {});

    const requested = OLD_SHAPE_MAP[opts.shape] || opts.shape;
    this.shapeId = SHAPE_BY_ID.has(requested) ? requested : 'cercle';
    this._painted = requested === 'lukis';   // mode lukis: shapeId tetap shape valid, yang tampil flipbook

    svg.innerHTML = '';
    svg.setAttribute('viewBox', '-158 -158 316 316');

    this.gBack = el('g');
    this.bodyEl = el('path', { fill: INK, 'fill-opacity': this.shapeId === 'ghost3d' ? '0' : '0.87' });
    this.gEyes = el('g');
    this.eyeEls = [el('path', { fill: 'none' }), el('path', { fill: 'none' })];
    this.mouthEl = el('path', { fill: 'none', 'stroke-width': '3.5', 'stroke-linecap': 'round' });
    this.gFront = el('g');
    this.dotPool = [];
    this._glowColor = localStorage.getItem('Mochi.glowColor') || '#ffffff';

    this.gEyes.append(...this.eyeEls, this.mouthEl);

    /* ── Translucent Mochi Glass / Jelly Shader with Chocolate Core ── */
    this.bodyEl.setAttribute('id', U('blobBodyPath'));
    const defs = el('defs');
    const clip = el('clipPath', { id: U('blobBodyClip') });
    clip.append(el('use', { href: `#${U('blobBodyPath')}` }));

    // Chocolate Core Gradients (filling deep inside thick mochi skin)
    // Stops otomatis mengikuti warna yang lebih gelap dari warna badan (bukan hitam)
    const radChoco = el('radialGradient', {
      id: U('blobChocoGrad'), cx: '0', cy: '10', r: '42', gradientUnits: 'userSpaceOnUse'
    });
    this.chocoStop0 = el('stop', { offset: '0%', 'stop-color': shadeHex(INK, 0.30), 'stop-opacity': '0.78' });
    this.chocoStop1 = el('stop', { offset: '45%', 'stop-color': shadeHex(INK, 0.48), 'stop-opacity': '0.55' });
    this.chocoStop2 = el('stop', { offset: '75%', 'stop-color': shadeHex(INK, 0.65), 'stop-opacity': '0.22' });
    this.chocoStop3 = el('stop', { offset: '100%', 'stop-color': shadeHex(INK, 0.65), 'stop-opacity': '0' });
    radChoco.append(this.chocoStop0, this.chocoStop1, this.chocoStop2, this.chocoStop3);

    const radChocoHi = el('radialGradient', {
      id: U('blobChocoHi'), cx: '-4', cy: '6', r: '26', gradientUnits: 'userSpaceOnUse'
    });
    this.chocoHiStop0 = el('stop', { offset: '0%', 'stop-color': shadeHex(INK, 0.22), 'stop-opacity': '0.50' });
    this.chocoHiStop1 = el('stop', { offset: '80%', 'stop-color': shadeHex(INK, 0.22), 'stop-opacity': '0' });
    radChocoHi.append(this.chocoHiStop0, this.chocoHiStop1);
    this._lastCoreFill = INK;

    // 1. Translucent vertical light wash: soft light passing through jelly body
    const linVert = el('linearGradient', {
      id: U('blobShadeVert'), gradientUnits: 'userSpaceOnUse',
      x1: '0', y1: '-100', x2: '0', y2: '100'
    });
    this.vertStop2 = el('stop', { offset: '70%', 'stop-color': shadeHex(INK, 0.85), 'stop-opacity': '0.10' });
    linVert.append(
      el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.35' }),
      el('stop', { offset: '30%', 'stop-color': '#ffffff', 'stop-opacity': '0.08' }),
      this.vertStop2,
      el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0.25' })
    );

    // 2. Subsurface scattering: soft inner light diffusing from center-belly
    const radCore = el('radialGradient', {
      id: U('blobMochiCore'), cx: '0', cy: '10', r: '95', gradientUnits: 'userSpaceOnUse'
    });
    radCore.append(
      el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.30' }),
      el('stop', { offset: '45%', 'stop-color': '#ffffff', 'stop-opacity': '0.12' }),
      el('stop', { offset: '85%', 'stop-color': '#ffffff', 'stop-opacity': '0.02' }),
      el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' })
    );

    // 3. Soft top dome light
    const radDome = el('radialGradient', {
      id: U('blobShadeHi'), cx: '-18', cy: '-50', r: '105', gradientUnits: 'userSpaceOnUse'
    });
    radDome.append(
      el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.38' }),
      el('stop', { offset: '40%', 'stop-color': '#ffffff', 'stop-opacity': '0.12' }),
      el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' })
    );

    // 4. Bottom bounce / caustic light: ground reflection in translucent belly
    const radBounce = el('radialGradient', {
      id: U('blobMochiBounce'), cx: '0', cy: '75', r: '85', gradientUnits: 'userSpaceOnUse'
    });
    radBounce.append(
      el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.28' }),
      el('stop', { offset: '55%', 'stop-color': '#ffffff', 'stop-opacity': '0.08' }),
      el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' })
    );

    // 5. Fresnel inner rim glow: tinted rim light derived from body color
    const linRim = el('linearGradient', {
      id: U('blobRimGrad'), x1: '0', y1: '-1', x2: '0', y2: '1'
    });
    this.rimStop0 = el('stop', { offset: '0%', 'stop-color': tintHex(INK, 0.80), 'stop-opacity': '0.70' });
    this.rimStop1 = el('stop', { offset: '50%', 'stop-color': tintHex(INK, 0.45), 'stop-opacity': '0.20' });
    this.rimStop2 = el('stop', { offset: '100%', 'stop-color': tintHex(INK, 0.15), 'stop-opacity': '0.50' });
    linRim.append(this.rimStop0, this.rimStop1, this.rimStop2);

    // 5b. Skin tone gradient: translucent skin shaded from body color
    // (bright tint at top → deeper saturated shade at bottom), so the skin is not flat
    const linSkin = el('linearGradient', {
      id: U('blobSkinGrad'), gradientUnits: 'userSpaceOnUse',
      x1: '-35', y1: '-105', x2: '35', y2: '115'
    });
    this.skinStop0 = el('stop', { offset: '0%', 'stop-color': tintHex(INK, 0.78), 'stop-opacity': '0.75' });
    this.skinStop1 = el('stop', { offset: '38%', 'stop-color': tintHex(INK, 0.35), 'stop-opacity': '0.30' });
    this.skinStop2 = el('stop', { offset: '62%', 'stop-color': INK, 'stop-opacity': '0.10' });
    this.skinStop3 = el('stop', { offset: '86%', 'stop-color': shadeHex(INK, 0.88), 'stop-opacity': '0.20' });
    this.skinStop4 = el('stop', { offset: '100%', 'stop-color': shadeHex(INK, 0.80), 'stop-opacity': '0.32' });
    linSkin.append(this.skinStop0, this.skinStop1, this.skinStop2, this.skinStop3, this.skinStop4);

    // 5c. Arm gradient (objectBoundingBox): same light direction as the skin per arm
    const linArm = el('linearGradient', { id: U('blobArmGrad'), x1: '0', y1: '0', x2: '0.35', y2: '1' });
    this.armStop0 = el('stop', { offset: '0%', 'stop-color': tintHex(INK, 0.65), 'stop-opacity': '0.65' });
    this.armStop1 = el('stop', { offset: '45%', 'stop-color': tintHex(INK, 0.25), 'stop-opacity': '0.22' });
    this.armStop2 = el('stop', { offset: '100%', 'stop-color': shadeHex(INK, 0.82), 'stop-opacity': '0.45' });
    linArm.append(this.armStop0, this.armStop1, this.armStop2);

    // 6. Primary glossy glass/jelly specular highlight
    const linSpec = el('linearGradient', {
      id: U('blobShadeSpec'), x1: '0', y1: '0', x2: '1', y2: '1'
    });
    linSpec.append(
      el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.80' }),
      el('stop', { offset: '45%', 'stop-color': '#ffffff', 'stop-opacity': '0.30' }),
      el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' })
    );

    // 6b. Ghost aura: aura ethereal lembut di belakang badan (khusus ghost3d)
    const radGhostGlow = el('radialGradient', {
      id: U('blobGhostGlow'), cx: '0', cy: '0', r: '140', gradientUnits: 'userSpaceOnUse'
    });
    this.glowStop0 = el('stop', { offset: '0%', 'stop-color': tintHex(INK, 0.85), 'stop-opacity': '0.6' });
    this.glowStop1 = el('stop', { offset: '60%', 'stop-color': tintHex(INK, 0.62), 'stop-opacity': '0.3' });
    this.glowStop2 = el('stop', { offset: '100%', 'stop-color': tintHex(INK, 0.5), 'stop-opacity': '0' });
    radGhostGlow.append(this.glowStop0, this.glowStop1, this.glowStop2);

    // 6c. Ghost core: inti bercahaya di dalam badan (khusus ghost3d)
    const radGhostCore = el('radialGradient', {
      id: U('blobGhostCore'), cx: '0', cy: '0', r: '60', gradientUnits: 'userSpaceOnUse'
    });
    radGhostCore.append(
      el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '1' }),
      el('stop', { offset: '55%', 'stop-color': '#ffffff', 'stop-opacity': '0.55' }),
      el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' })
    );

    defs.append(clip, radChoco, radChocoHi, linVert, radCore, radDome, radBounce, linRim, linSkin, linArm, linSpec, radGhostGlow, radGhostCore);

    // ── Stubby Cute Arms: Tangan melengkung organik menyatu dari badan (tanpa jari) ──
    const ARM_PATH_L = 'M 0 0 C -22 3 -46 11 -52 23 C -57 33 -46 41 -32 38 C -18 35 -4 27 10 17 Z';
    const ARM_PATH_R = 'M 0 0 C 22 3 46 11 52 23 C 57 33 46 41 32 38 C 18 35 4 27 -10 17 Z';

    this.gArms = el('g', { class: 'blob-arms' });
    this.armL = el('g', { class: 'blob-arm-l' });
    this.armR = el('g', { class: 'blob-arm-r' });

    this.armLBase = el('path', { d: ARM_PATH_L, fill: INK, 'fill-opacity': '0.80' });
    this.armLShade = el('path', { d: ARM_PATH_L, fill: `url(#${U('blobArmGrad')})` });
    this.armLHi = el('ellipse', { cx: '-18', cy: '10', rx: '11', ry: '4.5', fill: '#ffffff', opacity: '0.32', transform: 'rotate(-14 -18 10)' });
    this.armL.append(this.armLBase, this.armLShade, this.armLHi);

    this.armRBase = el('path', { d: ARM_PATH_R, fill: INK, 'fill-opacity': '0.80' });
    this.armRShade = el('path', { d: ARM_PATH_R, fill: `url(#${U('blobArmGrad')})` });
    this.armRHi = el('ellipse', { cx: '18', cy: '10', rx: '11', ry: '4.5', fill: '#ffffff', opacity: '0.32', transform: 'rotate(14 18 10)' });
    this.armR.append(this.armRBase, this.armRShade, this.armRHi);

    this.gArms.append(this.armL, this.armR);
    this._lastArmFill = INK;
    this._fsil = { s: 1, cx: 0, cy: 0, rot: 0 };

    // Solid chocolate core (filling softly diffused inside thick translucent mochi skin)
    this.gCore = el('g', { 'clip-path': `url(#${U('blobBodyClip')})`, 'pointer-events': 'none' });
    this.chocoBase = el('ellipse', { cx: '0', cy: '14', rx: '40', ry: '34', fill: `url(#${U('blobChocoGrad')})` });
    this.chocoHi = el('ellipse', { cx: '-3', cy: '10', rx: '24', ry: '18', fill: `url(#${U('blobChocoHi')})` });
    this.gCore.append(this.chocoBase, this.chocoHi);

    this.gShade = el('g', { 'clip-path': `url(#${U('blobBodyClip')})`, 'pointer-events': 'none' });
    this.gShade.append(
      // 1. Subsurface scattering glow
      el('circle', { cx: '0', cy: '10', r: '95', fill: `url(#${U('blobMochiCore')})` }),
      // 2. Translucent vertical wash
      el('rect', { x: '-160', y: '-160', width: '320', height: '320', fill: `url(#${U('blobShadeVert')})` }),
      // 2b. Skin tone gradient: body-color tint, bright top → deep bottom
      el('use', { href: `#${U('blobBodyPath')}`, fill: `url(#${U('blobSkinGrad')})` }),
      // 3. Soft top dome light
      el('ellipse', { cx: '-18', cy: '-50', rx: '105', ry: '80', fill: `url(#${U('blobShadeHi')})` }),
      // 4. Ground bounce ambient reflection in belly
      el('ellipse', { cx: '0', cy: '75', rx: '85', ry: '45', fill: `url(#${U('blobMochiBounce')})` }),
      // 5. Fresnel inner rim glow: wide translucent rim around mochi body
      el('use', { href: `#${U('blobBodyPath')}`, fill: 'none', stroke: `url(#${U('blobRimGrad')})`, 'stroke-width': '16', opacity: '0.62' }),
      // 6-8. Specular gloss: grup terpisah (gSpec) — bergerak pelan mengikuti arah mata
      (() => {
        this.gSpec = el('g');
        this.gSpec.append(
          el('ellipse', { cx: '-52', cy: '-66', rx: '17', ry: '8', fill: `url(#${U('blobShadeSpec')})`, transform: 'rotate(-26 -52 -66)' }),
          el('circle', { cx: '-44', cy: '-88', r: '4.2', fill: '#ffffff', opacity: '0.9' }),
          el('circle', { cx: '-31', cy: '-91', r: '1.7', fill: '#ffffff', opacity: '0.55' }),
          el('ellipse', { cx: '57', cy: '-52', rx: '11', ry: '4.5', fill: '#ffffff', opacity: '0.16', transform: 'rotate(32 57 -52)' })
        );
        return this.gSpec;
      })(),
      // inti cahaya ghost — di dalam clip badan, berdenyut pelan di loop
      (this.ghostCore = el('ellipse', { cx: '0', cy: '38', rx: '50', ry: '36', fill: `url(#${U('blobGhostCore')})`, opacity: '0' }))
    );

    /* ── Mochi 3D : telinga terkulai + ekor di BELAKANG badan, kaki di DEPAN ──
       Appendage digambar sebagai elemen terpisah (tepi bersih), bukan bagian
       siluet — badan tetap dome mulus. Sinkron warna di _loop. */
    const partDefs = [
      // telinga kiri-kanan: terkulai ke bawah di sisi badan
      ['ellipse', { cx: '-100', cy: '38', rx: '17', ry: '36', transform: 'rotate(8 -100 38)' }],
      ['ellipse', { cx: '100', cy: '36', rx: '16', ry: '34', transform: 'rotate(-8 100 36)' }],
      // kaki vertikal, di belakang badan — hanya ujungnya yang mengintip di bawah
      ['ellipse', { cx: '-28', cy: '76', rx: '12', ry: '18' }],
      ['ellipse', { cx: '28', cy: '76', rx: '12', ry: '18' }],
      // bola kecil kanan-atas (ekor)
      ['circle', { cx: '78', cy: '-58', r: '15' }]
    ];
    this.gMochiParts = el('g', { class: 'mochi3d-parts', style: 'display:none' });
    this.mochiPartFills = [];
    for (const [tag, attrs] of partDefs) {
      const base = el(tag, { ...attrs, fill: INK, 'fill-opacity': '0.84' });
      const shade = el(tag, { ...attrs, fill: `url(#${U('blobArmGrad')})` });
      this.mochiPartFills.push(base);
      this.gMochiParts.append(base, shade);
    }

    /* ── Mochi 3D decor: blush + taburan gula (khas mochi foto referensi) ──
       Disembunyikan kecuali shapeId === 'mochi3d'. */
    // Aura hantu: glow radial lembut di belakang badan, berdenyut pelan
    this.ghostGlow = el('ellipse', {
      cx: '0', cy: '8', rx: '132', ry: '138',
      fill: `url(#${U('blobGhostGlow')})`, 'pointer-events': 'none', style: 'display:none'
    });
    this.gBack.append(this.ghostGlow);

    this.gMochi3d = el('g', { 'clip-path': `url(#${U('blobBodyClip')})`, 'pointer-events': 'none', style: 'display:none' });
    // Taburan gula halus — titik-titik kecil tersebar di seluruh badan
    const sugarSeed = [
      [-58,-42,1.6],[-38,-58,1.2],[-15,-64,1.8],[8,-66,1.3],[30,-58,1.6],[52,-44,1.4],
      [-66,-18,1.5],[-44,-30,1.1],[-22,-44,1.9],[2,-48,1.4],[26,-40,1.7],[48,-26,1.2],
      [62,-10,1.6],[-70,4,1.3],[-52,-8,1.8],[-30,-20,1.4],[-8,-28,1.6],[14,-30,1.2],
      [36,-18,1.9],[56,-2,1.4],[-64,22,1.7],[-44,8,1.3],[-20,-4,1.6],[4,-10,1.4],
      [28,0,1.8],[50,14,1.2],[-56,40,1.5],[-36,28,1.8],[-12,16,1.3],[12,14,1.7],
      [34,26,1.4],[46,38,1.6],[-42,50,1.2],[-18,42,1.9],[8,38,1.4],[30,44,1.6],
      [-8,58,1.3],[20,56,1.5],[-30,62,1.2]
    ];
    for (const [sx, sy, sr] of sugarSeed) {
      this.gMochi3d.append(el('circle', {
        cx: sx, cy: sy, r: sr, fill: '#ffffff', opacity: '0.5'
      }));
    }
    // Blush pipi merah muda — diposisikan relatif ke mata tiap frame
    this.blushL = el('ellipse', { cx: '0', cy: '0', rx: '13', ry: '8', fill: '#ff8fa8', opacity: '0.55' });
    this.blushR = el('ellipse', { cx: '0', cy: '0', rx: '13', ry: '8', fill: '#ff8fa8', opacity: '0.55' });
    // Lidah kecil melet — menempel tepat di bawah mulut
    this.tongueEl = el('path', {
      d: 'M -5 0 Q -5 9 0 9 Q 5 9 5 0 Q 0 2.5 -5 0 Z',
      fill: '#ff7d9c', stroke: '#e05f7e', 'stroke-width': '1'
    });
    this.gMochi3d.append(this.blushL, this.blushR, this.tongueEl);

    // Kilau mata manik (mochi3d): titik putih kecil di pojok atas mata
    this.glintL = el('circle', { r: '1.8', fill: '#ffffff', opacity: '0' });
    this.glintR = el('circle', { r: '1.8', fill: '#ffffff', opacity: '0' });
    this.gEyes.append(this.glintL, this.glintR);

    // All blob content wrapped in gBody so gaze tilt can move the whole body
    this.gBody = el('g');
    // ghost: badan dirender sebagai glow berwarna badan (dari gradient tint), bukan fill solid
    this.ghostBody = el('path', { fill: `url(#${U('blobGhostGlow')})`, stroke: INK, 'stroke-width': '4', 'stroke-opacity': '0.5', 'pointer-events': 'none', style: 'display:none' });
    this.gBody.append(this.gBack, this.gArms, this.gMochiParts, this.bodyEl, this.ghostBody, this.gCore, this.gShade, this.gMochi3d, this.gEyes, this.gFront);
    svg.append(defs, this.gBody);
    this.gazeX = 0; this.gazeY = 0;
    this.gazeTargetX = 0; this.gazeTargetY = 0;

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

  _updateSkinColors(fill) {
    if (this._lastCoreFill === fill) return;
    this._lastCoreFill = fill;
    // Chocolate core: darker body-derived shades
    const cDeep = shadeHex(fill, 0.30);
    const cMid = shadeHex(fill, 0.48);
    const cEdge = shadeHex(fill, 0.65);
    const cHi = shadeHex(fill, 0.22);
    this.chocoStop0.setAttribute('stop-color', cDeep);
    this.chocoStop1.setAttribute('stop-color', cMid);
    this.chocoStop2.setAttribute('stop-color', cEdge);
    this.chocoStop3.setAttribute('stop-color', cEdge);
    this.chocoHiStop0.setAttribute('stop-color', cHi);
    this.chocoHiStop1.setAttribute('stop-color', cHi);
    // Vertical wash: stop gelap ikut warna badan (bukan hitam)
    this.vertStop2.setAttribute('stop-color', shadeHex(fill, 0.85));
    // Translucent skin gradient: bright tint top → soft deep bottom (iOS glass)
    this.skinStop0.setAttribute('stop-color', tintHex(fill, 0.78));
    this.skinStop1.setAttribute('stop-color', tintHex(fill, 0.35));
    this.skinStop2.setAttribute('stop-color', fill);
    this.skinStop3.setAttribute('stop-color', shadeHex(fill, 0.88));
    this.skinStop4.setAttribute('stop-color', shadeHex(fill, 0.80));
    // Fresnel rim: tinted edge light
    this.rimStop0.setAttribute('stop-color', tintHex(fill, 0.80));
    this.rimStop1.setAttribute('stop-color', tintHex(fill, 0.45));
    this.rimStop2.setAttribute('stop-color', tintHex(fill, 0.15));
    // Arms: same light direction as skin
    this.armStop0.setAttribute('stop-color', tintHex(fill, 0.65));
    this.armStop1.setAttribute('stop-color', tintHex(fill, 0.25));
    this.armStop2.setAttribute('stop-color', shadeHex(fill, 0.82));
    // Ghost aura: pale body-tinted glow
    this.glowStop0.setAttribute('stop-color', tintHex(fill, 0.85));
    this.glowStop1.setAttribute('stop-color', tintHex(fill, 0.62));
    this.glowStop2.setAttribute('stop-color', tintHex(fill, 0.5));
    if (this.ghostBody) this.ghostBody.setAttribute('stroke', fill);
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

    /* ── Gaze tilt: body leans/squashes toward where the eyes look ── */
    if (!this.lookActive) { this.gazeTargetX = 0; this.gazeTargetY = 0; }
    this.gazeX += (this.gazeTargetX - this.gazeX) * 0.08;
    this.gazeY += (this.gazeTargetY - this.gazeY) * 0.08;
    // Hantu melayang: bob naik-turun pelan di sepanjang animasinya
    const bobY = this.shapeId === 'ghost3d' ? Math.sin(now * 1.35) * 5 : 0;
    if (Math.abs(this.gazeX) > 0.01 || Math.abs(this.gazeY) > 0.01 || Math.abs(bobY) > 0.01) {
      const gx = this.gazeX, gy = this.gazeY;
      this.gBody.setAttribute('transform',
        `translate(${(gx * 9).toFixed(1)} ${(gy * 5 + bobY).toFixed(1)}) ` +
        `rotate(${(gx * 3).toFixed(1)}) skewX(${(gx * -4).toFixed(1)}) ` +
        `scale(${(1 - Math.abs(gx) * 0.045).toFixed(3)} ${(1 + Math.abs(gx) * 0.02).toFixed(3)})`);
      if (this.gCore) {
        const cx = (gx * 4.5).toFixed(1);
        const cy = (gy * 3).toFixed(1);
        this.gCore.setAttribute('transform', `translate(${cx} ${cy})`);
      }
    } else if (this.gBody.hasAttribute('transform')) {
      this.gBody.removeAttribute('transform');
      if (this.gCore && this.gCore.hasAttribute('transform')) this.gCore.removeAttribute('transform');
    }
    // spec gloss: melayang pelan sendiri + bergeser mengikuti arah mata (tidak fixed ke badan)
    if (this.gSpec) this.gSpec.setAttribute('transform',
      `translate(${(this.gazeX * 9 + Math.sin(now * 0.7) * 2.6).toFixed(1)} ${(this.gazeY * 5 + Math.cos(now * 0.53) * 1.7).toFixed(1)})`);
    // ghost: kilau spec disembunyikan — sebagai gantinya inti bercahaya di dalam badan
    const isGhostShape = this.shapeId === 'ghost3d';
    if (this.gSpec) this.gSpec.style.display = isGhostShape ? 'none' : '';
    // ghost: semua lapisan shading + inti cokelat disembunyikan — badan hanya glow berwarna badan
    if (this.gShade) this.gShade.style.display = isGhostShape ? 'none' : '';
    if (this.gCore) this.gCore.style.display = isGhostShape ? 'none' : '';
    if (this.ghostBody) {
      this.ghostBody.style.display = isGhostShape ? '' : 'none';
      // badan glow berdenyut pelan — ritme sama seperti bob hantu
      if (isGhostShape) this.ghostBody.setAttribute('opacity', (0.8 + Math.sin(now * 1.35) * 0.2).toFixed(2));
    }
    // inti disembunyikan — badan ghost sudah seluruhnya glow
    if (this.ghostCore) this.ghostCore.style.display = 'none';

    const curFill = this.bodyEl.getAttribute('fill') || INK;
    this._updateSkinColors(curFill);

    /* ── Animate stubby cute arms ── */
    /* mochi3d : les oreilles/pattes sont des elements separes — pas de bras */
    const isMochi3d = this.shapeId === 'mochi3d';
    const isGhost = this.shapeId === 'ghost3d';
    const armsHidden = isMochi3d || isGhost;
    if (this.gArms) this.gArms.style.display = armsHidden ? 'none' : '';
    // Aura hantu: tampil hanya untuk ghost3d, berdenyut pelan
    if (this.ghostGlow) {
      this.ghostGlow.style.display = isGhost ? '' : 'none';
      if (isGhost) {
        this.ghostGlow.setAttribute('opacity', (0.75 + Math.sin(now * 1.6) * 0.2).toFixed(2));
      }
    }
    if (this.gMochi3d) this.gMochi3d.style.display = isMochi3d ? '' : 'none';

    if (this._lastArmFill !== curFill) {
      this._lastArmFill = curFill;
      for (const p of this.mochiPartFills) p.setAttribute('fill', curFill);
      this.armLBase.setAttribute('fill', curFill);
      this.armRBase.setAttribute('fill', curFill);
    }

    if (isMochi3d) {
      // Telinga/kaki/ekor mengikuti transformasi siluet (menyusut/miring/geser)
      const fs = this._fsil;
      const k = Math.max(0.2, Math.min(1, fs.s));
      const rotDeg = fs.rot * 180 / Math.PI;
      const sway = Math.sin(now * 2.5) * 1.5;
      const t = `translate(${fs.cx.toFixed(1)} ${fs.cy.toFixed(1)}) rotate(${(rotDeg).toFixed(1)}) scale(${k.toFixed(2)}) translate(${(-fs.cx).toFixed(1)} ${(-fs.cy).toFixed(1)})`;
      if (this.gMochiParts) {
        this.gMochiParts.style.display = '';
        this.gMochiParts.setAttribute('transform', `rotate(${sway.toFixed(1)} 0 -20) ` + t);
      }
    } else {
      if (this.gMochiParts) this.gMochiParts.style.display = 'none';
    }

    if (this.gArms && !armsHidden && !this._micMode && !this._timerMode) {
      const isCheering = this.currentExpr === 'excite' || this.currentExpr === 'heureux' || this.currentExpr === 'hilare';
      const isSleepy = this.mood === 'sleepy' || this.currentExpr === 'somnolent';

      const isTri = this.shapeId === 'triangle';
      const baseY = isTri ? 20 : 6;
      const baseX = isTri ? 68 : 68;

      const breath = Math.sin(now * 2.8) * 1.5;

      let rotL = 0, rotR = 0;
      let offY = breath;
      let offX = 0;

      if (isTri) { rotL = -32; rotR = 32; }   // miring mengikuti lereng segitiga
      else if (isCheering) {
        rotL = -42 + Math.sin(now * 8) * 6;
        rotR = 42 - Math.sin(now * 8) * 6;
        offY = -12 + Math.abs(Math.sin(now * 8)) * 3;
      } else if (isSleepy) {
        rotL = 12;
        rotR = -12;
        offY = 6 + breath * 0.5;
      } else {
        rotL = Math.sin(now * 2.5) * 2;
        rotR = -Math.sin(now * 2.5) * 2;
      }

      // Lengan mengikuti siluet hidup (skala/posisi/rotasi dari engine) supaya
      // tetap menempel saat tubuh mengecil, bergeser, atau berputar.
      const fs = this._fsil;
      const k = Math.max(0.2, Math.min(1, fs.s));
      const cosR = Math.cos(fs.rot), sinR = Math.sin(fs.rot);
      const rotDeg = fs.rot * 180 / Math.PI;
      const ay = baseY + offY;
      let lx = fs.cx + ((-baseX + offX) * cosR - ay * sinR) * k;
      let ly = fs.cy + ((-baseX + offX) * sinR + ay * cosR) * k;
      let rx = fs.cx + ((baseX - offX) * cosR - ay * sinR) * k;
      let ry = fs.cy + ((baseX - offX) * sinR + ay * cosR) * k;
      if (isTri) { lx = fs.cx - (82 * fs.s + 10); ly = fs.cy - 8 * fs.s + breath * .5; rx = fs.cx + 82 * fs.s + 10; ry = fs.cy - 8 * fs.s + breath * .5; }  // segitiga: tepi lereng — ikut skala/posisi siluet supaya tidak detas saat squash

      this.armL.setAttribute('transform', `translate(${lx.toFixed(1)}, ${ly.toFixed(1)}) rotate(${(rotL + rotDeg).toFixed(1)}) scale(${k.toFixed(2)})`);
      this.armR.setAttribute('transform', `translate(${rx.toFixed(1)}, ${ry.toFixed(1)}) rotate(${(rotR + rotDeg).toFixed(1)}) scale(${k.toFixed(2)})`);
      if (!this._burstActive) {
        this.gArms.style.opacity = (isTri ? 1 : Math.max(0, Math.min(1, (fs.s - 0.38) / 0.22))).toFixed(2);
      }
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
      console.error('[Mochi] engine error', err);
      requestAnimationFrame(this._raf);
      return;
    }

    this.bodyEl.setAttribute('d', frame.bodyPath);
    this.bodyEl.setAttribute('opacity', frame.bodyAlpha.toFixed(2));
    if (this.ghostBody) this.ghostBody.setAttribute('d', frame.bodyPath);
    if (frame.silScale != null) {
      this._fsil = { s: frame.silScale, cx: frame.silCx, cy: frame.silCy, rot: frame.silRot };
      // Mata & mulut ikut offset siluet hidup (napas/bob pelan) — tanpa ini mata
      // tampak "lepas" saat badan bergerak pelan seperti saat tidur.
      this.gEyes.setAttribute('transform',
        `translate(${frame.silCx.toFixed(1)} ${frame.silCy.toFixed(1)}) rotate(${(frame.silRot * 180 / Math.PI).toFixed(1)}) scale(${Math.max(0.2, frame.silScale).toFixed(3)})`);
    }

    /* ── Skip face rendering during burst, orbit, or dizzy ── */
    if (this._burstActive || this._orbitActive || this._dizzyActive) {
      requestAnimationFrame(this._raf);
      return;
    }

    // mochi3d : mata manik gelap (bukan warna kertas) + kilau putih
    // ghost3d : mata rongga gelap (hollow eyes) — lebih seram
    let eyeCol = this.eyeColorCache;
    if (isMochi3d || isGhost) {
      let bl = 0.5;
      const hv = parseInt((curFill || '#14141e').replace('#', ''), 16);
      if (!isNaN(hv)) {
        const rr = hv >> 16 & 255, gg = hv >> 8 & 255, bb = hv & 255;
        bl = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255;
      }
      eyeCol = isMochi3d
        ? (bl > 0.32 ? '#4a2f33' : '#e8e4ec')
        : (bl > 0.3 ? shadeHex(curFill, 0.35) : '#d9d4e0');
    }
    for (let i = 0; i < 2; i++) {
      const eye = frame.eyes[i];
      const node = this.eyeEls[i];
      const glint = i === 0 ? this.glintL : this.glintR;
      if (!eye || eye.alpha <= 0.01) {
        node.setAttribute('d', '');
        if (glint) glint.setAttribute('opacity', '0');
        continue;
      }
      const ov = EYE_D_OVERRIDE[this.currentExpr];
      node.setAttribute('d', ov ? ov.d : eye.d);
      if (ov) {
        // Matriks engine menyertakan skala mata ekspresi (heureux sangat tipis)
        // — ambil hanya posisi + rotasi, path override tampil di ukuran natural
        const m = eye.matrix.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)\)/);
        const rot = m ? Math.atan2(parseFloat(m[2]), parseFloat(m[1])) * 180 / Math.PI : 0;
        node.setAttribute('transform', m ? `translate(${m[5]}, ${m[6]}) rotate(${rot.toFixed(1)})` : eye.matrix);
        // Ujung bulat: gambar sebagai stroke, bukan fill
        node.setAttribute('fill', 'none');
        node.setAttribute('stroke', eyeCol);
        node.setAttribute('stroke-width', ov.w);
        node.setAttribute('stroke-linecap', 'round');
        if (glint) glint.setAttribute('opacity', '0');
      } else {
        node.setAttribute('transform', eye.matrix);
        node.setAttribute('fill', eyeCol);
        node.setAttribute('stroke', 'none');
        // Kilau manik: ikut posisi mata, offset pojok kiri-atas
        if (glint) {
          const gm = eye.matrix.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)\)/);
          if (gm && isMochi3d) {
            glint.setAttribute('transform', `translate(${parseFloat(gm[5]) - 2.4}, ${parseFloat(gm[6]) - 3.4})`);
            glint.setAttribute('opacity', (eye.alpha * 0.9).toFixed(2));
          } else {
            glint.setAttribute('opacity', '0');
          }
        }
      }
      node.setAttribute('opacity', eye.alpha.toFixed(2));
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
        // Average rotation of both eyes
        const avgRot = eyePos.reduce((s, p) => s + p.rot, 0) / eyePos.length;
        const midX = eyePos.reduce((s, p) => s + p.x, 0) / eyePos.length;
        const midY = eyePos.reduce((s, p) => s + p.y, 0) / eyePos.length;
        // Mulut ditaruh tegak lurus garis antar-mata — tetap di tengah sumbu
        // wajah walau kepala miring atau satu mata lebih tinggi dari yang lain
        let offA = Math.PI / 2; // lurus ke bawah (satu mata / sejajar)
        if (eyePos.length >= 2) {
          const [p1, p2] = eyePos[0].x <= eyePos[1].x ? eyePos : [eyePos[1], eyePos[0]];
          offA = Math.atan2(p2.y - p1.y, p2.x - p1.x) + Math.PI / 2;
        }
        const cx = midX + Math.cos(offA) * 26;
        const cy = midY + Math.sin(offA) * 26;
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
        this.mouthEl.setAttribute('stroke', eyeCol);
        const mouthAlpha = Math.min(...eyePos.map((p) => p.a));
        this.mouthEl.setAttribute('opacity', mouthAlpha.toFixed(2));
        // Lidah mochi3d menempel persis di bawah mulut — disembunyikan saat
        // ekspresi negatif (cemberut/sedih) karena melet tidak cocok
        if (this.tongueEl) {
          const tongueOK = !['frown', 'wavy'].includes(finalShape.type);
          this.tongueEl.setAttribute('transform',
            `translate(${cx.toFixed(1)}, ${cy.toFixed(1)}) rotate(${avgRot.toFixed(1)}) translate(0, 2)`);
          this.tongueEl.setAttribute('opacity', (tongueOK ? mouthAlpha : 0).toFixed(2));
        }
        // Blush mengikuti posisi mata: di luar-bawah tiap mata, ikut kemiringan wajah
        if (this.blushL && this.blushR) {
          const sideA = offA - Math.PI / 2; // arah garis antar-mata (kiri→kanan)
          const sorted = [...eyePos].sort((a, b) => a.x - b.x);
          const bl = [this.blushL, this.blushR];
          for (let i = 0; i < Math.min(2, sorted.length); i++) {
            const p = sorted[i];
            const sgn = i === 0 ? -1 : 1;
            const bx = p.x + Math.cos(sideA) * sgn * 15 + Math.cos(offA) * 17;
            const by = p.y + Math.sin(sideA) * sgn * 15 + Math.sin(offA) * 17;
            bl[i].setAttribute('transform',
              `translate(${bx.toFixed(1)}, ${by.toFixed(1)}) rotate(${avgRot.toFixed(1)})`);
            bl[i].setAttribute('opacity', (p.a * 0.55).toFixed(2));
          }
        }
      }
    }
    if (this.mouthEl.getAttribute('d') === '') {
      if (this.tongueEl) this.tongueEl.setAttribute('opacity', '0');
      if (this.blushL) { this.blushL.setAttribute('opacity', '0'); this.blushR.setAttribute('opacity', '0'); }
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

  getEyePositions() {
    return this.eyeEls.map(e => {
      const t = e.getAttribute('transform') || '';
      const m = t.match(/matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)\)/);
      if (!m) return null;
      return { x: parseFloat(m[5]), y: parseFloat(m[6]) };
    }).filter(Boolean);
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
    this.gazeTargetX = Math.max(-1, Math.min(1, nx * 2 - 1));
    this.gazeTargetY = Math.max(-1, Math.min(1, ny * 2 - 1));
  }

  poke() {
    const now = nowSec();
    // lagi tidur → linglung dulu (confus), bukan wink yang tak kelihatan di mata merem
    if (this.mood === 'sleepy') {
      this.setState('confuse', 1400);
    } else {
      this.engine.setState('wink', now);
    }
    this.onPokeSound();
    this.onQuip();
    setTimeout(() => {
      if (this.mood === 'idle') this.engine.setState('idle', nowSec());
    }, 1500);
  }

  getShape() {
    return this._painted ? 'lukis' : this.shapeId;
  }

  setShape(id) {
    if (id === 'lukis') { this._painted = true; return; }   // flipbook painted Mochi; engine shape dibiarkan
    const rec = SHAPE_BY_ID.get(id);
    if (!rec) return;
    this._painted = false;
    this.shapeId = id;
    // Hantu lebih tembus pandang (sifat hantu); bentuk lain kulit mochi normal
    this.bodyEl.setAttribute('fill-opacity', id === 'ghost3d' ? '0' : '0.87');
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
    if (this.gCore) this.gCore.style.display = 'none';
    if (this.gArms) this.gArms.style.display = 'none';

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
        if (self.gCore) self.gCore.style.display = '';
        if (self.gArms) self.gArms.style.display = '';
        for (const e of eyeEls) e.setAttribute('opacity', '1');
        if (mouthEl) mouthEl.setAttribute('opacity', '1');
      } else {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  /* ── Timer dot-matrix morph: blob breaks into dots forming time digits ── */

  // 5x7 dot matrix font (standard LED display), 2x7 for colon
  static DOT_FONT = {
    '0': ['01110','10001','10011','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'],
    '3': ['11111','00010','00100','00010','00001','10001','01110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['00110','01000','10000','11110','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00010','01100'],
    ':': ['00','00','01','00','01','00','00'],
  };

  static computeDotPositions(timeStr) {
    // 5x7 font — width 5 for digits, 2 for colon
    // SP tuned so "25:00" (widest) fits within viewBox 316px
    const SP = 12;   // dot spacing
    const GAP = 6;   // gap between characters
    const ROWS = 7;
    // Compute total width
    let totalW = 0;
    for (const ch of timeStr) {
      const cw = ch === ':' ? 2 : 5;
      totalW += cw * SP + GAP;
    }
    totalW -= GAP;
    let x = -totalW / 2;
    const y0 = -(ROWS - 1) * SP / 2;
    const pts = [];
    for (const ch of timeStr) {
      const font = BlobCharacter.DOT_FONT[ch];
      if (!font) { x += 5 * SP + GAP; continue; }
      const cw = ch === ':' ? 2 : 5;
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
    return 5;
  }

  enterTimerMode() {
    if (this._timerMode || this._timerMorphing) return;
    this._timerMorphing = true;
    this._timerSavedBodyD = this.bodyEl.getAttribute('d');
    this._timerSavedBodyOpacity = this.bodyEl.getAttribute('opacity') || '1';
    this._timerSavedBodyFill = this.bodyEl.getAttribute('fill') || '#0a0a0c';
    if (this.gCore) this.gCore.style.display = 'none';
    if (this.gArms) this.gArms.style.display = 'none';

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
    // Smooth power-style morph: quick squish → hold → dots fly out
    const DUR = 900;
    const SHRINK_END = 0.35;
    const t0 = performance.now();

    const animate = () => {
      const now = performance.now();
      const elapsed = now - t0;
      const p = Math.min(elapsed / DUR, 1);

      // Body scale: smooth squish using easeInOut (like power effects)
      let scale;
      if (p < SHRINK_END) {
        const lp = p / SHRINK_END;
        scale = 1 - BlobCharacter._easeInOut(lp) * 0.45;
      } else {
        const lp = (p - SHRINK_END) / (1 - SHRINK_END);
        scale = 0.55 + BlobCharacter._easeOut(lp) * 0.45;
      }

      // Body opacity: smooth fade out with easeInOut
      const bodyOpacity = Math.max(0, 1 - BlobCharacter._easeInOut(Math.min(p / 0.55, 1)));
      bodyEl.setAttribute('opacity', bodyOpacity.toFixed(3));
      svg.style.transform = `scale(${scale.toFixed(4)})`;
      // Power-style glow that fades as morph completes
      const glow = (1 - p) * 0.6;
      svg.style.filter = `brightness(${(1 + glow * 0.7).toFixed(3)}) drop-shadow(0 0 ${(glow * 20).toFixed(1)}px rgba(124,92,255,${glow.toFixed(3)}))`;

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
      const sx = (Math.random() - 0.5) * 40;
      const sy = (Math.random() - 0.5) * 40;
      d.el.style.transition = 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.7s ease';
      d.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      d.el.style.opacity = '0';
    }

    // Restore blob body path
    if (self._timerSavedBodyD) bodyEl.setAttribute('d', self._timerSavedBodyD);
    bodyEl.setAttribute('fill', self._timerSavedBodyFill);

    svg.style.willChange = 'transform, filter';

    // Body grows back + fades in with power-style bounce
    const DUR = 700;
    const DELAY = 150;
    const t0 = performance.now() + DELAY;

    const animate = () => {
      const now = performance.now();
      if (now < t0) { requestAnimationFrame(animate); return; }
      const p = Math.min((now - t0) / DUR, 1);
      const ease = BlobCharacter._easeOut(p);

      // Bounce-back scale: start small, overshoot slightly, settle
      const scale = 0.5 + ease * 0.5;
      svg.style.transform = `scale(${scale.toFixed(4)})`;
      bodyEl.setAttribute('opacity', ease.toFixed(3));
      // Gentle glow fades out as blob reforms
      const glow = (1 - p) * 0.4;
      svg.style.filter = `brightness(${(1 + glow * 0.5).toFixed(3)}) drop-shadow(0 0 ${(glow * 15).toFixed(1)}px rgba(124,92,255,${glow.toFixed(3)}))`;

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
        if (self.gCore) self.gCore.style.display = '';
        if (self.gArms) self.gArms.style.display = '';
        if (self.mood === 'idle') self.engine.setState('idle', nowSec());
        for (const e of eyeEls) e.setAttribute('opacity', '1');
        if (mouthEl) mouthEl.setAttribute('opacity', '1');
      } else {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  /* ── Meditation mode: blob closes eyes, breathes slowly, soft glow ── */
  enterMeditation() {
    if (this._meditating) return;
    this._meditating = true;
    const svg = this.svg;
    const eyeEls = this.eyeEls;
    const mouthEl = this.mouthEl;
    const self = this;

    // Save current state
    this._medSavedState = this.engine.getState ? this.engine.getState() : 'idle';

    // Set sleepy state (eyes closed, calm)
    this.engine.setState('sleep', nowSec());
    this.engine.setExpression(EXPR_BY_ID.somnolent, nowSec());

    // Soft calm glow + slow breathing scale
    svg.style.transition = 'filter 1.5s ease-in-out';
    svg.style.filter = 'drop-shadow(0 0 20px rgba(124,92,255,0.3)) brightness(0.95)';

    // Breathing animation
    const t0 = performance.now();
    const breathe = () => {
      if (!self._meditating) return;
      const t = (performance.now() - t0) / 1000;
      // Slow breathing: 4s inhale, 4s exhale
      const breath = 1 + Math.sin(t * Math.PI / 4) * 0.04;
      svg.style.transform = `scale(${breath.toFixed(4)})`;
      requestAnimationFrame(breathe);
    };
    requestAnimationFrame(breathe);

    // Gentle smile
    if (mouthEl) {
      setTimeout(() => {
        if (!self._meditating) return;
        mouthEl.setAttribute('d', 'M -12 15 Q 0 22 12 15');
        mouthEl.setAttribute('stroke', self.eyeColorCache);
        mouthEl.setAttribute('opacity', '0.7');
      }, 800);
    }
  }

  exitMeditation() {
    if (!this._meditating) return;
    this._meditating = false;
    const svg = this.svg;

    // Fade out glow
    svg.style.transition = 'filter 0.8s ease, transform 0.8s ease';
    svg.style.filter = '';
    svg.style.transform = '';

    // Restore idle state
    this.engine.setState('idle', nowSec());
    this.engine.setExpression(EXPR_BY_ID.neutre, nowSec());

    setTimeout(() => {
      svg.style.transition = '';
    }, 850);
  }

  triggerState(fx) {
    clearTimeout(this.holdTimer);
    clearTimeout(this.fxTimer);
    this.mood = 'idle';
    const stage = this.svg.closest('.stage');

    if (fx === 'glow') {
      this._glow(stage);
      return;
    }

    if (fx === 'burst') {
      this._shatterBurst(stage);
      return;
    }

    if (fx === 'orbit') {
      this._orbitEyes(stage);
      return;
    }

    if (!STATE_BY_ID.has(fx)) return;

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
        this.svg.style.transition = 'filter 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
        this.svg.style.filter = 'drop-shadow(0 0 6px rgba(124,92,255,0.15))';
        this.svg.style.transform = 'translate(0px, 0px) rotate(0deg) scale(1)';
        this._fxCleanupTimer = setTimeout(() => {
          this.svg.style.transition = '';
          this.svg.style.filter = '';
          this.svg.style.transform = '';
          this._fxCleanupTimer = null;
        }, 550);
      }, 3000);
    } else {
      this.svg.style.transition = 'filter 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
      this.svg.style.filter = 'drop-shadow(0 0 25px rgba(124,92,255,0.8)) brightness(1.4)';
      this.svg.style.transform = 'scale(1.15)';
      this.fxTimer = setTimeout(() => {
        if (this.mood === 'idle') this.engine.setState('idle', nowSec());
        if (stage) stage.classList.remove('power');
        // Smooth transition back — set explicit target values, not empty strings
        this.svg.style.transition = 'filter 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
        this.svg.style.filter = 'drop-shadow(0 0 6px rgba(124,92,255,0.15))';
        this.svg.style.transform = 'translate(0px, 0px) rotate(0deg) scale(1)';
        // Clear inline styles after transition completes so HTML defaults take over
        this._fxCleanupTimer = setTimeout(() => {
          this.svg.style.transition = '';
          this.svg.style.filter = '';
          this.svg.style.transform = '';
          this._fxCleanupTimer = null;
        }, 550);
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

  _glow(stage) {
    const GLOW_DUR = 4000;
    this._glowActive = true;
    if (stage) stage.classList.add('power', 'glow');

    const c = this._glowColor;
    const rgb = c.replace('#', '');
    const r = parseInt(rgb.slice(0, 2), 16);
    const g = parseInt(rgb.slice(2, 4), 16);
    const b = parseInt(rgb.slice(4, 6), 16);

    const flash = document.createElement('div');
    flash.className = 'power-flash glow';
    flash.style.background = `radial-gradient(circle at center, rgba(${r},${g},${b},0.85), rgba(255,255,255,0.35) 40%, transparent 70%)`;
    flash.style.animation = 'flashBang 1.2s ease-out forwards';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1200);

    const origFill = this.bodyEl.getAttribute('fill') || '#0a0a0c';
    this.bodyEl.setAttribute('fill', c);
    this.svg.style.transition = 'filter 0.4s ease, transform 0.4s ease';
    this.svg.style.filter = `brightness(2.5) drop-shadow(0 0 45px ${c})`;
    this.svg.style.transform = 'scale(1.1)';

    const rayCount = 12;
    const rays = [];
    for (let i = 0; i < rayCount; i++) {
      const a = (Math.PI * 2 * i) / rayCount;
      const line = el('line', {
        x1: '0', y1: '0',
        x2: (Math.cos(a) * 160).toFixed(1),
        y2: (Math.sin(a) * 160).toFixed(1),
        stroke: c, 'stroke-width': '5',
        'stroke-linecap': 'round', opacity: '0.85'
      });
      this.gBack.append(line);
      rays.push(line);
    }

    const t0 = performance.now();
    const animate = () => {
      if (!this._glowActive) return;
      const now = performance.now();
      const p = (now - t0) / GLOW_DUR;
      if (p >= 1) {
        this._glowActive = false;
        rays.forEach((r) => r.remove());
        this.bodyEl.setAttribute('fill', origFill);
        this.svg.style.transition = 'filter 0.6s ease, transform 0.6s ease';
        this.svg.style.filter = 'drop-shadow(0 0 6px rgba(124,92,255,0.15))';
        this.svg.style.transform = 'translate(0px, 0px) rotate(0deg) scale(1)';
        if (stage) stage.classList.remove('power', 'glow');
        this._fxCleanupTimer = setTimeout(() => {
          this.svg.style.transition = '';
          this.svg.style.filter = '';
          this.svg.style.transform = '';
        }, 650);
        return;
      }
      const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * 8);
      const grow = 1 + p * 0.6;
      rays.forEach((r, i) => {
        const a = (Math.PI * 2 * i) / rayCount + p * Math.PI;
        const r1 = 70 + pulse * 20;
        const r2 = (150 + p * 100) * grow;
        r.setAttribute('x1', (Math.cos(a) * r1).toFixed(1));
        r.setAttribute('y1', (Math.sin(a) * r1).toFixed(1));
        r.setAttribute('x2', (Math.cos(a) * r2).toFixed(1));
        r.setAttribute('y2', (Math.sin(a) * r2).toFixed(1));
        r.setAttribute('stroke-width', (3 + pulse * 5).toFixed(1));
        r.setAttribute('opacity', (0.9 - p * 0.6).toFixed(2));
      });
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    this.fxTimer = setTimeout(() => { this._glowActive = false; }, GLOW_DUR);
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

    const NUM_CHUNKS = 16;
    const NUM_SPARKS = 42;
    const NUM_SMOKE = 10;
    const SPARK_COLORS = ['#fff4cc', '#ffdd44', '#ffaa00', '#ff8822', '#ff6600'];
    const particles = [];
    const baseFx = 'position:fixed;left:0;top:0;pointer-events:none;z-index:91;will-change:transform,opacity;';

    // Potongan blob: warna asli blob, bentuk acak tak beraturan, pinggir membara
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const el = document.createElement('div');
      const r = 9 + Math.random() * 18;
      const rad = `${40 + Math.random() * 25}% ${55 + Math.random() * 30}% ${45 + Math.random() * 30}% ${40 + Math.random() * 25}%`;
      el.style.cssText = `${baseFx}width:${r * 2}px;height:${r * 2}px;border-radius:${rad};background:${origFill};border:1px solid rgba(255,140,60,0.75);box-shadow:0 0 10px rgba(255,100,20,0.55), inset 0 0 6px rgba(255,120,40,0.4);`;
      fx.appendChild(el);
      const angle = (Math.PI * 2 * i) / NUM_CHUNKS + (Math.random() - 0.5) * 0.6;
      const speed = 380 + Math.random() * 320;
      particles.push({
        el, type: 'chunk', x: cx, y: cy,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 160,
        rot: 0, vrot: (Math.random() - 0.5) * 720,
        g: 950, drag: 1.1, life: 1.1, fadeT: 0.45
      });
    }

    // Percikan: streak memanjang searah laju, inti putih-panas
    for (let i = 0; i < NUM_SPARKS; i++) {
      const el = document.createElement('div');
      const color = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
      const w = 3 + Math.random() * 4;
      const len = w * (3 + Math.random() * 2.5);
      el.style.cssText = `${baseFx}width:${len}px;height:${w}px;border-radius:${w / 2}px;background:linear-gradient(90deg,transparent,${color} 40%,#fff);box-shadow:0 0 8px 2px ${color};`;
      fx.appendChild(el);
      const angle = Math.random() * Math.PI * 2;
      const speed = 500 + Math.random() * 420;
      particles.push({
        el, type: 'spark', x: cx, y: cy,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 120,
        g: 320, drag: 1.6, life: 0.5, fadeT: 0.35
      });
    }

    // Asap: puff abu-abu naik & membesar, layer paling belakang ledakan
    for (let i = 0; i < NUM_SMOKE; i++) {
      const el = document.createElement('div');
      const r = 14 + Math.random() * 22;
      el.style.cssText = `${baseFx}width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:radial-gradient(circle,rgba(120,118,130,0.5),rgba(120,118,130,0) 70%);z-index:90;`;
      fx.appendChild(el);
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 90;
      particles.push({
        el, type: 'smoke', x: cx, y: cy, r,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 90,
        g: -70, drag: 2.2, life: 1.3, fadeT: 0.8
      });
    }

    // ── Timing ──
    const CHARGE_DUR = 800;
    const BANG_DUR = 1300;
    const REFORM_DELAY = 900;
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
        if (this.gCore) this.gCore.style.opacity = faceAlpha;
        if (this.gArms) this.gArms.style.opacity = faceAlpha;

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

          // Suara ledakan + guncangan layar
          this.onBurstSound?.();
          if (stage) {
            stage.classList.add('knocking');
            setTimeout(() => stage.classList.remove('knocking'), 500);
          }

          // Body shrinks to 0.1 instantly + hide face
          svg.style.transition = 'transform 0.1s ease-out';
          svg.style.transform = 'scale(0.1)';
          svg.style.filter = '';
          this.bodyEl.setAttribute('opacity', '0');
          for (const e of this.eyeEls) e.setAttribute('opacity', '0');
          if (this.mouthEl) this.mouthEl.setAttribute('opacity', '0');
          if (this.gCore) this.gCore.style.opacity = '0';
          if (this.gArms) this.gArms.style.opacity = '0';
        }
        requestAnimationFrame(animBurst);

      } else if (phase === 'bang') {
        const p = Math.min(elapsed / BANG_DUR, 1);

        // Integrasi fisika per-partikel: velocity + gravitasi + drag udara
        for (const pt of particles) {
          if (pt.life <= 0) { pt.el.style.opacity = '0'; continue; }
          pt.life -= dt;
          pt.vy += pt.g * dt;
          pt.vx *= Math.exp(-pt.drag * dt);
          pt.vy *= Math.exp(-pt.drag * 0.4 * dt);
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          const op = Math.max(0, Math.min(pt.life / pt.fadeT, 1));

          if (pt.type === 'chunk') {
            pt.rot += pt.vrot * dt;
            pt.el.style.transform = `translate(${(pt.x - pt.el.offsetWidth / 2).toFixed(1)}px,${(pt.y - pt.el.offsetHeight / 2).toFixed(1)}px) rotate(${pt.rot.toFixed(1)}deg)`;
            pt.el.style.opacity = op.toFixed(2);
          } else if (pt.type === 'spark') {
            const a = Math.atan2(pt.vy, pt.vx) * 180 / Math.PI;
            pt.el.style.transform = `translate(${pt.x.toFixed(1)}px,${pt.y.toFixed(1)}px) rotate(${a.toFixed(1)}deg)`;
            pt.el.style.opacity = op.toFixed(2);
          } else { // smoke: membesar sambil naik
            const grow = 1 + (1 - pt.life / 1.3) * 1.6;
            pt.el.style.transform = `translate(${(pt.x - pt.r * grow).toFixed(1)}px,${(pt.y - pt.r * grow).toFixed(1)}px) scale(${grow.toFixed(2)})`;
            pt.el.style.opacity = (op * 0.7).toFixed(2);
          }
        }

        if (p >= 1) {
          phase = 'wait';
          phaseT0 = now;
          for (const pt of particles) pt.el.remove();
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
          if (this.gCore) this.gCore.style.opacity = '1';
          if (this.gArms) this.gArms.style.opacity = '1';
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

  setGlowColor(colorId) {
    const c = COLOR_BY_ID.get(colorId);
    if (c) {
      this._glowColor = c.hex;
      localStorage.setItem('Mochi.glowColor', c.hex);
    }
  }

  resetGlowColor() {
    this._glowColor = '#ffffff';
    localStorage.removeItem('Mochi.glowColor');
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
  const { onBubble, onPoke, onIdleStart, onIdleEnd } = opts;
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
    if (onIdleStart) onIdleStart(cls.replace('idle-', ''));

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
      if (onIdleEnd) onIdleEnd();
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
