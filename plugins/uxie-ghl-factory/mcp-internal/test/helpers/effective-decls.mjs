// Effective declarations of a stylesheet: per (media | selector | property) the value that wins the cascade (important beats
// normal, later beats earlier), whitespace outside strings collapsed. What a page renders, independent of how the rules are
// split into blocks. Quote-aware; no minifier dependency.
const badFirstLine = (v) => { const first = v.split('\n')[0]; let q = null; for (let i = 0; i < first.length; i++) { const ch = first[i]; if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; } return q !== null; };
export function effectiveDecls(css) {
  const len = css.length; const win = new Map();
  const readUntil = (i, stops) => {
    let t = ''; let d = 0;
    while (i < len) {
      const c = css[i];
      // a string ends at its closing quote, or at a NEWLINE when it is unterminated (CSS: a bad string ends at the line end)
      if (c === '"' || c === "'") { let j = i + 1; while (j < len && css[j] !== c && css[j] !== '\n') { if (css[j] === '\\') j++; j++; } const end = j < len && css[j] === c ? j + 1 : j; t += css.slice(i, end); i = end; continue; }
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
          // a declaration whose first line holds an unterminated string is lumped with the declarations after it (CSS: the bad string
          // ends at the newline); its whitespace is not meaningful (the flagged-rule rule ignores spaces and tabs)
          if (badFirstLine(val)) val = val.replace(/\s+/g, '');
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
