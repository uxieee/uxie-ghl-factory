#!/usr/bin/env node
/**
 * Launchpad compiler — spec JSON in, built GHL Memberships course out.
 *
 *   GHL_TOKEN='eyJ...' node build-course.mjs <spec.json> [--dry-run]
 *   GHL_TOKEN='eyJ...' node build-course.mjs --delete <productId>
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadToken, assertHeadroom } from '../engine/auth.mjs';
import { GhlMembershipsApi } from '../engine/api.mjs';
import { buildCourse, previewCourseSpec } from '../engine/course-builder.mjs';
import { makeCliMembershipsGateway } from './cli-gateway.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const deleteIndex = args.indexOf('--delete');
const deleteTarget = deleteIndex === -1 ? null : args[deleteIndex + 1];
const specPath = args.find((arg) => !arg.startsWith('--') && arg !== deleteTarget);

async function main() {
  if (deleteIndex !== -1) return deleteCourse(deleteTarget);
  if (!specPath) {
    console.error('usage: GHL_TOKEN=... node build-course.mjs <spec.json> [--dry-run]');
    process.exit(1);
  }

  const absoluteSpecPath = resolve(specPath);
  const spec = JSON.parse(await readFile(absoluteSpecPath, 'utf8'));
  const preview = previewCourseSpec(spec);
  if (!preview.valid) {
    console.error(`Spec invalid:\n${preview.errors.map((error) => ` - ${error}`).join('\n')}`);
    process.exit(1);
  }
  const itemCount = preview.wouldCreate.counts.lessons
    + preview.wouldCreate.counts.quizzes
    + preview.wouldCreate.counts.assignments;
  console.log(`Spec OK. ${preview.wouldCreate.counts.chapters} chapter(s), ${itemCount} item(s). ~${preview.estimatedSeconds}s estimated.`);
  if (dryRun) {
    console.log('--dry-run: nothing sent.');
    return;
  }

  const { token, claims, secondsRemaining } = loadToken();
  assertHeadroom(token, preview.estimatedSeconds);
  console.log(`Token OK (user ${claims.userId}, ${secondsRemaining}s left)`);
  const locationId = spec.locationId || process.env.GHL_LOC;
  const gw = makeCliMembershipsGateway({ token, loc: locationId, uid: claims.userId });
  const report = await buildCourse({
    gw,
    spec,
    specDir: dirname(absoluteSpecPath),
    log: console.log,
  });

  console.log('\n--- verify ---');
  for (const check of report.verification.checks) {
    console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.title}${check.failed?.length ? `: ${check.failed.join(', ')}` : ''}`);
  }
  console.log(`\n${report.verification.problems ? `${report.verification.problems} PROBLEM(S)` : 'BUILD OK'}`);
  console.log(JSON.stringify(report.built, null, 2));

  if (!report.ok) {
    const reason = report.error?.message
      ?? `verification found ${report.verification.problems} problem(s)`;
    throw new Error(`Build stopped during ${report.failurePhase}: ${reason}`);
  }
  console.log(`\nOpen it: Memberships > Courses > Products > "${spec.course.title}"`);
  console.log(`Remove it: GHL_TOKEN=... node build-course.mjs --delete ${report.built.productId}`);
}

async function deleteCourse(productId) {
  if (!productId) {
    console.error('--delete needs a productId');
    process.exit(1);
  }
  const { token, claims } = loadToken();
  const gw = makeCliMembershipsGateway({ token, loc: process.env.GHL_LOC, uid: claims.userId });
  const api = new GhlMembershipsApi({ gw });
  await api.deleteProduct(productId);
  const remaining = await api.listProducts();
  const gone = !remaining.some((product) => product.id === productId);
  console.log(gone ? `Deleted ${productId}. Remaining: ${remaining.length}` : `WARNING: ${productId} still listed`);
  console.log('NOTE: offers and credential templates do NOT cascade — delete those separately.');
  process.exit(gone ? 0 : 1);
}

main().catch((error) => { console.error(`\n${error.message}`); process.exit(1); });
