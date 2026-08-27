import test from 'node:test';
import assert from 'node:assert/strict';
import { gotoLoops } from './goto-loops.mjs';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('x'), catalog: loadCatalog() });

test('a goto pointing back at an ancestor is reported as a loop', () => {
  const templates = [
    { id: 'a', type: 'sms', name: 'First', next: 'b' },
    { id: 'b', type: 'email', name: 'Second', next: 'g' },
    { id: 'g', type: 'goto', name: 'Back to first', attributes: { targetNodeId: 'a', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates), [
    { id: 'g', name: 'Back to first', target: 'a', targetName: 'First' },
  ]);
});

test('a goto pointing FORWARD is not a loop', () => {
  const templates = [
    { id: 'a', type: 'sms', name: 'First', next: 'g' },
    { id: 'g', type: 'goto', name: 'Skip ahead', attributes: { targetNodeId: 'z', type: 'goto' } },
    { id: 'z', type: 'email', name: 'Later' },
  ];
  assert.deepEqual(gotoLoops(templates), []);
});

test('a goto reachable from its target through a BRANCH is still a loop', () => {
  const templates = [
    { id: 'c', type: 'if_else', name: 'Split', next: ['t1', 't2'] },
    { id: 't1', type: 'transition', name: 'Yes', next: 'g' },
    { id: 't2', type: 'transition', name: 'No' },
    { id: 'g', type: 'goto', name: 'Back to split', attributes: { targetNodeId: 'c', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates).map((l) => l.id), ['g']);
});

test('a goto whose target does not exist is not reported here (REF_DANGLING owns that)', () => {
  const templates = [
    { id: 'g', type: 'goto', name: 'Nowhere', attributes: { targetNodeId: 'missing', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates), []);
});

test('a goto pointing at ITSELF is a loop', () => {
  const templates = [
    { id: 'g', type: 'goto', name: 'Self', attributes: { targetNodeId: 'g', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates).map((l) => l.id), ['g']);
});

// A goto is emitted with NO `next` key — its forward edge is its jump. A walk that only reads
// `next` treats a second goto as a dead end and misses a mutual two-goto cycle entirely: this is
// the ordinary shape of two branches that each end in a goto (goto is required to be terminal in
// its branch, ir.mjs GOTO_NOT_TERMINAL), one of which happens to jump into the other's chain.
// A -> B -> g2(goto -> C); C -> g1(goto -> A). g2 sends control to C, C flows into g1, g1 sends
// control back to A: a genuine cycle GHL's backend would lock exactly like a single-hop one.
test('a mutual two-goto cycle (A->B->g2->C, C->g1->A) is reported on BOTH gotos', () => {
  const templates = [
    { id: 'a', type: 'sms', name: 'A', next: 'b' },
    { id: 'b', type: 'email', name: 'B', next: 'g2' },
    { id: 'g2', type: 'goto', name: 'G2', attributes: { targetNodeId: 'c', type: 'goto' } },
    { id: 'c', type: 'sms', name: 'C', next: 'g1' },
    { id: 'g1', type: 'goto', name: 'G1', attributes: { targetNodeId: 'a', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates).map((l) => l.id).sort(), ['g1', 'g2']);
});

// The unit tests above prove the pure helper; this proves the wiring — that compile() actually
// calls gotoLoops and throws on what it finds, not just that the helper works in isolation.
test('compile() itself throws GOTO_LOOP on a cyclic IR', () => {
  const ir = {
    name: 'Cyclic', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [
      { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Start', attributes: { tags: ['s'] } },
      { ref: 'g', kind: 'goto', name: 'Back to start', target: 'a' },
    ],
  };
  assert.throws(() => compile(ir, ctx()), /GOTO_LOOP/);
});
