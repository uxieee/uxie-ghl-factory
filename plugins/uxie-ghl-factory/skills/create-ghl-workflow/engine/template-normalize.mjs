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

export function normalizeStoredAttributes(template, ctx) {
  if (!template?.attributes || template.isMarketplaceAction === true || NORMALIZE_SKIP.has(template.type)) {
    return {
      attributes: template?.attributes,
      warnings: [
        `MODIFY_NOT_NORMALISED: '${template?.name ?? template?.id}' (${template?.type}): attributes were `
        + `merged as given — this type's author shape is not its wire shape (or it carries branch wiring), `
        + `so it cannot be re-normalised from what is stored. Use retypeStep for a full recompile through `
        + `the compiler, or author the complete wire shape yourself.`,
      ],
    };
  }
  return compilerNormalize(template, ctx);
}
