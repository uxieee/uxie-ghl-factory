// IF/ELSE condition vocabulary check — the engine is the ONLY guard here.
//
// `if_else` is proven-zero: GHL ships no step validator for it (the single structural check,
// validateIfElseCondition, runs for workflow_ai-authored workflows only). A condition with a
// misspelled subtype or an operator the picker would never offer compiles clean, saves clean,
// renders clean — and MATCHES WRONGLY at runtime, silently. That is the worst class of defect
// this project exists to kill, and until 2026-08-22 the engine had no vocabulary to check against.
//
// Vocabulary (catalog.ifElseConditions, extracted from utils/ifelse_conditions.ts +
// utils/conditions.ts, corpus-replayed over 544 stored conditions):
//   groups[]            conditionType → conditions[] (conditionSubType, operatorType, valueType,
//                       children[] for nested sub-categories). A group with NO static leaves is
//                       RUNTIME-populated (trigger/step outputs, custom values) → unknowable here.
//   operatorTable       operatorType → legal operator values
//   fieldTypeMap        CustomFieldDataType → operatorType (custom-field leaves)
//   dateFieldOperators  legal conditionValueOperator values for date leaves
//   dynamicLeafGroups   groups whose PUBLISHED corpus carries custom-field-id subtypes
//                       (contact_detail, opportunities) — an unknown subtype there is a custom
//                       field, and when ctx.customFields is available its dataType decides the
//                       legal operators; otherwise it is unknowable, never wrong
//   legacyOperators     operators stored on PUBLISHED workflows that the table omits ('is' on
//                       select leaves) — accepted, as data
//
// Severity: REFUSE (IRError 'IFELSE_VOCAB') — the corpus veto says the static sets are exact.
// Hatch: ctx.skipIfElseVocab = true.
import { IRError } from './ir.mjs';

const NO_VALUE_DATE_OPS = new Set(['today', 'yesterday', 'tomorrow']);
const ABSOLUTE_DATE_OPS = new Set(['on', 'between', 'afterDate', 'beforeDate']);

export function evaluateIfElseVocab(templates, vocab, ctx) {
  if (!vocab?.groups) return [];
  const groups = new Map(vocab.groups.map((g) => [g.value, g]));
  const leafOf = (g, sub) => { for (const c of g.conditions ?? []) { if (c.value === sub) return c; for (const ch of c.children ?? []) if (ch.value === sub) return ch; } return null; };
  const opsFor = (operatorType) => { const base = (vocab.operatorTable?.[operatorType] ?? []).map((o) => o?.value).filter((x) => typeof x === 'string'); return new Set([...base, ...(vocab.legacyOperators?.[operatorType] ?? [])]); };
  const dynamicLeafGroups = new Set(vocab.dynamicLeafGroups ?? []);
  const customFieldById = new Map();
  for (const f of (ctx?.customFields ?? [])) { const id = f?.id ?? f?._id; if (id) customFieldById.set(id, f); }
  const F = [];
  for (const t of templates ?? []) {
    if (t?.type !== 'if_else' || t.nodeType !== 'condition-node') continue;
    const where = `if/else '${t.name ?? t.id}'`;
    for (const b of (t.attributes?.branches ?? [])) for (const s of (b?.segments ?? [])) for (const c of (s?.conditions ?? [])) {
      if (!c || typeof c !== 'object') continue;
      const g = groups.get(c.conditionType);
      if (!g) { F.push({ where, branch: b.name, msg: `conditionType '${c.conditionType}' is not one GHL's picker offers (${[...groups.keys()].slice(0, 6).join(', ')}, …)` }); continue; }
      if (!(g.conditions?.length)) continue;                       // runtime-populated group: unknowable here
      let leaf = leafOf(g, c.conditionSubType);
      let operatorType = leaf?.operatorType ?? null;
      if (!leaf) {
        if (dynamicLeafGroups.has(g.value)) {
          // contact_detail / opportunities: a non-static subtype is a CUSTOM FIELD id. Judged only
          // when the account's field list is in the compile ctx (orchestrate passes it): then it
          // must match a field and the field's dataType decides the operator set. Without the
          // list it is unknowable — never wrong, never shape-guessed (fake ids in fixtures,
          // key-vs-id variants, and real typos all look alike offline).
          const cf = customFieldById.get(c.conditionSubType);
          if (cf) { const dt = cf.dataType ?? cf.data_type ?? cf.type; if (dt && vocab.fieldTypeMap?.[dt]) operatorType = vocab.fieldTypeMap[dt]; else continue; }
          else if (customFieldById.size) { F.push({ where, branch: b.name, msg: `conditionSubType '${c.conditionSubType}' (${g.value}) is not a picker field and matches no custom field on this account` }); continue; }
          else continue;
        } else { F.push({ where, branch: b.name, msg: `conditionSubType '${c.conditionSubType}' is not a field of '${g.value}' (${(g.conditions ?? []).slice(0, 6).map((x) => x.value).join(', ')}, …)` }); continue; }
      }
      if (operatorType) {
        const legal = opsFor(operatorType);
        if (legal.size && !legal.has(c.conditionOperator)) { F.push({ where, branch: b.name, msg: `operator '${c.conditionOperator}' is not legal for '${c.conditionSubType}' (${operatorType}: ${[...legal].join(', ')})` }); continue; }
        if (operatorType === 'date' && c.conditionValueOperator != null) {
          const vo = c.conditionValueOperator;
          if (!(vocab.dateFieldOperators ?? []).includes(vo)) F.push({ where, branch: b.name, msg: `date sub-operator '${vo}' is not one of ${(vocab.dateFieldOperators ?? []).join(', ')}` });
          else if (!NO_VALUE_DATE_OPS.has(vo) && !ABSOLUTE_DATE_OPS.has(vo) && !c.conditionValueUnit) F.push({ where, branch: b.name, msg: `date sub-operator '${vo}' requires conditionValueUnit (days|weeks|months|years)` });
        }
      }
    }
  }
  return F;
}

/** Compile chokepoint: refuse if/else conditions the picker could never produce. */
export function checkIfElseVocab(templates, catalog, ctx) {
  if (ctx?.skipIfElseVocab === true) return [];
  const F = evaluateIfElseVocab(templates, catalog?.ifElseConditions, ctx);
  if (!F.length) return [];
  const lines = F.map((f) => `  - ${f.where}${f.branch ? ` / branch '${f.branch}'` : ''}: ${f.msg}`);
  throw new IRError('IFELSE_VOCAB',
    `IFELSE_VOCAB: ${F.length} if/else condition(s) the GHL picker could never produce — GHL has NO validator for if/else, so this would save clean and MATCH WRONGLY at runtime:\n${lines.join('\n')}\n` +
    `Fix the condition (see catalog.ifElseConditions), or pass skipIfElseVocab: true if you are certain.`);
}
