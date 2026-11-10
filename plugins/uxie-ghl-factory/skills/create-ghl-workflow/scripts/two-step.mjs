// bl-1021 (2026-11-10, w9-wf2): the live conformance suite's one way to drive an outward write through its two-step gate.
// 1) preview: the call with NO confirm, which the gate answers with CONFIRM_REQUIRED, the preview and a confirmationToken (or, for the
//    edit path, a previewToken). Nothing is sent.
// 2) wait: a publish token is valid only from 20 s after its preview (core/publish-confirmation.mjs PUBLISH_MIN_AGE_MS), so the
//    suite waits TWO_STEP_WAIT_MS before it confirms.
// 3) confirm: the same call with confirm:true and the token presented exactly once.
// A tool that returns no token after the preview is not confirmed again. Tests inject `call` and `sleep`; live runs use the defaults.

export const TWO_STEP_WAIT_MS = 21_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function twoStep(call, name, args, { sleep = defaultSleep, waitMs = TWO_STEP_WAIT_MS } = {}) {
  const { confirm, confirmationToken, previewToken, ...rest } = args ?? {};
  const preview = await call(name, rest);
  const token = preview?.data?.confirmationToken;
  if (preview?.code === 'CONFIRM_REQUIRED' && typeof token === 'string') {
    await sleep(waitMs);
    // A tool that also gates on its roster previewToken (fast_forward_contacts) needs both on the confirm.
    const roster = preview?.data?.preview?.previewToken;
    const final = await call(name, { ...rest, confirm: true, confirmationToken: token, ...(roster !== undefined ? { previewToken: roster } : {}) });
    return { preview, final, waited: waitMs };
  }
  // The edit preview nests its token under data.preview (core/tools.mjs sets previewToken on the preview object).
  const edit = preview?.data?.preview?.previewToken ?? preview?.data?.previewToken;
  if (preview?.code === 'CONFIRM_REQUIRED' && edit !== undefined) {
    // A confirm that carries only the roster previewToken may answer CONFIRM_REQUIRED with a confirmationToken (fast_forward_contacts).
    // Then wait the two-step minimum and confirm with BOTH tokens. A confirm that succeeds, or refuses with no token, is final.
    const first = await call(name, { ...rest, confirm: true, previewToken: edit });
    const issued = first?.data?.confirmationToken;
    if (first?.code === 'CONFIRM_REQUIRED' && typeof issued === 'string') {
      await sleep(waitMs);
      const final = await call(name, { ...rest, confirm: true, confirmationToken: issued, previewToken: edit });
      return { preview, first, final, waited: waitMs };
    }
    return { preview, final: first, waited: 0 };
  }
  return { preview, final: preview, waited: 0 };
}

// The one-result form the suite's write legs use: the gate's final result (the preview is discarded).
export async function confirmedCall(call, name, args, opts) {
  return (await twoStep(call, name, args, opts)).final;
}
