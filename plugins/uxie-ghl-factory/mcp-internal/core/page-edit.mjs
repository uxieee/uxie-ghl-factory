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

import { sectionKnobs, sectionInnerRule, BUILDER_INNER_MAX_WIDTH, videoTypeOf, routeClickAction, sectionStylingPatch, withElement } from './funnel-pages.mjs';
import { randomId, allIds, subtreeIds, parentOf, positionIn, movedIndex, cloneSubtree, copyRulesUnderNewIds, stripRulesNaming, findPopup, popupRoot } from './page-structure.mjs';
import { nodeLayerCss, storedMap, LAYER_SPEC_KEYS } from './style-layer.mjs';
import { typographyValue, setRootVars, TYPOGRAPHY_SLOTS, typographySlot, isCustomFont, upsertCustomFont, customFamily } from './page-fonts.mjs';
import { entranceClass, hoverClass, entranceCss, hoverCss, stripAnimationCss, parentAnimationOffset, ENTRANCE_METAS, HOVER_METAS } from './page-animation.mjs';

const mergeInto = (node, key, patch) => {
  node[key] = { ...(node[key] ?? {}), ...patch };
  // The builder also reads a canonical copy from node.element (see withElement); keep them equal.
  if (node.element && typeof node.element === 'object') node.element[key] = { ...(node.element[key] ?? {}), ...patch };
};


const inPopup = (pageData, nodeId) => (pageData.popupsList ?? []).some((p) => (p.elements ?? []).some((e) => e.id === nodeId));

/** The column an inserted element goes into, and its position: parentId (+ index | after | before among its children) or a sibling (after | before). */
function insertTarget(pageData, o) {
  let hit; let col;
  if (o.parentId) {
    hit = findNode(pageData, o.parentId);
    if (!hit || hit.isSection) throw new Error(`insert: no column with id ${o.parentId} on the page`);
    col = hit.node;
  } else {
    const sib = o.after ?? o.before;
    if (!sib) throw new Error('insert needs parentId (a column) or after / before (a sibling element)');
    hit = findNode(pageData, sib);
    if (!hit || hit.isSection) throw new Error(`insert: no element with id ${sib} on the page`);
    col = parentOf(hit.section, sib)?.parent;
    if (!col) throw new Error(`insert: ${sib} has no parent column`);
  }
  if (col.meta !== 'col') throw new Error(`insert: ${col.id} is a ${col.meta}, an element goes into a column (name a column, or a sibling of the element position)`);
  const where = o.parentId ? { index: o.index, after: o.after, before: o.before } : { after: o.after, before: o.before };
  return { section: hit.section, col, at: positionIn(col.child ?? [], where, 'insert') };
}

/** Reorder: a section among the sections; a row, column or element among its siblings; an element into another column of the same section. */
function moveNode(pageData, o) {
  const hit = findNode(pageData, o.nodeId);
  if (!hit) return { error: 'no node with this id on the page' };
  try {
    if (hit.isSection) {
      const ids = pageData.sections.map((x) => x.id); const from = ids.indexOf(o.nodeId);
      const at = movedIndex(ids, from, o);
      const [moving] = pageData.sections.splice(from, 1);
      pageData.sections.splice(at, 0, moving);
      pageData.sections = pageData.sections.map((x, k) => ({ ...x, sequence: k }));
      return { moved: 'section', from, to: at, order: pageData.sections.map((x) => x.id) };
    }
    const cur = parentOf(hit.section, o.nodeId);
    if (!cur) return { error: 'this node has no parent' };
    let dest = cur.parent;
    if (o.parentId && o.parentId !== cur.parent.id) {
      const d = findNode(pageData, o.parentId);
      if (!d || d.isSection || d.section !== hit.section) return { error: `parentId ${o.parentId}: a node moves between the columns of ITS section only` };
      if (hit.node.type !== 'element' && hit.node.meta !== undefined && ['row', 'col', 'section'].includes(hit.node.meta)) return { error: `a ${hit.node.meta} keeps its parent; only elements move between columns` };
      if (d.node.meta !== 'col') return { error: `parentId ${o.parentId} is a ${d.node.meta}; an element goes into a column` };
      dest = d.node;
    }
    if (dest === cur.parent) {
      const at = movedIndex(dest.child, cur.index, o);
      const child = dest.child.filter((c) => c !== o.nodeId); child.splice(at, 0, o.nodeId);
      dest.child = child; if (dest.element && typeof dest.element === 'object') dest.element.child = [...child];
      return { moved: hit.node.meta, parentId: dest.id, from: cur.index, to: at, siblings: [...child] };
    }
    if (o.direction !== undefined) return { error: 'a move into another column names a position (index, after, before), not a direction' };
    cur.parent.child = cur.parent.child.filter((c) => c !== o.nodeId);
    const at = positionIn(dest.child ?? [], o, 'move');
    dest.child = [...(dest.child ?? []).slice(0, at), o.nodeId, ...(dest.child ?? []).slice(at)];
    for (const p of [cur.parent, dest]) if (p.element && typeof p.element === 'object') p.element.child = [...p.child];
    return { moved: hit.node.meta, parentId: dest.id, fromParent: cur.parent.id, to: at, siblings: [...dest.child] };
  } catch (e) { return { error: e.message }; }
}

