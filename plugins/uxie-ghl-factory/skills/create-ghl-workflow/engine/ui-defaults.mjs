// UI DEFAULTS — make an engine-built step carry what a UI-built step carries.
//
// The UI's model classes initialize `attributes` before the user touches anything
// (`call` → `{timeout: 60, call_connect: true, …}`), and their constructors FORCE some fields
// regardless of input (`this.attributes.type = 'goto'`). A step the engine builds without those
// keys is accepted by GHL but is NOT the document the UI would have written — and the whole point
// is "as if built in the UI" (Xander, 2026-08-22).
//
// The catalog carries, per step type (gen-catalog ← research model-defaults.json):
//   uiDefaults   — initializer keys the CORPUS proves survive a UI save (present in ≥90% of
//                  UI-built stored nodes, n≥5). The UI's save() strips some keys; emitting a
//                  stripped key would make engine output DIVERGE from the UI's. Only the
//                  corpus-verified set is applied; the rest is documented as uiDefaultsUnverified.
//   uiForced     — constructor assignments proven unconditional (brace-depth + header-aware
//                  extraction, then corpus-checked). The UI can never emit the step without them.
//
// Merge order: uiDefaults (lowest) ← what the engine/author emitted ← uiForced (only where the
// engine left the key undefined; a DIFFERENT engine value is surfaced as a warning, never
// silently overwritten — that would hide an engine/UI disagreement worth knowing about).
// Hatch: ctx.skipUiDefaults = true.

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Apply to every emitted template in place. Returns the number of keys added. */
export function applyUiDefaults(templates, catalog, ctx) {
  if (!catalog?.step || ctx?.skipUiDefaults === true) return 0;
  let added = 0;
  for (const t of templates ?? []) {
    if (!t?.type || t.type === 'transition') continue;
    const meta = catalog.step(t.type);
    if (!meta) continue;
    const attrs = t.attributes ?? (t.attributes = {});
    for (const [k, v] of Object.entries(meta.uiDefaults ?? {})) {
      if (attrs[k] === undefined) { attrs[k] = clone(v); added++; }
    }
    for (const [k, v] of Object.entries(meta.uiForced ?? {})) {
      if (attrs[k] === undefined) { attrs[k] = clone(v); added++; }
      else if (JSON.stringify(attrs[k]) !== JSON.stringify(v))
        ctx?.warn?.(`UI_FORCED_MISMATCH: '${t.name ?? t.id}' (${t.type}) emits ${k}=${JSON.stringify(attrs[k])} but the UI's constructor always sets ${JSON.stringify(v)}`);
    }
  }
  return added;
}
