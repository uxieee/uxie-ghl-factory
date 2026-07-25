// SERVER:scripts/gen-manifest.mjs — emits TWO artefacts.
//
//   capability-manifest.json       the exact {tool,method,path} triples the docs repo's
//                                  coverage checker verifies against the capability matrix
//   audit-capability-manifest.json the audit profile's full policy manifest
//
// Both are COMPILED FROM source: `TOOLS` for the first, `core/audit-capabilities.mjs` for
// the second. Nothing is ever read back the other way. A manifest that could redefine policy
// would let a checked-in file widen the audit surface with no test and no descriptor change,
// which is the one direction of drift Task 7's receipts cannot survive.
//
// Importing this module has NO side effect. It used to write on import, which meant a test
// that merely inspected the generator rewrote a committed artefact as a side effect.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOLS } from '../core/tools.mjs';
import { AUDIT_CAPABILITIES } from '../core/audit-capabilities.mjs';
import { AUDIT_TOOL_NAMES, toolsForProfile } from '../core/audit-profile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const MANIFEST_PATH = resolve(ROOT, 'capability-manifest.json');
export const AUDIT_MANIFEST_PATH = resolve(ROOT, 'audit-capability-manifest.json');

// The tool capability rows have always spelled their path templates {loc}/{wid}; the audit
// descriptors spell the same routes {locationId}/{workflowId}. They address ONE route, so a
// naive textual "descriptor and row differ => fail" check would reject every audit capability
// that carries a path binding at all. The alias table IS the whole rule — an unknown
// placeholder is a hard failure rather than a silent pass-through, because a typo that
// matched nothing would otherwise read as a route the audit rail simply does not cover.
const PLACEHOLDER_ALIASES = Object.freeze({
  loc: 'locationId',
  locationId: 'locationId',
  wid: 'workflowId',
  workflowId: 'workflowId',
  agentId: 'agentId',
});

const manifestError = (code, detail) => {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
};

export function normalizeCapabilityPath(path) {
  return String(path).split('/').map((segment) => {
    if (!(segment.startsWith('{') && segment.endsWith('}'))) return segment;
    const name = segment.slice(1, -1);
    if (!Object.hasOwn(PLACEHOLDER_ALIASES, name)) {
      throw manifestError('AUDIT_MANIFEST_UNKNOWN_PLACEHOLDER',
        `unknown path placeholder {${name}} in ${path}`);
    }
    return `{${PLACEHOLDER_ALIASES[name]}}`;
  }).join('/');
}

// The descriptor fields a manifest row carries, plus `tool`. `repeatableQueryKeys` and
// `sealedBy` are here even though the plan's prose field list predates both: without
// `sealedBy` a reader cannot tell which discovery route may authorize a detail route, and
// without `repeatableQueryKeys` a future non-empty value could be introduced with no
// manifest diff to review. Either omission would let the artefact describe a WIDER surface
// than the gateway actually enforces.
const ROW_FIELDS = Object.freeze([
  'capabilityId', 'host', 'authRail', 'method', 'normalizedPath', 'pathBindings',
  'queryBindings', 'requiredQueryKeys', 'optionalQueryKeys', 'repeatableQueryKeys',
  'fixedQueryValues', 'allowedQueryValues', 'numericQueryBounds', 'locationBinding',
  'sealedBy',
]);

const LEGAL_HOST_RAILS = Object.freeze(['backend/backend', 'services/ai']);

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