/** A copy of a section, row, column or element — every id new, put right after the original — with its rules under the new ids. */
function cloneNode(pageData, o) {
  const hit = findNode(pageData, o.nodeId);
  if (!hit) return { error: 'no node with this id on the page' };
  const taken = allIds(pageData);
  const rnd = o.rnd ?? Math.random;
  if (hit.isSection) {
    const { ids, nodes } = cloneSubtree(hit.section, o.nodeId, taken, rnd);
    const [meta, ...elements] = nodes;
    // the builder's own clone of a section carries `styles.background = none` (and no _id): measured in its saves, wave34 capture 3 and wave35
    meta.styles = { ...(meta.styles ?? {}), background: { value: 'none' } };
    const newId = ids.get(o.nodeId);
    const { metaData: _m, elements: _e, general, ...rest } = hit.section;
    const copy = { ...rest, id: newId, metaData: meta, elements, general: { ...(general ?? {}), sectionStyles: copyRulesUnderNewIds(general?.sectionStyles ?? '', ids) } };
    const secs = pageData.sections;
    pageData.sections = [...secs.slice(0, hit.sectionIndex + 1), copy, ...secs.slice(hit.sectionIndex + 1)].map((x, k) => ({ ...x, sequence: k }));
    return { cloneId: newId, cloned: 'section', at: hit.sectionIndex + 1, ids: Object.fromEntries(ids) };
  }
  const cur = parentOf(hit.section, o.nodeId);
  if (!cur) return { error: 'this node has no parent' };
  const { ids, nodes } = cloneSubtree(hit.section, o.nodeId, taken, rnd);
  hit.section.elements = [...hit.section.elements, ...nodes];
  cur.parent.child = [...cur.parent.child.slice(0, cur.index + 1), ids.get(o.nodeId), ...cur.parent.child.slice(cur.index + 1)];
  if (cur.parent.element && typeof cur.parent.element === 'object') cur.parent.element.child = [...cur.parent.child];
  const rules = copyRulesUnderNewIds(hit.section.general?.sectionStyles ?? '', ids);
  if (rules) hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: `${hit.section.general?.sectionStyles ?? ''}${rules}` };
  return { cloneId: ids.get(o.nodeId), cloned: hit.node.meta, parentId: cur.parent.id, at: cur.index + 1, siblings: [...cur.parent.child], nodes: nodes.length, ids: Object.fromEntries(ids) };
}

const POPUP_KNOBS = { disabled: 'popupDisabled', closeOnOutsideClick: 'popupHide' };

/** A popup's own flags: disabled (popupDisabled) and closeOnOutsideClick (popupHide) on its root node; showOn ('exit' | 'none' | {delay}) — showPopupOnMouseOut. */
function setPopup(pageData, o) {
  const hit = findPopup(pageData, o.popupId);
  if (!hit) return { error: `no popup ${o.popupId} on this page (${(pageData.popupsList ?? []).map((p) => popupRoot(p)?.title ?? p.id).join(', ') || 'it has none'})` };
  if (hit.ambiguous) return { error: `${o.popupId} names several popups (${hit.ambiguous.join(', ')}); use the popup id` };
  const root = popupRoot(hit.popup);
  if (!root) return { error: 'this popup has no root node' };
  const changed = [];
  for (const [k, field] of Object.entries(POPUP_KNOBS)) if (o[k] !== undefined) {
    if (typeof o[k] !== 'boolean') return { error: `${k} must be true or false` };
    root.extra = { ...(root.extra ?? {}), [field]: { value: o[k] } }; changed.push(`extra.${field}`);
  }
  if (o.showOn !== undefined) {
    const s = o.showOn;
    const trig = s === 'exit' ? { value: 'exit', delay: 1 } : s === 'none' ? { value: 'none', delay: 1 }
      : (s && Number.isFinite(Number(s.delay)) && Number(s.delay) >= 0) ? { value: 'delay', delay: Number(s.delay) } : null;
    if (!trig) return { error: "showOn must be 'exit', 'none' or {delay: seconds}" };
    root.extra = { ...(root.extra ?? {}), showPopupOnMouseOut: trig }; changed.push('extra.showPopupOnMouseOut');
  }
  if (!changed.length) return { error: 'set-popup needs disabled, closeOnOutsideClick or showOn' };
  if (root.element && typeof root.element === 'object') root.element.extra = { ...root.extra };
  return { popupId: hit.popup.id, changed, expect: Object.fromEntries(changed.map((c) => [c, root.extra[c.slice(6)]])) };
}

/** Take a popup out of popupsList, and its page-level rules (every rule naming the popup or one of its nodes). Refused while a button opens it. */
function removePopup(pageData, o) {
  const hit = findPopup(pageData, o.popupId);
  if (!hit) return { error: `no popup ${o.popupId} on this page (${(pageData.popupsList ?? []).map((p) => popupRoot(p)?.title ?? p.id).join(', ') || 'it has none'})` };
  if (hit.ambiguous) return { error: `${o.popupId} names several popups (${hit.ambiguous.join(', ')}); use the popup id` };
  const id = hit.popup.id;
  const openers = [];
  for (const sec of pageData.sections ?? []) for (const e of sec.elements ?? []) if (e.extra?.popupId?.value === id || Object.values(e.extra ?? {}).some((v) => v?.value?.popupId === id)) openers.push(e.id);
  if (openers.length) return { error: `${openers.join(', ')} open this popup; point them elsewhere (set) or remove them first` };
  const ids = (hit.popup.elements ?? []).map((e) => e.id);
  const before = pageData.pageStyles ?? '';
  const keep = stripRulesNaming(before, ids);
  pageData.popupsList = pageData.popupsList.filter((p) => p.id !== id);
  pageData.pageStyles = keep;
  return { popupId: id, removedNodes: ids.length, pageStylesChanged: keep !== before, remaining: pageData.popupsList.map((p) => p.id) };
}

