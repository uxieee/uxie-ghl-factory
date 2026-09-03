#!/usr/bin/env node
// Publish the ghl-system-conventions skill to its standalone repo — a MIRROR, never a source.
//
//   node scripts/publish-standalone.mjs --version 0.54.0            # clone, copy, commit, tag, push
//   node scripts/publish-standalone.mjs --version 0.54.0 --dry-run  # everything but push (and no repo creation)
//
// Why a mirror: people share a link, and a link to a 16-skill plugin repo is a poor landing page
// for one skill. But two editable copies drift, so the standalone repo is written ONLY by this
// script, from the plugin's copy, stamped with the plugin version. release.mjs runs it last, so
// every plugin release refreshes the mirror. Editing the mirror by hand is the one thing that
// breaks this — the next publish overwrites it.
//
// The mirror is a fresh clone into a temp dir each run: nothing to keep on disk, nothing to
// get out of sync. It creates the GitHub repo on first run if it does not exist.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SKILL = join(REPO, 'plugins/uxie-ghl-factory/skills/ghl-system-conventions');
const TEMPLATE = join(REPO, 'scripts/standalone-readme.template.md');
export const MIRROR = 'uxieee/ghl-system-conventions';
export const MIRROR_URL = `https://github.com/${MIRROR}.git`;

const sh = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const die = (m) => { console.error(`publish-standalone: ${m}`); process.exit(1); };

// Never mirror junk: OS files, and anything that is not part of the skill's contract.
const SKIP = new Set(['.DS_Store']);
function copySkill(dst) {
  cpSync(SKILL, dst, {
    recursive: true,
    filter: (src) => !SKIP.has(src.split('/').pop()),
  });
}

// The mirror README is generated from a template so the install line, version and the
// "what you get standalone vs with the plugin" note can never drift from the skill.
export function renderReadme(template, { version, skillDescription, typeCount, nativeCount }) {
  return template
    .replaceAll('{{VERSION}}', version)
    .replaceAll('{{DESCRIPTION}}', skillDescription)
    .replaceAll('{{TYPE_COUNT}}', String(typeCount))
    .replaceAll('{{NATIVE_COUNT}}', String(nativeCount));
}

function skillDescription() {
  const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(SKILL, 'SKILL.md'), 'utf8'));
  const m = fm && /^description:\s*(.+)$/m.exec(fm[1]);
  return m ? m[1].trim() : '';
}

function typeCounts() {
  const cards = JSON.parse(readFileSync(join(SKILL, 'catalog/type-cards.json'), 'utf8')).cards.filter((c) => c.family !== '.');
  return { typeCount: cards.length, nativeCount: cards.filter((c) => !c.family.endsWith('-marketplace')).length };
}

// Importable without side effects (the tests import renderReadme); argv is only read when run.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const DRY = args.includes('--dry-run');
  const version = opt('--version');
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('usage: node scripts/publish-standalone.mjs --version <MAJOR.MINOR.PATCH> [--dry-run]');
    process.exit(2);
  }
  if (!existsSync(join(SKILL, 'SKILL.md'))) die('the skill is not in the plugin tree');
  if (!existsSync(TEMPLATE)) die('scripts/standalone-readme.template.md is missing');

  // 1. the repo exists (create on first publish)
  const exists = spawnSync('gh', ['repo', 'view', MIRROR, '--json', 'name'], { encoding: 'utf8' }).status === 0;
  if (!exists) {
    if (DRY) { console.log(`publish-standalone: ${MIRROR} does not exist — a real run would create it (public)`); }
    else {
      console.log(`publish-standalone: creating ${MIRROR} (public)`);
      sh('gh', ['repo', 'create', MIRROR, '--public', '--description',
        'House conventions for building GoHighLevel systems — a Claude Code / Codex skill. Mirror of the uxie-ghl-factory plugin skill.']);
    }
  }

  // 2. fresh clone (or an empty tree on a dry run against a repo that does not exist yet)
  const work = mkdtempSync(join(tmpdir(), 'ghl-system-conventions-mirror-'));
  if (exists) sh('git', ['clone', '--quiet', MIRROR_URL, work]);
  else { sh('git', ['init', '--quiet', '-b', 'main', work]); }

  // 3. replace the tree wholesale — everything except .git — so removed files disappear too
  for (const name of readdirSync(work)) {
    if (name === '.git') continue;
    rmSync(join(work, name), { recursive: true, force: true });
  }
  copySkill(work);
  cpSync(join(REPO, 'LICENSE'), join(work, 'LICENSE'));
  const readme = renderReadme(readFileSync(TEMPLATE, 'utf8'), { version, skillDescription: skillDescription(), ...typeCounts() });
  writeFileSync(join(work, 'README.md'), readme);

  // 4. commit stamped with the plugin version; tag; push
  sh('git', ['add', '-A'], work);
  const staged = sh('git', ['status', '--porcelain'], work);
  if (!staged) {
    console.log(`publish-standalone: mirror already matches ${version} — nothing to publish`);
    if (!DRY && exists && !sh('git', ['tag', '-l', `v${version}`], work)) {
      sh('git', ['tag', '-a', `v${version}`, '-m', `uxie-ghl-factory ${version}`], work);
      sh('git', ['push', '--quiet', 'origin', `v${version}`], work);
      console.log(`publish-standalone: tagged v${version}`);
    }
    process.exit(0);
  }
  const files = staged.split('\n').length;
  sh('git', ['commit', '--quiet', '-m', `mirror: ghl-system-conventions from uxie-ghl-factory ${version}\n\nPublished by scripts/publish-standalone.mjs. Do not edit here — the plugin copy is canonical.`], work);
  if (DRY) {
    console.log(`publish-standalone: DRY RUN — would push ${files} file(s) + tag v${version} to ${MIRROR}`);
    console.log(`   staged tree left at ${work}`);
    process.exit(0);
  }
  sh('git', ['tag', '-a', `v${version}`, '-m', `uxie-ghl-factory ${version}`], work);
  sh('git', ['push', '--quiet', '-u', 'origin', 'main'], work);
  sh('git', ['push', '--quiet', 'origin', `v${version}`], work);
  console.log(`publish-standalone: pushed ${files} file(s) + tag v${version} → https://github.com/${MIRROR}`);
}
