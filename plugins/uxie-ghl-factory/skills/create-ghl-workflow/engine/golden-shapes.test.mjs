import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog() });
const fx = (n) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${n}.json`, import.meta.url)), 'utf8'));

// Strip generated/scaffold keys the spec says will differ per compile.
const normCond = ({ __conditionId, nestedDropdownTypes, allowIsOperatorTypes, ...rest }) => rest;

test('golden: tag-gate if_else compiles to the live known-good condition', () => {
  const ir = { triggers: [{ type: 'contact_tag', name: 'T', filters: [] }], graph: [{
    kind: 'if_else', type: 'if_else', name: 'Deposit paid?',
    branches: [
      { ref: 'paid', name: 'Paid', conditions: [{ conditionType: 'contact_detail', tag: 'deposit:paid-course' }], then: [] },
      { ref: 'no', name: 'No', else: true, then: [] },
    ],
  }] };
  const t = compile(ir, ctx()).autoSaveBody.workflowData.templates;
  const container = t.find((s) => s.type === 'if_else' && s.nodeType === 'condition-node');
  const cond = container.attributes.branches[0].segments[0].conditions[0];
  assert.deepEqual(normCond(cond), fx('known-good-tag-gate'));
});
