// FORMATTER STEPS THAT SAVE CLEAN AND ARE SKIPPED AT RUN TIME (T10 / W2-6).
//
// Both shapes pass GHL's own validator (warning-level only) and round-trip byte-identical; the
// premium-actions worker then refuses them per run with `status: skipped`, `skippedFor.type:
// "invalid-data"`, and the step's output renders empty in every later merge tag. Live 2026-09-25,
// sniffs/workflows-wave1-2026-09-25/live-A-formatters.json + live-A4-trim.json:
//   - number_formatter whose format.fromFieldType / toFieldType differ from the action's own
//     `<from>_to_<to>` split ("Source field type must be number. Given -> fromFieldType: string").
//     The builder derives both from the action (NumberFormatter.ts setFieldTypes), so only an API
//     author can produce the mismatch.
//   - text_formatter `trim` with extras.skip 0 ("Invalid data. "key" : "skip" , "value" : "0".").
//     skip must be omitted or > 0; omitting it trims from the start.
//
// Pure, never throws. `error` severity: the document is broken for every run, not merely risky.

// The builder's derivation: split on `_to_`, strip `formatted_` from the target.
export function numberFormatterFieldTypes(action) {
  const [from, to] = String(action ?? '').split('_to_');
  if (!from || !to) return null;
  return { fromFieldType: from, toFieldType: to.replace('formatted_', '') };
}

export const isZeroSkip = (v) => v !== undefined && v !== null && v !== '' && Number(v) === 0;

export function lintFormatterSkips(templates) {
  const out = [];
  for (const t of Array.isArray(templates) ? templates.filter(Boolean) : []) {
    const a = t.attributes ?? {};
    if (t.type === 'number_formatter') {
      const want = numberFormatterFieldTypes(a.action);
      const f = a.format ?? {};
      if (!want) continue;
      for (const k of ['fromFieldType', 'toFieldType']) {
        if (f[k] !== undefined && f[k] !== want[k])
          out.push({ code: 'FORMATTER_RUNTIME_SKIP', severity: 'error', stepId: t.id,
            msg: `number_formatter '${t.name ?? t.id}' has format.${k} '${f[k]}' but action '${a.action}' needs `
              + `'${want[k]}' — GHL skips this step on every run (invalid-data) and its output renders empty. `
              + `Set ${k}: '${want[k]}'.` });
      }
    }
    if (t.type === 'text_formatter' && a.formatterType === 'trim' && isZeroSkip(a.extras?.skip)) {
      out.push({ code: 'FORMATTER_RUNTIME_SKIP', severity: 'error', stepId: t.id,
        msg: `text_formatter '${t.name ?? t.id}' trims with skip ${JSON.stringify(a.extras.skip)} — GHL skips this step `
          + `on every run ("Invalid data. key: skip, value: 0") and its output renders empty. Omit skip to trim from the start.` });
    }
  }
  return out;
}
