// Which stored templates modifyStep may re-run through the compiler's builders, and which it
// must leave alone. A type whose AUTHOR shape differs from its WIRE shape cannot be re-derived
// from its stored attributes: opportunity steps take lean keys and emit __customInputFields__,
// marketplace steps carry an app envelope, and email / custom_webhook / custom_code have
// construction-time keys. For those, retypeStep — a full attribute replacement through the
// compiler — is the door, and modifyStep stays a merge plus the commit-time lints.
//
// Containers are skipped for a different reason: their attributes carry branch WIRING
// (transitions, next[]), which a re-run would mint fresh ids for and detach the subtree.
import { normalizeStoredAttributes as compilerNormalize } from './compiler.mjs';

export const NORMALIZE_SKIP = new Set([
  // author shape !== wire shape
  'internal_update_opportunity', 'internal_create_opportunity', 'update_opportunity', 'create_opportunity',
  'find_opportunity', 'email', 'custom_webhook', 'custom_code', 'webhook', 'voice_ai_outbound_call',
  // branch wiring lives in the attributes
  'if_else', 'transition', 'workflow_split', 'ai_decision', 'goto', 'loop', 'workflow_goal',
]);

// `opts.novelKeys` — the attribute keys the patch INTRODUCED (absent from the stored attributes
// before the merge). When the caller supplies it, a skipped type warns ONLY for novel keys: a
// patch that overwrites keys the stored wire shape already carries (a goto's targetNodeId, an
// opportunity step's __customInputFields__) is a same-shape edit and needs no recompile. The
// unconditional warning fired on every goto / opportunity / custom_code modifyStep — 100% noise
// (backlog 6, D-85/D-89) — and a correct edit was indistinguishable from a suspect one. Without
// `opts` (a caller that does not know the patch) the warning stays unconditional.
export function normalizeStoredAttributes(template, ctx, opts) {
  if (!template?.attributes || template.isMarketplaceAction === true || NORMALIZE_SKIP.has(template.type)) {
    const novel = Array.isArray(opts?.novelKeys) ? opts.novelKeys : null;
    if (novel && !novel.length) return { attributes: template?.attributes, warnings: [] };
    const which = novel
      ? `the patch introduces key(s) [${novel.join(', ')}] the stored step did not carry, and they were merged as given`
      : 'attributes were merged as given';
    return {
      attributes: template?.attributes,
      warnings: [
        `MODIFY_NOT_NORMALISED: '${template?.name ?? template?.id}' (${template?.type}): ${which} — this type's `
        + `author shape is not its wire shape (or it carries branch wiring), so a new key cannot be normalised from `
        + `what is stored. If the key is an AUTHOR-shape key (pipeline, stage, a lean opportunity field) it will be `
        + `stored verbatim and move nothing: use retypeStep for a full recompile through the compiler, or author the `
        + `complete wire shape yourself.`,
      ],
    };
  }
  return compilerNormalize(template, ctx);
}