/** popupsList in the given order (ids or names); popups not listed keep their relative order after the listed ones. */
function orderPopups(pageData, o) {
  const list = pageData.popupsList ?? [];
  if (!Array.isArray(o.order) || !o.order.length) return { error: 'order-popups needs `order`: the popup ids or names, first = highest priority' };
  const picked = [];
  for (const ref of o.order) {
    const hit = findPopup(pageData, ref);
    if (!hit) return { error: `no popup ${ref} on this page` };
    if (hit.ambiguous) return { error: `${ref} names several popups (${hit.ambiguous.join(', ')}); use the popup id` };
    if (picked.includes(hit.popup.id)) return { error: `${ref} is listed twice` };
    picked.push(hit.popup.id);
  }
  const next = [...picked.map((id) => list.find((p) => p.id === id)), ...list.filter((p) => !picked.includes(p.id))];
  pageData.popupsList = next;
  return { order: next.map((p) => p.id), names: next.map((p) => popupRoot(p)?.title ?? p.id) };
}

/**
 * ops:
 *  { op: 'set', nodeId, extra?: {...}, styles?: {...},     merge into an existing leaf, row or column;
 *    entranceAnimation?: {name, duration?, delay?, scale?, easing?}, hoverAnimation?: {name, …knobs} }
 *                                                          the animations go into `class` AND the compiled sheet
 *  { op: 'set', nodeId: <section id>, sticky?, width?, fullWidthRows? }   a section's General-tab knobs
 *  { op: 'append-popup', popup }                           popup: a built entry from makePopup() (+ its css)
 *  { op: 'append-section', section }                       section: a node tree from makeSection()
 *  { op: 'remove-node', nodeId }                           a leaf (and its id in its parent's child[]) or a whole section
 * `compileStyles(nodeId, meta, styles)` returns a CSS rule string for the public stylesheet (or '').
 */
