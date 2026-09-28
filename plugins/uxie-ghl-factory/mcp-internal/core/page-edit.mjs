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

import { sectionKnobs, sectionInnerRule, BUILDER_INNER_MAX_WIDTH } from './funnel-pages.mjs';
import { typographyValue, setRootVars, TYPOGRAPHY_SLOTS } from './page-fonts.mjs';
import { entranceClass, hoverClass, entranceCss, hoverCss, stripAnimationCss, parentAnimationOffset, ENTRANCE_METAS, HOVER_METAS } from './page-animation.mjs';

const mergeInto = (node, key, patch) => {
  node[key] = { ...(node[key] ?? {}), ...patch };
  // The builder also reads a canonical copy from node.element (see withElement); keep them equal.
  if (node.element && typeof node.element === 'object') node.element[key] = { ...(node.element[key] ?? {}), ...patch };
};

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
export function applyPageEdits(pageData, ops, { compileStyles = () => '' } = {}) {
  const next = structuredClone(pageData);
  const report = [];
  for (const [i, o] of ops.entries()) {
    if (o.op === 'set') {
      const hit = findNode(next, o.nodeId);
      if (!hit) { report.push({ i, op: 'set', nodeId: o.nodeId, error: 'no node with this id on the page' }); continue; }
      if (hit.isSection) {
        // A section takes its three General-tab knobs; its content is edited node by node, its styling by replacing it.
        if (o.extra || o.styles || o.entranceAnimation || o.hoverAnimation) { report.push({ i, op: 'set', nodeId: o.nodeId, error: 'a section takes sticky, width and fullWidthRows here; set its rows, columns and leaves by their own ids, or replace the section' }); continue; }
        if (o.sticky === undefined && o.width === undefined && o.fullWidthRows === undefined) { report.push({ i, op: 'set', nodeId: o.nodeId, error: 'set on a section needs sticky, width or fullWidthRows' }); continue; }
        let knobs;
        try { knobs = sectionKnobs(o); } catch (e) { report.push({ i, op: 'set', nodeId: o.nodeId, error: e.message }); continue; }
        const meta = hit.node; const changed = [];
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
        report.push({ i, op: 'set', nodeId: o.nodeId, meta: 'section', changed, expect: { extra: knobs.extra, class: knobs.cls } });
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
      report.push({ i, op: 'set', nodeId: o.nodeId, meta: hit.node.meta, changed, expect: { extra: o.extra ?? {}, styles: o.styles ?? {}, class: clsPatch } });
    } else if (o.op === 'append-section') {
      next.sections = [...(next.sections ?? []), { ...o.section, sequence: (next.sections ?? []).length }];
      report.push({ i, op: 'append-section', sectionId: o.section.id, nodes: (o.section.elements ?? []).length });
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
          const [key, varName, label] = TYPOGRAPHY_SLOTS[which];
          if (t?.fonts) t.fonts[key] = { id: varName, text: t.fonts[key]?.text ?? label, value: typographyValue(family), isCustom: false };
          vars[`--${varName}`] = `'${family}'`; vars[typographyValue(family).value.slice(4, -1)] = `'${family}'`; fams.push(family);
        }
        const g = next.general?.general;
        if (g) { const merged = [...new Set([...(g.fontsToLoad ?? []), ...fams])]; g.fontsToLoad = merged; g.fontsToLoadForPreview = merged; }
        next.pageStyles = setRootVars(next.pageStyles, vars);
        changed.push('settings.settings.typography', 'general.general.fontsToLoad', 'pageStyles');
      }
      if (!changed.length) { report.push({ i, op: 'page', error: 'page op needs trackingCode, customCss, background or typography (SEO goes in `seo`)' }); continue; }
      report.push({ i, op: 'page', changed, expectPage: { trackingCode: o.trackingCode, customCss: o.customCss, background: o.background, typography: o.typography } });
    } else {
      report.push({ i, op: o.op, error: `unknown op ${o.op} (set | append-section | append-popup | remove-node | page)` });
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
      // Compare VALUES, not presence: a set that landed as the old value is the failure to catch.
      const hit = findNode(stored, r.nodeId);
      const wrong = [];
      for (const key of ['extra', 'styles', 'class']) {
        for (const [k, v] of Object.entries(r.expect?.[key] ?? {})) {
          if (JSON.stringify(hit?.node?.[key]?.[k]) !== JSON.stringify(v)) wrong.push(`${key}.${k}`);
        }
      }
      out.push({ nodeId: r.nodeId, present: !!hit, applied: !!hit && wrong.length === 0, ...(wrong.length ? { notApplied: wrong } : {}) });
    } else if (r.op === 'append-section') {
      out.push({ sectionId: r.sectionId, present: (stored.sections ?? []).some((s) => s.id === r.sectionId) });
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
