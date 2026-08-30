// SERVER:scripts/audit-report.mjs — the read-only health check.
//
// TWO TIERS, and the distinction is the whole point. The OFFLINE tier below runs on config and token
// claims alone: free, instant, no login. The ONLINE tier -- is this folder missing accounts its
// agency has? -- needs a LIVE credential per agency and cannot be done centrally, so it is the
// caller's job and every folder here is marked onlineChecked:false.
//
// Audit must never imply a folder is clean when it could not check it.

const parse = (raw) => (typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []);

export function auditOffline({ rows, tokenClaims }) {
  const folders = rows.map((r) => {
    const ids = parse(r.locationsRaw);
    const claim = r.tokenFile ? tokenClaims.get(r.tokenFile) : undefined;
    const flags = [];
    if (!ids.length) flags.push('unbound');
    if (r.legacyTokenFile) flags.push('legacy-token-file-env');
    if (r.legacyLocations) flags.push('legacy-locations-env');
    if (!r.tokenFile) flags.push('no-token-file-configured');
    else if (!claim || claim.error !== undefined) flags.push('credential-unreadable');
    else if (claim.secondsRemaining <= 0) flags.push('credential-expired');
    return { folder: r.folder, server: r.server, boundCount: ids.length, ids, flags, onlineChecked: false };
  });

  const owner = new Map();
  for (const f of folders) for (const id of f.ids) owner.set(id, [...(owner.get(id) ?? []), f.folder]);
  const overlaps = [...owner].filter(([, fs]) => fs.length > 1).map(([id, fs]) => ({ id, folders: fs }));

  return { folders, overlaps };
}

export function formatAudit(result) {
  const lines = ['OFFLINE AUDIT — config and token claims only.', ''];
  for (const f of result.folders) {
    lines.push(`  ${f.folder}`);
    lines.push(`      ${f.boundCount} account(s) bound${f.flags.length ? `   ⚠ ${f.flags.join(', ')}` : ''}`);
  }
  if (result.overlaps.length) {
    lines.push('', '  Reachable from more than one folder:');
    for (const o of result.overlaps) lines.push(`    ${o.id} -> ${o.folders.join('  +  ')}`);
  }
  lines.push('', '  NOT CHECKED against each agency: whether a folder is missing accounts, or is');
  lines.push('  bound to an id that no longer exists. That needs a live credential per agency.');
  return lines.join('\n');
}
