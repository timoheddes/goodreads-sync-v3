import type { DigestBookRef, DigestContent } from './email.js';

/**
 * Decides whether a user has anything worth emailing about, from rows
 * already fetched from the DB. Pure and DB-free (unlike digest.ts, which
 * pulls in the whole repo/DB layer) so it can be unit tested directly --
 * same pattern as src/match.ts and src/backoff.ts. Returns null (skip
 * sending) if both lists are empty.
 */
export function buildDigestContent(
  found: DigestBookRef[],
  stillSearching: DigestBookRef[]
): DigestContent | null {
  if (found.length === 0 && stillSearching.length === 0) return null;
  return { found, stillSearching };
}
