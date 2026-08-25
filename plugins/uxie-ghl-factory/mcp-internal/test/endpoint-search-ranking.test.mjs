import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

// The frozen A0 baseline: what search_endpoints returned for ten read-shaped intents BEFORE the
// scorer knew what an endpoint does. It is checked in so this is a comparison against a recorded
// measurement rather than an absolute claim about ranking quality.
const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(readFileSync(resolve(HERE, 'fixtures/catalogue-acceptance-baseline.json'), 'utf8'));

const search = TOOLS.find((t) => t.name === 'search_endpoints');
const topThree = async (intent) => {
  const res = await search.handler({ intent, limit: 10 }, {});
  return (res.data.results ?? []).slice(0, 3);
};

test('no DELETE surfaces in the top 3 of a read-shaped question', async () => {
  // Measured before this rule existed: "which contacts are sitting at step X right now" returned
  // remove-stuck-statuses and requeue-stuck-statuses at #1 and #2 -- destructive runtime mutations
  // for a pure read -- and "read the email deliverability posture" put send-test-email at #2.
  for (const { intent } of BASELINE.intents) {
    const rows = await topThree(intent);
    const deletes = rows.filter((r) => r.method === 'DELETE');
    assert.equal(deletes.length, 0, `"${intent}" surfaced ${deletes.map((r) => r.path).join(', ')}`);
  }
});

test('a curated destructive row never surfaces unless the caller names the act', async () => {
  // flowguard/blacklist STOPS a workflow, and its path matches "workflow" strongly enough that it
  // reached the top five for "publish the workflow" before this rule.
  // The GET that READS the blacklist is fine and may surface; the POST that WRITES it is the one
  // that stops a workflow, and that is what must not appear.
  const rows = await search.handler({ intent: 'publish the workflow', limit: 10 }, {});
  const writes = (rows.data.results ?? []).filter((r) => r.method !== 'GET' && r.path.includes('blacklist'));
  assert.equal(writes.length, 0, `blacklist write surfaced: ${writes.map((r) => `${r.method} ${r.path}`).join(', ')}`);

  // But a caller who asks for it by name still reaches it.
  const named = await search.handler({ intent: 'blacklist a workflow so it stops', limit: 10 }, {});
  assert.ok((named.data.results ?? []).some((r) => r.method !== 'GET' && r.path.includes('blacklist')),
    'naming the destructive act must still reach it');
});

test('write pressure on read-shaped intents is below the recorded baseline', async () => {
  let writeSlots = 0;
  for (const { intent } of BASELINE.intents) {
    writeSlots += (await topThree(intent)).filter((r) => r.method !== 'GET').length;
  }
  const before = BASELINE.aggregate.writeSlotsInTopThree;
  assert.ok(writeSlots < before, `write slots ${writeSlots} is not below the baseline ${before}`);
  // Guard the gain rather than only the direction: a later change that quietly gives most of it
  // back should fail here, not pass because it is still one better than 18.
  assert.ok(writeSlots <= 8, `write slots regressed to ${writeSlots} (was ${before}, achieved 5)`);
});

test('add and set are stop-words, so they are absent from the mutation verbs', () => {
  // CARD_STOP strips both before scoring sees them. Listing them as mutation verbs would be a rule
  // that silently never fires -- which is how the first draft of this was written.
  const src = readFileSync(resolve(HERE, '../core/tools.mjs'), 'utf8');
  const verbs = src.slice(src.indexOf('const MUTATION_VERBS'), src.indexOf('const DESTRUCTIVE_VERBS'));
  assert.ok(!/'add'/.test(verbs) && !/'set'/.test(verbs), 'add/set must not be listed as mutation verbs');
});