// Hash the canonical manifest with `manifestHash` OMITTED, not blanked: a hash taken over a
// manifest that still contains its own placeholder could never be recomputed by a verifier.
export function auditManifestHash(manifest) {
  const { manifestHash: _omitted, ...rest } = manifest;
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(rest))).digest('hex')}`;
}

export function buildAuditManifest({ tools = toolsForProfile('audit'), descriptors = AUDIT_CAPABILITIES } = {}) {
  // Host/rail legality is a property of the DESCRIPTOR set, checked before any tool is
  // matched, so an illegal pair fails generation even for a capability no tool declares yet.
  for (const descriptor of descriptors) {
    const pair = `${descriptor.host}/${descriptor.authRail}`;
    if (!LEGAL_HOST_RAILS.includes(pair)) {
      throw manifestError('AUDIT_MANIFEST_ILLEGAL_HOST_RAIL',
        `${descriptor.capabilityId} declares ${pair}; only ${LEGAL_HOST_RAILS.join(' and ')} may carry audit credentials`);
    }
    // The DESCRIPTOR's method, not just the tool row's. `row.method` is copied from the
    // descriptor, so checking only the tool row would let a non-GET descriptor ship a
    // manifest that contradicts the profile's core claim — and Task 7 mints receipts
    // against that manifest's hash.
    if (descriptor.method !== 'GET') {
      throw manifestError('AUDIT_MANIFEST_METHOD_NOT_GET',
        `${descriptor.capabilityId} declares ${descriptor.method}; the audit profile is structurally read-only`);
    }
  }

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  // Missing is checked before forbidden: renaming an audit tool produces BOTH symptoms, and
  // "the registry lost a tool it must publish" is the more actionable of the two.
  for (const name of AUDIT_TOOL_NAMES) {
    if (!byName.has(name)) {
      throw manifestError('AUDIT_MANIFEST_TOOL_MISSING',
        `${name} is in the audit profile but absent from the tools handed to the generator`);
    }
  }
  const allowed = new Set(AUDIT_TOOL_NAMES);
  for (const tool of tools) {
    if (!allowed.has(tool.name)) {
      throw manifestError('AUDIT_MANIFEST_FORBIDDEN_TOOL',
        `${tool.name} is not in the audit allowlist and cannot appear in the audit manifest`);
    }
  }

  // Tool capability rows carry no host, so a row can only be bound to a descriptor by path.
  // That makes a path collision a silent last-wins rewrite: a second descriptor on the same
  // path would hand an existing tool row the WRONG host and the WRONG credential rail. The
  // map is therefore keyed on host+path and a collision is fatal.
  const byNormalizedPath = new Map();
  for (const descriptor of descriptors) {
    const path = normalizeCapabilityPath(descriptor.normalizedPath);
    if (byNormalizedPath.has(path)) {
      throw manifestError('AUDIT_MANIFEST_PATH_COLLISION',
        `${descriptor.capabilityId} and ${byNormalizedPath.get(path).capabilityId} both normalize to ${path}; a tool row could not be bound to one of them`);
    }
    byNormalizedPath.set(path, descriptor);
  }

  const capabilities = [];
  for (const name of AUDIT_TOOL_NAMES) {
    const tool = byName.get(name);
    for (const capability of tool.capabilities) {
      if (capability.method !== 'GET') {
        throw manifestError('AUDIT_MANIFEST_METHOD_NOT_GET',
          `${tool.name} declares ${capability.method} ${capability.path}; the audit profile is structurally read-only`);
      }
      const normalizedPath = normalizeCapabilityPath(capability.path);
      const descriptor = byNormalizedPath.get(normalizedPath);
      if (!descriptor) {
        throw manifestError('AUDIT_MANIFEST_DESCRIPTOR_MISMATCH',
          `${tool.name} declares ${normalizedPath}, which no audit descriptor enforces`);
      }
      // structuredClone so a caller can inspect or mutate a row without reaching back into
      // the deep-frozen descriptors — the artefact is data, the descriptors are policy.
      const row = { tool: tool.name };
      for (const field of ROW_FIELDS) row[field] = structuredClone(descriptor[field] ?? null);
      row.normalizedPath = normalizedPath;
      capabilities.push(row);
    }
  }

  const manifest = {
    schemaVersion: '1.0',
    profile: 'audit',
    proofModel: 'external_capability_receipts_v1',
    tools: [...AUDIT_TOOL_NAMES],
    capabilities,
    manifestHash: '',
  };
  manifest.manifestHash = auditManifestHash(manifest);
  return manifest;
}

export function buildCapabilityManifest(tools = TOOLS) {
  return tools.flatMap((t) => t.capabilities.map((c) => ({ tool: t.name, method: c.method, path: c.path })));
}

// Only write when run directly. `npm run manifest` regenerates both artefacts; importing this
// module for inspection must never touch a committed file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = buildCapabilityManifest();
  writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2) + '\n');
  console.log(`capability-manifest: ${entries.length} entries`);
  const auditManifest = buildAuditManifest();
  writeFileSync(AUDIT_MANIFEST_PATH, JSON.stringify(auditManifest, null, 2) + '\n');
  console.log(`audit-capability-manifest: ${auditManifest.capabilities.length} capability rows`);
}
