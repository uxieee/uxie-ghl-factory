// build_funnel_page edit mode: change an EXISTING page's content in place instead of replacing it.
//
// The page data is FLAT: section.elements[] holds every node of the section (rows, columns, leaves)
// and child[] holds node ids. Two stylesheets matter (see funnel-pages.mjs): the builder recompiles
// the canvas from node `styles`, the public renderer serves `section.general.sectionStyles` keyed by
// node id. So a styles edit here updates BOTH: the node's `styles` and a rule appended to its
// section's compiled stylesheet — otherwise the canvas changes and the public page does not.
//
// Pure: takes the page data read from GET /funnels/builder/page/data, returns the next page data and
// a per-op report. The caller writes it with the ordinary autosave envelope and reads it back.

export function findNode(pageData, nodeId) {
  for (const [si, s] of (pageData.sections ?? []).entries()) {
    if (s.id === nodeId) return { section: s, sectionIndex: si, node: s.metaData ?? s, isSection: true };
    const n = (s.elements ?? []).find((e) => e.id === nodeId);
    if (n) return { section: s, sectionIndex: si, node: n, isSection: false };
  }
  return null;
}

const mergeInto = (node, key, patch) => {
  node[key] = { ...(node[key] ?? {}), ...patch };
  // The builder also reads a canonical copy from node.element (see withElement); keep them equal.
  if (node.element && typeof node.element === 'object') node.element[key] = { ...(node.element[key] ?? {}), ...patch };
};

/**
 * ops:
 *  { op: 'set', nodeId, extra?: {...}, styles?: {...} }   merge into an existing node
 *  { op: 'append-section', section }                       section: a node tree from makeSection()
 *  { op: 'remove-node', nodeId }                           a leaf (and its id in its parent's child[]) or a whole section
 * `compileStyles(nodeId, meta, styles)` returns a CSS rule string for the public stylesheet (or '').
 */
export function applyPageEdits(pageData, ops, { compileStyles = () => '' } = {}) {
  const next = structuredClone(pageData);
  const report = [];
  for (const [i, o] of ops.entries()) {
    if (o.op === 'set') {
      const hit = findNode(next, o.nodeId);
      if (!hit) { report.push({ i, op: 'set', nodeId: o.nodeId, error: 'no node with this id on the page' }); continue; }
      if (hit.isSection) { report.push({ i, op: 'set', nodeId: o.nodeId, error: 'set targets leaves, rows and columns; edit a section by replacing it' }); continue; }
      const changed = [];
      if (o.extra && Object.keys(o.extra).length) { mergeInto(hit.node, 'extra', o.extra); changed.push(...Object.keys(o.extra).map((k) => `extra.${k}`)); }
      if (o.styles && Object.keys(o.styles).length) {
        mergeInto(hit.node, 'styles', o.styles); changed.push(...Object.keys(o.styles).map((k) => `styles.${k}`));
        const rule = compileStyles(hit.node.id, hit.node.meta, hit.node.styles);
        if (rule) {
          hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: `${hit.section.general?.sectionStyles ?? ''}${rule}` };
          changed.push('section.general.sectionStyles');
        }
      }
      hit.node.updated = true;
      report.push({ i, op: 'set', nodeId: o.nodeId, meta: hit.node.meta, changed });
    } else if (o.op === 'append-section') {
      next.sections = [...(next.sections ?? []), { ...o.section, sequence: (next.sections ?? []).length }];
      report.push({ i, op: 'append-section', sectionId: o.section.id, nodes: (o.section.elements ?? []).length });
    } else if (o.op === 'remove-node') {
      const hit = findNode(next, o.nodeId);
      if (!hit) { report.push({ i, op: 'remove-node', nodeId: o.nodeId, error: 'no node with this id on the page' }); continue; }
      if (hit.isSection) {
        next.sections = next.sections.filter((s) => s.id !== o.nodeId).map((s, k) => ({ ...s, sequence: k }));
        report.push({ i, op: 'remove-node', nodeId: o.nodeId, removed: 'section' });
      } else {
        // Remove the node and every descendant, and drop its id from its parent's child[].
        const drop = new Set([o.nodeId]);
        let grew = true;
        while (grew) { grew = false; for (const e of hit.section.elements) if (drop.has(e.id)) for (const c of e.child ?? []) if (!drop.has(c)) { drop.add(c); grew = true; } }
        hit.section.elements = hit.section.elements.filter((e) => !drop.has(e.id)).map((e) => ({ ...e, child: (e.child ?? []).filter((c) => !drop.has(c)) }));
        report.push({ i, op: 'remove-node', nodeId: o.nodeId, removed: [...drop] });
      }
    } else {
      report.push({ i, op: o.op, error: `unknown op ${o.op} (set | append-section | remove-node)` });
    }
  }
  return { pageData: next, report, errors: report.filter((r) => r.error) };
}

// What a read-back must show for each op, on a separate request.
export function verifyEdits(stored, report) {
  const out = [];
  for (const r of report) {
    if (r.error) continue;
    if (r.op === 'set') {
      const hit = findNode(stored, r.nodeId);
      out.push({ nodeId: r.nodeId, present: !!hit });
    } else if (r.op === 'append-section') {
      out.push({ sectionId: r.sectionId, present: (stored.sections ?? []).some((s) => s.id === r.sectionId) });
    } else if (r.op === 'remove-node') {
      out.push({ nodeId: r.nodeId, absent: !findNode(stored, r.nodeId) });
    }
  }
  return out;
}
