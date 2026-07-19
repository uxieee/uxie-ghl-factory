/**
 * Credentials = certificates + badges (one object, `type` discriminates).
 * Service: backend…/certificates/locations/{loc}/*
 *
 * All EXECUTED-proven (captures/23-independent-verification.json), except the
 * AUTOMATIC course-completion trigger, which is not exposed here because it was
 * never captured — see `linkToLesson()` for what is and isn't known.
 */

const BACKEND = 'https://backend.leadconnectorhq.com';

export class Credentials {
  constructor(api) {
    this.api = api;
    this.loc = api.loc;
    this.C = `${BACKEND}/certificates/locations/${api.loc}`;
  }
  req(...a) { return this.api.req(...a); }

  // ---------- templates ----------
  listTemplates({ skip = 0, limit = 50, search = '' } = {}) {
    return this.req('GET', `${this.C}/templates?skip=${skip}&limit=${limit}&search=${encodeURIComponent(search)}`);
  }

  /**
   * ⚠️ The single-template GET returns an ENVELOPE, not the bare object:
   *   { error, message, template: {...}, templateJson, templateHtml }
   * The list endpoint returns bare objects under `templates[]`, so the two reads
   * have DIFFERENT shapes for the same entity. This function normalises to the
   * template object and attaches the hydrated design payload (which the list omits).
   *
   * Caught by conformance.mjs — captures/20 originally documented the unwrapped
   * shape because the probe code silently did `body.template ?? body`.
   */
  async getTemplate(templateId) {
    const res = await this.req('GET', `${this.C}/templates/${templateId}`);
    const tpl = res.template ?? res;
    return { ...tpl, templateJson: res.templateJson, templateHtml: res.templateHtml };
  }

  /** The raw envelope, if you need `error`/`message`. */
  getTemplateRaw(templateId) {
    return this.req('GET', `${this.C}/templates/${templateId}`);
  }

  /**
   * ⚠️ The RESPONSE's `type` is "TEMPLATE_CREATED" — an EVENT NAME, not the
   * credential type. Read `type` from the list/get, never from this response.
   *
   * templateJson is a Fabric.js canvas doc: {version, objects[], backgroundMetadata, width, height}
   */
  createTemplate({ title, type = 'certificate', templateJson = {}, templateHtml = '' }) {
    if (!['certificate', 'badge'].includes(type)) {
      throw new Error(`credential type must be 'certificate' or 'badge', got ${type}`);
    }
    return this.req('POST', `${this.C}/templates`, {
      title, locationId: this.loc, templateJson, templateHtml, type,
      isFromLegacyBuilder: false,
    });
  }

  /** PATCH, not PUT. Each save appends to versionHistory (GCS-versioned, like themes). */
  saveTemplate(templateId, patch) {
    return this.req('PATCH', `${this.C}/templates/${templateId}`, patch);
  }

  deleteTemplate(templateId) {
    return this.req('DELETE', `${this.C}/templates/${templateId}`);
  }

  // ---------- issuance ----------
  /**
   * Issues AND emails in one call — there is no issue-without-email variant.
   * `recipient` (emails) and `contactIds` are PARALLEL ARRAYS; recipients must
   * already exist as contacts. `fromName` (UI: "Instructor Name") is REQUIRED.
   *
   * The UI's two-step warning dialog is cosmetic — the API needs only this POST.
   */
  issue({ templateId, certificateTitle, fromName, subject, recipients, contactIds, emailTemplateLabel = '' }) {
    const emails = Array.isArray(recipients) ? recipients : [recipients];
    const ids = Array.isArray(contactIds) ? contactIds : [contactIds];
    if (!fromName) throw new Error('fromName is required by sendCertificatesToMail');
    if (emails.length !== ids.length) {
      throw new Error(`recipients (${emails.length}) and contactIds (${ids.length}) are parallel arrays and must match`);
    }
    return this.req('POST', `${this.C}/registry/sendCertificatesToMail`, {
      fromName, subject, recipient: emails, contactIds: ids,
      emailTemplateLabel, templateId, certificateTitle,
    });
  }

  /**
   * ONE endpoint serves both Issued tabs — `type` discriminates.
   * Date range is MANDATORY and uses `+00:00` offset form, NOT `Z`.
   * Response key is always `issuedCertificates`, even for type=badge.
   */
  listIssued({ type = 'certificate', from, to, skip = 0, pageNumber = 1, limit = 20, search = '' } = {}) {
    const fromS = encodeURIComponent(from ?? isoDaysAgo(30));
    const toS = encodeURIComponent(to ?? isoEndOfToday());
    return this.req('GET',
      `${this.C}/registry?skip=${skip}&pageNumber=${pageNumber}&limit=${limit}` +
      `&search=${encodeURIComponent(search)}&startDate=${fromS}&endDate=${toS}&type=${type}`);
  }

  /** Issued credentials ARE deletable — unlike assessment submissions. */
  deleteIssued(issuedId) {
    return this.req('DELETE', `${this.C}/registry/${issuedId}`);
  }

  // ---------- automatic issuance (attachments) ----------
  /**
   * AUTO-ISSUE ON COMPLETION. This is the real mechanism — a course-level
   * ATTACHMENT, not the per-post `certificateTemplateId` field the docs first
   * guessed at. UI: course studio > Credentials > Attach Credential.
   *
   * @param {string} templateId
   * @param {string} productId
   * @param {'certificate'|'badge'} type
   * @param {'product_complete'} eventType
   */
  attach({ templateId, productId, type = 'certificate', eventType = 'product_complete' }) {
    return this.api.req('POST', `${this.api.M}/certificate-attachments`, {
      templateId,
      altId: productId,
      altType: 'product',
      eventType,
      productId,
      type,
    });
  }

  /**
   * Attachments on a product.
   * Rows carry {id, templateId, altId, altType, eventType, status, product, category}.
   * The presence of a `category` field implies module-level attachment is possible
   * (altType 'category') — NOT verified, so attach() only exposes product level.
   */
  listAttachments(productId, { skip = 0, limit = 10 } = {}) {
    return this.api.req('GET',
      `${this.api.M}/certificate-attachments/products/${productId}?skip=${skip}&limit=${limit}`);
  }
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d, endOfDay) {
  const t = endOfDay ? '23:59:59' : '00:00:00';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${t}+00:00`;
}
function isoDaysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return fmt(d, false); }
function isoEndOfToday() { return fmt(new Date(), true); }
