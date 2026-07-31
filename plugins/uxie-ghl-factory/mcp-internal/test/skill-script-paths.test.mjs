import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

// Every `node <path>` invocation in a skill must resolve to a real file.
// Each skill file now documents its own anchor in prose (see SKILL.md and
// conversation-ai.md), stating the path is relative to the skill's own root
// directory. This test resolves paths against that documented anchor
// (skillDir below) rather than assuming how any particular harness runs the
// command.
const CASES = [
  {
    file: "skills/ghl-workflow-specialist/SKILL.md",
    skillDir: "skills/ghl-workflow-specialist",
  },
  {
    file: "skills/ghl-ai-agents-specialist/references/conversation-ai.md",
    skillDir: "skills/ghl-ai-agents-specialist",
  },
]

test("every node script path invoked from a skill resolves to a real file", () => {
  const failures = []
  for (const { file, skillDir } of CASES) {
    const text = readFileSync(join(PLUGIN_ROOT, file), "utf8")
    for (const m of text.matchAll(/`node ([A-Za-z0-9._/-]+\.m?js)/g)) {
      const rel = m[1]
      const abs = join(PLUGIN_ROOT, skillDir, rel)
      if (!existsSync(abs)) failures.push(`${file}: 'node ${rel}' -> missing ${abs}`)
    }
  }
  assert.deepEqual(failures, [], `unresolvable script paths:\n${failures.join("\n")}`)
})
