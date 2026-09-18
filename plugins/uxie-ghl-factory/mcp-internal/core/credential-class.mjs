// WHICH CREDENTIAL CLASS IS THE CALLER? Reach is a function of (route, credential class): the same
// path answered 401 to a location-user Bearer and 200 to an agency-admin one. The catalogue records
// which NAMED classes reached a row (`provenFor`) and which were refused (`refusedFor`); this module
// names the caller the same way, so a result can say what the evidence means FOR THEM.
//
// The Bearer says only `authClass: 'User'`. The token-id beside it carries `type` (agency | account)
// and `role` (admin | user) — that pair is the class. The same rule is restated, for the prober, in
// knowledge/scripts/lib/reach-ledger.mjs (knowledge/ may not import plugin/); both test the vocabulary.
import { readCredentials, safeTokenIdClaims } from './auth.mjs';

export const CREDENTIAL_CLASSES = Object.freeze([
  'agency-admin-bearer', 'agency-user-bearer', 'location-admin-bearer', 'location-user-bearer', 'public-pit',
]);

/** {role, scope} as safeTokenIdClaims returns them -> the class, or null. Never a guess. */
export function credentialClassFromClaims(claims) {
  const scope = claims?.scope === 'agency' ? 'agency' : claims?.scope === 'account' ? 'location' : null;
  const role = claims?.role === 'admin' ? 'admin' : claims?.role === 'user' ? 'user' : null;
  return scope && role ? `${scope}-${role}-bearer` : null;
}

/** The caller's class off the token file, or null when it cannot be read. Never throws. */
export function callerCredentialClass(state) {
  try {
    const creds = readCredentials({ tokenFile: state?.tokenFile, allowExpired: true, legacyTokenFileEnv: state?.legacyTokenFileEnv });
    return creds.tokenId ? credentialClassFromClaims(safeTokenIdClaims(creds.tokenId)) : null;
  } catch { return null; }
}

/**
 * What a row's recorded reach means for ONE caller. Only three things can be said honestly:
 *   refused  — this very class was refused on it
 *   proven   — this very class reached it
 *   unproven-for-your-class — it was reached, but only by classes that are not the caller's
 * Anything else (no class on the row, or no class for the caller) returns null: silence, not a guess.
 */
export function reachForCaller(row, callerClass) {
  if (!callerClass) return null;
  if (row?.refusedFor?.includes(callerClass)) return 'refused';
  if (row?.provenFor?.includes(callerClass)) return 'proven';
  if (row?.provenFor?.length) return 'unproven-for-your-class';
  return null;
}