export function applyPageEdits(pageData, ops, { compileStyles = () => '', compileSizes = () => '', kindLayer = null } = {}) {
  const next = structuredClone(pageData);
  const report = [];
  for (const [i, o] of ops.entries()) {
    if (o.op === 'set') {
      const hit = findNode(next, o.nodeId);
      if (!hit) { report.push({ i, op: 'set', nodeId: o.nodeId, error: inPopup(next, o.nodeId) ? 'this node is inside a popup: a popup\'s own settings go through set-popup; its content is rebuilt with remove-popup + append-popup (content edits inside a popup are not supported)' : 'no node with this id on the page' }); continue; }
      const beforeNode = !hit.isSection && kindLayer ? structuredClone(hit.node) : null;
      if (hit.isSection) {
        // A section takes its General-tab knobs and its styling (styles, wrapper, tablet / mobile maps, visibility, custom
        // classes, background image, entrance animation); its content is edited node by node.
        const SECTION_SET = ['sticky', 'width', 'fullWidthRows', 'styles', 'visibility', 'customClass', 'bgImage', 'entranceAnimation', ...LAYER_SPEC_KEYS];
        if (o.extra || o.hoverAnimation) { report.push({ i, op: 'set', nodeId: o.nodeId, error: `a section takes ${SECTION_SET.join(', ')} here; set its rows, columns and leaves by their own ids` }); continue; }
        if (!SECTION_SET.some((k) => o[k] !== undefined)) { report.push({ i, op: 'set', nodeId: o.nodeId, error: `set on a section needs one of ${SECTION_SET.join(', ')}` }); continue; }
        let knobs; let styling;
        try { knobs = sectionKnobs(o); styling = sectionStylingPatch(o); } catch (e) { report.push({ i, op: 'set', nodeId: o.nodeId, error: e.message }); continue; }
        const meta = hit.node; const changed = [];
        for (const [layer, patch] of Object.entries(styling.merge)) { mergeInto(meta, layer, patch); changed.push(...Object.keys(patch).map((k) => `${layer}.${k}`)); }
        for (const [k, v] of Object.entries(styling.replace)) { meta[k] = v; changed.push(k); }
        if (styling.touchesCss) {
          const sid = hit.section.id;
          let css = `${hit.section.general?.sectionStyles ?? ''}${nodeLayerCss({ ...meta, id: sid })}`;
          if (o.entranceAnimation) css = stripAnimationCss(css, sid) + entranceCss(sid, meta.class);
          hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: css };
          changed.push('section.general.sectionStyles');
        }
        if (Object.keys(knobs.extra).length) { mergeInto(meta, 'extra', knobs.extra); changed.push(...Object.keys(knobs.extra).map((k) => `extra.${k}`)); }
        if (Object.keys(knobs.cls).length) {
          mergeInto(meta, 'class', knobs.cls); changed.push('class.width');
          // classStr is the builder's flattened class list; keep the width class in it when the node has one.
          if (typeof meta.classStr === 'string') meta.classStr = [...meta.classStr.split(/\s+/).filter((c) => c && !/Section$/.test(c)), knobs.cls.width.value].join(' ');
        }
        if (o.fullWidthRows !== undefined) {
          // The compiled inner rule the builder writes for this knob (its sectionStyle(): 100% or 1170px).
          const sid = hit.section.id;
          const css = (hit.section.general?.sectionStyles ?? '').replace(new RegExp(`#${sid.replace(/[-]/g, '\\-')}>\\.inner\\{max-width:[^}]*\\}`, 'g'), '');
          hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: css + sectionInnerRule(sid, { fullWidthRows: o.fullWidthRows === true, maxWidth: BUILDER_INNER_MAX_WIDTH }) };
          changed.push('section.general.sectionStyles');
        }
        meta.updated = true;
        report.push({ i, op: 'set', nodeId: o.nodeId, meta: 'section', changed, expect: { extra: { ...knobs.extra, ...(styling.merge.extra ?? {}) }, class: { ...knobs.cls, ...(styling.merge.class ?? {}) }, styles: styling.merge.styles ?? {}, wrapper: styling.merge.wrapper ?? {}, ...styling.replace } });
        continue;
      }
      const changed = [];
      let clsPatch = {};
      try {
        if (o.entranceAnimation) {
          if (!ENTRANCE_METAS.includes(hit.node.meta)) throw new Error(`the builder offers an entrance animation on ${ENTRANCE_METAS.join(', ')} — not on ${hit.node.meta}`);
          clsPatch = { ...clsPatch, ...entranceClass(o.entranceAnimation) };
        }
        if (o.hoverAnimation) {
          if (!HOVER_METAS.includes(hit.node.meta)) throw new Error(`the builder offers a hover animation on buttons only — not on ${hit.node.meta}`);
          clsPatch = { ...clsPatch, ...hoverClass(o.hoverAnimation) };
        }
      } catch (e) { report.push({ i, op: 'set', nodeId: o.nodeId, error: e.message }); continue; }
      if (typeof o.appendCss === 'string' && o.appendCss) {
        hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: `${hit.section.general?.sectionStyles ?? ''}${o.appendCss}` };
        changed.push('section.general.sectionStyles');
      }
      if (Object.keys(clsPatch).length) {
        // A new entrance replaces every timing knob of the old one; a new hover replaces the old knobs.
        if (o.entranceAnimation) for (const k of ['animationScale', 'animationDuration', 'animationDelay', 'animationEasing']) { delete hit.node.class?.[k]; if (hit.node.element?.class) delete hit.node.element.class[k]; }
        if (o.hoverAnimation) for (const k of ['hoverDuration', 'hoverDelay', 'hoverEasing', 'hoverScale', 'hoverAngle', 'hoverDistance', 'hoverBorderThickness', 'hoverBlur', 'hoverSpread']) { delete hit.node.class?.[k]; if (hit.node.element?.class) delete hit.node.element.class[k]; }
        mergeInto(hit.node, 'class', clsPatch); changed.push(...Object.keys(clsPatch).map((k) => `class.${k}`));
        const id = hit.node.id;
        const rules = entranceCss(id, hit.node.class, parentAnimationOffset(id, hit.section)) + hoverCss(id, hit.node.class);
        hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: stripAnimationCss(hit.section.general?.sectionStyles ?? '', id) + rules };
        changed.push('section.general.sectionStyles');
      }
      // A video's source is ONE object (videoProperties.value): a set naming only a new url keeps the rest of the stored
      // value, and the player type follows the url (or a Media Storage file) unless the caller names one.
      if (hit.node.meta === 'video' && o.extra?.videoProperties?.value && typeof o.extra.videoProperties.value === 'object') {
        const cur = hit.node.extra?.videoProperties?.value ?? {};
        const given = o.extra.videoProperties.value;
        const next = { ...cur, ...given, selfHostedVideo: { ...(cur.selfHostedVideo ?? {}), ...(given.selfHostedVideo ?? {}) } };
        if (!given.type) next.type = given.selfHostedVideo?.id ? 'selfHosted' : (given.url ? (videoTypeOf(given.url) ?? cur.type) : cur.type);
        o.extra = { ...o.extra, videoProperties: { value: next } };
      }
      // An image or svg keeps its click action in imageActions / svgImageActions, not `action` (funnel-pages.mjs).
      if (o.extra) {
        try { o.extra = routeClickAction(hit.node.meta, o.extra); } catch (e) { report.push({ i, op: 'set', nodeId: o.nodeId, error: e.message }); continue; }
      }
      if (o.extra && Object.keys(o.extra).length) { mergeInto(hit.node, 'extra', o.extra); changed.push(...Object.keys(o.extra).map((k) => `extra.${k}`)); }
      if (o.styles && Object.keys(o.styles).length) {
        mergeInto(hit.node, 'styles', o.styles); changed.push(...Object.keys(o.styles).map((k) => `styles.${k}`));
        // a ported kind's sheet is regenerated whole below (generic + per-kind layer); the flat compile would add a wrapper rule
        const rule = beforeNode && kindLayer.handles(hit.node.meta) ? '' : compileStyles(hit.node.id, hit.node.meta, hit.node.styles);
        if (rule) {
          hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: `${hit.section.general?.sectionStyles ?? ''}${rule}` };
          changed.push('section.general.sectionStyles');
        }
      }
      // The wrapper and tablet / mobile maps: merged into the node, and the node's generic-layer rules recompiled (the later
      // rule wins) — what a builder save writes for it.
      const layerPatch = {};
      try {
        if (o.wrapper) layerPatch.wrapper = storedMap(o.wrapper);
        for (const k of ['tabletStyles', 'mobileStyles', 'tabletWrapper', 'mobileWrapper']) if (o[k]) layerPatch[k] = storedMap(o[k]);
      } catch (e) { report.push({ i, op: 'set', nodeId: o.nodeId, error: e.message }); continue; }
      for (const [layer, patch] of Object.entries(layerPatch)) { mergeInto(hit.node, layer, patch); changed.push(...Object.keys(patch).map((k) => `${layer}.${k}`)); }
      // Only the wrapper and per-device parts are appended here: appended after the page's per-kind rules, the node's
      // generic STYLES would win over them (the builder writes generic rules first); `styles` keep their own compile above.
      if (Object.keys(layerPatch).length && !(beforeNode && kindLayer.handles(hit.node.meta))) {
        const { styles: _drop, ...rest } = hit.node;
        hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: `${hit.section.general?.sectionStyles ?? ''}${nodeLayerCss({ ...rest, styles: {} })}` };
        if (!changed.includes('section.general.sectionStyles')) changed.push('section.general.sectionStyles');
      }
      // A size or weight change is recompiled from the node, the way the builder compiles it; the later rule wins.
      const sized = Object.keys(o.extra ?? {}).some((k) => /FontSize$/.test(k)) || Object.keys(o.styles ?? {}).some((k) => /^fontWeight/.test(k));
      const sizeRule = sized && !(beforeNode && kindLayer.handles(hit.node.meta)) ? compileSizes(hit.node) : '';
      if (sizeRule) {
        hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: `${hit.section.general?.sectionStyles ?? ''}${sizeRule}` };
        changed.push('section.general.sectionStyles');
      }
      // A node of a kind whose per-kind rules are compiled here: BOTH layers the builder writes for it (generic + per-kind) are
      // regenerated — the rules of its old state are taken out of the section's sheet and those of its new state written (a value
      // that no longer switches a rule on must not leave the old rule behind). A new state the measurements do not cover refuses
      // the edit — the builder alone could compile it. On a page the builder has saved, the old rules are minified and cannot be
      // found verbatim: the new ones are appended (later wins) and the report says the old ones may remain until the next save.
      if (beforeNode && kindLayer.handles(hit.node.meta)) {
        const palette = next.general?.general?.colors;
        const why = kindLayer.refusal(hit.node, palette);
        if (why) { report.push({ i, op: 'set', nodeId: o.nodeId, error: `${hit.node.meta}: ${why}; the builder compiles this kind's CSS on its next save — nothing was written` }); continue; }
        const { styles: _s, ...noStyles } = hit.node;
        const layers = (n) => [nodeLayerCss(n), kindLayer.css(n, palette)];
        const oldL = layers(beforeNode), newL = layers(hit.node);
        let cur = hit.section.general?.sectionStyles ?? ''; let stale = false;
        for (let k = 0; k < 2; k++) if (oldL[k] !== newL[k]) { if (oldL[k] && cur.includes(oldL[k])) cur = cur.replace(oldL[k], ''); else if (oldL[k]) stale = true; }
        // the generic layer of the NEW state (all of it, not only the wrapper and per-device parts) then the per-kind layer
        const add = (oldL[0] !== newL[0] ? newL[0] : '') + (oldL[1] !== newL[1] ? newL[1] : '');
        if (add || cur !== (hit.section.general?.sectionStyles ?? '')) {
          hit.section.general = { ...(hit.section.general ?? {}), sectionStyles: `${cur}${add}` };
          if (!changed.includes('section.general.sectionStyles')) changed.push('section.general.sectionStyles');
        }
        if (stale) changed.push('note: the old rules of this node were not found verbatim (a builder-saved sheet is minified); they stay until the page is next saved in the builder');
      }
      hit.node.updated = true;
      report.push({ i, op: 'set', nodeId: o.nodeId, meta: hit.node.meta, changed, expect: { extra: o.extra ?? {}, styles: o.styles ?? {}, class: clsPatch, ...layerPatch } });
    } else if (o.op === 'append-section') {
      // At the end, or at a position among the sections (index | after | before — a section id).
      const secs = next.sections ?? [];
      let at;
      try { at = positionIn(secs.map((x) => x.id), o, 'append-section'); } catch (e) { report.push({ i, op: 'append-section', error: e.message }); continue; }
      next.sections = [...secs.slice(0, at), o.section, ...secs.slice(at)].map((x, k) => ({ ...x, sequence: k }));
      report.push({ i, op: 'append-section', sectionId: o.section.id, nodes: (o.section.elements ?? []).length, ...(['index', 'after', 'before'].some((k) => o[k] !== undefined) ? { at } : {}) });
    } else if (o.op === 'insert') {
      // A new element into an existing column at a position: the node joins the section's element bag, its id goes into the column's
      // child[] (builder Quick Add: right after the selected element), its rules into the section's sheet.
      let target;
      try { target = insertTarget(next, o); } catch (e) { report.push({ i, op: 'insert', error: e.message }); continue; }
      const { section, col, at } = target;
      const leaf = withElement(o.leaf);
      section.elements = [...section.elements, leaf];
      col.child = [...(col.child ?? []).slice(0, at), leaf.id, ...(col.child ?? []).slice(at)];
      if (col.element && typeof col.element === 'object') col.element.child = [...col.child];
      if (o.css) section.general = { ...(section.general ?? {}), sectionStyles: `${section.general?.sectionStyles ?? ''}${o.css}` };
      report.push({ i, op: 'insert', nodeId: leaf.id, meta: leaf.meta, sectionId: section.id, parentId: col.id, at, siblings: [...col.child] });
    } else if (o.op === 'move') {
      const r = moveNode(next, o);
      report.push({ i, op: 'move', nodeId: o.nodeId, ...r });
    } else if (o.op === 'clone') {
      const r = cloneNode(next, o);
      report.push({ i, op: 'clone', nodeId: o.nodeId, ...r });
    } else if (o.op === 'set-popup') {
      const r = setPopup(next, o);
      report.push({ i, op: 'set-popup', popup: o.popupId, ...r });
    } else if (o.op === 'remove-popup') {
      const r = removePopup(next, o);
      report.push({ i, op: 'remove-popup', popup: o.popupId, ...r });
    } else if (o.op === 'order-popups') {
      const r = orderPopups(next, o);
      report.push({ i, op: 'order-popups', ...r });
    } else if (o.op === 'append-popup') {
      next.popupsList = [...(next.popupsList ?? []), o.popup.entry];
      // The popup's box and its content's rules are PAGE-level CSS, where the builder keeps them.
      next.pageStyles = `${next.pageStyles ?? ''}${o.popup.css}`;
      report.push({ i, op: 'append-popup', popupId: o.popup.entry.id, name: o.popup.name, nodes: o.popup.entry.elements.length, changed: ['popupsList', 'pageStyles'] });
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
    } else if (o.op === 'page') {
      // Page-level settings, each where the builder keeps it (measured from the builder's own saves,
      // knowledge sniffs/funnels-wave4-page-2026-09-26). SEO is not here: it rides the autosave
      // envelope's `meta`, not the page data (see seoMeta below).
      const changed = [];
      if (o.trackingCode) {
        next.trackingCode = { headerCode: '', footerCode: '', ...(next.trackingCode ?? {}), ...o.trackingCode };
        changed.push(...Object.keys(o.trackingCode).map((k) => `trackingCode.${k}`));
      }
      if (typeof o.customCss === 'string') {
        // The raw custom CSS lives in general.general.pageStyles; the top-level pageStyles is the
        // builder's compiled sheet (theme vars, popup rules) with the custom CSS APPENDED — the copy
        // the public page serves. Replace the old suffix, never the builder's part.
        const gen = next.general?.general ?? {};
        const old = gen.pageStyles ?? '';
        let compiled = next.pageStyles ?? '';
        if (old && compiled.endsWith(old)) compiled = compiled.slice(0, compiled.length - old.length).replace(/\s*$/, '');
        next.general = { ...(next.general ?? {}), general: { ...gen, pageStyles: o.customCss } };
        next.pageStyles = o.customCss ? `${compiled} \n ${o.customCss}` : compiled;
        changed.push('general.general.pageStyles', 'pageStyles');
      }
      if (o.background) {
        const bg = next.settings?.settings?.background ?? {};
        const img = bg.bgImage?.value ?? { url: '', options: 'bgCover', svgCode: '', svgEncode: '' };
        const nextBg = {
          ...bg,
          bgImage: { value: { ...img, ...(o.background.imageUrl !== undefined ? { url: o.background.imageUrl } : {}), ...(o.background.imageOptions ? { options: o.background.imageOptions } : {}) } },
          ...(o.background.color !== undefined ? { backgroundColor: { value: o.background.color } } : {}),
        };
        next.settings = { ...(next.settings ?? {}), settings: { ...(next.settings?.settings ?? {}), background: nextBg } };
        changed.push('settings.settings.background');
      }
      if (o.typography && (o.typography.headlineFont || o.typography.contentFont)) {
        // The builder's shape: the setting, the face in fontsToLoad, and the :root variables in pageStyles
        // (the renderer reads --headlinefont/--contentfont from there only; wave12 typography differential).
        const t = next.settings?.settings?.typography;
        const vars = {}; const fams = [];
        for (const [which, family] of [['headline', o.typography.headlineFont], ['content', o.typography.contentFont]]) {
          if (!family) continue;
          const [key] = TYPOGRAPHY_SLOTS[which];
          const { slot, vars: v, family: fam } = typographySlot(which, family, t?.fonts?.[key]?.text);
          if (t?.fonts) t.fonts[key] = slot;
          Object.assign(vars, v);
          // An uploaded font (resolved from {customFontId} by the tool) loads from customFonts, not fontsToLoad.
          if (fam) fams.push(fam); else upsertCustomFont(next, family);
        }
        const g = next.general?.general;
        if (g) { const merged = [...new Set([...(g.fontsToLoad ?? []), ...fams])]; g.fontsToLoad = merged; g.fontsToLoadForPreview = merged; }
        next.pageStyles = setRootVars(next.pageStyles, vars);
        changed.push('settings.settings.typography', 'general.general.fontsToLoad', 'pageStyles');
      }
      if (!changed.length) { report.push({ i, op: 'page', error: 'page op needs trackingCode, customCss, background or typography (SEO goes in `seo`)' }); continue; }
      report.push({ i, op: 'page', changed, expectPage: { trackingCode: o.trackingCode, customCss: o.customCss, background: o.background, typography: o.typography } });
    } else {
      report.push({ i, op: o.op, error: `unknown op ${o.op} (set | append-section | insert | move | clone | append-popup | set-popup | remove-popup | order-popups | remove-node | page)` });
    }
  }
  return { pageData: next, report, errors: report.filter((r) => r.error) };
}

