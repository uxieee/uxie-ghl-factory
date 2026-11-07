// A COMPACT read of a live workflow — the read half of every edit.
//
// export_workflow returns the raw document, which for a real workflow is tens of kilobytes of
// wire shape: __customInputFields__ rows, frozen UI-hint arrays, transition scaffolding. An agent
// that has to read all of it to answer "what does this workflow do, and where would my change
// land?" either burns the context or skips the read — and skipping the read is how edits get
// authored against a graph the agent never actually looked at.
//
// The digest keeps what an EDIT needs: identity and version (so a write can be
// concurrency-checked), the trigger set, one line per step with its wiring and outgoing
// references, the linear chains, and a fingerprint that changes when anything structural does.
import { createHash } from 'node:crypto';
import { stepRefsOf } from './graph-refs.mjs';
import { branchTargets } from './edit.mjs';
import { stripNullNext } from './terminals.mjs';

const MERGE_TAG = /\{\{\s*[A-Za-z_][\w.-]*\s*\}\}/g;

// Every merge tag anywhere in a step's attributes, deduped and in document order.
function mergeTagsOf(attrs) {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { for (const m of v.match(MERGE_TAG) ?? []) found.add(m.replace(/\s+/g, '')); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(attrs);
  return [...found];
}

// The one or two strings a human recognises the step by — an SMS body, an email subject, a tag.
function textOf(t) {
  const a = t?.attributes ?? {};
  const pick = a.body ?? a.subject ?? a.message ?? a.html ?? null;
  if (typeof pick === 'string' && pick.trim()) return pick.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (Array.isArray(a.tags) && a.tags.length) return `tags: ${a.tags.slice(0, 6).join(', ')}`;
  return undefined;
}

function flagsOf(t) {
  const f = [];
  if (t.next === null || t.next === undefined) f.push('terminal');
  // GHL stores a disabled step as advanceCanvasMeta.isDisabled; `disabled` is only the IR's spelling.
  if (t.advanceCanvasMeta?.isDisabled === true || t.disabled === true) f.push('disabled');
  if (t.isMarketplaceAction === true) f.push('marketplace');
  if (Array.isArray(t.next)) f.push('container');
  return f;
}

export function fingerprintWorkflow(templates, triggers) {
  const steps = stripNullNext(templates ?? []).map((t) => ({
    id: t.id, type: t.type, next: t.next, parentKey: t.parentKey ?? null, attributes: t.attributes,
  }));
  const trg = (triggers ?? []).map((t) => ({
    id: t.id ?? t._id, type: t.type,
    conditions: (t.conditions ?? []).map((c) => [c.field, c.operator, c.value]),
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash('sha256').update(JSON.stringify({ steps, trg })).digest('hex').slice(0, 16);
}

// The WHOLE step list, every key, in a stable key order. For a write that sends the whole document (repair_workflow):
// a rename or a builder disable since the preview is a change that PUT would revert, so it must move the token too.
const stableJson = (v) => (Array.isArray(v) ? `[${v.map(stableJson).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
    : JSON.stringify(v) ?? 'null');
export function fingerprintDocument(templates) {
  return createHash('sha256').update(stableJson(stripNullNext(templates ?? []))).digest('hex').slice(0, 16);
}

export function digestWorkflow({ doc, triggers = [], stickyNotes = [], include = [], now = Date.now() } = {}) {
  const templates = (doc?.workflowData?.templates ?? doc?.templates ?? []).filter(Boolean);
  const byId = new Map(templates.map((t) => [t.id, t]));

  // A branch ENTRY is any step a container points at; name each one so a step can say which
  // branch it lives on without the reader reconstructing the tree.
  const branchNameById = new Map();
  for (const t of templates) {
    if (!Array.isArray(t.next)) continue;
    for (const target of branchTargets(t, templates) ?? []) {
      branchNameById.set(target.id, `${t.name ?? t.id}/${target.name ?? target.id}`);
    }
  }
  // The branch a step is on is the chain it is REACHED on — `next` from a branch entry — because that is what the
  // runtime follows. A `parent` left stale by a re-parenting write named the old branch (bl-425); the walk up
  // parent/parentKey is only the fallback for a step no chain reaches.
  const chainBranch = new Map();
  for (const [entryId, label] of branchNameById) {
    let cursor = byId.get(entryId), hops = 0;
    while (cursor && hops++ < 500) {
      if (!chainBranch.has(cursor.id)) chainBranch.set(cursor.id, label);
      cursor = typeof cursor.next === 'string' ? byId.get(cursor.next) : null;
    }
  }
  const branchOf = (t) => {
    if (chainBranch.has(t.id)) return chainBranch.get(t.id);
    let cursor = t, hops = 0;
    while (cursor && hops++ < 200) {
      if (branchNameById.has(cursor.id)) return branchNameById.get(cursor.id);
      const parent = cursor.parent ?? cursor.parentKey;
      cursor = typeof parent === 'string' ? byId.get(parent) : null;
    }
    return undefined;
  };

  const steps = templates.map((t) => {
    const refs = {};
    for (const { path, id } of stepRefsOf(t)) refs[path] = id;
    const tags = mergeTagsOf(t.attributes);
    const text = textOf(t);
    const branch = branchOf(t);
    return {
      id: t.id,
      name: t.name ?? null,
      type: t.type,
      order: t.order ?? null,
      parentKey: t.parentKey ?? null,
      ...(branch ? { branch } : {}),
      next: t.next ?? null,
      ...(Object.keys(refs).length ? { refs } : {}),
      ...(tags.length ? { mergeTags: tags } : {}),
      ...(text ? { text } : {}),
      flags: flagsOf(t),
    };
  });

  // Linear chains: from the root and from each branch entry, follow `next` while it is a string.
  const chains = [];
  const chainFrom = (label, startId) => {
    const path = [];
    let cursor = byId.get(startId), hops = 0;
    while (cursor && hops++ < 500) {
      path.push(cursor.id);
      cursor = typeof cursor.next === 'string' ? byId.get(cursor.next) : null;
    }
    if (path.length) chains.push({ from: label, path });
  };
  const root = templates.find((t) => (t.parentKey === null || t.parentKey === undefined) && t.parent == null);
  if (root) chainFrom('ROOT', root.id);
  for (const [id, label] of branchNameById) chainFrom(label, id);

  return {
    workflowId: doc?.id ?? doc?._id ?? null,
    name: doc?.name ?? null,
    status: doc?.status ?? null,
    // A scheduled pause un-publishes a workflow at its start and re-publishes it at its end, and
    // while it runs the document carries `paused: "workflow-scheduled-pause"` and the pause config's
    // _id in `pauseUpdatedById` (live 2026-09-23). Without this, a digest shows a bare `draft` —
    // indistinguishable from an unfinished workflow — and an agent that "finishes" it by publishing
    // ends somebody's maintenance window early. Only present while a pause holds the workflow.
    ...(doc?.paused ? { pausedBy: {
      by: doc.paused,
      pauseConfigId: doc.pauseUpdatedById ?? null,
      note: 'DRAFT BECAUSE A SCHEDULED PAUSE IS RUNNING, not because it is unfinished. The pause re-publishes it when its window ends; publishing it now ends the pause early.',
    } } : {}),
    // `getWorkflow` asks for includeScheduledPauseInfo, which adds `scheduledPauseDates` — EVERY pause
    // window naming this workflow, past ones included, with no ids and no ran-state. Only windows that
    // have not ended bear on an edit or a publish, so only those are shown: each one is a span during
    // which this workflow will be un-published and take no new contacts.
    ...(() => {
      const ahead = (doc?.scheduledPauseDates ?? [])
        .filter((w) => Number.isFinite(Date.parse(w?.pauseEndTime)) && Date.parse(w.pauseEndTime) > now)
        .map((w) => ({ start: w.pauseStartTime ?? null, end: w.pauseEndTime }));
      return ahead.length ? { scheduledPauses: ahead } : {};
    })(),
    version: doc?.version ?? null,
    updatedAt: doc?.dateUpdated ?? doc?.updatedAt ?? null,
    fingerprint: fingerprintWorkflow(templates, triggers),
    settings: {
      allowMultiple: doc?.allowMultiple ?? null,
      timezone: doc?.timezone ?? null,
      window: doc?.window ?? null,
      stopOnResponse: doc?.stopOnResponse ?? null,
    },
    triggers: (triggers ?? []).map((t) => ({
      id: t.id ?? t._id ?? null,
      type: t.type,
      name: t.name ?? null,
      active: t.active ?? null,
      conditions: (t.conditions ?? []).map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
    })),
    stepCount: steps.length,
    steps,
    chains,
    ...(stickyNotes?.length ? { stickyNotes: stickyNotes.map((n) => ({ id: n.id ?? n._id, text: n.text ?? n.note ?? null })) } : {}),
    ...(include.includes('raw') ? { raw: doc } : {}),
  };
}
