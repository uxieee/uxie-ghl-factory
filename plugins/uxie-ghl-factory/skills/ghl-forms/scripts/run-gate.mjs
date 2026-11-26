// ONE argv parser shared by the gate and both d18 entry scripts (orchestrator 2026-11-22, after the --dry incident). The gate is copied from the
// ai-reads gate at plugin 03956a53. `startup()` runs FIRST in an entry script, before any auth, token read or tool import:
//   - an unknown flag is refused (exit 2);
//   - --smoke / --dry return {smoke:true} and the caller exits without any account call;
//   - otherwise the runner S (D18_RUNNER_S, 40-hex), QA_CLEARED equal to it and a --go=<ISO> that has passed are all required (exit 2).
// This module imports nothing from mcp-internal.
const KNOWN = [/^--smoke$/, /^--dry$/, /^--go=.+$/];
export const parseArgv = (argv) => {
  const unknown = argv.filter((a) => !KNOWN.some((re) => re.test(a)));
  return { unknown, smoke: argv.includes('--smoke') || argv.includes('--dry'), go: (argv.find((a) => a.startsWith('--go=')) ?? '').slice(5) };
};
export const gateProblems = (env, argv, now = Date.now()) => {
  const p = []; const S = env.D18_RUNNER_S ?? ''; const { go } = parseArgv(argv);
  if (!/^[0-9a-f]{40}$/.test(S)) p.push('D18_RUNNER_S (the runner S, 40-hex) is missing');
  if (!S || env.QA_CLEARED !== S) p.push('QA_CLEARED does not equal the runner S');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(go) || !(Date.parse(go) < now)) p.push('--go=<ISO> is missing or has not passed');
  return p;
};
export const startup = (env = process.env, argv = process.argv.slice(2)) => {
  const a = parseArgv(argv);
  if (a.unknown.length) { console.error(`REFUSED, nothing was run: unknown argument(s) ${a.unknown.join(' ')}`); process.exit(2); }
  if (a.smoke) return { smoke: true };
  const g = gateProblems(env, argv);
  if (g.length) { console.error(`REFUSED, nothing was run: ${g.join('; ')}`); process.exit(2); }
  return { smoke: false };
};