// What a read-back must show for each op, on a separate request.
export function verifyEdits(stored, report) {
  const out = [];
  // A child[] snapshot in the report is that op's result; a LATER op on the same parent changes the final list, so only the last op
  // touching a parent is compared exactly (the earlier ones are checked to have left their node in the parent).
  const lastOnParent = new Map(); report.forEach((r, k) => { if (!r.error && r.parentId && r.siblings) lastOnParent.set(r.parentId, k); });
  // …and the same for the SECTION order (move / clone of a section / append-section at a position).
  const secOrder = (r) => r.moved === 'section' || r.cloned === 'section' || (r.op === 'append-section' && r.at !== undefined);
  let lastSection = -1; report.forEach((r, k) => { if (!r.error && secOrder(r)) lastSection = k; });
  const orderOk = (final, snap, exact, id) => (exact ? JSON.stringify(final) === JSON.stringify(snap) : (final ?? []).includes(id));
  for (const [k, r] of report.entries()) {
    if (r.error) continue;
    if (r.op === 'set') {
      // Compare VALUES, not presence: a set that landed as the old value is the failure to catch.
      const hit = findNode(stored, r.nodeId);
      const wrong = [];
      for (const key of ['extra', 'styles', 'class', 'wrapper', 'tabletStyles', 'mobileStyles', 'tabletWrapper', 'mobileWrapper']) {
        for (const [k, v] of Object.entries(r.expect?.[key] ?? {})) {
          if (JSON.stringify(hit?.node?.[key]?.[k]) !== JSON.stringify(v)) wrong.push(`${key}.${k}`);
        }
      }
      out.push({ nodeId: r.nodeId, present: !!hit, applied: !!hit && wrong.length === 0, ...(wrong.length ? { notApplied: wrong } : {}) });
    } else if (r.op === 'append-section') {
      const at = (stored.sections ?? []).findIndex((s) => s.id === r.sectionId);
      out.push({ sectionId: r.sectionId, present: at >= 0, ...(r.at !== undefined ? { at, applied: k === lastSection ? at === r.at : at >= 0 } : {}) });
    } else if (r.op === 'insert' || r.op === 'clone') {
      // The new node is stored, and its parent's child[] is exactly what the tool wrote (position included).
      const id = r.nodeId && r.op === 'insert' ? r.nodeId : r.cloneId;
      const hit = findNode(stored, id);
      const parent = hit && !hit.isSection ? parentOf(hit.section, id)?.parent : null;
      const secOk = r.cloned === 'section' ? (k === lastSection ? (stored.sections ?? []).findIndex((s) => s.id === id) === r.at : (stored.sections ?? []).some((s) => s.id === id)) : null;
      const sibOk = r.siblings ? orderOk(parent?.child, r.siblings, lastOnParent.get(r.parentId) === k, id) : (r.cloned === 'section' ? null : parent?.child?.indexOf(id) === r.at);
      const subtree = hit ? subtreeIds(hit.section, id).length : 0;
      out.push({ nodeId: id, present: !!hit, ...(r.op === 'clone' ? { nodes: subtree } : {}), applied: !!hit && sibOk !== false && secOk !== false && (r.op !== 'clone' || r.cloned === 'section' || subtree === r.nodes) });
    } else if (r.op === 'move') {
      let ok;
      if (r.moved === 'section') { const now = (stored.sections ?? []).map((x) => x.id); ok = k === lastSection ? JSON.stringify(now) === JSON.stringify(r.order) : JSON.stringify(now.filter((x) => r.order.includes(x))) === JSON.stringify(r.order); }
      else { const hit = findNode(stored, r.nodeId); ok = !!hit && orderOk(parentOf(hit.section, r.nodeId)?.parent?.child, r.siblings, lastOnParent.get(r.parentId) === k, r.nodeId); }
      out.push({ nodeId: r.nodeId, applied: ok });
    } else if (r.op === 'set-popup') {
      const p = (stored.popupsList ?? []).find((x) => x.id === r.popupId);
      const root = p && popupRoot(p);
      const wrong = Object.entries(r.expect ?? {}).filter(([c, v]) => JSON.stringify(root?.extra?.[c.slice(6)]) !== JSON.stringify(v)).map(([c]) => c);
      out.push({ popupId: r.popupId, present: !!p, applied: !!p && wrong.length === 0, ...(wrong.length ? { notApplied: wrong } : {}) });
    } else if (r.op === 'remove-popup') {
      out.push({ popupId: r.popupId, absent: !(stored.popupsList ?? []).some((x) => x.id === r.popupId), applied: JSON.stringify((stored.popupsList ?? []).map((x) => x.id)) === JSON.stringify(r.remaining) });
    } else if (r.op === 'order-popups') {
      out.push({ order: (stored.popupsList ?? []).map((x) => x.id), applied: JSON.stringify((stored.popupsList ?? []).map((x) => x.id)) === JSON.stringify(r.order) });
    } else if (r.op === 'append-popup') {
      const p = (stored.popupsList ?? []).find((x) => x.id === r.popupId);
      out.push({ popupId: r.popupId, present: !!p, nodes: p?.elements?.length ?? 0, applied: !!p && p.elements.length === r.nodes });
    } else if (r.op === 'remove-node') {
      out.push({ nodeId: r.nodeId, absent: !findNode(stored, r.nodeId) });
    } else if (r.op === 'page') {
      const e = r.expectPage ?? {};
      const wrong = [];
      for (const [k, v] of Object.entries(e.trackingCode ?? {})) if (stored.trackingCode?.[k] !== v) wrong.push(`trackingCode.${k}`);
      if (typeof e.customCss === 'string') {
        if ((stored.general?.general?.pageStyles ?? '') !== e.customCss) wrong.push('general.general.pageStyles');
        if (e.customCss && !(stored.pageStyles ?? '').endsWith(e.customCss)) wrong.push('pageStyles');
      }
      const bg = stored.settings?.settings?.background;
      if (e.background?.imageUrl !== undefined && bg?.bgImage?.value?.url !== e.background.imageUrl) wrong.push('background.imageUrl');
      if (e.background?.color !== undefined && bg?.backgroundColor?.value !== e.background.color) wrong.push('background.color');
      for (const [which, family] of [['headline', e.typography?.headlineFont], ['content', e.typography?.contentFont]]) {
        if (!family) continue;
        const [key, varName] = TYPOGRAPHY_SLOTS[which];
        if (isCustomFont(family)) {
          const slot = stored.settings?.settings?.typography?.fonts?.[key];
          if (slot?.value?.value !== `'${customFamily(family)}'` || slot?.isCustom !== true) wrong.push(`typography.${key}`);
          if (!(stored.general?.general?.customFonts ?? []).some((f) => f.id === family.id && f.url === family.url)) wrong.push(`customFonts.${family.id}`);
          if (!(stored.pageStyles ?? '').includes(`--${varName}: '${customFamily(family)}'`) && !(stored.pageStyles ?? '').includes(`--${varName}:'${customFamily(family)}'`)) wrong.push(`pageStyles.--${varName}`);
          continue;
        }
        if (stored.settings?.settings?.typography?.fonts?.[key]?.value?.text !== family) wrong.push(`typography.${key}`);
        if (!(stored.general?.general?.fontsToLoad ?? []).includes(family)) wrong.push(`fontsToLoad.${family}`);
        if (!new RegExp(`--${varName}\\s*:\\s*'${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(stored.pageStyles ?? '')) wrong.push(`pageStyles.--${varName}`);
      }
      out.push({ page: true, applied: wrong.length === 0, ...(wrong.length ? { notApplied: wrong } : {}) });
    }
  }
  return out;
}

// The target check an in-place edit needs: the page must belong to the named step of this funnel, and
// the caller must name that step exactly. A wrong pageId would otherwise overwrite someone else's page
// with a 201. Pages on a step are ids (or {id} objects on older documents).
export function checkPageTarget(funnel, { stepId, pageId, stepName }) {
  const steps = funnel?.steps ?? [];
  const step = steps.find((s) => s.id === stepId);
  if (!step) return { ok: false, reason: `no step ${stepId} in this funnel` };
  if (step.name !== stepName) return { ok: false, reason: `step ${stepId} is named "${step.name}", not "${stepName}"` };
  const pages = (step.pages ?? []).map((pg) => (typeof pg === 'string' ? pg : pg?.id ?? pg?._id));
  if (!pages.includes(pageId)) return { ok: false, reason: `page ${pageId} is not a page of step "${step.name}" (its pages: ${pages.join(', ') || 'none'})` };
  const owners = steps.filter((s) => (s.pages ?? []).some((pg) => (typeof pg === 'string' ? pg : pg?.id ?? pg?._id) === pageId));
  if (owners.length !== 1) return { ok: false, reason: `page ${pageId} is claimed by ${owners.length} steps — ambiguous, refusing` };
  return { ok: true, step: { id: step.id, name: step.name, url: step.url, type: step.type } };
}

// The page-data read carries a traceId and lacks the `id` the autosave body repeats; everything else is
// written back as read, so an edit changes only what its ops name.
export const pageDataForWrite = (read, pageId) => {
  const { traceId, ...rest } = read ?? {};
  return { ...rest, id: rest.id ?? pageId, pageId: rest.pageId ?? pageId };
};

// SEO rides the autosave ENVELOPE as a top-level `meta`, and GHL shows it on the page RECORD
// (GET /funnels/page/{pageId}.meta) — measured from the builder's own save, knowledge
// sniffs/funnels-wave8-actions-2026-09-28/ui-autosave-seo.req.network-request. The builder always sends
// all eight keys, so the current record is merged with the caller's fields.
export const SEO_KEYS = Object.freeze(['title', 'description', 'keywords', 'author', 'imageUrl', 'customMeta', 'canonicalMeta', 'language']);
export function seoMeta(current, patch) {
  const base = { title: '', description: '', keywords: '', author: '', imageUrl: '', customMeta: [], canonicalMeta: [], language: 'en' };
  const out = { ...base };
  for (const k of SEO_KEYS) if (current?.[k] !== undefined) out[k] = current[k];
  for (const k of SEO_KEYS) if (patch?.[k] !== undefined) out[k] = patch[k];
  return out;
}
export function seoDiff(stored, want) {
  return SEO_KEYS.filter((k) => want[k] !== undefined && JSON.stringify(stored?.[k]) !== JSON.stringify(want[k]));
}
