// GATE for every live-capable d18 entry point (orchestrator DECISIONS 2026-11-22): a script that can write to an account refuses unless the runner S (D18_RUNNER_S, 40-hex),
// QA's clearance (QA_CLEARED equal to it) and a GO second that has already passed (--go=<ISO>) are all present. Only --smoke and --dry run without them, and they make no account call.
// Same gate as the ai-reads entry point (03956a53), shared so the two workflows entry points cannot drift from it.
export const gateProblems = (env, argv, now = Date.now()) => {
  const p = []; const S = env.D18_RUNNER_S ?? ''; const go = (argv.find((a) => a.startsWith('--go=')) ?? '').slice(5);
  if (!/^[0-9a-f]{40}$/.test(S)) p.push('D18_RUNNER_S (the runner S, 40-hex) is missing');
  if (!S || env.QA_CLEARED !== S) p.push('QA_CLEARED does not equal the runner S');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(go) || !(Date.parse(go) < now)) p.push('--go=<ISO> is missing or has not passed');
  return p;
};
// ONE argv parser per entry, shared by the gate and the script (orchestrator 2026-11-22: forms went live because a gate skipped on --dry while the script did not exit on it).
// `allowed` lists the flags the entry takes ('--smoke', '--dry', '--go=', '--no-contact'...). An unknown flag is an error, and a smoke/dry is decided here, once.
export function parseArgv(argv, allowed = []) {
  const known = new Set(['--smoke', '--dry', ...allowed]);
  const unknown = argv.filter((a) => !(known.has(a) || (known.has('--go=') && a.startsWith('--go=')) || [...known].some((k) => k.endsWith('=') && a.startsWith(k))));
  return { argv, unknown, smoke: argv.includes('--smoke') || argv.includes('--dry'), has: (f) => argv.includes(f) };
}
// Call this FIRST in an entry point, before any gateway, token or tool import is touched. exit(0) after a smoke/dry, exit(2) on a refusal or an unknown flag.
export function gateOrExit({ what, allowed = ['--go='], env = process.env, argv = process.argv.slice(2), exit = process.exit, out = console }) {
  const a = parseArgv(argv, allowed);
  if (a.unknown.length) { out.error(`REFUSED, nothing was run: unknown flag(s) ${a.unknown.join(' ')}`); exit(2); return null; }
  if (a.smoke) { out.log(`smoke: ${what}; no account call was made`); exit(0); return null; }
  const g = gateProblems(env, argv);
  if (g.length) { out.error(`REFUSED, nothing was run: ${g.join('; ')}`); exit(2); return null; }
  return a;
}
