// What a funnel page's version list says about what the public URL serves (fn-4, 2026-11-08). One function, used by build_funnel_page
// before its write and again after a verified publish (the read-back), so the note never describes a state the call has already changed.
// versions: get-versions rows, newest first ({version_id, pageType, updated_at: {_seconds}}).
// opts.justPublished: the version_id this call published. Only when the live row IS that version does the note say the publish took.
export function publishStateOf(versions, { justPublished = null } = {}) {
  const rows = Array.isArray(versions) ? versions : [];
  const liveIdx = rows.findIndex((v) => v.pageType === 'live');
  const newest = rows[0] ?? null;
  const pinnedTo = liveIdx >= 0 ? rows[liveIdx] : null;
  const secs = (v) => v?.updated_at?._seconds ?? 0;
  const publishTook = justPublished !== null && liveIdx >= 0 && pinnedTo.version_id === justPublished;
  const servingNote = publishTook
    ? `Verified after this call's publish: the public URL serves version ${justPublished}, the one this call published.`
    : liveIdx >= 0
      ? 'This page is PINNED to a published version. The public URL serves that version, NOT the draft this call just wrote.'
      // Measured 2026-09-29 (knowledge sniffs/funnels-wave14-object-tools-2026-09-29 live-differential.first-version-live.json):
      // on a NEW page the SECOND autosave flipped the FIRST version to `live`, so "newest draft is served" lasted one
      // save. Older never-published pages were measured (2026-09-10) holding many drafts and no live version, so this
      // is not every page — but a caller must know it can happen on the very next write.
      : 'This page has never been published, so the public URL serves the draft this call just wrote. 🔴 On a new page GHL was measured turning the FIRST version live on the SECOND save; if it does here, the next write will not be public until a publish (publish:true). publishState on the next run shows which happened.';
  return {
    versions: rows.length,
    pinned: liveIdx >= 0,
    // Drafts stacked behind the pinned version: work the public cannot see.
    draftsSincePublish: liveIdx >= 0 ? liveIdx : null,
    staleBySeconds: liveIdx >= 0 ? Math.max(0, secs(newest) - secs(pinnedTo)) : null,
    servingNote,
  };
}
