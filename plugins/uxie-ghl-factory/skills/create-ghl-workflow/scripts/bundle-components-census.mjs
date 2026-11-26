// READ-ONLY census of the bundle components OTHER than conversation_ai (QA 2026-11-22: Agent Studio was never read, so a published managed agent on
// contact_created / tag / form would fire on a test contact while both censuses read clean). One shared helper: convAiCensus calls it, and so both censuses
// and censusGate see it through convAiClean. Fail closed: a component that is missing, not complete, not a list, or unknown BLOCKS; so does an item whose
// detail was not read, an unknown trigger type, or an unreadable published / enabled flag. Item and trigger SHAPES are [inferred] from managed-agent-shape.md:60
// and 12-ai-agents-api.md:349 (13 slugs); no live bundle read of these two components is committed, so every shape surprise is a block, never a pass.

export const KNOWN_COMPONENTS = Object.freeze(['conversation_ai', 'voice_ai', 'agent_studio']);
// DEFAULT: every published AND enabled trigger blocks, whatever its type (orchestrator 2026-11-22: our proof runs create or touch contacts, appointments, opportunities,
// surveys and forms, and none was shown unreachable). An exemption exists ONLY per named run S, where that run's declared action set proves the type unreachable,
// and each one needs its own test. Zero exemptions today. Shape: { '<40-hex S>': { studio: ['<trigger type>'], convAi: ['<trigger type>'] } }.
export const RUN_EXEMPTIONS = Object.freeze({});
export const exempt = (runS, kind, type) => typeof runS === 'string' && /^[0-9a-f]{40}$/.test(runS) && Array.isArray(RUN_EXEMPTIONS[runS]?.[kind]) && RUN_EXEMPTIONS[runS][kind].includes(type);

