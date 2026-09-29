// Effective declarations of a stylesheet: per (media | selector | property) the value that wins the cascade (important beats
// normal, later beats earlier), whitespace outside strings collapsed. What a page renders, independent of how the rules are
// split into blocks. Quote-aware; no minifier dependency.
export function effectiveDecls(css) {
  const len = css.length; const win = new Map();
  const readUntil = (i, stops) => {
    let t = ''; let d = 0;
    while (i < len) {
      const c = css[i];
      if (c === '"' || c === "'") { let j = i + 1; while (j < len && css[j] !== c) { if (css[j] === '\\') j++; j++; } t += css.slice(i, j + 1); i = j + 1; continue; }
      if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? len : e + 2; continue; }
      if (c === '(') d++; else if (c === ')') d--;
      if (d <= 0 && stops.includes(c)) break;
      t += c; i++;
    }
    return [t.replace(/\s+/g, ' ').trim(), i];
  };
  const splitSel = (s) => { const r = []; let d = 0; let cur = ''; for (const c of s) { if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; if (c === ',' && d === 0) { r.push(cur.trim()); cur = ''; } else cur += c; } r.push(cur.trim()); return r; };
  const block = (i, media) => {
    while (i < len) {
      while (/\s/.test(css[i] ?? '')) i++;
      if (i >= len || css[i] === '}') return i + 1;
      const [pre, j] = readUntil(i, '{;}');
      if (css[j] !== '{') { i = j + 1; continue; }
      if (pre.startsWith('@')) { i = block(j + 1, pre); continue; }
      const sels = splitSel(pre); let k = j + 1;
      while (k < len) {
        while (/\s/.test(css[k] ?? '')) k++;
        if (css[k] === '}') { k++; break; }
        const [decl, e] = readUntil(k, ';}'); const c = decl.indexOf(':');
        if (c > 0) {
          const prop = decl.slice(0, c).trim(); let val = decl.slice(c + 1).trim(); const imp = /!\s*important$/i.test(val); if (imp) val = val.replace(/\s*!\s*important$/i, '') + ' !important';
          for (const s of sels) { const key = `${media}|${s}|${prop}`; const w = win.get(key); if (w?.imp && !imp) continue; win.set(key, { val, imp }); }
        }
        k = css[e] === ';' ? e + 1 : e;
      }
      i = k;
    }
    return i;
  };
  block(0, '');
  return [...win].map(([k, w]) => `${k}:${w.val}`).sort();
}
