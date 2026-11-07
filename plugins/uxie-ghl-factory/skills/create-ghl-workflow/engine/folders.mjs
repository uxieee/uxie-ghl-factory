// W6 item 11: workflow folders for build-time placement. Folders are `type=directory` rows of the workflow list
// (`type=folder` silently answers an empty set); each row carries its parentId, so one complete walk gives the tree.
// GHL honours parentId on the create POST (live 2026-10-30, knowledge sniffs/workflows-w6b-2026-10-30/live-folders.json).
import { IRError } from './ir.mjs';

const FOLDER_PAGE = 100;   // the list endpoint's own bound
const MAX_FOLDER_PAGES = 100;

/** Every folder in the location, walked to a short page; a walk that cannot finish is an error, never a partial tree. */
export async function readAllFolders(call, loc) {
  const out = [];
  for (let page = 0; page < MAX_FOLDER_PAGES; page++) {
    const q = new URLSearchParams({ type: 'directory', limit: String(FOLDER_PAGE), offset: String(page * FOLDER_PAGE), sortBy: 'name', sortOrder: 'asc' });
    const r = await call('GET', `/workflow/${loc}/list?${q}`);
    if (!r?.ok) return { folders: null, error: `the folder list answered HTTP ${r?.status ?? '?'} on page ${page + 1}` };
    const rows = Array.isArray(r.json?.rows) ? r.json.rows : [];
    out.push(...rows.filter((x) => (x?.type ?? 'directory') === 'directory'));
    if (rows.length < FOLDER_PAGE) return { folders: out, error: null };
  }
  return { folders: null, error: `the folder list did not end within ${MAX_FOLDER_PAGES} pages` };
}

export function checkFolderPath(path, createIfMissing) {
  if (!Array.isArray(path) || path.length < 1 || path.length > 10 || path.some((s) => typeof s !== 'string' || !s.trim())) {
    throw new IRError('FOLDER_PATH', 'folderPath must be a list of 1–10 non-empty folder names, outermost first (e.g. ["Clients", "Acme"]).');
  }
  if (createIfMissing !== undefined && typeof createIfMissing !== 'boolean') throw new IRError('FOLDER_PATH', 'createFolderIfMissing must be true or false.');
}

/**
 * Resolve a folder path by EXACT name level by level from the root.
 * @returns {{ids: string[], missing: string[]}} ids of the levels that exist; the names that do not (from the first gap on)
 */
export function resolveFolderPath(folders, path) {
  const ids = [];
  let parent = null;
  for (let i = 0; i < path.length; i++) {
    const hits = folders.filter((f) => f.name === path[i] && (f.parentId ?? null) === parent);
    if (hits.length > 1) {
      throw new IRError('FOLDER_AMBIGUOUS', `FOLDER_AMBIGUOUS: ${hits.length} folders are named '${path[i]}' under ${parent ? `folder ${parent}` : 'the root'} `
        + `(${hits.map((h) => h._id ?? h.id).join(', ')}) — rename one, or file the workflow with move_workflows by id.`);
    }
    if (!hits.length) return { ids, missing: path.slice(i) };
    parent = hits[0]._id ?? hits[0].id;
    ids.push(parent);
  }
  return { ids, missing: [] };
}
