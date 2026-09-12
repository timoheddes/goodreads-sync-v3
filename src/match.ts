/**
 * Fuzzy-matches Anna's Archive search results against the title/author we
 * expect from Goodreads. Ported from v2 with the logging pulled out so the
 * logic is unit-testable on its own (see match.test.ts) -- callers log the
 * returned MatchResult if they want visibility.
 */

/** Lowercase, strip parenthetical series info, punctuation, and extra whitespace. */
export function normalizeText(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\(.*?\)/g, '') // "(Culture, #3)"
    .replace(/:\s*a novel$/i, '') // ": A Novel"
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fraction of words from the shorter string that appear in the longer one, 0-1. */
export function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(normalizeText(a).split(' ').filter(Boolean));
  const wordsB = new Set(normalizeText(b).split(' ').filter(Boolean));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
  let matches = 0;
  for (const w of smaller) {
    if (larger.has(w)) matches++;
  }
  return matches / smaller.size;
}

export interface MatchResult {
  isMatch: boolean;
  titleScore: number;
  authorChecked: boolean;
  authorHit: boolean;
}

/**
 * Strips a title down to something worth typing into Anna's Archive's own
 * search box: parenthetical and bracketed asides (series annotations like
 * "(John Puller, #3)" or "[Book 2]"), plus a couple of common separator-
 * based series/volume suffixes that don't use brackets at all ("Title -
 * Book 3", "Title, Vol. 2"). This is deliberately narrower than
 * normalizeText -- it has to produce a still-readable query string, not a
 * lowercased comparison key, and a too-aggressive strip risks mangling a
 * title that legitimately ends in a number.
 *
 * Case in point: "De ontsnapping (John Puller #3)" is on Anna's Archive
 * under just "De ontsnapping" -- searching the full Goodreads title
 * (including the series annotation) returns nothing, even though the book
 * is there.
 */
export function sanitizeTitleForSearch(title: string): string {
  return title
    .replace(/[([][^)\]]*[)\]]/g, '') // "(...)" or "[...]"
    .replace(/\s*[,\-–—]?\s*(?:book|vol\.?|volume|#)\s*\d+\.?\s*$/i, '') // trailing ", Book 3" / "- Vol. 2" / "#3" with no brackets
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds an ordered list of search queries to try against Anna's Archive,
 * most specific first, stopping at whichever one actually turns up a
 * match (see findBookOnAnnaWithFallback in search.ts). Two attempts,
 * de-duplicated:
 *
 *   1. sanitized title + author -- the common case.
 *   2. sanitized title alone -- covers cases where the author field
 *      doesn't help or actively hurts: translated editions are often
 *      indexed under the translator rather than (or alongside) the
 *      actual author, which can bury the real result outside the top N
 *      candidates (maxSearchResultsToCheck) once the author name is
 *      folded into the query.
 *
 * Falls back to the raw, unsanitized title if sanitizing empties it out
 * entirely -- defensive, shouldn't normally happen.
 */
export function buildSearchQueries(title: string | null, author: string | null): string[] {
  const trimmedTitle = (title ?? '').trim();
  const cleanTitle = sanitizeTitleForSearch(trimmedTitle) || trimmedTitle;

  const queries = [[cleanTitle, author].filter(Boolean).join(' ').trim(), cleanTitle].filter(Boolean);

  return [...new Set(queries)];
}

const TITLE_MATCH_THRESHOLD = 0.7;

/**
 * A result is a good match if title word-overlap is >= 70%, and (when we
 * have an expected author) at least one significant part of their name
 * appears in the result's author field.
 */
export function isGoodMatch(
  expectedTitle: string | null,
  expectedAuthor: string | null,
  resultTitle: string,
  resultAuthor: string
): MatchResult {
  const titleScore = wordOverlap(expectedTitle ?? '', resultTitle);

  if (titleScore < TITLE_MATCH_THRESHOLD) {
    return { isMatch: false, titleScore, authorChecked: false, authorHit: false };
  }

  if (!expectedAuthor) {
    return { isMatch: true, titleScore, authorChecked: false, authorHit: false };
  }

  const expectedParts = normalizeText(expectedAuthor)
    .split(' ')
    .filter((w) => w.length > 2);
  const resultAuthorNorm = normalizeText(resultAuthor);
  const authorHit = expectedParts.some((part) => resultAuthorNorm.includes(part));

  return { isMatch: authorHit, titleScore, authorChecked: true, authorHit };
}
