// The pure half of scripts/release.mjs: everything that can be unit-tested without a git repo,
// a network, or a shell. release.mjs does the I/O; this file decides.
//
// Kept separate so the release orchestration can be read as a straight list of steps and the
// rules it enforces (version ordering, what a CHANGELOG entry must look like, what "clean" means)
// are pinned by mcp-internal/test/release-lib.test.mjs rather than by running a release.

export function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`not a MAJOR.MINOR.PATCH version: "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a, b) {
  const x = parseSemver(a), y = parseSemver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// Keep-a-Changelog heading as this repo writes it: `## [0.51.0] — 2026-09-03`. The date is optional
// on read so a heading typed without one still resolves; the release refuses it separately.
const HEADING = /^## \[(\d+\.\d+\.\d+)\](?:\s+[—-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;

export function changelogSection(text, version) {
  const lines = String(text).split('\n');
  let start = -1, date = null;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING.exec(lines[i]);
    if (m && m[1] === version) { start = i; date = m[2] ?? null; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \[/.test(lines[i])) { end = i; break; }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return { heading: lines[start], date, body };
}

// The first sentence of the entry's first paragraph, with markdown stripped, is the release title
// unless one is given. `0.51.0 — one browser profile per token file` is the shape the existing
// GitHub releases use, so the title must read as a phrase, not a paragraph.
export function releaseTitle(body, override) {
  if (override && override.trim()) return override.trim();
  const para = String(body).split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !p.startsWith('-'));
  if (!para) return '';
  const flat = para.replace(/\s+/g, ' ').replace(/[`*_]/g, '');
  const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  const clean = sentence.replace(/[.!?]$/, '');
  if (clean.length <= 80) return clean;
  const cut = clean.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 80)}…`;
}

// Text-level bump so the manifest keeps its own formatting (key order, indentation, trailing
// newline). Exactly one `"version"` field, or refuse — a manifest with two is not one to guess at.
export function bumpManifestText(json, version) {
  parseSemver(version);
  const re = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/g;
  const hits = [...String(json).matchAll(re)];
  if (hits.length !== 1) throw new Error(`expected exactly one "version" field, found ${hits.length}`);
  return String(json).replace(re, `$1${version}$3`);
}

export function releaseCommitMessage(version, title) {
  return `release: ${version} — ${title}`;
}

// Everything that must be true before a single file is touched. Returns the failures, all of
// them, so one run reports every problem rather than the first.
export function preflightFailures({ branch, behind, ahead, dirty, current, next, section, today, tools }) {
  const out = [];
  if (branch !== 'main') out.push(`on branch "${branch}" — releases are cut from main`);
  if (behind > 0) out.push(`main is ${behind} commit(s) behind origin/main — pull first (the 0.50.0 collision was exactly this)`);
  if (dirty.length) out.push(`tracked files are modified: ${dirty.join(', ')} — commit or stash before releasing`);
  try {
    if (compareSemver(next, current) <= 0) out.push(`version ${next} is not above the current ${current}`);
  } catch (e) { out.push(e.message); }
  if (!section) out.push(`CHANGELOG.md has no "## [${next}] — YYYY-MM-DD" entry — write the entry first; the release notes come from it`);
  else {
    if (!section.date) out.push(`CHANGELOG entry for ${next} has no date — write it as "## [${next}] — ${today}"`);
    else if (section.date !== today) out.push(`CHANGELOG entry for ${next} is dated ${section.date}; today is ${today}`);
    if (!section.body) out.push(`CHANGELOG entry for ${next} is empty`);
  }
  for (const [name, present] of Object.entries(tools ?? {})) {
    if (!present) out.push(`"${name}" is not on PATH — the release needs it`);
  }
  if (ahead > 0) out.push(`note: main is ${ahead} commit(s) ahead of origin/main — those ship with this release`);
  return out;
}
