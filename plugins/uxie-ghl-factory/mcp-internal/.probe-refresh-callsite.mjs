#!/usr/bin/env node
// PROBE 13 (2026-08-31) — probe 12 found no public map for the main app and no literal
// "oauth/refresh" (the path is constructed). But two SMALL chunks carry refreshToken+refreshJwt.
// Read them directly and print every "refresh" context, plus any URL-ish literal near it.
const CHUNKS = [
  'https://static.leadconnectorhq.com/1777/js/chunk.CPWPww0r.js',
  'https://static.leadconnectorhq.com/1777/js/chunk.BaQm359R.js',
];
const around = (t, i, r=420) => t.slice(Math.max(0,i-r), i+r).replace(/\s+/g,' ');
for (const u of CHUNKS) {
  let t; try { const r = await fetch(u); if(!r.ok){console.log(`${u} -> HTTP ${r.status}`);continue;} t = await r.text(); }
  catch { console.log(`${u} -> fetch failed`); continue; }
  console.log(`\n${'='.repeat(78)}\n${u.split('/').slice(-1)[0]}  (${t.length} bytes)\n${'='.repeat(78)}`);
  if (t.length < 4000) { console.log(t); continue; }
  const seen = new Set();
  for (const re of [/refreshToken/g, /refreshJwt/g, /refresh/gi]) {
    let m; while ((m = re.exec(t)) !== null) {
      const key = Math.floor(m.index/300);
      if (seen.has(key)) continue; seen.add(key);
      console.log(`\n--- @${m.index} ---\n${around(t, m.index)}`);
      if (seen.size > 12) break;
    }
    if (seen.size > 12) break;
  }
}
