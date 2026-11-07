// W6 item 10: workflow search over list_workflows' COMPLETE walk — folder, statuses, updated range, author, id list,
// sort, an exact total and a cursor. Shaped after GHL's public workflow search (filters + sort + limit/offset + total),
// which is allow-listed and refused on our accounts; computed client-side, the total is exact because the walk it reads
// is complete-or-refused. A row's folder is its `parentId` (null at the root).
import { createHash } from 'node:crypto';
import { ROSTER_STATUS_VALUES } from './audit-configuration.mjs';

export const SEARCH_SORT_FIELDS = Object.freeze(['name', 'updatedAt', 'createdAt']);
export const SEARCH_KEYS = Object.freeze(['folderId', 'statuses', 'updatedAfter', 'updatedBefore', 'updatedBy', 'ids', 'sort', 'limit', 'cursor']);

const time = (v, name) => {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error(`${name} must be an ISO date-time (e.g. 2026-10-01T00:00:00Z)`);
  return t;
};

// The cursor binds the filter it was made for, so a cursor replayed against another filter is refused, not mis-applied.
const filterKey = (o) => createHash('sha256').update(JSON.stringify([o.folderId ?? null, o.statuses ?? null, o.updatedAfter ?? null,
  o.updatedBefore ?? null, o.updatedBy ?? null, o.ids ?? null, o.sort ?? null])).digest('hex').slice(0, 12);

export function searchWorkflowRoster(rows, opts = {}) {
  const { folderId, statuses, updatedAfter, updatedBefore, updatedBy, ids, sort, limit, cursor } = opts;
  if (statuses?.some((s) => !ROSTER_STATUS_VALUES.includes(s))) throw new Error(`statuses must be from ${ROSTER_STATUS_VALUES.join(', ')}`);
  if (sort?.field !== undefined && !SEARCH_SORT_FIELDS.includes(sort.field)) throw new Error(`sort field must be one of ${SEARCH_SORT_FIELDS.join(', ')}`);
  if (sort?.direction !== undefined && !['asc', 'desc'].includes(sort.direction)) throw new Error('sort direction must be asc or desc');
  const after = updatedAfter !== undefined ? time(updatedAfter, 'updatedAfter') : null;
  const before = updatedBefore !== undefined ? time(updatedBefore, 'updatedBefore') : null;
  const want = ids?.length ? new Set(ids) : null;
  const wantStatus = statuses?.length ? new Set(statuses) : null;

  let out = rows.filter((w) => {
    if (folderId !== undefined && (folderId === 'root' ? w.parentId != null : w.parentId !== folderId)) return false;
    if (wantStatus && !wantStatus.has(w.status)) return false;
    const u = Date.parse(w.updatedAt);
    if (after !== null && !(u >= after)) return false;
    if (before !== null && !(u < before)) return false;
    if (updatedBy !== undefined && w.updatedBy !== updatedBy) return false;
    if (want && !want.has(w._id ?? w.id)) return false;
    return true;
  });
  const field = sort?.field ?? 'name';
  const dir = sort?.direction === 'desc' ? -1 : 1;
  const keyOf = (w) => (field === 'name' ? String(w.name ?? '').toLowerCase() : Date.parse(w[field]) || 0);
  out = out.map((w, i) => ({ w, i })).sort((a, b) => {
    const x = keyOf(a.w), y = keyOf(b.w);
    return (x < y ? -1 : x > y ? 1 : a.i - b.i) * (x === y ? 1 : dir);
  }).map((x) => x.w);

  const fk = filterKey(opts);
  let offset = 0;
  if (cursor !== undefined && cursor !== null) {
    const m = /^o(\d+)\.([0-9a-f]{12})$/.exec(String(cursor));
    if (!m) throw new Error('cursor is not one this tool issued');
    if (m[2] !== fk) throw new Error('cursor was issued for a different filter or sort — start again without a cursor');
    offset = Number(m[1]);
  }
  const total = out.length;
  const page = limit ? out.slice(offset, offset + limit) : out.slice(offset);
  const next = limit && offset + limit < total ? `o${offset + limit}.${fk}` : null;
  return { workflows: page, total, nextCursor: next };
}
