import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The bundles ship in a public repo. A build run from a worktree whose node_modules is a SYMLINK makes the
// bundler write the resolved absolute path into every module comment (1.1.0 shipped 311 such lines naming the
// build machine's folders). A relative build writes none. An absolute path that runs into node_modules or this
// repo's own tree is a bad build; an example path in a message ("/Users/you/project/…") is not.
const LOCAL = /(?:\/Users\/|\/Volumes\/|\/home\/|\/private\/tmp\/|[A-Z]:\\)[^\n"']*(?:node_modules|plugins\/uxie-ghl-factory)/;

for (const f of ['../dist/server.mjs', '../dist/audit-server.mjs']) {
  test(`${f.replace('../', '')} embeds no absolute local path`, () => {
    let src;
    try { src = readFileSync(new URL(f, import.meta.url), 'utf8'); } catch { return; } // bundle absent: nothing ships
    const hit = src.split('\n').find((l) => LOCAL.test(l));
    assert.equal(hit, undefined, `bundle contains a local path: ${hit?.slice(0, 160)}`);
  });
}

test('CONTROL: the pattern catches the 1.1.0 shape and passes relative paths and message examples', () => {
  assert.ok(LOCAL.test('// ../../../../Volumes/Some Drive/x/node_modules/ajv/dist/compile/codegen/code.js'));
  assert.ok(!LOCAL.test('// node_modules/ajv/dist/compile/codegen/code.js'));
  assert.ok(!LOCAL.test('Pass e.g. "/Users/you/project/.ghl/export.json".'));
});
