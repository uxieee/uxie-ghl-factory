// ONE entry gate for every live-capable d18/STEP 2 script (orchestrator, 2026-11-22). Pure; imports nothing, so it can run before any auth or tool import.
//   refusal(env, argv, { flags, prefixes, now }) -> { code, message } | null
//     unknown flag/positional            -> exit 2 (a typo must never fall through to a live run)
//     --smoke / --dry                    -> exit 0 with no account call
//     otherwise needs D18_RUNNER_S (40-hex), QA_CLEARED equal to it, and a --go=<ISO> second that has passed -> else exit 2
export const BASE_FLAGS = ['--smoke', '--dry'];
export const refusal = (env, argv, { flags = [], prefixes = ['--go='], now = Date.now() } = {}) => {
  const known = [...BASE_FLAGS, ...flags];
  const bad = argv.filter((a) => !known.includes(a) && !prefixes.some((p) => a.startsWith(p)));
  if (bad.length) return { code: 2, message: `REFUSED, nothing was run: unknown argument(s): ${bad.map((a) => a.split('=')[0].slice(0, 20)).join(' ')}` };
  if (argv.includes('--smoke') || argv.includes('--dry')) return { code: 0, message: 'smoke: nothing was run, no account call was made' };
  const S = env.D18_RUNNER_S ?? ''; const go = (argv.find((a) => a.startsWith('--go=')) ?? '').slice(5); const p = [];
  if (!/^[0-9a-f]{40}$/.test(S)) p.push('D18_RUNNER_S (the runner S, 40-hex) is missing');
  if (!S || env.QA_CLEARED !== S) p.push('QA_CLEARED does not equal the runner S');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(go) || !(Date.parse(go) < now)) p.push('--go=<ISO> is missing or has not passed');
  return p.length ? { code: 2, message: `REFUSED, nothing was run: ${p.join('; ')}` } : null;
};
export const enforce = (env, argv, opts) => { const r = refusal(env, argv, opts); if (!r) return; (r.code === 0 ? console.log : console.error)(r.message); process.exit(r.code); };
