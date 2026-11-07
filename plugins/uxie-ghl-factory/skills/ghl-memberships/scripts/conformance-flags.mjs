// The flags of conformance.mjs, parsed in one place so the rule "what each flag may do" is tested (conformance-flags.test.mjs).
//   --keep           leave the created objects in place (no teardown)
//   --allow-sends    the send-class calls: a membership grant and revoke that e-mail, a certificate issue. Gate G4.
//                    It publishes NOTHING.
//   --allow-publish  publish the test offer. Gate G6. Never implied by --allow-sends.
export function parseConformanceFlags(argv) {
  return {
    keep: argv.includes('--keep'),
    sends: argv.includes('--allow-sends'),
    publish: argv.includes('--allow-publish'),
  };
}
