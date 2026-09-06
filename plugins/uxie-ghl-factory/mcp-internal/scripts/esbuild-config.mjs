// Shared esbuild config for the bundled server, used by BOTH scripts/build.mjs (which
// writes dist/server.mjs) and test/bundle.test.mjs (which rebuilds-and-diffs). Keeping it
// in one place means the committed bundle and the sync-check can never disagree on defines.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const OUTFILE = resolve(ROOT, 'dist/server.mjs');
export const AUDIT_OUTFILE = resolve(ROOT, 'dist/audit-server.mjs');

// Values baked into the bundle at build time, because dist/ ships without a sibling
// package.json or the tool-description catalog:
//   __MCP_VERSION__  — the engine version (auth_status reports it)
//   __HAS_CATALOG__  — presence flag so tools.mjs reads the embedded catalog in the bundle
//                      and falls back to the co-located file in the un-bundled dev entry
//   __TOOL_CATALOG__ — the tool-description catalog, inlined as a JS object literal (raw
//                      JSON is a valid object-literal expression)
//   __HAS_ENDPOINTS__ / __ENDPOINT_CATALOG__
//                    — the same treatment for the internal ENDPOINT catalog, which was left out.
//                      The reasoning above was applied to tool-descriptions.json and simply never
//                      extended here, so the bundle only found the endpoint catalog when a sibling
//                      catalog/ happened to sit next to it. Proven by copying dist/server.mjs to a
//                      bare directory: search_endpoints returned "the internal endpoint catalog is
//                      missing or unreadable", with remediation pointing at a script in a
//                      knowledge/ repo the user does not have. The bundle test only called
//                      tools/list, so it passed the whole time.
function optionsFor(entry, extra = {}) {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const catalog = readFileSync(resolve(ROOT, 'tool-descriptions.json'), 'utf8');
  const endpoints = readFileSync(resolve(ROOT, 'catalog/internal-endpoints.json'), 'utf8');
  const overlay = readFileSync(resolve(ROOT, 'catalog/endpoint-overlay.json'), 'utf8');
  // Same treatment again for the contact filter-field catalogue: no endpoint serves it, the
  // contacts screen builds it in the browser, and check_smart_lists needs the static half to
  // tell an unknown field from a bad envelope. A bundle without it would silently stop making
  // that distinction.
  const filterFields = readFileSync(resolve(ROOT, 'catalog/contact-filter-fields.json'), 'utf8');
  return {
    entryPoints: [resolve(ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: {
      __MCP_VERSION__: JSON.stringify(pkg.version),
      __HAS_CATALOG__: 'true',
      __TOOL_CATALOG__: catalog,
      __HAS_ENDPOINTS__: 'true',
      __ENDPOINT_CATALOG__: endpoints,
      __ENDPOINT_OVERLAY__: overlay,
      __HAS_FILTER_FIELDS__: 'true',
      __CONTACT_FILTER_FIELDS__: filterFields,
    },
    logLevel: 'warning',
    ...extra,
  };
}

export function buildOptions(extra = {}) {
  return optionsFor('stdio.mjs', extra);
}

// The audit bundle is a SEPARATE artefact from a SEPARATE entry point, sharing only the
// defines. It is built and diffed by the same gates as the full bundle because a stale
// dist/audit-server.mjs could still carry a tool the source no longer registers — and the
// whole point of a structurally read-only profile is that the thing the plugin launches is
// the thing the tests checked.
export function auditBuildOptions(extra = {}) {
  return optionsFor('stdio-audit.mjs', extra);
}
