// LIVE: get_snapshot_contents reads what a snapshot CARRIES, not what its source account could put in
// one (console bl-133: push_snapshot's remediation sent callers to that superset). Read-only. The
// agency's first snapshot is read; a ghost snapshot id is the control and must not come back as contents.
export async function runSnapshotContentsProof({ call, check, log = null }) {
  const subject = (s) => log?.subject?.(s);
  subject('list_snapshots');
  const ls = await call('list_snapshots', {});
  const snaps = Array.isArray(ls.data?.snapshots) ? ls.data.snapshots : (Array.isArray(ls.data) ? ls.data : []);
  check(ls.ok === true && snaps.length > 0, 'PRECONDITION: the agency has at least one snapshot to read', `${ls.code ?? ''} ${snaps.length}`);
  if (!snaps.length) return;
  subject('get_snapshot_contents');
  const c = await call('get_snapshot_contents', { snapshotId: snaps[0].id ?? snaps[0]._id });
  const total = c.data?.totalAssets ?? 0;
  const rowsOk = Object.values(c.data?.contents ?? {}).flat().every((row) => typeof row?.id === 'string' && 'name' in row);
  check(c.ok === true && total > 0 && rowsOk && Array.isArray(c.data?.emptyCategories),
    'get_snapshot_contents returns the snapshot\'s own rows ({id, name}) per category, empty categories named', JSON.stringify({ total, categories: c.data?.categories?.length, rowsOk }));
  const g = await call('get_snapshot_contents', { snapshotId: 'TESTCONFnoSuchSnap01' });
  check(g.ok === false, 'CONTROL: a ghost snapshot id is refused, never returned as empty contents', `${g.code} ${String(g.detail ?? '').slice(0, 120)}`);
  subject(false);
}
