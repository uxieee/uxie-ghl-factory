// The whole-document advisory pass. The build path runs about ten lint layers and the edit path
// runs a touched-scoped subset, but check_workflow ran exactly ONE (the marketplace action schema)
// — so recon on a live account found nothing that only the build path checks. A client shipped a
// literal {{appointment.date}} for three weeks under a clean check_workflow (RC-F).
//
// Read-side contract: FINDINGS, never throws, never blocks. A pack that cannot run lands in
// notEvaluable with a reason rather than silently reporting clean, because "no findings" and
// "could not look" are the two answers a reader must never confuse.
import { evaluateWorkflowRules } from '../graph-rules.mjs';
import { checkGraphContextRules } from '../graph-context-rules.mjs';
import { gotoLoops } from '../goto-loops.mjs';
import { danglingStepRefs } from '../graph-refs.mjs';
import { danglingParentKeys } from '../edit.mjs';
import { evaluateMergeTags } from '../merge-tags.mjs';
import { evaluateIfElseVocab } from '../ifelse-vocab.mjs';
import { lintContactFieldTemplates } from '../contact-field-shapes.mjs';
import { lintOpportunityWrites } from './opportunity.mjs';
import { lintTriggerRows } from './trigger-rows.mjs';
import { lintEntryStep } from './entry-step.mjs';
import { lintPublishRules } from './publish-rules.mjs';
import { HYGIENE_RULES } from './hygiene.mjs';
import { runDoctrine } from './doctrine.mjs';

export function runLints(doc, {
  packs = ['platform', 'hygiene'],
  catalog = null,
  customFields,
  customValues,
  doctrinePack = null,
} = {}) {
  const out = { platform: [], hygiene: [], doctrine: [], notEvaluable: [] };
  const T = Array.isArray(doc?.templates) ? doc.templates.filter(Boolean) : [];
  const triggers = Array.isArray(doc?.triggers) ? doc.triggers.filter(Boolean) : [];
  const F = (pack, rule, severity, msg, ids = {}) => out[pack].push({ pack, rule, severity, msg, ...ids });

  if (packs.includes('platform')) {
    try {
      if (catalog?.workflowRules) {
        // evaluateWorkflowRules returns THREE lists: findings (GHL blocks the save), advisories
        // (GHL's own result:'warning'), and notEvaluable (rules needing builder state we cannot
        // have). Dropping the last two is how a read reports clean on a document GHL would object to.
        const wr = evaluateWorkflowRules(
          { templates: T, triggers, settings: doc?.settings ?? {}, publishing: false },
          catalog.workflowRules,
        );
        for (const f of wr.findings ?? []) F('platform', f.rule ?? 'workflow-rule', 'error', f.message ?? String(f));
        for (const a of wr.advisories ?? []) F('platform', a.rule ?? 'workflow-rule', 'warning', a.message ?? String(a));
        for (const r of wr.notEvaluable ?? []) out.notEvaluable.push(`workflowRules:${r.rule ?? r}`);
      } else {
        out.notEvaluable.push('workflowRules (no catalog supplied)');
      }

      checkGraphContextRules(T, { warn: (m) => F('platform', 'graph-context', 'warning', m) });

      for (const l of gotoLoops(T)) {
        F('platform', 'goto-loop', 'error',
          `goto '${l.name ?? l.id}' closes a cycle to '${l.targetName ?? l.target}' — GHL demotes the workflow to draft`,
          { stepId: l.id });
      }
      for (const d of danglingStepRefs(T)) {
        F('platform', 'dangling-ref', 'error',
          `'${d.name ?? d.id}' (${d.type}) ${d.path} → '${d.missing}' does not exist — the builder shows a broken link and "0 Errors"`,
          { stepId: d.id });
      }
      for (const d of danglingParentKeys(T)) {
        F('platform', 'dangling-parentkey', 'warning',
          `'${d.name ?? d.id}' parentKey → '${d.parentKey}' is missing (builder hygiene; the runtime walks next)`,
          { stepId: d.id });
      }
      if (catalog?.mergeTags) {
        for (const f of evaluateMergeTags(T, catalog.mergeTags, { customFields, customValues })) {
          F('platform', 'merge-tag', f.severity, `${f.where}: ${f.msg}`);
        }
      } else {
        out.notEvaluable.push('mergeTags (no catalog supplied)');
      }
      if (catalog?.ifElseConditions) {
        for (const f of evaluateIfElseVocab(T, catalog.ifElseConditions, { customFields })) {
          F('platform', 'ifelse-vocab', 'warning', `${f.where}${f.branch ? ` [${f.branch}]` : ''}: ${f.msg}`);
        }
      }
      lintContactFieldTemplates(T, T.map((t) => t.id), { warn: (m) => F('platform', 'contact-field-shape', 'warning', m) });
      for (const f of lintEntryStep(T)) F('platform', f.code, f.severity, f.msg, f.stepId ? { stepId: f.stepId } : {});
      // The publish validator's STRUCTURAL rules. Publish is the only validator that matters:
      // 21 workflows passed check_workflow with 0 errors and the PUT refused three of them.
      for (const f of lintPublishRules(T)) F('platform', f.code, f.severity, f.msg, { stepId: f.stepId });
      for (const f of lintOpportunityWrites(T)) F('platform', f.code, f.severity, f.msg, { stepId: f.stepId });
      for (const f of lintTriggerRows(triggers, catalog)) F('platform', f.code, f.severity, f.msg, { triggerId: f.triggerId });
    } catch (e) {
      out.notEvaluable.push(`platform crashed: ${e.message}`);
    }
  }

  if (packs.includes('hygiene')) {
    for (const r of HYGIENE_RULES) {
      try {
        for (const hit of r.run({ templates: T, triggers }) ?? []) {
          F('hygiene', r.rule, r.severity, hit.msg, hit.stepId ? { stepId: hit.stepId, name: hit.name } : {});
        }
      } catch (e) {
        out.notEvaluable.push(`hygiene:${r.rule} crashed: ${e.message}`);
      }
    }
  }

  if (packs.includes('doctrine')) {
    if (!doctrinePack) out.notEvaluable.push('doctrine (no pack supplied)');
    else {
      try {
        out.doctrine.push(...runDoctrine({ templates: T, triggers }, doctrinePack));
      } catch (e) {
        out.notEvaluable.push(`doctrine crashed: ${e.message}`);
      }
    }
  }
  return out;
}
