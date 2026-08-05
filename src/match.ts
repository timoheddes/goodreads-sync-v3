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
