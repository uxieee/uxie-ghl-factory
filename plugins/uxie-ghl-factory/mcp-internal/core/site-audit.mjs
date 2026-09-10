// Site audit — the checks that decide whether a GHL funnel/website actually WORKS, as opposed to
// whether it was built without an error.
//
// Why this module exists, in one sentence: every defect this catches returns 2xx everywhere, stores
// correctly, and renders a page that looks right to whoever built it.
//
// The evidence it is built on (all proven live 2026-09-10, funnels/40-rules rules 24-28):
//   * 49 of 51 embedded formIds on a template-built account pointed at a form in the SOURCE
//     account; 4 of 5 calendarIds likewise. The embed carries the CORRECT name beside the wrong id,
//     so the builder, a screenshot and any name-based grep all pass.
//   * The nine id-reference props are THREE different things. Treating them alike emits 776 false
//     positives on popupId alone; checking only formId misses every booking page.
//   * A page pinned to a published version serves that version forever — so the stored document and
//     the served page can be different content entirely.
//   * Auto-generated schema.org markup never regenerates on republish.
// Everything here is READ-ONLY. It reports; it never repairs.

// The three reference classes. Only `account` refs dangle on a clone.
export const REF_CLASS = Object.freeze({
  formId: 'account', calendarId: 'account', surveyId: 'account', countdownTimerId: 'account',
  productId: 'account', storeProductId: 'account', storeCollectionId: 'account',
  popupId: 'page-local',           // hl_main_popup-<id>, defined in this page's own popupsList
  storeProductPriceId: 'sentinel', // observed value "all" — not an id at all
});

// Which account list answers each account-class prop. A prop with no list here cannot be judged,
// and is reported as NOT CHECKED rather than passed.
export const REF_SOURCE = Object.freeze({
  formId: 'forms', calendarId: 'calendars', surveyId: 'surveys',
});

// A value that is never a real id. `none` is what GHL's AI generator writes on an account with no
// forms; `{{ … }}` is a template placeholder the install never substituted. Both fail the set test
// correctly, but they are worth naming separately because the fix differs.
export const placeholderKind = (v) => {
  if (v === 'none' || v === '' || v == null) return 'empty';
  if (/^\{\{.*\}\}$/.test(String(v).trim())) return 'unsubstituted-merge-tag';
  return null;
};

// `{{ custom_values.ai_name }}` and `{{custom_values.ai_name}}` are the same key. The account's own
// fieldKey carries the spaces; pages usually omit them.
export const normaliseTag = (s) => String(s).replace(/\s+/g, '').toLowerCase();

const walk = (node, fn, depth = 0) => {
  if (depth > 64 || node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) walk(x, fn, depth + 1); return; }
  fn(node);
  for (const v of Object.values(node)) walk(v, fn, depth + 1);
};

/** Pull every reference, merge tag and location id out of one page's stored content. Pure. */
export function scanPage({ pageData, pageId, pageName = null }) {
  const refs = [];
  const tags = new Set();
  const locations = new Set();
  const popupsDefined = new Set();

  for (const p of pageData?.popupsList ?? []) if (p?.id) popupsDefined.add(p.id);
  walk(pageData, (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (REF_CLASS[k] && v && typeof v === 'object' && 'value' in v) {
        refs.push({ prop: k, cls: REF_CLASS[k], value: String(v.value ?? ''), text: v.text ?? null, pageId, pageName });
      }
      if ((k === 'locationId' || k === 'location_id') && typeof v === 'string' && v) locations.add(v);
    }
  });
  // The first heading's text, for rule 28: generated schema.org markup is pinned to a page's FIRST
  // publish, so a page republished with new copy keeps describing the old one. Comparing the JSON-LD
  // against the CURRENT headline is the only way to see it, and only from the rendered page.
  let headline = null;
  walk(pageData, (o) => {
    if (headline || o?.type !== 'element') return;
    if (o.meta !== 'heading' && o.meta !== 'sub-heading') return;
    // The text lives in `extra.text.value` on a synthesised node; `html` is undefined there and is
    // only populated on some donor-copied shapes. Reading `html` alone returns null on every page
    // this engine builds, which silently disables the schema check that depends on it.
    const raw = o.extra?.text?.value ?? o.extra?.text ?? o.html ?? '';
    const t = String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t) headline = t;
  });

  const raw = JSON.stringify(pageData ?? {});
  for (const m of raw.matchAll(/\{\{\s*custom_values\.[a-z0-9_]+\s*\}\}/gi)) tags.add(m[0]);
  // A locationId can also appear inside a URL (the review-widget case) rather than as a key.
  // The review widget is `/reputation/widgets/<widgetType>/<locationId>` — the id is NOT the segment
  // straight after `widgets/`, and media is `/msgsndr/<locationId>/...`. Both were observed carrying
  // the SOURCE account's id after a clone.
  for (const m of raw.matchAll(/\/reputation\/widgets\/[A-Za-z0-9_-]+\/([A-Za-z0-9]{20,24})\b/g)) locations.add(m[1]);
  const mediaLocations = new Set();
  for (const m of raw.matchAll(/\/msgsndr\/([A-Za-z0-9]{20,24})\b/g)) { locations.add(m[1]); mediaLocations.add(m[1]); }

  return { pageId, pageName, headline, refs, tags: [...tags], locations: [...locations],
    mediaLocations: [...mediaLocations], popupsDefined: [...popupsDefined] };
}

