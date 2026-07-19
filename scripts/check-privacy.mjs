#!/usr/bin/env node
// Privacy gate for a PUBLIC repo.
//
// This repo is built by harvesting live GoHighLevel accounts, so real client content
// (emails, phone numbers, business names, third-party account ids) gets copied verbatim
// into catalog examples, sniff bundles and llms-full.txt. It has leaked three times.
// This is the backstop: run it before committing, and in CI.
//
//   node scripts/check-privacy.mjs            # scan tracked files, exit 1 on a hit
//   node scripts/check-privacy.mjs --staged   # scan only staged files (pre-commit)
//
// Adding a legitimate exception: put it in ALLOW below with a reason.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const staged = process.argv.includes('--staged');
const listCmd = staged
  ? ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']
  : ['ls-files', '-z'];
const files = execFileSync('git', listCmd, { encoding: 'utf8' }).split('\0').filter(Boolean);

// Substrings that are FINE — placeholders, reserved domains, our own identifiers.
const ALLOW = [
  'example.com', 'example.org', 'example.net',       // RFC 2606 reserved
  '@{', '{{',                                        // merge tags
  'a@b.com', 'jane@x.com', 'subaccount-c.com',       // long-standing doc placeholders
  'testemailvalue@value.com',
  'gromdigital.com', 'xanderroque.com',              // ours, deliberate
  'xanderjohnrazonroque.workers.dev',                // our MCP endpoint
  '+15551234567', '+61400000000', '+1234567890',     // placeholder numbers
  // GHL's OWN sample number, used across its phone-format UI labels. Not client data —
  // scrubbing it corrupts the recovered-source fidelity (it demonstrates formats).
  '541-313-4664', '541 313-4664', '5413134664', '541 313 4664',
  // GHL's own placeholder addresses inside recovered-source / UI metadata.
  'john@acme.com', 'fromemailtest@test.com', 'bcctest@bcctest.com', 'cctest@cctest.com',
  // Synthetic ids substituted during the 2026-07-19 scrub. Kept digit-shaped so the
  // surrounding examples still parse and read realistically.
  '100000000000000000001', '100000000000000000002',  // were third-party Google account ids
  '120000000000000001', 'act_000000000000001',       // were a client's Facebook ad ids
  '00000000000000000001',                            // was an ephemeral GCP task id
  // Synthetic ids from the EARLIER plugin-repo scrub (v0.5.3/0.6.1). Same fields, different
  // placeholder values than above — the two repos were sanitized in separate passes.
  'act_100000000000000', '120200000000000000', '109876543210987654321',
];

const RULES = [
  { name: 'email address',      re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'E.164 phone number', re: /\+\d{7,15}\b/g },
  { name: 'long opaque account id', re: /\b\d{18,}\b/g },
  // Ad-platform account ids are shorter than the digit rule above but just as identifying.
  { name: 'ad account id', re: /\bact_\d{6,}\b/g },
];

// Known client / person names, stored as SHA-256 HASHES — never plaintext.
//
// A denylist of client names, committed to a public repo, is itself the disclosure it
// exists to prevent. (This gate caught exactly that on its own first commit: the earlier
// plaintext version of this list failed its own check, correctly.) So the repo carries
// only hashes; the check still works everywhere and reveals nothing.
//
// To add a name:  node scripts/check-privacy.mjs --hash "Some Client"
// then paste the printed hash below. Keep the plaintext out of the repo.
const NAME_HASHES = new Set([
  '6322994f1a45a4bb6be70aac157d3f90d6eb9ac5cdbc6085ec75585b62ada2e4',
  '034a85ade0d41d12a48323120ac45c02a7003723ec394102959d442cc1dea6c1',
  '739103c7a0e4608b9370e4493c41c3f77553fe05ec60acc6827d1992b3c479b3',
  '2f8ef233688fbb8c88a7bba957f9fd5db219a90f443dd59bb17183db59541fd6',
  '5172d78d1b03b901f59ca509435bb501f969da5a9eacb21336fcb7c69d36e743',
  '87d968253934dd7e138c324e4b42c5e9f576f6c6b2231a70dd415a083f3e897f',
  'b8e7c8ef6a2fb24c3b9d3208f013ab7b6bbeb4be7319f1341f225b87f39d9ad1',
  '89847fd8a6136490c589bc54b0ca562bebef22ceb1c2b2e43fa6feaa9d7468ca',
  '35b24f76ed4716be19309a13d1af68a2e6cfc36755472a303a8ddccc6416c5b5',
  '9b80960fc20873aabedc60da10c234c9bd78d59d03274553ab1a31b661d2528b',
  'bbc31cb5c93507e4bfbe1b98a531678b1bba76de50e6b8b4d0f7bde197f4ab66',
  'f4e84b010041170abbad72ca0d88448a5163e7184ce647d737187f3d1f9f5502',
  '9405c87cab48a3e132788af460dbfe80fe1a23ac9862b45188fa7475acb4a4eb',
  'cf5ff1a6a6c9ff2cf816962347936a5a8d2fe4988a5fa423afac2bea0e6d9ee0',
  '5dfd46e27a5e3e8e06fcb92817b0955f7fd28048f5003bfd4e5be8e67bf417db',
]);

// Normalize a candidate the way the hashes were generated: lowercase, collapse any
// non-alphanumeric run to a single space, trim. So "Acme Widgets", "acme-widgets" and
// "ACME  WIDGETS" all hash identically.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sha = (s) => createHash('sha256').update(norm(s)).digest('hex');

if (process.argv.includes('--hash')) {
  const value = process.argv[process.argv.indexOf('--hash') + 1];
  if (!value) { console.error('usage: --hash "Client Name"'); process.exit(2); }
  console.log(`${sha(value)}  // ${norm(value).replace(/\S/g, '*')}`);
  process.exit(0);
}

// Build 1..3-word n-grams from a line and hash each, plus the de-spaced join so a
// run-together form ("acmewidgets") is caught alongside the spaced one.
function nameHits(line) {
  const words = norm(line).split(' ').filter(Boolean);
  const found = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n).join(' ');
      for (const cand of new Set([gram, gram.replace(/ /g, '')])) {
        if (NAME_HASHES.has(sha(cand))) found.push(gram);
      }
    }
  }
  return found;
}

const allowed = (s) => ALLOW.some((a) => s.includes(a));
const hits = [];

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }   // binary / deleted
  if (text.includes('\0')) continue;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { name, re } of RULES) {
      for (const m of line.match(re) ?? []) {
        if (!allowed(m)) hits.push({ file, line: i + 1, kind: name, value: m });
      }
    }
    for (const n of new Set(nameHits(line))) {
      hits.push({ file, line: i + 1, kind: 'client name', value: n });
    }
  });
}

if (!hits.length) {
  console.log(`privacy check: clean (${files.length} files scanned)`);
  process.exit(0);
}
console.error(`\nprivacy check FAILED — ${hits.length} potential leak(s):\n`);
for (const h of hits.slice(0, 40)) console.error(`  ${h.file}:${h.line}  [${h.kind}]  ${h.value}`);
if (hits.length > 40) console.error(`  … and ${hits.length - 40} more`);
console.error(`\nThis repo is PUBLIC and is built from live account harvests.`);
console.error(`Replace with a placeholder, or add a documented exception to ALLOW in ${'scripts/check-privacy.mjs'}.\n`);
process.exit(1);