// Shapes are the COMMITTED corpus, knowledge main corpus/ai-agents/10-anatomy/managed-agent-shape.md ("The record", lines 20-45; "Triggers", line 49): the detail is
// {id, status:"draft"|"published", hasPublishedVersion, hasUnpublishedChanges, versionId (the DRAFT's), config:{…, triggers:[{type,name,enabled:boolean,config,triggerMessage}]}}.
// The only clean "not live" read is status === 'draft' AND hasPublishedVersion === false (unpublish read-back, same page, line 96). Anything else is live or unknown and is judged.
export function judgeStudioAgent(item, plannedTags = [], runS = null) {
  const id = item?.id ?? item?._id ?? null;
  const base = { id, triggers: [] };
  const d = item?.detailRead === true ? item.detail : null;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ...base, blocks: true, why: 'detail unreadable' };
  if (d.status === 'draft' && d.hasPublishedVersion === false) return { ...base, blocks: false, why: 'not published (status draft, hasPublishedVersion false)' };
  const why = [];
  if (d.status !== 'published' && d.status !== 'draft') why.push('published state unreadable (status is neither draft nor published)');
  else if (d.status === 'draft') why.push('status draft but hasPublishedVersion is not false');
  else if (d.hasPublishedVersion !== true) why.push('status published but hasPublishedVersion is not exactly true: contradictory, so live-but-all-off cannot be shown');
  if (d.hasUnpublishedChanges !== false) why.push('hasUnpublishedChanges is not exactly false: the served config is the draft, not what is live');
  if ('triggers' in d) why.push('a top-level triggers key is present (the corpus shape keeps them in config.triggers)');
  const cfg = d.config && typeof d.config === 'object' && !Array.isArray(d.config) ? d.config : null;
  const rows = cfg && Array.isArray(cfg.triggers) ? cfg.triggers : null;
  if (rows === null) why.push('config.triggers unreadable');
  else for (const r of rows) {
    const type = typeof r?.type === 'string' ? r.type : null;
    const enabled = r?.enabled;
    base.triggers.push({ type, enabled: typeof enabled === 'boolean' ? enabled : null });
    if (typeof enabled !== 'boolean') { why.push(`${type ?? 'trigger'}: enabled flag missing or not a boolean`); continue; }
    if (enabled === false) continue;
    if (type === null) why.push('trigger without a type');
    else if (!exempt(runS, 'studio', type)) why.push(`${type} trigger is enabled (no exemption for this run)`);
  }
  return { ...base, blocks: why.length > 0, why: why.join('; ') || 'published, no unpublished changes, every trigger disabled' };
}
// Voice AI: NO committed detail shape carries a top-level outbound off switch, so every non-tombstone agent blocks until a committed live read names one exact field
// (then only that field === false may be clean: set VOICE_OFF_FIELD below, with its own test). A confirmed tombstone gets no detail call and cannot act.
export const VOICE_OFF_FIELD = null;
export function judgeVoiceAgent(item) {
  const id = item?.id ?? item?._id ?? null;
  if (item?.tombstone === true) return { id, blocks: false, why: 'soft-deleted tombstone' };
  const d = item?.detailRead === true ? item.detail : null;
  if (!d || typeof d !== 'object') return { id, blocks: true, why: 'detail unreadable' };
  if (VOICE_OFF_FIELD !== null && d[VOICE_OFF_FIELD] === false) return { id, blocks: false, why: `${VOICE_OFF_FIELD} is false` };
  return { id, blocks: true, why: 'no committed outbound-off field to read: an agent that may call is not proven inbound-only' };
}
const need = (name, comp) => {
  if (!comp || typeof comp !== 'object') return `${name}: component missing`;
  if (comp.complete !== true) return `${name}: component not complete`;
  if (!Array.isArray(comp.items)) return `${name}: items not a list`;
  return null;
};
// Agent Studio's list route (agents-with-folders) answers {items, folders, total, totalAgents, totalFolders, page, pageSize, hasMore} (committed shape, live read 2026-09-28). The bundle's
// agent_studio component carries only the rows (items) and the totals it saw (totalHistory / reportedTotal); it has NO folder count, and foldered agents may sit outside items. So this check
// ALWAYS needs the separate strict read (agent-studio-folders-read.mjs) as `proof`, folders or not: it clears the component only when the bundle total equals the rows, the proof read the same
// number of agents, and the proof's id union is exactly the judged set. No proof (no reader, no location, a failed read) blocks, the zero-agent case included. If the component ever does carry
// a totalFolders key it must agree with the proof.
const studioWhole = (comp, proof = null) => {
  if (!comp || !Array.isArray(comp.items)) return null;
  const hist = Array.isArray(comp.totalHistory) ? comp.totalHistory.filter((x) => x !== null && x !== undefined) : [];
  const total = hist.length ? hist[hist.length - 1] : comp.reportedTotal;
  if (!(Number.isInteger(total) && total === comp.items.length)) return `agent_studio: no reported total equal to the ${comp.items.length} row(s) read`;
  const proven = proof && proof.ok === true && proof.blocks === false && proof.totalAgents === total && proof.unionIds === total && Number.isInteger(proof.totalFolders)
    && (comp.totalFolders === undefined || comp.totalFolders === proof.totalFolders);
  return proven ? null : `agent_studio: the strict folders read did not prove the listed agents are the whole set (${proof?.reason ?? 'no folders read was made'})`;
};
// data = the get_ai_configuration_bundle data. Returns { ok, blocks, reason, studio:[…], voice:[…], unknownComponents:[…] }.
export function bundleComponentsCensus(data, plannedTags = [], runS = null, foldersProof = null) {
  const comps = data?.components && typeof data.components === 'object' ? data.components : null;
  if (!comps) return { ok: false, blocks: true, reason: 'bundle components unreadable', studio: [], voice: [], unknownComponents: [] };
  const unknownComponents = Object.keys(comps).filter((k) => !KNOWN_COMPONENTS.includes(k));
  const problems = [...unknownComponents.map((k) => `unknown component ${k}`), need('voice_ai', comps.voice_ai), need('agent_studio', comps.agent_studio), need('agent_studio', comps.agent_studio) ? null : studioWhole(comps.agent_studio, foldersProof)].filter(Boolean);
  const studio = Array.isArray(comps.agent_studio?.items) ? comps.agent_studio.items.map((i) => judgeStudioAgent(i, plannedTags, runS)) : [];
  const voice = Array.isArray(comps.voice_ai?.items) ? comps.voice_ai.items.map(judgeVoiceAgent) : [];
  const blocking = [...studio, ...voice].filter((a) => a.blocks);
  const reason = problems.length ? problems.join('; ') : blocking.length ? `${blocking.length} Agent Studio / Voice AI agent(s) can act without an inbound message` : null;
  return { ok: problems.length === 0, blocks: problems.length > 0 || blocking.length > 0, reason, studio, voice, unknownComponents };
}
export const bundleComponentsRecord = (c) => ({ ok: c.ok, blocks: c.blocks, reason: c.reason, unknownComponents: c.unknownComponents, studio: c.studio.map((a) => ({ id: a.id, type: 'agent_studio', blocks: a.blocks, why: a.why, triggers: a.triggers })), voice: c.voice.map((a) => ({ id: a.id, type: 'voice_ai', blocks: a.blocks, why: a.why })) });
