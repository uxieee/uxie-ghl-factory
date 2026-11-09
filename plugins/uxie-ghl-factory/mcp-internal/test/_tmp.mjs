// Test helper: a temp dir that is removed when the test process exits, so a test run leaves nothing
// behind in $TMPDIR (bl-997). Use instead of mkdtempSync(join(tmpdir(), ...)) in any test.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made = new Set();
process.on('exit', () => {
  for (const d of made) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* already gone */ }
  }
});

export function tempDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.add(d);
  return d;
}
