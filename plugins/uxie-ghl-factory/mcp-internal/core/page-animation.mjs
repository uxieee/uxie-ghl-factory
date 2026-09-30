// Entrance and hover animations on a funnel-page node: the stored class knobs AND the compiled CSS the
// public page serves.
//
// The public renderer serves `section.general.sectionStyles` verbatim, and the builder writes an
// animation there as per-node rules: `@-webkit-keyframes <name>-<id>` + `@keyframes <name>-<id>` + an
// `.animate__<name>-<id>` rule for an entrance, and `--hover-*` variables for a hover. Those rules are the
// builder's own generator (page-builder bundle: animationKeyframes / generateKeyframes /
// generateAnimationCustomizationStyles / buildHoverAnimationCssVarsString, 2026-09-28) run through csso.
// This module ports the generator and emits csso's output directly. It is checked against csso over every
// animation at six scales (test/fixtures/animation-keyframes.golden.json) and against the builder's own
// saved text (knowledge sniffs/funnels-wave11-structure-styling-2026-09-28 pd.ui3.json).

const EASE_OUT_CUBIC = 'cubic-bezier(0.215, 0.61, 0.355, 1)';
const kf = (percentage, opacity, transform, timingFunction) => ({ percentage, opacity, transform, timingFunction });

// The builder's keyframe table, one entry per entrance animation; `s` is the Scale knob (default 1).
const KEYFRAMES = {
  fadeIn: (s) => [kf('0%', 0, { scale: `${s}` }), kf('100%', 1, { scale: '1' })],
  fadeInUp: (s) => [kf('0%', 0, { translate3d: '0, 100%, 0', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  fadeInDown: (s) => [kf('0%', 0, { translate3d: '0, -100%, 0', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  fadeInLeft: (s) => [kf('0%', 0, { translate3d: '-100%, 0, 0', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  fadeInRight: (s) => [kf('0%', 0, { translate3d: '100%, 0, 0', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  slideInUp: (s) => [kf('0%', 0, { translate3d: '0, 100%, 0', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  slideInDown: (s) => [kf('0%', 0, { translate3d: '0, -100%, 0', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  slideInLeft: (s) => [kf('0%', 0, { translate3d: '-100%, 0, 0', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  slideInRight: (s) => [kf('0%', 0, { translate3d: '100%, 0, 0', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  bounceIn: (s) => [
    kf('0%', 0, { scale3d: `${0.3 * s}, ${0.3 * s}, ${0.3 * s}` }, EASE_OUT_CUBIC),
    kf('20%', undefined, { scale3d: `${1.1 * s}, ${1.1 * s}, ${1.1 * s}` }, EASE_OUT_CUBIC),
    kf('40%', undefined, { scale3d: `${0.9 * s}, ${0.9 * s}, ${0.9 * s}` }, EASE_OUT_CUBIC),
    kf('60%', 1, { scale3d: `${1.03 * s}, ${1.03 * s}, ${1.03 * s}` }, EASE_OUT_CUBIC),
    kf('80%', undefined, { scale3d: `${0.97 * s}, ${0.97 * s}, ${0.97 * s}` }, EASE_OUT_CUBIC),
    kf('100%', 1, { scaleX: '1' }, EASE_OUT_CUBIC)],
  bounceInUp: (s) => [
    kf('0%', 0, { translate3d: '0, 3000px, 0', scaleY: '5', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('60%', 1, { translate3d: '0, -20px, 0', scaleY: '0.9', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('75%', undefined, { translate3d: '0, 10px, 0', scaleY: '0.95', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('90%', undefined, { translate3d: '0, -5px, 0', scaleY: '0.985', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('100%', undefined, { translateZ: '0' }, EASE_OUT_CUBIC)],
  bounceInDown: (s) => [
    kf('0%', 0, { translate3d: '0, -3000px, 0', scaleY: '3', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('60%', 1, { translate3d: '0, 25px, 0', scaleY: '0.9', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('75%', undefined, { translate3d: '0, -10px, 0', scaleY: '0.95', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('90%', undefined, { translate3d: '0, 5px, 0', scaleY: '0.985', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('100%', undefined, { translateZ: '0' }, EASE_OUT_CUBIC)],
  bounceInLeft: (s) => [
    kf('0%', 0, { translate3d: '-3000px, 0, 0', scaleX: '3' }, EASE_OUT_CUBIC),
    kf('60%', 1, { translate3d: '25px, 0, 0', scaleX: '1' }, EASE_OUT_CUBIC),
    kf('75%', undefined, { translate3d: '-10px, 0, 0', scaleX: '0.98', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('90%', undefined, { translate3d: '5px, 0, 0', scaleX: '0.995', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('100%', undefined, { translateZ: '0' }, EASE_OUT_CUBIC)],
  bounceInRight: (s) => [
    kf('0%', 0, { translate3d: '3000px, 0, 0', scaleX: '3' }, EASE_OUT_CUBIC),
    kf('60%', 1, { translate3d: '-25px, 0, 0', scaleX: '1' }, EASE_OUT_CUBIC),
    kf('75%', undefined, { translate3d: '10px, 0, 0', scaleX: '0.98', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('90%', undefined, { translate3d: '-5px, 0, 0', scaleX: '0.995', scale: `${s}` }, EASE_OUT_CUBIC),
    kf('100%', undefined, { translateZ: '0' }, EASE_OUT_CUBIC)],
  flip: (s) => [
    kf('0%', 0, { perspective: '400px', scaleX: '1', scale: `${s}`, translateZ: '0', rotateY: '-1turn' }, 'ease-out'),
    kf('40%', undefined, { perspective: '400px', scaleX: '1', scale: `${s}`, translateZ: '150px', rotateY: '-190deg' }, 'ease-out'),
    kf('50%', undefined, { perspective: '400px', scaleX: '1', scale: `${s}`, translateZ: '150px', rotateY: '-170deg' }, 'ease-in'),
    kf('80%', undefined, { perspective: '400px', scale3d: '0.95, 0.95, 0.95', translateZ: '0', rotateY: '0deg' }, 'ease-in'),
    kf('100%', 1, { perspective: '400px', scaleX: '1', scale: '1', translateZ: '0', rotateY: '0deg' }, 'ease-in')],
  flipInX: (s) => [
    kf('0%', 0, { perspective: '400px', rotateX: '90deg', scale: `${s}` }, 'ease-in'),
    kf('40%', undefined, { perspective: '400px', rotateX: '-20deg', scale: `${s}` }, 'ease-in'),
    kf('60%', 1, { perspective: '400px', rotateX: '10deg', scale: `${s}` }),
    kf('80%', undefined, { perspective: '400px', rotateX: '-5deg', scale: `${s}` }),
    kf('100%', undefined, { perspective: '400px', rotateX: '0deg', scale: '1' })],
  flipInY: (s) => [
    kf('0%', 0, { perspective: '400px', rotateY: '90deg', scale: `${s}` }, 'ease-in'),
    kf('40%', undefined, { perspective: '400px', rotateY: '-20deg', scale: `${s}` }, 'ease-in'),
    kf('60%', 1, { perspective: '400px', rotateY: '10deg', scale: `${s}` }),
    kf('80%', undefined, { perspective: '400px', rotateY: '-5deg', scale: `${s}` }),
    kf('100%', undefined, { perspective: '400px', rotateY: '0deg', scale: '1' })],
  rollIn: (s) => [kf('0%', 0, { translate3d: '-100%, 0, 0', rotate: '-120deg', scale: `${s}` }), kf('100%', 1, { translateZ: '0', scale: '1' })],
  zoomIn: (s) => [kf('0%', 0, { scale3d: '0.3, 0.3, 0.3', scale: `${s}` }), kf('50%', 1, { scale: '1' })],
  lightSpeedInLeft: (s) => [kf('0%', 0, { translate3d: '-100%, 0, 0', skewX: '30deg', scale: `${s}` }), kf('60%', 1, { skewX: '-20deg' }), kf('80%', undefined, { skewX: '5deg' }), kf('100%', undefined, { translateZ: '0' })],
  lightSpeedInRight: (s) => [kf('0%', 0, { translate3d: '100%, 0, 0', skewX: '-30deg', scale: `${s}` }), kf('60%', 1, { skewX: '20deg' }), kf('80%', undefined, { skewX: '-5deg' }), kf('100%', undefined, { translateZ: '0' })],
};

/** The 21 entrance animations the builder compiles (the Entrance grid minus "None" and the three infinite loops). */
const COMPILED_ENTRANCE = Object.freeze(Object.keys(KEYFRAMES));
/** The grid's "Infinite loop" group: Glow, Rocking, Bounce. Their value is a bare class (`buttonPulseGlow` …) — no `animate__animated`, no timing knobs,
 *  no compiled keyframes: the public stylesheet ships `.buttonPulseGlow{animation:pulseGlow 2s infinite …}` (page builder INFINITE_LOOP_PREVIEW; read on a public page). Buttons only. */
export const LOOP_ANIMATIONS = Object.freeze(['buttonPulseGlow', 'buttonRocking', 'buttonBounce']);
export const LOOP_METAS = Object.freeze(['button']);
/** All 24 the entrance grid offers: 21 compiled + 3 loops. */
export const ENTRANCE_ANIMATIONS = Object.freeze([...COMPILED_ENTRANCE, ...LOOP_ANIMATIONS]);

// The builder's generateTransform: object order is emission order; translateX/Y/Z fold into one
// translate3d only when no translate3d is given, and only from the translateX key — so a lone
// translateZ emits nothing (which is why fadeInUp's last frame is `scale(1)` alone).
function transformOf(t) {
  const out = [];
  for (const [k, v] of Object.entries(t)) {
    if (!v) continue;
    switch (k) {
      case 'translateX': case 'translateY': case 'translateZ':
        if (!t.translate3d && k === 'translateX' && !out.some((x) => x.startsWith('translate'))) out.push(`translate3d(${t.translateX ?? '0'}, ${t.translateY ?? '0'}, ${t.translateZ ?? '0'})`);
        break;
      default: out.push(`${k}(${v})`);
    }
  }
  return out.join(' ');
}

// What csso does to these values: `, ` → `,`, a leading `0.` loses its 0, `100%` → `to`, empty frames vanish.
const cssoValue = (v) => v.replace(/,\s+/g, ',').replace(/(^|[\s,(-])0\.(\d)/g, '$1.$2');

function keyframesCss(name, frames) {
  const body = frames.map((f) => {
    const t = f.transform ? transformOf(f.transform) : '';
    const decls = [];
    if (f.opacity !== undefined) decls.push(`opacity:${f.opacity}`);
    if (t) decls.push(`-webkit-transform:${cssoValue(t)}`, `transform:${cssoValue(t)}`);
    if (f.timingFunction) decls.push(`-webkit-animation-timing-function:${cssoValue(f.timingFunction)}`, `animation-timing-function:${cssoValue(f.timingFunction)}`);
    return decls.length ? `${f.percentage === '100%' ? 'to' : f.percentage}{${decls.join(';')}}` : '';
  }).join('');
  return `@-webkit-keyframes ${name}{${body}}@keyframes ${name}{${body}}`;
}

/** Exported for the golden test: the keyframes block for one animation, exactly as csso prints the builder's. */
export const keyframesFor = (animation, name, scale) => keyframesCss(name, KEYFRAMES[animation](scale ?? 1));

export const EASINGS = Object.freeze(['linear', 'ease-in', 'ease-out', 'ease-in-out']);

// The builder's parseNumericKnob.
const knob = (v, { min = -Infinity, exclusiveMin = false } = {}) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return !Number.isFinite(n) || (exclusiveMin ? n <= min : n < min) ? null : n;
};
const num = (n) => cssoValue(String(n));

/**
 * The compiled entrance rule for a node whose `class` carries the knobs, or '' when the builder would emit
 * none (no animate__ class, or no timing knob set — the global animate.css class then runs as is).
 * `parentOffset` is the summed duration+delay of animated section/row/column ancestors (the builder's
 * getParentAnimationOffset).
 */
export function entranceCss(id, cls, parentOffset = 0) {
  // "Disable animations on mobile" (class.disableAnimationsOnMobile.value === true): the builder's generateAnimationCustomizationStyles adds a
  // no-animation rule under 1024px and under the canvas's .--mobile wrapper (csso-minified here).
  const mobile = cls?.disableAnimationsOnMobile?.value === true && /^[a-zA-Z0-9_-]+$/.test(id) ? `@media (max-width:1024px){#${id}{animation:none!important}}.--mobile #${id}{animation:none!important}` : '';
  const v = cls?.entranceAnimation?.value;
  if (typeof v !== 'string' || !v.includes('animate__animated')) return mobile;
  const scale = cls.animationScale?.value, dur = cls.animationDuration?.value, delay = cls.animationDelay?.value, easing = cls.animationEasing?.value;
  if (!scale && !dur && !delay && !easing) return mobile;
  const name = v.split(' ').pop()?.replace('animate__', '');
  if (!name || !KEYFRAMES[name]) return mobile;
  const s = knob(scale, { min: 0, exclusiveMin: true });
  const d = knob(dur, { min: 0, exclusiveMin: true });
  const e = typeof easing === 'string' && EASINGS.includes(easing) ? easing : 'linear';
  const total = (Number(delay) || 0) + (parentOffset || 0);
  const kn = `${name}-${id}`;
  const rule = `.animate__${kn}{animation:${kn} ${num(d ?? 1)}s ${e} ${num(total || 0)}s forwards!important;-webkit-animation-name:${kn};animation-name:${kn}}`;
  return rule + keyframesCss(kn, KEYFRAMES[name](s ?? 1)) + mobile;
}

// Hover effects and the knob each category adds to duration/delay/easing (the builder's
// HOVER_EFFECT_CATEGORY / HOVER_CATEGORY_SPECIFIC_KEYS). The colour knobs (fill, border and shadow colour)
// are not offered here: the builder decides whether to emit them by comparing against its own preview
// defaults, and that comparison is not ported.
export const HOVER_EFFECT_CATEGORY = Object.freeze({
  'hvr-grow': 'scale', 'hvr-shrink': 'scale', 'hvr-pulse': 'scale', 'hvr-bounce-in': 'scale',
  'hvr-rotate': 'rotation', 'hvr-skew-forward': 'rotation',
  'hvr-float': 'movement', 'hvr-wobble-horizontal': 'movement', 'hvr-buzz': 'movement', hoverElevate: 'movement',
  'hvr-fade': 'background', 'hvr-sweep-to-right': 'background', 'hvr-sweep-to-bottom': 'background', 'hvr-radial-in': 'background', 'hvr-bounce-to-top': 'background',
  'hvr-ripple-out': 'border', 'hvr-outline-in': 'border', 'hvr-underline-from-center': 'border',
  'hvr-shadow': 'shadow', 'hvr-glow': 'shadow', 'hvr-box-shadow-outset': 'shadow',
});
export const HOVER_ANIMATIONS = Object.freeze(Object.keys(HOVER_EFFECT_CATEGORY));
const CATEGORY_KEYS = { scale: ['hoverScale'], rotation: ['hoverAngle'], movement: ['hoverDistance'], background: [], border: ['hoverBorderThickness'], shadow: ['hoverBlur', 'hoverSpread'] };
export const hoverKeysFor = (name) => ['hoverDuration', 'hoverDelay', 'hoverEasing', ...(CATEGORY_KEYS[HOVER_EFFECT_CATEGORY[name]] ?? [])];

/** The compiled hover variables for a button, as csso prints the builder's `.<id> {…} .c<id> {…}` pair. */
export function hoverCss(id, cls) {
  const name = cls?.hoverAnimation?.value;
  if (!name || !HOVER_EFFECT_CATEGORY[name]) return '';
  const allowed = new Set(hoverKeysFor(name));
  const vars = [];
  const dur = knob(cls.hoverDuration?.value, { min: 0 }) ?? 0.3;
  const delay = knob(cls.hoverDelay?.value, { min: 0 }) ?? 0;
  const e = cls.hoverEasing?.value;
  vars.push(`--hover-duration:${dur}s`, `--hover-delay:${delay}s`, `--hover-easing:${typeof e === 'string' && EASINGS.includes(e) ? e : 'ease-in-out'}`);
  const scale = knob(cls.hoverScale?.value, { min: 0, exclusiveMin: true });
  if (allowed.has('hoverScale') && scale != null) vars.push(`--hover-scale:${scale}`);
  if (allowed.has('hoverAngle')) {
    const a = cls.hoverAngle?.value;
    const m = typeof a === 'string' ? a.trim().match(/^(-?[\d.]+)\s*deg$/i) : null;
    const n = typeof a === 'number' ? a : m ? Number(m[1]) : (a == null || a === '' ? null : Number(a));
    if (n != null && Number.isFinite(n)) vars.push(`--hover-angle:${n}`);
  }
  const dist = knob(cls.hoverDistance?.value);
  if (allowed.has('hoverDistance') && dist != null) vars.push(`--hover-distance:${dist}`);
  const thick = knob(cls.hoverBorderThickness?.value, { min: 0 });
  if (allowed.has('hoverBorderThickness') && thick != null) vars.push(`--hover-border-thickness:${thick}px`);
  const blur = knob(cls.hoverBlur?.value, { min: 0 });
  if (allowed.has('hoverBlur') && blur != null) vars.push(`--hover-blur:${blur}px`);
  const spread = knob(cls.hoverSpread?.value, { min: 0 });
  if (allowed.has('hoverSpread') && spread != null) vars.push(`--hover-spread:${spread}px`);
  return `.${id},.c${id}{${vars.join(';')}}`;
}

// Caller-facing specs → the node's `class` patch, as the builder stores it. Throws a message on a bad spec.
export function entranceClass(spec, meta) {
  if (!spec) return {};
  const { name, duration, delay, scale, easing, disableOnMobile } = spec;
  if (!ENTRANCE_ANIMATIONS.includes(name)) throw new Error(`entranceAnimation.name must be one of: ${ENTRANCE_ANIMATIONS.join(', ')}`);
  if (easing !== undefined && !EASINGS.includes(easing)) throw new Error(`entranceAnimation.easing must be one of: ${EASINGS.join(', ')}`);
  if (disableOnMobile !== undefined && typeof disableOnMobile !== 'boolean') throw new Error('entranceAnimation.disableOnMobile is true or false');
  const out = {};
  if (LOOP_ANIMATIONS.includes(name)) {
    if (meta !== undefined && !LOOP_METAS.includes(meta)) throw new Error(`entranceAnimation ${name} is an infinite loop the builder offers on buttons — not on ${meta}`);
    const knobs = ['duration', 'delay', 'scale', 'easing'].filter((k) => spec[k] !== undefined);
    if (knobs.length) throw new Error(`entranceAnimation ${name} is an infinite loop: the builder hides its timing knobs (${knobs.join(', ')} given)`);
    out.entranceAnimation = { value: name };
  } else {
    out.entranceAnimation = { value: `animate__animated animate__${name}` };
    if (scale !== undefined) out.animationScale = { value: scale };
    if (duration !== undefined) out.animationDuration = { value: duration };
    if (delay !== undefined) out.animationDelay = { value: delay };
    if (easing !== undefined) out.animationEasing = { value: easing };
  }
  if (disableOnMobile !== undefined) out.disableAnimationsOnMobile = { value: disableOnMobile };
  return out;
}

const HOVER_SPEC_KEYS = { duration: 'hoverDuration', delay: 'hoverDelay', easing: 'hoverEasing', scale: 'hoverScale', angle: 'hoverAngle', distance: 'hoverDistance', borderThickness: 'hoverBorderThickness', blur: 'hoverBlur', spread: 'hoverSpread' };
export function hoverClass(spec) {
  if (!spec) return {};
  const { name, ...knobs } = spec;
  if (!HOVER_EFFECT_CATEGORY[name]) throw new Error(`hoverAnimation.name must be one of: ${HOVER_ANIMATIONS.join(', ')}`);
  const allowed = new Set(hoverKeysFor(name));
  const out = { hoverAnimation: { value: name } };
  const snapshot = {};
  for (const [k, v] of Object.entries(knobs)) {
    const key = HOVER_SPEC_KEYS[k];
    if (!key) throw new Error(`hoverAnimation.${k} is not a knob here (${Object.keys(HOVER_SPEC_KEYS).join(', ')}; colour knobs are set in the builder)`);
    if (!allowed.has(key)) throw new Error(`hoverAnimation ${name} does not take ${k} (it takes ${[...allowed].map((x) => Object.keys(HOVER_SPEC_KEYS).find((s) => HOVER_SPEC_KEYS[s] === x)).join(', ')})`);
    if (k === 'easing' && !EASINGS.includes(v)) throw new Error(`hoverAnimation.easing must be one of: ${EASINGS.join(', ')}`);
    out[key] = { value: v }; snapshot[key] = { value: v };
  }
  // The builder keeps a per-effect snapshot of the knobs so switching effects and back restores them.
  out.hoverAdjustByEffect = { value: { [name]: snapshot } };
  return out;
}

/** Summed duration+delay of animated section/row/column ancestors — the builder's getParentAnimationOffset. */
export function parentAnimationOffset(id, section) {
  const nodes = [section?.metaData, ...(section?.elements ?? [])].filter(Boolean);
  const parentOf = new Map();
  for (const n of nodes) for (const c of n.child ?? []) if (!parentOf.has(c)) parentOf.set(c, n);
  let total = 0; const seen = new Set();
  for (let p = parentOf.get(id); p && !seen.has(p.id); p = parentOf.get(p.id)) {
    seen.add(p.id);
    const layout = ['section', 'row', 'col'].includes(p.meta) && String(p.class?.entranceAnimation?.value ?? '').includes('animate__animated');
    if (layout) total += (Number(p.class?.animationDuration?.value ?? 1) || 1) + (Number(p.class?.animationDelay?.value ?? 0) || 0);
  }
  return total;
}

/** Remove a node's previously compiled animation rules from a stylesheet (so a re-set does not stack). */
export function stripAnimationCss(css, id) {
  let out = css ?? '';
  const esc = id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  // @-webkit-keyframes / @keyframes <name>-<id>{ … } — nested braces, so walk them.
  const at = new RegExp(`@(?:-webkit-)?keyframes [A-Za-z]+-${esc}\\{`, 'g');
  for (let m = at.exec(out); m; m = at.exec(out)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < out.length; i++) { if (out[i] === '{') depth++; else if (out[i] === '}' && --depth === 0) break; }
    out = out.slice(0, m.index) + out.slice(i + 1); at.lastIndex = m.index;
  }
  out = out.replace(new RegExp(`\\.animate__[A-Za-z]+-${esc}\\{[^}]*\\}`, 'g'), '');
  out = out.replace(new RegExp(`\\.${esc},\\.c${esc}\\{--hover-[^}]*\\}`, 'g'), '');
  out = out.replace(new RegExp(`@media \\(max-width:1024px\\)\\{#${esc}\\{animation:none!important\\}\\}\\.--mobile #${esc}\\{animation:none!important\\}`, 'g'), '');
  return out;
}

/** Metas the builder offers an Entrance animation on, and the one it offers Hover on. */
export const ENTRANCE_METAS = Object.freeze(['heading', 'sub-heading', 'paragraph', 'rich-text', 'bulletList', 'button', 'image', 'section', 'row', 'col']);
export const HOVER_METAS = Object.freeze(['button']);