/** Turn scans + what the account actually holds into findings. Pure — no network, fully testable. */
export function judge({ scans, known, locationId }) {
  const seen = new Map();
  const findings = [];
  // The same broken binding repeated across a page is ONE defect to fix, not N. Collapse to a
  // single finding carrying an occurrence count: a report of 424 rows is a report nobody reads.
  const add = (f) => {
    const key = `${f.pageId}|${f.check}|${f.prop ?? ''}|${f.value ?? ''}`;
    const hit = seen.get(key);
    if (hit) { hit.occurrences += 1; return; }
    const rec = { ...f, occurrences: 1 };
    seen.set(key, rec);
    findings.push(rec);
  };

  for (const s of scans) {
    const localPopups = new Set(s.popupsDefined);
    for (const r of s.refs) {
      if (r.cls === 'sentinel') continue;                       // never an id; flagging it is noise
      const ph = placeholderKind(r.value);

      if (r.cls === 'page-local') {
        if (ph) continue;                                       // an empty popup binding is not a defect
        if (!localPopups.has(r.value)) {
          add({ severity: 'medium', check: 'page-local-references', prop: r.prop, value: r.value,
            pageId: s.pageId, pageName: s.pageName,
            detail: `${r.prop} points at a popup that is not defined on this page` });
        }
        continue;
      }

      const source = REF_SOURCE[r.prop];
      if (!source || !known[source]) {
        add({ severity: 'unknown', check: 'dangling-references', prop: r.prop, value: r.value,
          pageId: s.pageId, pageName: s.pageName, notChecked: true,
          detail: `no account list is available for ${r.prop}, so this reference was NOT checked` });
        continue;
      }
      if (ph) {
        add({ severity: 'high', check: 'dangling-references', prop: r.prop, value: r.value,
          text: r.text, pageId: s.pageId, pageName: s.pageName, placeholder: ph,
          detail: ph === 'empty'
            ? `${r.prop} is empty/"none" — the element renders an error where the ${source.replace(/s$/, '')} should be`
            : `${r.prop} still holds an unsubstituted template placeholder` });
        continue;
      }
      if (!known[source].has(r.value)) {
        add({ severity: 'high', check: 'dangling-references', prop: r.prop, value: r.value,
          text: r.text, pageId: s.pageId, pageName: s.pageName,
          detail: `${r.prop} points at a ${source.replace(/s$/, '')} that does not exist in this account`
            + (r.text ? ` — it displays as ${JSON.stringify(r.text)}, which is why this survives a visual check` : '') });
      }
    }

    for (const loc of s.locations) {
      if (loc === locationId) continue;
      // 🔴 A foreign id in a MEDIA url is normal and must not be repointed: GHL ships template
      // imagery from its own accounts' media stores, and a naive "fix all foreign references" sweep
      // eats the site's pictures. Only a STRUCTURAL foreign id (a widget bound to another account,
      // a locationId in settings) is a clone defect.
      const media = s.mediaLocations?.includes(loc);
      add(media
        ? { severity: 'info', check: 'foreign-location', value: loc, pageId: s.pageId, pageName: s.pageName,
            media: true,
            detail: 'media is served from another account\'s store — NORMAL for template imagery. Do not repoint it; doing so removes the images.' }
        : { severity: 'high', check: 'foreign-location', value: loc, pageId: s.pageId, pageName: s.pageName,
            detail: 'page content is BOUND to another account (a widget or setting carrying a foreign locationId) — a clone that was never remapped' });
    }

    if (known.customValues) {
      for (const t of s.tags) {
        if (!known.customValues.has(normaliseTag(t))) {
          add({ severity: 'high', check: 'merge-tags', value: t, pageId: s.pageId, pageName: s.pageName,
            detail: 'merge tag references a custom value that does not exist — it renders as blank (an empty bullet, a missing heading), while every id on the page resolves' });
        }
      }
    }
  }
  return findings;
}

