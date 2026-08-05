import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from './config.js';
import { logger } from './logger.js';
import { isGoodMatch } from './match.js';

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

/**
 * Searches Anna's Archive for a book by query string, fuzzy-matching the top
 * results against the expected title/author. Returns a download URL (the
 * fast_download API link if an API key is configured, otherwise the book's
 * detail page), or null if nothing matched.
 */
export async function findBookOnAnna(
  query: string,
  expectedTitle: string | null,
  expectedAuthor: string | null
): Promise<string | null> {
  const searchParams = 'search?index=&page=1&sort=&ext=epub&lang=en&lang=fr&lang=nl&display=&q=';

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
      logger.debug(
        { resultTitle, resultAuthor, titleScore: match.titleScore, isMatch: match.isMatch },
        `[Search] Result #${r + 1}/${toCheck}`
      );

      if (match.isMatch) {
        logger.info({ resultTitle, resultAuthor, domain }, '[Search] Match found');
        if (config.annasArchiveApiKey) {
          return `https://${domain}/fast_download/${md5}/0/0?key=${config.annasArchiveApiKey}`;
        }
        return `https://${domain}/md5/${md5}`;
      }
    }

    logger.info({ domain, expectedTitle, expectedAuthor }, '[Search] No matching result on this domain');
  }

  logger.info({ expectedTitle }, '[Search] Exhausted all domains -- book not found');
  return null;
}
