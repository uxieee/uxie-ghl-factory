// rel-10b (2026-11-07): the structural id rule. When knowledge/ sits beside the checkout, the privacy gate checks every
// random-looking id in these files against ALL of knowledge's captured data (sniffs/ and samples/, any date), so the next
// real id that nobody listed by hash is still caught. This test takes a real id from a knowledge capture AT RUN TIME and
// never writes it into the repo: it is planted in a throwaway git repo, and the gate must refuse it. A synthetic control in
// the same run must pass. Skipped when knowledge/ is not beside the checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './_tmp.mjs';

const GATE = fileURLToPath(new URL('../../../../scripts/check-privacy.mjs', import.meta.url));
const KNOWLEDGE = fileURLToPath(new URL('../../../../../knowledge/', import.meta.url));
const CAPTURE = 'sniffs/ai-agents-wave4-voice-2026-09-28/live-ai.voice.agent_create_from_template-snap-after-probe.json';
const CONTROL = 'Lq7TestCtl00000000001';   // synthetic, never in knowledge
const CAPTURE_HEX = 'sniffs/courses-w8-2026-11-06/live-tools-w8.jsonl';   // a courses capture with 24-character hex ids
const CONTROL_HEX = '5e0c1a2b3d4f607182930a4b';   // synthetic 24-hex, never in knowledge
const ID = /(?<![A-Za-z0-9-])([A-Za-z0-9]{20})(?![A-Za-z0-9-])/g;

const haveKnowledge = existsSync(join(KNOWLEDGE, CAPTURE));
const haveHexCapture = existsSync(join(KNOWLEDGE, CAPTURE_HEX));
// A random-looking 20-character id from the capture that knowledge does not list as a vendor value.
// It must also be a value the hash list does NOT already catch, so this test isolates the structural rule (a listed id
// is refused, and printed, by the hash rule instead).
const GATE_SRC = readFileSync(GATE, 'utf8');
const knownId = () => {
  const vendor = new Set(Object.keys(JSON.parse(readFileSync(join(KNOWLEDGE, 'scripts', 'privacy-vendor-ids.json'), 'utf8')).ids ?? {}));
  for (const m of readFileSync(join(KNOWLEDGE, CAPTURE), 'utf8').matchAll(ID)) {
    const t = m[1];
    const listed = GATE_SRC.includes(createHash('sha256').update(t.toLowerCase()).digest('hex'));
    if (/\d/.test(t) && /[A-Z]/.test(t) && /[a-z]/.test(t) && !vendor.has(t) && !listed && t !== CONTROL) return t;
  }
  throw new Error('no unlisted random-looking id found in the capture');
};

const gateOn = (files) => {
  const dir = tempDir('privacy-structural-');
  execFileSync('git', ['init', '-q', dir]);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  try {
    const out = execFileSync('node', [GATE], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    return { refused: false, out };
  } catch (e) {
    return { refused: true, out: String(e.stderr ?? '') + String(e.stdout ?? '') };
  }
};

test('the gate refuses an id that appears in knowledge captured data, although no hash lists it',
  { skip: !haveKnowledge && 'knowledge/ is not beside this checkout' }, () => {
    const id = knownId();
    const r = gateOn({ 'planted.test.mjs': `const r = { id: '${id}' };\n` });
    assert.equal(r.refused, true, 'a knowledge id must be refused');
    assert.match(r.out, /planted\.test\.mjs:1/);
    assert.match(r.out, /id present in knowledge data/);
    assert.ok(!r.out.includes(id), 'the value itself is not printed');
  });

test('CONTROL: a synthetic id that knowledge does not contain passes in the same run',
  { skip: !haveKnowledge && 'knowledge/ is not beside this checkout' }, () => {
    const r = gateOn({ 'control.test.mjs': `const r = { id: '${CONTROL}' };\n` });
    assert.equal(r.refused, false, r.out);
  });

// rel-10b (QA finding): a 24-character hex id (GHL's Mongo-style ids) is checked the same way.
const knownHexId = () => {
  const vendor = new Set(Object.keys(JSON.parse(readFileSync(join(KNOWLEDGE, 'scripts', 'privacy-vendor-ids.json'), 'utf8')).ids ?? {}));
  for (const m of readFileSync(join(KNOWLEDGE, CAPTURE_HEX), 'utf8').matchAll(/(?<![0-9a-f])[0-9a-f]{24}(?![0-9a-f])/gi)) {
    const t = m[1] ?? m[0];
    const listed = GATE_SRC.includes(createHash('sha256').update(t.toLowerCase()).digest('hex'));
    if (!vendor.has(t) && !listed) return t;
  }
  throw new Error('no unlisted 24-hex id found in the capture');
};

test('the gate refuses a 24-hex id that appears in knowledge captured data, although no hash lists it',
  { skip: !haveHexCapture && 'knowledge/ is not beside this checkout' }, () => {
    const id = knownHexId();
    const r = gateOn({ 'planted-hex.test.mjs': `const r = { id: '${id}' };\n` });
    assert.equal(r.refused, true, 'a knowledge 24-hex id must be refused');
    assert.match(r.out, /planted-hex\.test\.mjs:1/);
    assert.ok(!r.out.includes(id), 'the value itself is not printed');
  });

test('CONTROL: a synthetic 24-hex id that knowledge does not contain passes in the same run',
  { skip: !haveHexCapture && 'knowledge/ is not beside this checkout' }, () => {
    const r = gateOn({ 'control-hex.test.mjs': `const r = { id: '${CONTROL_HEX}' };\n` });
    assert.equal(r.refused, false, r.out);
  });

// rel-10b (QA finding): UUID matching is case-insensitive. An UPPER-case form of a knowledge UUID must be refused.
const knownUuid = () => {
  const vendor = new Set(Object.keys(JSON.parse(readFileSync(join(KNOWLEDGE, 'scripts', 'privacy-vendor-ids.json'), 'utf8')).ids ?? {}));
  for (const m of readFileSync(join(KNOWLEDGE, CAPTURE_HEX), 'utf8').matchAll(/(?<![0-9a-f-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f-])/g)) {
    const t = m[0];
    const listed = GATE_SRC.includes(createHash('sha256').update(t.toLowerCase()).digest('hex'));
    if (!vendor.has(t) && !listed) return t;
  }
  throw new Error('no unlisted UUID found in the capture');
};
test('an UPPER-case UUID of a knowledge id is refused (UUID matching is case-insensitive)',
  { skip: !haveHexCapture && 'knowledge/ is not beside this checkout' }, () => {
    const upper = knownUuid().toUpperCase();
    const r = gateOn({ 'planted-uuid.test.mjs': `const r = { id: '${upper}' };\n` });
    assert.equal(r.refused, true, 'an upper-case knowledge UUID must be refused');
    assert.match(r.out, /planted-uuid\.test\.mjs:1/);
    assert.ok(!r.out.includes(upper), 'the value itself is not printed');
  });
