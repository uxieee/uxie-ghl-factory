/**
 * GHL Memberships internal-API client.
 * Every endpoint here is live-proven (see ../../BUILD-API.md + smoke-test.mjs).
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const BACKEND = 'https://backend.leadconnectorhq.com';

export class GhlMembershipsApi {
  constructor({ gw, log = console.log }) {
    if (!gw?.call) throw new Error('gw.call required');
    if (!gw.loc) throw new Error('gw.loc required');
    this.gw = gw;
    this.loc = gw.loc;
    this.userId = gw.uid;
    this.log = log;
    this.M = `${BACKEND}/membership/locations/${this.loc}`;
    this.C = `${BACKEND}/courses/locations/${this.loc}`;
    this.D = `${BACKEND}/assets-drm`;
  }

  async req(method, url, body, { raw = false } = {}) {
    const { base, path } = splitEndpoint(url);
    const response = await this.gw.call(method, path, body, {
      base,
      headers: { sourceid: this.loc }, // required — omitted in the day-1 capture doc
    });
    if (response.status === 401) {
      const error = new Error(`401 Unauthorized on ${method} ${url} — token expired or wrong sub-account. Re-mint (see engine/auth.mjs).`);
      error.gatewayResponse = response;
      throw error;
    }
    if (!response.ok) {
      const detail = typeof response.json === 'string' ? response.json : JSON.stringify(response.json);
      const error = new Error(`${response.status} on ${method} ${url}\n${detail.slice(0, 400)}`);
      error.gatewayResponse = response;
      throw error;
    }
    if (raw && typeof response.json !== 'string') return JSON.stringify(response.json);
    return response.json;
  }

  // ---------- product (course) ----------
  createProduct({ title, description = '' }) {
    return this.req('POST', `${this.M}/products`, { title, description });
  }
  getProduct(productId) {
    return this.req('GET', `${this.M}/products/${productId}`);
  }
  listProducts() {
    return this.req('GET', `${this.M}/products?doNotIncludeOffers=true&sendCustomizations=true`);
  }
  deleteProduct(productId) {
    return this.req('DELETE', `${this.M}/products/${productId}`);
  }

  // ---------- category (chapter/module) ----------
  createCategory({ title, productId, sequenceNo = 0, dripDays = 0, description = '',
                   parentCategory = null, visibility = 'published',
                   lockedBy = null, lockedByCategory = null }) {
    return this.req('POST', `${this.M}/categories`, {
      title, productId, visibility, sequenceNo, dripDays, description,
      parentCategory, posterImage: '', lockedBy, lockedByCategory,
      commentPermission: null, metadata: null,
    });
  }
  /** NOTE: returns a PARTIAL post projection (no post_materials / asset_urls). */
  getTree(productId) {
    return this.req('GET', `${this.M}/categories?product_id=${productId}&posts=true`);
  }

  // ---------- post (lesson) ----------
  /**
   * contentType is a CLOSED MySQL ENUM: video | audio | quiz | assignment,
   * or OMIT for a text-only lesson. 'text'/'embed'/'html'/'pdf' all 500.
   *
   * EMBEDS: pass `embed` = {src, width, height, allowFullScreen}. An embed lesson
   * is contentType 'video' + an `embedJson` object — NOT a separate content type.
   * You do NOT mint metaData.embedMediaId; the server generates it from embedJson.
   */
  createPost({ title, description = '', categoryId, productId, sequenceNo = 0,
               contentType = 'video', visibility = 'published',
               lockedByPost = null, lockedByCategory = null,
               certificateTemplateId = null, embed = null }) {
    const body = {
      title, description, categoryId, productId, visibility, sequenceNo,
      posterImage: null, commentStatus: 'visible',
      commentPermission: 'enabled', lockedByPost, lockedByCategory,
      certificateTemplateId,
      metaData: { embedMediaId: null },
      contentId: null,
    };
    if (contentType !== undefined && contentType !== null) body.contentType = contentType;
    if (embed) body.contentType = 'video';   // embeds ride on the video type
    return this.req('POST', `${this.M}/posts`, body);
  }

  /**
   * Attach an embed to an existing post.
   *
   * ⚠️ MUST BE A PUT. POST /posts silently DROPS `embedJson` — it returns 200 and
   * the post is created, but the embed is simply absent on read-back. Only the
   * full-replace PUT persists it. (Caught by build verification, not by status code.)
   *
   * The server then mints `metaData.embedMediaId` itself from embedJson — you do
   * NOT create that id, which is why no "embed media" endpoint exists.
   */
  async setEmbed(postId, embed) {
    const current = await this.getPost(postId);
    const body = { ...current };
    // strip read-only joins the PUT rejects / ignores
    delete body.video; delete body.post_materials; delete body.asset_urls;
    delete body.category; delete body.product;
    body.contentType = 'video';
    body.embedJson = {
      src: embed.src,
      width: String(embed.width ?? 640),
      height: String(embed.height ?? 360),
      allowFullScreen: embed.allowFullScreen !== false,
    };
    await this.req('PUT', `${this.M}/posts/${postId}`, body);
    return this.getPost(postId);
  }

  /** Parse a pasted <iframe …> into the embedJson shape the API wants. */
  static parseIframe(html) {
    const src = /src=["']([^"']+)["']/i.exec(html)?.[1];
    if (!src) throw new Error('could not find src="..." in the iframe snippet');
    return {
      src,
      width: /width=["']?(\d+)/i.exec(html)?.[1] ?? 640,
      height: /height=["']?(\d+)/i.exec(html)?.[1] ?? 360,
      allowFullScreen: /allowfullscreen/i.test(html),
    };
  }
  /** Full lesson detail — the ONLY read that includes post_materials + asset_urls. */
  getPost(postId) {
    return this.req('GET', `${this.M}/posts/${postId}`);
  }

  // ---------- media: video (4-step DRM rail) ----------
  async uploadVideo({ filePath, postId, title }) {
    this.assertLocalMediaGateway();
    const bytes = await readFile(filePath);
    const name = basename(filePath);
    const durationInSeconds = await probeDuration(filePath);

    const signed = await this.req('POST', `${this.D}/assets/signed-url/upload`,
      { source: 'courses', entityId: this.loc, type: 'videos', mimeType: 'video/mp4' });

    await this.putBytes(signed.signedUrl, bytes, 'video/mp4');

    const sourceEntityId = randomUUID();
    // gotcha: signed-url returns `path` WITHOUT a leading slash; this call wants one.
    const path = signed.path.startsWith('/') ? signed.path : `/${signed.path}`;
    const { licenseId } = await this.req('POST', `${this.D}/assets`, {
      asset: { sourceEntityId, sourceEntityType: 'videos', entityId: this.loc, entityType: 'Location' },
      path, source: 'courses', bucket: signed.bucket,
      assetType: 'video', name, durationInSeconds, contentType: 'video/mp4',
    });

    const video = await this.req('POST', `${this.M}/videos`, {
      url: `https://storage.googleapis.com/${signed.bucket}/${signed.path}`,
      title, postId, assetsLicenseId: licenseId, id: sourceEntityId,
    });
    return { video, licenseId };
  }
  transcodeStatus(licenseId) {
    return this.req('GET', `${this.D}/assets-license/${licenseId}/processing-status`);
  }

  // ---------- media: files (PDF etc) ----------
  async uploadMaterial({ filePath, postId, sequenceNo = 0, mimeType = 'application/pdf', type = 'pdf' }) {
    this.assertLocalMediaGateway();
    const bytes = await readFile(filePath);
    const filename = basename(filePath);
    const signed = await this.req('POST', `${this.M}/media/signed-url`,
      { filename, folder: 'courses', type: mimeType });
    await this.putBytes(signed.url, bytes, mimeType);
    // server normalises unsignedUrl -> a /memberships/... path on read
    return this.req('POST', `${this.M}/posts/material`,
      { url: signed.unsignedUrl, type, title: filename, sequenceNo, postId });
  }

  // ---------- offers (access control) ----------
  createOffer({ title, productIds, type = 'free', amount = 0, currency = 'EUR' }) {
    return this.req('POST', `${this.M}/offers`, {
      title, type, isLivePaymentMode: true, locationId: this.loc,
      productIds, amount, currency,
    });
  }

  // ---------- assessments ----------
  async createQuiz({ title, productId, categoryId, sequenceNo = 0 }) {
    const post = await this.createPost({ title, categoryId, productId, sequenceNo, contentType: 'quiz', visibility: 'draft' });
    const quiz = await this.req('POST', `${this.M}/assessments/quiz`, { title, postId: post.id, productId });
    return { post, quiz: quiz.quiz || quiz };
  }
  async createAssignment({ title, productId, categoryId, sequenceNo = 0 }) {
    const post = await this.createPost({ title, categoryId, productId, sequenceNo, contentType: 'assignment', visibility: 'draft' });
    const assignment = await this.req('POST', `${this.M}/assessments/assignment`, { title, postId: post.id, productId });
    return { post, assignment: assignment.assignment || assignment };
  }

  // ---------- theme ----------
  async applyTheme({ productId, templateId = 'NeoClassic', name = 'Course Theme', mutate }) {
    const base = `${this.C}/product-themes/${productId}`;
    const created = await this.req('POST', `${base}/`, {
      themeData: {}, productId, name, templateId,
      locationId: this.loc, userId: this.userId,
    });
    const themeId = created._id || created.id;
    const current = await this.req('GET', `${base}/theme/${themeId}`);
    const themeData = current.themeData || {};
    if (typeof mutate === 'function') mutate(themeData);
    await this.req('PUT', `${base}/theme/${themeId}`,
      { themeData, name, templateId, productId, locationId: this.loc });
    // REQUIRED second step — without this the course keeps its previous theme.
    await this.req('PUT', `${this.M}/products/apply-theme/${productId}?template_id=${templateId}`, {});
    return { themeId };
  }

  assertLocalMediaGateway() {
    if (this.gw.capabilities?.unauthenticatedRawUpload === true) return;
    const error = new Error(
      'Local media upload is unavailable on this gateway. Use the shipped build-course CLI on a machine with filesystem access and ffprobe.',
    );
    error.code = 'LOCAL_MEDIA_UNAVAILABLE';
    throw error;
  }

  /** Raw binary PUT to a signed GCS URL. The CLI gateway sends no app auth. */
  async putBytes(signedUrl, bytes, contentType) {
    this.assertLocalMediaGateway();
    const { base, path } = splitEndpoint(signedUrl);
    const response = await this.gw.call('PUT', path, bytes, {
      base,
      headers: { 'content-type': contentType },
      signedUpload: true,
    });
    if (!response.ok) {
      const detail = typeof response.json === 'string' ? response.json : JSON.stringify(response.json);
      const error = new Error(`GCS upload failed ${response.status}: ${detail.slice(0, 200)}`);
      error.gatewayResponse = response;
      throw error;
    }
  }
}

function splitEndpoint(value) {
  const url = new URL(value, BACKEND);
  return { base: url.origin, path: `${url.pathname}${url.search}` };
}

/** The DRM asset call requires durationInSeconds from the client. */
async function probeDuration(filePath) {
  try {
    const { stdout } = await execFileP('ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
    const d = Math.round(parseFloat(stdout.trim()));
    return Number.isFinite(d) && d > 0 ? d : 1;
  } catch {
    return 1; // ffprobe absent — GHL still accepts the upload, duration metadata is approximate
  }
}
