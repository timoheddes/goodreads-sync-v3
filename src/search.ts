import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from './config.js';
import { logger } from './logger.js';
import { buildSearchQueries, isGoodMatch } from './match.js';

interface FlareSolverrResponse {
  status: string;
  message?: string;
  solution: { response: string; url: string };
}

async function flareSolverrGet(url: string): Promise<FlareSolverrResponse | null> {
  const response = await axios.post(
    config.flareSolverrUrl,
    { cmd: 'request.get', url, maxTimeout: 120000 },
    { timeout: 150000, validateStatus: () => true }
  );

  if (response.status !== 200) {
    logger.error({ status: response.status, url }, '[Search] FlareSolverr returned non-200');
    return null;
  }
  if (response.data?.status !== 'ok') {
    logger.error({ status: response.data?.status, message: response.data?.message, url }, '[Search] FlareSolverr status not ok');
    return null;
  }
  return response.data;
}

export interface AnnaMatch {
  domain: string;
  md5: string;
}

/**
 * Builds the query-string portion of an Anna's Archive search URL (the
 * bit between "search?" and the "&q=<query>" tail), from config. Pulled
 * out into its own pure function so a regression -- e.g. a language
 * filter silently creeping back in -- shows up as a failing unit test
 * instead of a mysteriously not-found book (see search.test.ts).
 *
 * Deliberately does NOT filter by language. It used to hardcode
 * lang=en&lang=fr&lang=nl (repeated params, same pattern Anna's Archive's
 * own search UI uses for its multi-select language filter), on the
 * assumption that narrowing to languages the user actually reads would
 * cut down on foreign-language noise. Confirmed via a real book
 * ("Japanese Gothic" by Kylie Lee Baker) that this backfires: Anna's
 * Archive's own UI lists the exact matching record as tagged "English
 * [en]", but applying the lang=en filter (in the UI, reproduced manually)
 * makes that same record disappear from the results entirely -- whatever
 * is going on internally, the filter doesn't reliably mean what its own
 * badges say. Since isGoodMatch never checked language anyway (only
 * title/author), the filter was pure narrowing with no correctness
 * benefit, and a demonstrated false-negative cost. See
 * config.maxSearchResultsToCheck, raised alongside this removal to absorb
 * the wider, unfiltered result set without losing the real match past the
 * cutoff.
 */
export function buildSearchParams(): string {
  const extParams = config.annasArchiveExtensions.map((ext) => `ext=${ext}`).join('&');
  return `search?index=&page=1&sort=&${extParams}&display=&q=`;
}

/**
 * Searches Anna's Archive for a book by query string, fuzzy-matching the top
 * results against the expected title/author. Returns EVERY matching
 * record's domain + md5 from the first domain that yields any match (not
 * just the first result) -- Anna's Archive commonly has multiple uploads/
 * scans of the same book under different md5s, and not every one of them
 * is actually fast-downloadable (confirmed via a real book where the top
 * match's md5 rejected every path/domain index combo, while a different
 * md5 for the same title worked fine). download.ts tries each candidate
 * in order until one resolves. Returns an empty array if nothing matched
 * anywhere.
 */
export async function findBookOnAnna(
  query: string,
  expectedTitle: string | null,
  expectedAuthor: string | null
): Promise<AnnaMatch[]> {
  const searchParams = buildSearchParams();

  for (const domain of config.annasArchiveDomains) {
    const searchUrl = `https://${domain}/${searchParams}${encodeURIComponent(query)}`;
    logger.info({ domain, searchUrl }, '[Search] Trying domain via FlareSolverr');

    let flareResult: FlareSolverrResponse | null;
    try {
      flareResult = await flareSolverrGet(searchUrl);
    } catch (err) {
      logger.error({ err, domain }, '[Search] FlareSolverr request failed');
      continue;
    }
    if (!flareResult) continue;

    const html = flareResult.solution.response;
    const $ = cheerio.load(html);

    const container = $('div.js-aarecord-list-outer');
    if (container.length === 0) {
      logger.warn({ domain }, '[Search] Results container not found -- page structure may have changed');
      continue;
    }

    const resultDivs = container.children('div');
    if (resultDivs.length === 0) {
      logger.info({ domain, query }, '[Search] No results found');
      continue;
    }

    const toCheck = Math.min(resultDivs.length, config.maxSearchResultsToCheck);
    const matches: AnnaMatch[] = [];
    // Kept at info level (not just the per-result debug line below) so a
    // "why didn't this match anything" question can be answered from the
    // default logs, without having to redeploy with LOG_LEVEL=debug first.
    const consideredResults: { title: string; author: string; titleScore: number }[] = [];

    for (let r = 0; r < toCheck; r++) {
      const el = $(resultDivs[r]);
      const resultTitle = el.find('a.js-vim-focus').first().text().trim();
      const authorLink = el.find('span[class*="icon-[mdi--user-edit]"]').closest('a');
      const resultAuthor = authorLink.text().trim();
      const md5Href = el.find('a[href^="/md5/"]').first().attr('href');

      if (!md5Href) continue;
      const md5Match = md5Href.match(/\/md5\/([a-fA-F0-9]+)/);
      if (!md5Match) continue;
      const md5 = md5Match[1];

      const match = isGoodMatch(expectedTitle, expectedAuthor, resultTitle, resultAuthor);
      consideredResults.push({ title: resultTitle, author: resultAuthor, titleScore: match.titleScore });
      logger.debug(
        { resultTitle, resultAuthor, titleScore: match.titleScore, isMatch: match.isMatch },
        `[Search] Result #${r + 1}/${toCheck}`
      );

      if (match.isMatch) {
        logger.info({ resultTitle, resultAuthor, domain, md5 }, '[Search] Match found');
        matches.push({ domain, md5 });
      }
    }

    if (matches.length > 0) {
      logger.info({ domain, count: matches.length }, '[Search] Collected candidate matches');
      return matches;
    }

    logger.info(
      { domain, expectedTitle, expectedAuthor, consideredResults },
      '[Search] No matching result on this domain'
    );
  }

  logger.info({ expectedTitle }, '[Search] Exhausted all domains -- book not found');
  return [];
}

/**
 * Entry point queue.ts actually calls. Wraps findBookOnAnna with the
 * query fallback ladder from buildSearchQueries: tries the most specific
 * query first and only falls back to a simpler one if that query comes
 * back with zero matches on every domain. Most books resolve on the first
 * (and only) query -- the fallback only costs extra FlareSolverr requests
 * for books that were already failing outright.
 */
export async function findBookOnAnnaWithFallback(
  title: string | null,
  author: string | null
): Promise<AnnaMatch[]> {
  const queries = buildSearchQueries(title, author);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const matches = await findBookOnAnna(query, title, author);
    if (matches.length > 0) {
      if (i > 0) {
        logger.info(
          { query, attempt: i + 1, of: queries.length, title, author },
          '[Search] Fallback query succeeded after a more specific query found nothing'
        );
      }
      return matches;
    }
  }

  if (queries.length > 1) {
    logger.info({ queries, title, author }, '[Search] All fallback queries exhausted -- book not found');
  }
  return [];
}
