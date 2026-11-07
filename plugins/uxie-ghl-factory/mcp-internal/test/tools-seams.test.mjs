// p2 (release-lane plan): TOOLS ends with three seams, one per lane that adds tools later (workflows W6c, funnels
// W7, courses W8). Each seam is a module that returns an array of tools, spread into TOOLS by tools.mjs.
// This file is owned by integration and is not edited by the lanes. It locks the base tool count of tools.mjs
// itself and the seams' wiring, and it lets each seam's own length change as its lane adds tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOOLS } from '../core/tools.mjs';
import { makeW6cTools } from '../core/workflow-w6c-tools.mjs';
import { makeFunnelRenderTools } from '../core/funnel-render-tools.mjs';
import { makeCourseTools } from '../core/course-tools.mjs';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'core');
// Tools defined in tools.mjs itself, outside the three seams. Adding or removing one of these changes this number.
const BASE_TOOL_COUNT = 107;
const deps = { describe: () => ({}), schema: () => ({}), guard: () => {} };
const SEAMS = [
  ['makeW6cTools', 'workflow-w6c-tools.mjs', makeW6cTools],
  ['makeFunnelRenderTools', 'funnel-render-tools.mjs', makeFunnelRenderTools],
  ['makeCourseTools', 'course-tools.mjs', makeCourseTools],
];

test('TOOLS is the 107 base tools plus whatever the three seams return', () => {
  const seamTotal = SEAMS.reduce((n, [, , make]) => n + make(deps).length, 0);
  assert.equal(TOOLS.length, BASE_TOOL_COUNT + seamTotal);
});

for (const [fn, file, make] of SEAMS) {
  test(`${fn} returns an array, and tools.mjs spreads it into TOOLS`, () => {
    assert.ok(Array.isArray(make(deps)), `${fn} must return an array`);
    const src = readFileSync(join(CORE, 'tools.mjs'), 'utf8');
    const importRe = new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\s*'\\./${file.replace(/\./g, '\\.')}'`);
    assert.match(src, importRe, `tools.mjs must import ${fn} from ./${file}`);
    assert.ok(src.includes(`...${fn}({ describe, schema, guard })`), `tools.mjs must spread ...${fn}({ describe, schema, guard }) into TOOLS`);
  });
}
