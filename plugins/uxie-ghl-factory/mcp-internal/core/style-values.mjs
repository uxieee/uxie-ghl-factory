// Authored style values → the shape the builder stores: {value} or {value, unit}. A bare string in `styles` ("#d00000", "16px") used to be stored
// AS WRITTEN: the public sheet compiled it, but the builder reads styles.<key>.value, so its canvas ignored it and its next save could rewrite the
// page differently (bl-332: an inserted paragraph rendered red publicly and default-coloured in the builder — knowledge sniffs/funnels-wave35-f4c-tool-live-2026-09-30).
//   "16px" / "50%" / "1.3em"  → {value:16, unit:"px"} / {value:50, unit:"%"} / {value:1.3, unit:"em"}   (the builder's own {value, unit})
//   "#d00000", "bold", "var(--x)", "rgb(1 2 3)", "1px solid red", "Roboto, sans-serif"  → {value:"…"}   (colours, keywords, shorthands: stored whole)
//   16 (a number)  → {value:16, unit:"px"} on a key that carries a unit (padding, margin, size, radius, gap, width, height …), else {value:16} (opacity, zIndex, weight)
//   {value, unit?, desktop?, tablet?, mobile?}  → untouched (already the builder's shape)
// Anything else (null, boolean, array, an object with none of those keys, an empty string, NaN) is refused BY NAME.
const UNITS = 'px|%|em|rem|vh|vw|vmin|vmax|pt|ch';
const SIZED = /^(-?\d+(?:\.\d+)?)(px|%|em|rem|vh|vw|vmin|vmax|pt|ch)$/;
const UNIT_KEYS = /(padding|margin|width|height|size|radius|gap|spacing|thickness|blur|spread|offset|^top$|^left$|^right$|^bottom$|indent)/i;
const SHAPED = new Set(['value', 'unit', 'desktop', 'tablet', 'mobile']);

export const isShaped = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).some((k) => SHAPED.has(k)) && Object.keys(v).every((k) => SHAPED.has(k) || /^(label|isCustom|text|id)$/.test(k));

export function normalizeStyleValue(key, v, where = 'styles') {
  const at = `${where}.${key}`;
  if (isShaped(v)) return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`${at}: ${v} is not a finite number`);
    return UNIT_KEYS.test(key) ? { value: v, unit: 'px' } : { value: v };
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) throw new Error(`${at}: an empty string is not a value (leave the key out, or name a keyword such as "none")`);
    const m = SIZED.exec(t);
    if (m) return { value: Number(m[1]), unit: m[2] };
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return UNIT_KEYS.test(key) ? { value: Number(t), unit: 'px' } : { value: Number(t) };
    return { value: t };
  }
  throw new Error(`${at}: ${v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? `an object with none of ${[...SHAPED].join(' / ')}` : typeof v} cannot be stored as a style value — give a string ("16px", "#d00000", "bold"), a number, or {value, unit}`);
}

export function normalizeStyles(map, where = 'styles') {
  if (map === undefined) return undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`${where} must be an object of {prop: value}`);
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, normalizeStyleValue(k, v, where)]));
}
