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
  if (t.disabled === true) f.push('disabled');
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

export function digestWorkflow({ doc, triggers = [], stickyNotes = [], include = [] } = {}) {
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
  // walk each step up to its owning branch entry
  const branchOf = (t) => {
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
