// READ-ONLY strict read of Agent Studio's agents-with-folders listing, to prove foldered agents are in the census's judged set (QA 2026-11-22: no tool returns that, and no core change).
// Shapes, both committed (live reads, 2026-09-28): the listing {items, folders, total, totalAgents, totalFolders, page, pageSize, hasMore} from
// GET /agent-studio/agents/agents-with-folders?...&productId=superagent, and a folder's members {agents[], total, page, pageSize, hasMore, traceId} from
// GET /agent-studio/super-agent/agents?locationId=&folderId= (default pageSize 25). Both are paged here to hasMore === false.
// Fail closed: a missing or non-boolean hasMore, a non-integer count, a page that is not the one asked for, the page cap, an unreadable folder, a members total that is not the ids read
// for that folder, or an id union that is not exactly totalAgents AND exactly the judged set all BLOCK. Ids only; no name is read into the result.
const ID = '[A-Za-z0-9_-]{6,64}';
export const LOCATION_RE = /^[A-Za-z0-9]{20}$/;
export const PAGE_SIZES = Object.freeze([25, 50, 100]);
export const FOLDERS_FENCES = (loc) => {
  if (typeof loc !== 'string' || !LOCATION_RE.test(loc)) throw new Error('refused locationId');
  return [
    new RegExp(`^/agent-studio/agents/agents-with-folders\\?locationId=${loc}&productId=superagent&page=[1-9][0-9]{0,2}&pageSize=(25|50|100)$`),
    new RegExp(`^/agent-studio/super-agent/agents\\?locationId=${loc}&folderId=${ID}&page=[1-9][0-9]{0,2}&pageSize=(25|50|100)$`),
  ];
};
export const MAX_PAGES = 40;
const ids = (rows) => (Array.isArray(rows) && rows.every((r) => r && typeof r === 'object' && typeof r.id === 'string' && new RegExp(`^${ID}$`).test(r.id)) ? rows.map((r) => r.id) : null);
// get(path) -> { ok, json }; judged = the ids the census judged (component items); returns { ok, blocks, reason, totalAgents, totalFolders, unionIds, folders }
export async function agentStudioFolders({ get, locationId, judged, pageSize = 100 }) {
  if (typeof locationId !== 'string' || !LOCATION_RE.test(locationId) || !PAGE_SIZES.includes(pageSize)) return { ok: false, blocks: true, reason: 'locationId or pageSize refused before any call' };
  const fences = FOLDERS_FENCES(locationId);
  // A failed read names its HTTP status and closed error code (never server text), so a 401 reads differently from a changed shape.
  const failure = (r) => (r?.ok === true ? '' : ` (read failed${Number.isInteger(r?.status) ? `, http ${r.status}` : ''}${typeof r?.code === 'string' && /^[A-Za-z0-9_]{2,40}$/.test(r.code) ? `, code ${r.code}` : ''})`);
  const ask = async (path) => { if (!fences.some((r) => r.test(path))) throw new Error('refused path'); return get(path); };
  const block = (reason, extra = {}) => ({ ok: false, blocks: true, reason, ...extra });
  try {
    const judgedSet = new Set(Array.isArray(judged) && judged.every((x) => typeof x === 'string') ? judged : []);
    if (!Array.isArray(judged) || judgedSet.size !== judged.length) return block('the judged id list is unreadable or has duplicates');
    const union = new Set(), folderIds = []; let totalAgents = null, totalFolders = null, page = 1, more = true;
    while (more) {
      if (page > MAX_PAGES) return block('page cap hit');
      const r = await ask(`/agent-studio/agents/agents-with-folders?locationId=${locationId}&productId=superagent&page=${page}&pageSize=${pageSize}`);
      const j = r?.ok === true ? r.json : null;
      if (!j || typeof j !== 'object' || Array.isArray(j) || !Array.isArray(j.items) || !Array.isArray(j.folders) || !Number.isInteger(j.totalAgents) || !Number.isInteger(j.totalFolders) || typeof j.hasMore !== 'boolean' || j.page !== page) return block(`page ${page}: not the {items, folders, totalAgents, totalFolders, page, hasMore:boolean} envelope${failure(r)}`);
      if (totalAgents !== null && (j.totalAgents !== totalAgents || j.totalFolders !== totalFolders)) return block('the totals moved during the walk');
      totalAgents = j.totalAgents; totalFolders = j.totalFolders;
      const a = ids(j.items), f = ids(j.folders);
      if (a === null || f === null) return block(`page ${page}: an item or folder has no readable id`);
      for (const id of a) union.add(id);
      for (const id of f) if (!folderIds.includes(id)) folderIds.push(id);
      more = j.hasMore; page += 1;
    }
    if (folderIds.length !== totalFolders) return block(`folders read ${folderIds.length} differ from totalFolders ${totalFolders}`, { totalAgents, totalFolders });
    for (const fid of folderIds) {
      const mine = new Set(); let mp = 1, mmore = true;
      while (mmore) {
        if (mp > MAX_PAGES) return block('a folder members page cap hit', { totalAgents, totalFolders });
        const r = await ask(`/agent-studio/super-agent/agents?locationId=${locationId}&folderId=${fid}&page=${mp}&pageSize=${pageSize}`);
        const j = r?.ok === true && r.json && typeof r.json === 'object' && !Array.isArray(r.json) ? r.json : null;
        const m = j && Array.isArray(j.agents) && Number.isInteger(j.total) && typeof j.hasMore === 'boolean' && j.page === mp ? ids(j.agents) : null;
        if (m === null) return block(`a folder members page ${mp} is not the {agents[], total, page, hasMore:boolean} envelope${failure(r)}`, { totalAgents, totalFolders });
        for (const id of m) mine.add(id);
        mmore = j.hasMore; mp += 1;
        if (!mmore && j.total !== mine.size) return block(`a folder's total ${j.total} differs from the ${mine.size} ids read`, { totalAgents, totalFolders });
      }
      for (const id of mine) union.add(id);
    }
    if (union.size !== totalAgents) return block(`id union ${union.size} differs from totalAgents ${totalAgents}`, { totalAgents, totalFolders });
    const missing = [...union].filter((id) => !judgedSet.has(id)).length, extra = [...judgedSet].filter((id) => !union.has(id)).length;
    if (missing || extra) return block(`the union and the judged set differ (${missing} not judged, ${extra} judged but not listed)`, { totalAgents, totalFolders });
    return { ok: true, blocks: false, reason: null, totalAgents, totalFolders, unionIds: union.size, folders: folderIds.length };
  } catch { return block('the read threw'); }
}
