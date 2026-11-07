// git calls that give the right answer whoever runs them (W10 bl-668).
//
// A git hook exports GIT_DIR and GIT_INDEX_FILE for the repository that fired it. The knowledge post-commit hook runs
// `npm run sync` in plugin/, so without this a `git status` made here reported the KNOWLEDGE repo's whole tree, and
// execFileSync's default 1 MB buffer then overflowed (ENOBUFS). The cwd names the repo; the hook variables must not
// override it, and the output may be large.
import { execFileSync } from 'node:child_process';

const HOOK_VARS = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR'];
const MAX_BUFFER = 256 * 1024 * 1024;

export function cleanGitEnv(env = process.env) {
  const out = { ...env };
  for (const k of HOOK_VARS) delete out[k];
  return out;
}

export function gitOut(argv, cwd, { env } = {}) {
  return execFileSync('git', argv, { cwd, env: cleanGitEnv(env), encoding: 'utf8', maxBuffer: MAX_BUFFER }).trim();
}
