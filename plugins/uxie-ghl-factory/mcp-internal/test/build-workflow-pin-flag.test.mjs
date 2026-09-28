// bl-261: build_workflow must not force pinWebhookSample to false. With zod default(false) plus
// `args.pinWebhookSample === true`, orchestrate's `opts.pinWebhookSample ?? ir.pinWebhookSample` never
// reached the documented IR-level flag (live 2026-09-28: spec.pinWebhookSample:true pinned nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'build_workflow');

test('an absent pinWebhookSample stays absent after schema parsing (no default(false))', () => {
  const parsed = tool().inputSchema.parse({ locationId: 'L', spec: { name: 'x' } });
  assert.equal(parsed.pinWebhookSample, undefined);
});

test('an explicit tool-level false is still honoured', () => {
  assert.equal(tool().inputSchema.parse({ locationId: 'L', spec: {}, pinWebhookSample: false }).pinWebhookSample, false);
});

test('the handler forwards undefined, not a coerced false, so the IR flag can apply', () => {
  const src = readFileSync(new URL('../core/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /pinWebhookSample: args\.pinWebhookSample === true/);
  assert.match(src, /pinWebhookSample: typeof args\.pinWebhookSample === 'boolean' \? args\.pinWebhookSample : undefined/);
});