/** Checks that can only be made against what the server actually SERVES. Pure over the HTML. */
export function judgeRendered({ html, url, headline = null }) {
  const findings = [];
  if (/Unable to find form/i.test(html)) {
    findings.push({ severity: 'high', check: 'render', url,
      detail: 'the served page renders "Unable to find form" — lead capture is dead on this page' });
  }
  const preview = [...html.matchAll(/https?:\/\/app\.gohighlevel\.com\/v2\/preview\/[A-Za-z0-9]+/g)].map((m) => m[0]);
  if (preview.length) {
    findings.push({ severity: 'medium', check: 'render', url, count: preview.length,
      sample: [...new Set(preview)].slice(0, 3),
      detail: 'the served page links to app.gohighlevel.com/v2/preview/… — template-origin links that do not resolve for a visitor' });
  }
  // Rule 28: the generated schema block describes the PREVIOUS publish.
  //
  // Compare it against what is ON THE SERVED PAGE, never against the stored draft. A page pinned to
  // a published version serves that version, so a draft-vs-schema comparison reports "stale schema"
  // for a page whose schema is fine and whose DRAFT has simply moved on — two different findings
  // wearing one message. Asking "does the schema name something that is not on this page" needs no
  // headline at all and cannot confuse the two.
  const ldBlocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  const ld = ldBlocks.map((m) => m[1]).join(' ');
  if (ld) {
    const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const named = [...ld.matchAll(/"name"\s*:\s*"([^"]{4,120})"/g)].map((m) => m[1])
      .filter((n) => !/^HEADING \[/i.test(n));       // the generator's own element label, not copy
    const missing = [...new Set(named)].filter((n) => !bodyText.includes(n));
    if (missing.length) {
      findings.push({ severity: 'medium', check: 'render', url, names: missing.slice(0, 3),
        detail: `the schema.org JSON-LD describes copy that is not on this page (${missing.slice(0, 2).map((n) => JSON.stringify(n)).join(', ')}) — generated schema runs ONE PUBLISH BEHIND, so a search engine is reading the previous version` });
    }
  }
  return findings;
}

/** Rule 27: a pinned page serves its published version, so later writes are invisible. */
export function judgeVersions({ versions, pageId, pageName = null }) {
  const rows = Array.isArray(versions) ? versions : [];
  const liveIdx = rows.findIndex((v) => v.pageType === 'live');
  if (liveIdx <= 0) return [];   // never published (fallback regime), or pinned to the newest
  const secs = (v) => v?.updated_at?._seconds ?? 0;
  return [{ severity: 'medium', check: 'publish-state', pageId, pageName,
    draftsSincePublish: liveIdx, staleBySeconds: Math.max(0, secs(rows[0]) - secs(rows[liveIdx])),
    detail: `${liveIdx} draft(s) sit ahead of the published version — the public page is serving older content than the builder shows` }];
}

/** Rule 25: what a domain attach did to your paths. Pure, because the inline version shipped a
 *  false "drift" finding until a live run turned up a step carrying TWO routing rows. */
export function judgeRouting({ rows, steps, documentName = '', hasDomain = true }) {
  const findings = [];
  // 🔴 ROUTING ROWS DO NOT EXIST UNTIL A DOMAIN IS ATTACHED. Measured across 14 funnels on one
  // account: every funnel with no `domainId` had ZERO lookup rows, and the two with a domain had 20
  // and 14. The correlation is total.
  //
  // So on an unattached funnel the per-step check below has no evidence to reason from, and it used
  // to read that absence as "this step has NO routing row, so it 404s in public" at severity HIGH —
  // on EVERY step of EVERY funnel mid-build. A peer acted on 19 of those as urgent and lost a
  // detour to it. An absence that is guaranteed by the state of the account is not a finding.
  //
  // One `info` per DOCUMENT instead, which is the true and useful statement, said once rather than
  // once per step. The caller records this as a check that could not run.
  if (!hasDomain) {
    return [{ severity: 'info', check: 'routing', pageName: documentName,
      detail: 'no domain is attached to this funnel, so it has no routing rows and serves nothing in '
        + 'public yet. That is expected mid-build and says nothing about the steps — routing is '
        + 'materialised at attach time.' }];
  }
  const all = Array.isArray(rows) ? rows.filter((r) => !r.deleted) : [];
  // 🔴 A step can carry MORE THAN ONE live row — observed: one step holding `/upsell-8618` and
  // `/upsell`, same typeId, neither deleted. They serve as aliases. Keying a Map by typeId keeps
  // whichever came last and then reports drift against an arbitrary one.
  const byType = new Map();
  for (const r of all) {
    if (!byType.has(r.typeId)) byType.set(r.typeId, []);
    byType.get(r.typeId).push(r);
  }
  const paths = new Map();
  for (const r of all) paths.set(r.path, (paths.get(r.path) ?? 0) + 1);

  for (const st of steps ?? []) {
    const where = `${documentName} / ${st.name}`;
    if (!st.id) continue;                       // rule 24 reports this separately
    const mine = byType.get(st.id) ?? [];
    const served = mine.map((r) => r.path).join(', ');
    if (!mine.length) {
      findings.push({ severity: 'high', check: 'routing', pageName: where, value: st.url,
        detail: 'this step has NO routing row, so it 404s in public — a domain attach skips a step whose path is already held, and says nothing. '
          + `Repair: POST /funnels/lookup/create { type:'step', typeId:'${st.id}', path:'${st.url}', funnelId, locationId, domain }` });
    } else if (!mine.some((r) => r.path === st.url)) {
      findings.push({ severity: 'medium', check: 'routing', pageName: where, value: served,
        detail: `the step record says ${st.url} but NO routing row serves that path — the live route(s) are ${served}. `
          + 'An attach renamed it, or a path move updated only one side. Routing is materialised at attach time and NEVER '
          + 'recomputed from the step record, so re-saving the step will not fix this. '
          + `Repair: PUT /funnels/lookup/${mine[0]._id} { path: '${st.url}', pathLowercase: '${String(st.url).toLowerCase()}' }` });
    } else if (mine.length > 1) {
      findings.push({ severity: 'info', check: 'routing', pageName: where, value: served,
        detail: `${mine.length} routing rows point at this step and all serve as aliases; the step record matches ${st.url}` });
    }
  }
  for (const [p, n] of paths) if (n > 1) {
    findings.push({ severity: 'medium', check: 'routing', value: p,
      detail: `${n} routing rows share this path — only one can win and which is undefined` });
  }
  return findings;
}

/**
 * TWO checks against a page's own document — no network, no rendering.
 *
 * 1. UNCOMPILED ELEMENT. A section carries `general.sectionStyles`: a precompiled CSS string whose
 *    selectors are keyed by element id (`.hl_page-preview--content .image-3vpf_iQ2f0 …`). The
 *    PUBLIC renderer lays out from that string; a node's own `styles`/`mobileStyles` drive the
 *    BUILDER canvas only. So an element present in the tree with NO selector in its section's
 *    compiled CSS renders naked in public while looking correct in the builder, and every write
 *    that "fixes" it through node styles returns 201 and reads back exactly as written.
 *
 *    The way this happens in practice is CLONING: a copied element with a fresh id inherits none
 *    of the template's compiled rules. Observed live on a client rebuild 2026-09-10 — cloned footer
 *    links rendered as raw blue browser anchors beside identically-structured siblings, and cloned
 *    columns rendered not at all. 744 clone rules had to be written by hand across 19 pages.
 *
 * 2. MIRROR DIVERGENCE. A row can carry a nested `element` MIRROR of itself, and the renderer reads
 *    `row.element.child` rather than `row.child`. Pushing a new column id into `row.child` persists,
 *    reads back correct, and renders nothing. 257 mirrors were out of sync on one account.
 *
 * Both are the same shape as everything else on this rail: the write succeeds, the read-back agrees,
 * and the public page disagrees with both.
 */
export function judgeStyles({ pageData, pageId, pageName = null }) {
  const findings = [];
  for (const sec of pageData?.sections ?? []) {
    const css = String(sec?.general?.sectionStyles ?? '');
    const nodes = [];
    const walkNode = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.id && n.type) nodes.push(n);
      for (const c of n.child ?? []) walkNode(c);
      // the mirror's children are a separate subtree and are checked too
      for (const c of n.element?.child ?? []) walkNode(c);
    };
    for (const el of sec?.elements ?? []) walkNode(el);

    // A section with NO compiled CSS at all is a different (and louder) problem than one element
    // missing a rule — report it once rather than once per node.
    if (!css.trim()) {
      if (nodes.length) {
        findings.push({ severity: 'high', check: 'uncompiled-styles', pageId, pageName,
          value: sec.id, occurrences: nodes.length,
          detail: `section '${sec.id}' has ${nodes.length} element(s) and an EMPTY sectionStyles — the public `
            + 'renderer lays out from that string, so this whole section renders unstyled in public while the '
            + 'builder canvas (which uses node styles) looks correct' });
      }
      continue;
    }
    // ONLY nodes that carry styling INTENT. An element with no `styles`/`mobileStyles`/`wrapper` of
    // its own is meant to be unstyled, and having no compiled rule for it is correct rather than
    // broken — flagging those would put a finding on every minimal page and teach people to skim.
    // The signal is the CONTRADICTION: node styles that say one thing and compiled CSS that has
    // never heard of the element.
    // 🔴 DO NOT "TIGHTEN" THIS TO A SELF-SELECTOR MATCH, AND DO NOT NARROW IT TO DESCENDANT EITHER.
    // The id-presence test looks loose and the obvious refactor is to require a real `.<id>{` rule.
    // Two template-installed pages, from different sessions, counting self and descendant as
    // INDEPENDENT booleans (an element can have both, and classifying it as one OR the other is how
    // both of us got this wrong first time):
    //
    //   structural  row, col, column      SELF only — 105/105 on one page, zero descendant
    //   most leaves button, heading,      BOTH — 35/35 paragraph, 15/15 heading, 12/12 button,
    //               paragraph, image,            11/11 sub-heading, 10/10 image, 5/5 divider
    //               sub-heading, divider
    //   nav-menu                          DESCENDANT ONLY — no self-selector at all
    //   faq                               SELF ONLY — no descendant rule, beside leaves with both
    //   photo-video-gallery, social-icons NEITHER — and they render correctly
    //   blog                              NEITHER
    //
    // So depth is PER KIND and is not derivable from structural-vs-leaf. A `.<id>{` requirement
    // reports a healthy `nav-menu` as unstyled; a descendant-only requirement reports a healthy
    // `faq` as unstyled. Substring presence is the only test that survives both, precisely because
    // it does not care which depth the rule lives at.
    //
    // WHAT THIS DOES NOT CATCH, stated because a peer reasonably assumed otherwise. The question
    // asked here is "does this element have ANY compiled rule", implemented as id-presence, and the
    // rule that governs an element is often a DESCENDANT selector — `.image-<id> .image-container
    // img{width:180px}` rather than `.image-<id>` itself. That passes, correctly: the element has
    // rules. What it cannot see is a rule that exists and is WRONG — the same selector still saying
    // width:180px after a 3:1 banner was swapped for a square logo, which rendered it as tall as it
    // was wide. "Has a rule" is objective; "has the RIGHT rule" needs the author's intent, and
    // nothing in the document carries that. This check is for the CLONE case — styling intent with
    // zero compiled rules — and claims nothing further.
    const styled = (n) => [n.styles, n.mobileStyles, n.wrapper, n.mobileWrapper]
      .some((o) => o && typeof o === 'object' && Object.keys(o).length > 0);
    const naked = nodes.filter((n) => !css.includes(n.id) && styled(n));

    // A THIRD OUTCOME, not a binary. Two element kinds on a snapshot-installed page —
    // photo-video-gallery and social-icons — carry their own styles, have zero compiled rules, and
    // RENDER CORRECTLY (28 images, no breakage, no overflow at 1440 or 390). So "no rule" is not
    // always damage: a composite widget can carry styles that were never going to be compiled for
    // it, and the absence is then correct.
    //
    // The signal that separates them is whether EVERY instance of a type is uncompiled. One naked
    // heading beside compiled headings is a clone that lost its rules. A type with no compiled
    // instance anywhere on the page looks like the compiler having no emitter for it, which is a
    // different report and a much weaker claim. Reported at `info` and named as a lead, so a hit is
    // not automatically actionable — the caller still has to look.
    // KIND, not `type`. Every leaf carries the literal `type: 'element'` and the real discriminator
    // is `meta` (heading, sub-heading, paragraph, image, social-icons…). Grouping on `type` collapses
    // the entire leaf family into one bucket, so a single cloned heading beside compiled headings
    // gets averaged in with every other leaf and downgraded from damage to a lead — the exact
    // opposite of what this split is for. Caught by running it against real pages; grouping on
    // `type` reported 0 damage and 7 leads where the truth is the reverse.
    const kindOf = (n) => (n.type === 'element' ? (n.meta ?? 'element') : n.type);
    const byKind = new Map();
    for (const n of nodes) {
      if (!styled(n)) continue;
      const k = kindOf(n);
      const e = byKind.get(k) ?? { total: 0, naked: 0 };
      e.total += 1; if (!css.includes(n.id)) e.naked += 1;
      byKind.set(k, e);
    }
    // "Every instance of this kind is uncompiled" only means MISSING EMITTER when the section
    // compiles other kinds fine. If NOTHING in the section is compiled, that is systematic loss and
    // downgrading it to a lead is precisely backwards — which is what a live run showed: on
    // engine-built pages every heading and paragraph is uncompiled, and grouping alone reported
    // 0 damage and 7 leads when the truth is the reverse.
    // …and the reference has to be another LEAF. Structural nodes (row/col/column) are always
    // self-selected and always compile, so "something in this section compiled" is trivially true
    // and tells you nothing about whether leaf styling survived. Only a compiled LEAF proves the
    // section's leaf emitter works, which is what makes a single uncompiled leaf kind a missing
    // emitter rather than systematic loss.
    const leafKinds = new Set(nodes.filter((n) => n.type === 'element' && styled(n)).map(kindOf));
    const anyCompiled = [...byKind].some(([k, e]) => leafKinds.has(k) && e.naked < e.total);
    const noEmitter = anyCompiled
      ? new Set([...byKind].filter(([, e]) => e.total > 0 && e.naked === e.total).map(([t]) => t))
      : new Set();
    const damaged = naked.filter((n) => !noEmitter.has(kindOf(n)));

    if (noEmitter.size) {
      findings.push({ severity: 'info', check: 'uncompiled-styles', pageId, pageName,
        value: sec.id, occurrences: [...noEmitter].length, sample: [...noEmitter],
        detail: `${noEmitter.size} element TYPE(s) in section '${sec.id}' have styles and no compiled rule on `
          + 'ANY instance, which looks like the compiler having no emitter for that type rather than damage to '
          + 'a particular element. Composite widgets in this state have been observed rendering correctly, so '
          + 'this is a LEAD to check, not a defect — look at the rendered page before changing anything.' });
    }
    if (damaged.length) {
      const naked = damaged;
      findings.push({ severity: 'high', check: 'uncompiled-styles', pageId, pageName,
        value: sec.id, occurrences: naked.length,
        sample: naked.slice(0, 4).map((n) => `${kindOf(n)}:${n.id}`),
        detail: `${naked.length} element(s) in section '${sec.id}' carry their own styles but have NO selector `
          + 'in that section\'s compiled sectionStyles, so they render unstyled in public however correct they look in the '
          + 'builder. Usually a CLONE: a copied element gets a fresh id and inherits none of the template\'s '
          + 'rules. Fixing node styles/mobileStyles will NOT fix it — the compiled declaration has to be '
          + 'duplicated with the id substituted.' });
    }

    // 2. the mirror
    const mirrored = [];
    const walkMirror = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.element?.child)) {
        const own = (n.child ?? []).map((c) => c?.id).filter(Boolean).join(',');
        const mir = n.element.child.map((c) => c?.id).filter(Boolean).join(',');
        if (own !== mir) mirrored.push({ id: n.id, type: n.type, own, mir });
      }
      for (const c of n.child ?? []) walkMirror(c);
    };
    for (const el of sec?.elements ?? []) walkMirror(el);
    if (mirrored.length) {
      findings.push({ severity: 'high', check: 'mirror-divergence', pageId, pageName,
        value: sec.id, occurrences: mirrored.length,
        sample: mirrored.slice(0, 3).map((m) => `${m.type}:${m.id}`),
        detail: `${mirrored.length} node(s) in section '${sec.id}' carry a nested \`element\` mirror whose `
          + '`child` list differs from their own. The renderer reads the MIRROR, so a child added to '
          + '`node.child` alone persists, reads back correct, and renders nothing.' });
    }
  }
  return findings;
}
