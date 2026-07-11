// Inbound-webhook merge tags. When an inbound_webhook trigger receives a JSON
// payload, GHL exposes every field as a merge tag `{{inboundWebhookRequest.<path>}}`
// (dot notation into nested objects, numeric index into arrays). Downstream steps —
// most importantly a Create/Update Contact step — reference these to map the payload
// onto contact fields. This flattens a SAMPLE payload into all available merge tags so
// an author/agent can wire them without hand-deriving the paths.
//
//   webhookMergeTags({ lead: { email: "a@b.com" }, dealRefId: "X" })
//     => { 'lead.email': '{{inboundWebhookRequest.lead.email}}',
//          'dealRefId':  '{{inboundWebhookRequest.dealRefId}}' }

const PREFIX = 'inboundWebhookRequest';

// Flatten a sample payload → { dotPath: mergeTag } for every leaf value.
export function webhookMergeTags(payload, { prefix = PREFIX, includeHeaders = false } = {}) {
  const out = {};
  const walk = (val, path) => {
    if (val !== null && typeof val === 'object') {
      if (Array.isArray(val)) val.forEach((v, i) => walk(v, path ? `${path}.${i}` : String(i)));
      else for (const [k, v] of Object.entries(val)) walk(v, path ? `${path}.${k}` : k);
    } else {
      out[path] = `{{${prefix}.${path}}}`;
    }
  };
  walk(payload, '');
  // `headers` is transport noise GHL includes but authors almost never map — drop by default
  if (!includeHeaders) for (const k of Object.keys(out)) if (k === 'headers' || k.startsWith('headers.')) delete out[k];
  return out;
}

// Convenience: the merge tag for one dot path (no sample needed).
export const mergeTag = (path, prefix = PREFIX) => `{{${prefix}.${path}}}`;

// Build create_update_contact `fields` mapping common contact attributes from a sample
// payload by best-effort key matching (email/phone/firstName/lastName/name). Returns the
// mapping + the full tag list so the author can override/extend.
export function contactFieldsFromWebhook(payload, overrides = {}) {
  const tags = webhookMergeTags(payload);
  // Prefer a lead-/contact-scoped path (the actual person) over an incidental email
  // elsewhere in the payload (e.g. an agent/broker signer).
  const rank = (p) => (/^(lead|contact)\./i.test(p) ? 0 : 1);
  const find = (...names) => {
    for (const n of names) {
      const hits = Object.keys(tags).filter((p) => p.toLowerCase().endsWith(n.toLowerCase())).sort((a, b) => rank(a) - rank(b));
      if (hits.length) return tags[hits[0]];
    }
    return undefined;
  };
  const fields = {};
  const email = overrides.email ?? find('email');
  const phone = overrides.phone ?? find('phone');
  const firstName = overrides.firstName ?? find('firstName', 'first_name');
  const lastName = overrides.lastName ?? find('lastName', 'last_name');
  if (email) fields.email = email;
  if (phone) fields.phone = phone;
  if (firstName) fields.firstName = firstName;
  if (lastName) fields.lastName = lastName;
  return { fields, allTags: tags };
}
