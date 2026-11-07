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
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const staged = process.argv.includes('--staged');
// Plain mode scans tracked AND new-but-not-ignored files. `ls-files -z` alone is tracked-only,
// which made a freshly authored file invisible to the exact command the docs tell you to run
// before committing — a new SKILL.md reported "clean (585 files scanned)" on 2026-09-08 without
// being among them. The --staged path still caught it on the way in, so this was a hole in
// `npm test`, not an open door; the knowledge copy has scanned this way since 2026-08-22.
const listCmd = staged
  ? ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']
  : ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
// Generated build artifacts are NOT scanned: they are bundled third-party code (minified
// deps carry arbitrary long numeric constants — e.g. int64/uint64 bounds — that trip the
// "long opaque account id" rule). Their authored source (mcp-internal/core, stdio.mjs) is
// tracked and scanned on its own, so nothing that could actually leak is skipped.
// RUN THIS FROM THE PLUGIN ROOT. The pattern below is written against the path as seen from here,
// so running the script with a different cwd silently stops skipping the bundles and then trips on
// the Int64 min/max constants inside vendored SDK code, reported as account ids.
// The bundles are excluded because they are generated; their INPUTS are scanned as source.
const SKIP_PATHS = [/(^|\/)mcp-internal\/dist\//];
const files = execFileSync('git', listCmd, { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((f) => !SKIP_PATHS.some((re) => re.test(f)));

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
  // Fixtures for the From-address preflight (engine/preflight.test.mjs). `.example` is RFC 2606
  // reserved exactly like the three domains above, so none of these can exist; the gmail literal
  // is the free-webmail probe itself, since GHL answers `free_webmail_blocked` only for a REAL
  // free-webmail domain and the differential cannot be written with a placeholder.
  // 🔴 FULL ADDRESSES, never the bare domain, and never the `acme.example` fragment an earlier
  // version of this list carried: `allowed()` below is a SUBSTRING test, so that fragment also
  // waved through any address at a REAL domain merely starting the same way (acme.examplecorp.com,
  // sub.acme.example.io, acme.example.com), and a bare `gmail.com` would blind this gate to every
  // real personal gmail address a future harvest drags in. The narrowness IS the safety property
  // — do not "simplify" these back into domains.
  'hello@acme.example', 'hello@mail.acme.example', 'a@acme.example', 'Someone@Gmail.com',
  // Synthetic ids substituted during the 2026-07-19 scrub. Kept digit-shaped so the
  // surrounding examples still parse and read realistically.
  '100000000000000000001', '100000000000000000002',  // were third-party Google account ids
  '120000000000000001', 'act_000000000000001',       // were a client's Facebook ad ids
  '00000000000000000001',                            // was an ephemeral GCP task id
  // Synthetic ids from the EARLIER plugin-repo scrub (v0.5.3/0.6.1). Same fields, different
  // placeholder values than above — the two repos were sanitized in separate passes.
  'act_100000000000000', '120200000000000000', '109876543210987654321',
  // Shape-valid but plainly fake Google API key used by the token-renewal tests to prove the
  // firebase exchange is called with the CAPTURED key. Deliberately not a real key: the rule
  // below caught it on its first run, which is the behaviour it exists to have.
  ['AIza', 'TESTKEY', '0'.repeat(28)].join(''),
  // GHL's own PUBLIC Firebase web client key, shipped in the AI Studio bundle. Not a secret;
  // it identifies the Firebase project and cannot authorise anything on its own.
  'AIzaSyB_w3vXmsI7WeQtrIOkjR6xTRVN5uOieiE',
];

const RULES = [
  { name: 'email address',      re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'E.164 phone number', re: /\+\d{7,15}\b/g },
  { name: 'long opaque account id', re: /\b\d{18,}\b/g },
  // Ad-platform account ids are shorter than the digit rule above but just as identifying.
  { name: 'ad account id', re: /\bact_\d{6,}\b/g },
  // 0.45.0 shipped GHL's Firebase web key as a constant; GitHub's scanner flagged the bundle
  // within minutes. Public or not, a third party's key is captured at runtime, never committed.
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
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
  'fcb1d1c298887a6ffcd3f5f6eb28504c1ffa84f79984040683b0c74452b2245f',
  '6e8bfe2ae1abb91f367c8c9ecbef24cddbedbc0686ae0f1ea9584116ad4ffd98',
  '73f91b8e33fa0f6931d3872a012785b54373c1c3712dad952a11d631d873c569',
  // 2026-08-31 roster sweep: a task review noticed an (untracked) design doc naming a client the
  // gate did not know. Hashing the active roster against this list found TEN names missing, not
  // one — the 18 above date from the earlier scrubs and never tracked the roster as it grew.
  '91fd465dae01a9a169703b165d1d64acc4890754e792b52c7d4105ee1b40df4c',
  '4004a99ad5bcc81a99b32429d1830496a891abfc2c2fcfcdef1b57e8c61ba396',
  'd7aa31064c1df93fd9d981b97fe2927474956d497d3d3a988885a6a55fc20688',
  '4a813e2dd7276ce07313c62fbd0fcd3c92adc274dac762a03d9bb2927f56b829',
  '792d3c8b8c2e74ee9429f726d9e7c7aba29c0549b3e17ed7f0c4896743a301f7',
  '0c60ce0631ed9a6e8f92cd96292c6e7f04cfc62826d6085e63cd60ec13bcc1bc',
  'b637471b996f6ed120c5084b69bd8754e082333b511305c655ca47134450f821',
  'a7a81f0dbbe295f1069931133d696a0473175e7695b85cfc03985e9d2314e2ef',
  '345aa0743f7662db7d2fc2861d1650f58df0f7091f0548127079d9b33a4a7fd6',
  'adf6a4a4af14f65e86cef064eb19b54015bc9467bafefc1579c7e1cd96b8f4a3',

  // ── reconciled with knowledge/scripts/check-privacy.mjs, 2026-09-08 (bl-107) ──────────────
  // The two lists had drifted apart in BOTH directions: 17 hashes shared, 19 only in knowledge,
  // 11 only here. The reported "7 unaccounted" was arithmetic on the two counts (36 vs 28), not a
  // comparison of the sets — the sets differed by 30.
  //
  // The 16 below were in knowledge and missing here, which is the direction that matters: this
  // repo is the PUBLIC one, so each was a name the public gate could not see.
  //
  // FIVE knowledge hashes are deliberately NOT here and must stay that way: the GROM family —
  // the agency names, its AU location id, its company id, and the repo owner's own user id.
  // This repo is allowed to name the account it tests against, and the plugin's own fixtures do.
  // Adding them would fail the gate on correct, intentional content. Do not "align" the lists.
  // rel-10 narrowed this: the account NAMES stay allowed, but the GROM Sandbox LOCATION ID is denied
  // (its hash is in the list below). Test fixtures use a synthetic id of the same shape instead.
  //
  // FIVE were dropped from this batch, not sixteen-minus-three: the first attempt added "GROM UK"
  // and GROM AU's location id, and the gate failed on four real files within seconds. That failure
  // is the method, not an accident — this repo passed its own gate before the edit, so any hash
  // that fires on existing content is by definition sanctioned, and the gate names the plaintext
  // it matched. If a future legitimate GROM mention trips this list, that is the same signal:
  // read the name the gate prints and delete its hash from here.
  '38ae3fd72195c277920f1421b2dff5a9093db94f2cda96bd9bed5c1c235d81ee',
  '5208c21f20bc5583ac46a3e912d64709089094255c7bc460a38232a111d85c8c',
  '592f306a24159bbe2855c928b3604063edcc1a470b53c100b94012c23edda1eb',
  '5ec8ee33d4bc9513880be2bd732bb5a15dab4991cce7f6f9ef4993316cb045d0',
  '7ecf07cc499ac7a43498e4753585392ac4e2ccdd6a93385cd86933685deac364',
  '87e4a915021315b660c0f10c59b6d0a241b6d97afdf372a0454b3eb862667b0f',
  'b549da6fd5fc800b4d6a577934684cbce36164cb9bea87d32d52bc81ed0d1d92',
  'c7fbed69acaf7409fbb231c325f107d7235d0bef89334fefac7ef4d0d076ca95',
  'd551d8256dd4b282a6eb11de055f8e2ac1c83baeb206940f8956c3a861762787',
  'd90877a69f3cf3c860b2c99c45aeaa0abb0d0304b16549814c39981d2bff4716',
  'e0b800b00aab4a190c57fa3ee83112a09e3a3a9504d6fd8225cdd747a9321a0e',
  // A client BUSINESS NAME both gates were blind to: only its location id was denied, so the
  // name sat in this PUBLIC repo right beside the id it labelled. 2026-09-08, bl-107.
  'fcde94e0b02d0e73c2f011d7c6b5971c49b608eee1a523944e3c60b161ee5777',
  // Client BUSINESS names found beside real ids in DISCOVERIES.md, 2026-09-08 (bl-102).
  // Their location ids were denied; the names were not — the same blind spot that let a
  // client's name sit in the public repo next to the id it labelled.
  '08989090a6db86c767fba6bfd4a97f71aa734198d6e928b128bcf840c5a28e7c',
  '51218c2ab5fde7d4a29f39fe2778d7cc5f67d7987799ab2718ad0a0fde0557c9',
  'a3fbdc684d6b27536d700a4bd5172ece1e1f971a029ebd18e175a6c712e6bdd3',
  'bd174fffc69b6e10ab1b8116372e08c9440ef3e003ed43f8aa58ebb50ca2da2b',
  'fe7d1bf25d986599d5f1c3145935792b6d8a724110f958f9075e02bc93a62a74',
  '10fc7f70b0898c80c6165da25b54019641755c61a069f8be1d5b3f7c75e53d97',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  '3eb493400f074af07730cc657ba3daa825f9bca8cc6438c53db6881ae787474a',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  '4f3411d07b0ac622d7865a9f09476085dc10c98f07b0ee9e886625d1443f3a15',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  '69e60ee97a1509920dbacc29cf848990ea2d3569726b1d9313aa99f0eaeff04f',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  '7aa6b6043298d094bc4dec1659c37190ec3cbcb5083e48fe2deb877b4c2a263b',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  '8193af59573adc133252553e216fdf45b7345263dc7ee2cfd384f60aa9d2b3b8',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'abf4d9a69545993a88103697f450705bb32522d4092c3ffac31a69d5138ba86a',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'acf0097e4ed663ef190e5ab8e89a0d9077df4b77f55b81c7e2b6458cc51ef426',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'ad6bb7afa95860ec2749ffeabd25d2f8ac0489779a1eecf0c3dc6d2fc24ccea0',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'b9127ca4467637c8a6136db04e712aebd023865685b084eb94c9e46d9757989e',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'bf4379ae940e929abad8b86e640655585251e6b5dd0aa2d0dceb9d981bd77a6a',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'c3bfb1e3f000df690266b8e911a34bddfcfe7382622f31effd42b14bf3d42d58',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'cf29afbec64670893bd7e20486307758991b3e3508f945a1fd30b38a3cca640c',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'fd818535497745f4d00a06fb8cc5fd06f7461bed80bef12ceee1af3a1811ba1b',  // synced from knowledge's list 2026-09-23 (console bl-107: the two lists had drifted)
  'a3c003efb343054a3fcb7d59e9e853536fd72839942dad8a8918dfedd709c136',  // harvested-account spelling variant (2026-09-23, bl-107 sweep)
  '776b485b912a57aa8aea1d9e749f1c377a1c5bd81eebf5581a6c67a20f24938c',  // harvested-account spelling variant (2026-09-23, bl-107 sweep)
  'e9db02674de84594e916dc84eac9dcf6d99f0ed3589770de82452d25339dfdf9',  // harvested-account spelling variant (2026-09-23, bl-107 sweep)
  // bl-107 (2026-09-23): synced with knowledge's list EXCEPT the GROM family (grom, grom au, grom uk,
  // grom digital, gromdigital): this repo names the agency's own accounts in provenance on purpose.

  // One harvested project's vocabulary that sat in hand-curated step examples for months (found 2026-09-30): its product
  // name (one word and two), a custom-field title, a merge-tag stem and a routing-schema field. The scanner joins at most
  // three adjacent words, so each entry is a 1-3 gram. Same five hashes as knowledge/scripts/check-privacy.mjs.
  'd934dd1d7a70ef2c30959ffb62ec7f81ffef520824b15bdf52e26145931b4f42',
  'e1839bc29f08189b7876e7acf8ff3954951b5efbf951dfa80db16f8d01b8e58d',
  'd47bf56312ee8eb99b7f945306a7c804d6dc35726391c54af7cb75cf98119fc5',
  'af56a0419031ae138a3f3a88256ec97aa34e77ea85c12556bdf6d063a48a10a7',
  '327b59e7f26ffe855ebbc5e65687bbe0cb32eafee7732d7d5dc80782a7dff066',

  // rel-10 (2026-11-07, orchestrator decision (a) on privacy): the GROM Sandbox LOCATION ID. The GROM family's
  // account NAMES may still appear in this repo (see the exemption note above), but this id may not: it sat in
  // test fixtures in the public plugin and on origin/main. Hashed like every other entry; the plaintext stays out.
  // Sandbox workflow, form and contact ids are flagged the same way when they are known: add the hash with --hash.
  '2bdf35474a3ff3aa9018f37b6eefc8aec29897936b9ed54e9c5e9e86a02342e4',
  // rel-10 fix 2 (2026-11-07): real ids found on origin/main by QA's sweep. Each is held by its hash only.
  // Three are GROM Sandbox records (two draft workflows, a sandbox step id, a sandbox record id, a custom field).
  // One is a location's media bucket id (not the sandbox's, and not in the local accounts list). One is a message id
  // from the operator's own asset capture. Add a new one with: node scripts/check-privacy.mjs --hash "<id>".
  '227c416a100538ce1ef7a898cc1c665c081c1dcc5d725d05f6f6dc91e2258aec',
  'a7727880496782a29a047b9b03057b058a50a384da2deac1fa9235c6d3b608f5',
  'e182f7788601bf23696d15f60a0bcc8cc31b6617aa842b6461468543e46d90e2',
  'cb0f98c9a93d70901b42a8c7dca6fa2d55ab690623e77c1f8850e64f732d0d44',
  'a8c6cbd67b874b266733b0e37ed52829b19fe2adc5dd73252a1c55351539f50b',
  '615428735bf121f168cfdad2a8fb98ceea94e4a16708983a1fb089aec96d4529',
  '485965590c06848bbe1ec104a68845463379c5622ebee720740a84d7a87bf64f',
  // rel-10b (2026-11-07): eight more real ids from QA's deeper sweep (sandbox folder, sandbox agents, sandbox workflow and
  // bot ids, a GROM Digital AU probe id, a live step UUID not on origin/main, a GROM UK comment id). Hash only.
  '39532233b759cb1a688db2e1e4790eb0a9433963e3448e6c6b217aacdc5f53fc',
  '795a1261bc237a0c70db66386577dec1652cd3c7a93195f1863b3f1136c8cf70',
  '675ca3122d74acaa4039ca936085e1d2813dd63782010b2cc4302aedf7ce2497',
  '37180eb56e77d2ae7a489d4e5c6fd6dbb66584fcb642ebfe45c5f0d9bc2954d2',
  '730a8aa1915a7e0f0fead4ebad9a41c5173166c9a0c39a9ff4be828ce62850aa',
  '85e32da5960981d5f97ae6766aae331f0bb6c4ea3ceae5ec72b0f54a4aae4417',
  '7cf3b2ca244915d1525f20e43780b30ae3cab2aec0e30b7c6c7f6a14e75a7a91',
  '3359f7ad911127e59d840410c86bcfaaa8182d79d856921666b92a1a6dc97728',
  // rel-10b (2026-11-07, decision 3): a messageId from the operator's own asset capture (scrubbed from the plugin fixture). Hash only.
  '7d0ed087c381932c392ceb5762e6042e01b7b248428fc6d94f11ef8069beb642',
  // rel-10b (decision 3): two real-account 24-hex ids, scrubbed from the plugin tests. Hash only.
  'a296fc956175b1cf2d5555fd7ff51a1cf0ca523709dc4ff2ee6b38de01149b59',
  'ec767b583e5ad935c3cf90e7a6987209a32364e6df639e63ed645bf10de034c6',
]);

// Extra deny hashes for a run (rel-10 fix): PRIVACY_EXTRA_DENY_HASHES=<sha256>,<sha256> adds to NAME_HASHES for that run.
// It can only add refusals, never remove one. The plugin's own tests use it to prove the gate bites on a SYNTHETIC id
// by its hash, so no real id has to be written into the repo.
for (const h of (process.env.PRIVACY_EXTRA_DENY_HASHES ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  if (/^[0-9a-f]{64}$/.test(h)) NAME_HASHES.add(h);
}

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
  // rel-10 (fix 2): a listed ID is matched as a WHOLE token too. A UUID normalises to five words, which the 1-3 word
  // grams below never reach, so a hashed UUID would otherwise pass. Ids are 20-36 characters of letters, digits and hyphens.
  for (const tok of line.match(/[A-Za-z0-9-]{20,36}/g) ?? []) {
    if (NAME_HASHES.has(sha(tok))) found.push(tok);
  }
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

// ── Structural rule (rel-10b, 2026-11-07): the id cross-check ───────────────────────────────────
// A hash list only catches the ids someone has already found. When knowledge/ sits beside this checkout, every
// random-looking id in these files (a 20-character mixed-case token, or a UUID) is also checked against ALL of knowledge's
// captured data (sniffs/ and samples/, any date). A token knowledge lists in scripts/privacy-vendor-ids.json is a vendor
// value and is exempt. A cold scan takes minutes, so the result is cached in the OS temp directory, keyed by knowledge's
// HEAD, its uncommitted captures and the candidate set. The cache holds hashes only. Without knowledge/ beside the checkout
// the check is skipped, and the gate says so.
const KNOWLEDGE_DIR = fileURLToPath(new URL('../../knowledge/', import.meta.url));
const ID_SHAPE = /(?<![A-Za-z0-9-])([A-Za-z0-9-]{20,36})(?![A-Za-z0-9-])/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRandomId = (t) => UUID_RE.test(t)
  || (t.length === 20 && /^[A-Za-z0-9]+$/.test(t) && /\d/.test(t) && /[A-Z]/.test(t) && /[a-z]/.test(t))
  // GHL's Mongo-style ids (products, prices, schema docs) are 24 hex characters (rel-10b, QA finding).
  || /^[0-9a-f]{24}$/i.test(t);
const sha256raw = (s) => createHash('sha256').update(s).digest('hex');

function knowledgeVendorIds() {
  const f = join(KNOWLEDGE_DIR, 'scripts', 'privacy-vendor-ids.json');
  return existsSync(f) ? new Set(Object.keys(JSON.parse(readFileSync(f, 'utf8')).ids ?? {})) : new Set();
}

// Returns the sha256 of each candidate (lowercased) that knowledge's data contains, or null when knowledge/ is not present.
// rel-10b: the search is an INDEX of every random-looking token in every file on disk under sniffs/ and samples/ (tracked,
// untracked or ignored alike), built once and cached in a private directory. The cache key is HEAD plus each file's path,
// size and mtime, so an edited, added or removed capture rebuilds the index. The index holds hashes only.
function knowledgeIdHashes(cands) {
  const roots = ['sniffs', 'samples'].map((d) => join(KNOWLEDGE_DIR, d)).filter((d) => existsSync(d));
  if (!roots.length) return null;
  const vendor = knowledgeVendorIds();
  const checkable = [...cands.keys()].filter((t) => !vendor.has(t));
  if (!checkable.length) return new Set();
  const files = [];
  for (const r of roots) {
    for (const rel of readdirSync(r, { recursive: true })) {
      const abs = join(r, rel);
      const st = statSync(abs);
      if (st.isFile()) files.push({ abs, fp: `${abs.slice(KNOWLEDGE_DIR.length)}\0${st.size}\0${st.mtimeMs}` });
    }
  }
  const head = execFileSync('git', ['-C', KNOWLEDGE_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const key = sha256raw(`${head}\n${files.map((f) => f.fp).sort().join('\n')}`);
  const cacheDir = join(homedir(), '.cache', 'ghl-privacy-gate');
  const cacheFile = join(cacheDir, `index-${key.slice(0, 40)}.json`);
  let index = null;
  try {
    if (existsSync(cacheFile)) index = new Set(JSON.parse(readFileSync(cacheFile, 'utf8')).tokens);
  } catch { /* unreadable cache: rebuild */ }
  if (!index) {
    index = new Set();
    for (const f of files) {
      let text;
      try { text = readFileSync(f.abs, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(ID_SHAPE)) if (isRandomId(m[1])) index.add(sha256raw(m[1].toLowerCase()));
    }
    try {
      mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
      writeFileSync(cacheFile, JSON.stringify({ tokens: [...index] }), { mode: 0o600 });
    } catch { /* the cache is an optimisation; a failed write costs time, not correctness */ }
  }
  return new Set(checkable.map((t) => sha256raw(t.toLowerCase())).filter((h) => index.has(h)));
}

const allowed = (s) => ALLOW.some((a) => s.includes(a));
const hits = [];
const idCands = new Map();   // token -> [{file,line}] for random-looking ids (the cross-check below)

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }   // binary / deleted
  if (text.includes('\0')) continue;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(ID_SHAPE)) {
      if (!isRandomId(m[1])) continue;
      if (!idCands.has(m[1])) idCands.set(m[1], []);
      idCands.get(m[1]).push({ file, line: i + 1 });
    }
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

const knownIdHashes = knowledgeIdHashes(idCands);
if (knownIdHashes === null) {
  console.log(`privacy check: knowledge/ is not beside this checkout; the id cross-check was skipped (${idCands.size} candidate ids)`);
} else {
  for (const [tok, locs] of idCands) {
    if (knownIdHashes.has(sha256raw(tok.toLowerCase()))) for (const l of locs) hits.push({ file: l.file, line: l.line, kind: 'id present in knowledge data', value: '(value not printed)' });
  }
}

if (!hits.length) {
  console.log(`privacy check: clean (${files.length} files scanned)`);
  process.exit(0);
}
console.error(`\nprivacy check FAILED — ${hits.length} potential leak(s):\n`);
// Masked (rel-10b): a refusal names the file, the line and the kind of rule, never the matched value.
for (const h of hits.slice(0, 40)) console.error(`  ${h.file}:${h.line}  [${h.kind}]`);
if (hits.length > 40) console.error(`  … and ${hits.length - 40} more`);
console.error(`\nThis repo is PUBLIC and is built from live account harvests.`);
console.error(`Replace with a placeholder, or add a documented exception to ALLOW in ${'scripts/check-privacy.mjs'}.\n`);
process.exit(1);
