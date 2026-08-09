import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import axios, { type AxiosResponse } from 'axios';
import { config } from './config.js';
import { logger } from './logger.js';
import { sanitizeFilename } from './utils.js';
import type { AnnaMatch } from './search.js';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'application/epub+zip': '.epub',
  'application/epub': '.epub',
  'application/pdf': '.pdf',
  'application/x-mobipocket-ebook': '.mobi',
  'application/vnd.amazon.ebook': '.azw3',
  'application/x-cbz': '.cbz',
  'application/x-cbr': '.cbr',
  'application/zip': '.zip',
};

function getFileExtension(response: AxiosResponse): string {
  const disposition = response.headers['content-disposition'] as string | undefined;
  if (disposition) {
    const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (filenameMatch) {
      const filename = filenameMatch[1].replace(/['"]/g, '');
      const ext = path.extname(filename);
      if (ext) return ext;
    }
  }

  const contentType = response.headers['content-type'] as string | undefined;
  if (contentType) {
    for (const [type, ext] of Object.entries(EXTENSION_BY_CONTENT_TYPE)) {
      if (contentType.includes(type)) return ext;
    }
  }

  try {
    const urlPath = new URL(response.config.url ?? '').pathname;
    const ext = path.extname(urlPath);
    if (ext && ext.length <= 6) return ext;
  } catch {
    // ignore
  }

  return '.epub';
}

interface FastDownloadResponse {
  download_url?: string;
  error?: string;
}

/**
 * Condenses an axios response body down to a short, loggable/storable
 * string. The body isn't guaranteed to be the typed FastDownloadResponse
 * shape at runtime -- a non-200 can come back as JSON, plain text, or an
 * HTML error/interstitial page depending on what rejected the request
 * (Anna's Archive itself vs. a proxy/CDN in front of it) -- so this
 * handles whatever axios actually parsed rather than assuming.
 *
 * Anna's Archive's own error responses are self-documenting -- a rejected
 * request comes back with a `download_url`-shaped key whose value is an
 * array of explanatory sentences (API usage docs, then the specific
 * reason). That preamble alone runs past 300 characters, which is what
 * used to get cut off here before the actual reason ever appeared -- see
 * the 300-char version of this function in an earlier commit for what
 * that looked like. 1500 comfortably fits the whole thing while still
 * bounding a pathological case like a full HTML error page.
 */
function summarizeResponseBody(data: unknown, maxLength = 1500): string {
  if (data === null || data === undefined || data === '') return '(empty body)';
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

/**
 * path_index/domain_index identify which copy of a file to fetch -- per
 * Anna's Archive's own docs, domain_index picks the download server (e.g.
 * 0 = "Fast Partner Server #1") and path_index picks the collection, for
 * files present in more than one. Omitting both maps to (0, 0) server-side,
 * which is usually right -- but confirmed via a real failure that some
 * files simply aren't available at (0, 0) and the API rejects the request
 * with "Invalid domain_index or path_index" instead of falling back on its
 * own. These candidates are tried in order on that specific error; the
 * exact number of partner servers/collections isn't documented, so this is
 * a bounded best-effort sweep, not a guarantee.
 */
const FAST_DOWNLOAD_INDEX_CANDIDATES: Array<{ pathIndex: number; domainIndex: number }> = [
  { pathIndex: 0, domainIndex: 0 },
  { pathIndex: 0, domainIndex: 1 },
  { pathIndex: 0, domainIndex: 2 },
  { pathIndex: 1, domainIndex: 0 },
];

interface FastDownloadAttempt {
  downloadUrl?: string;
  errorMessage?: string;
  isInvalidIndexError: boolean;
}

async function attemptFastDownload(
  match: AnnaMatch,
  pathIndex: number,
  domainIndex: number
): Promise<FastDownloadAttempt> {
  const apiUrl =
    `https://${match.domain}/dyn/api/fast_download.json?md5=${match.md5}&key=${config.annasArchiveApiKey}` +
    `&path_index=${pathIndex}&domain_index=${domainIndex}`;
  const response = await axios.get<FastDownloadResponse>(apiUrl, {
    timeout: 30000,
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    validateStatus: () => true,
  });

  const apiError = typeof response.data === 'object' && response.data !== null ? response.data.error : undefined;

  if (response.status === 200 && response.data?.download_url) {
    return { downloadUrl: response.data.download_url, isInvalidIndexError: false };
  }

  const bodySnippet = summarizeResponseBody(response.data);
  const isInvalidIndexError = /invalid domain_index or path_index/i.test(apiError ?? bodySnippet);

  logger.warn(
    { status: response.status, pathIndex, domainIndex, domain: match.domain, md5: match.md5, body: response.data },
    '[Download] fast_download.json attempt failed'
  );

  const errorMessage =
    response.status !== 200
      ? `fast_download.json returned HTTP ${response.status}: ${bodySnippet}`
      : `fast_download.json error: ${apiError || 'no download_url in response'}`;

  return { errorMessage, isInvalidIndexError };
}

/**
 * Resolves a matched book to an actual downloadable file URL using Anna's
 * Archive's documented member JSON API (/dyn/api/fast_download.json) --
 * NOT the /fast_download/{md5}/... HTML page, which is meant for browsers
 * and requires scraping a "Download now" link out of a page that also
 * contains plenty of other links (nav, account menu, etc.) matching naive
 * substring heuristics. This plain JSON call doesn't need FlareSolverr.
 *
 * Tries FAST_DOWNLOAD_INDEX_CANDIDATES in order, but only keeps going past
 * the first one if the failure is specifically the "invalid index" error --
 * any other rejection (bad key, exhausted quota, book genuinely
 * unavailable) will fail identically at every index, so there's no point
 * spending 4 requests to learn that once would have told us.
 */
async function resolveDownloadUrl(match: AnnaMatch): Promise<string> {
  if (!config.annasArchiveApiKey) {
    throw new Error('AA_API_KEY is not configured -- cannot resolve a download URL');
  }

  let lastErrorMessage = 'fast_download.json failed for an unknown reason';

  for (const { pathIndex, domainIndex } of FAST_DOWNLOAD_INDEX_CANDIDATES) {
    const attempt = await attemptFastDownload(match, pathIndex, domainIndex);

    if (attempt.downloadUrl) {
      logger.info(
        { downloadUrl: attempt.downloadUrl, pathIndex, domainIndex },
        '[Download] Resolved via fast_download.json API'
      );
      return attempt.downloadUrl;
    }

    lastErrorMessage = attempt.errorMessage ?? lastErrorMessage;
    if (!attempt.isInvalidIndexError) break;
  }

  throw new Error(lastErrorMessage);
}

/**
 * Streams a matched book to a temp path. Returns the temp file path and
 * detected extension. Refuses to save anything that comes back as HTML --
 * that's what an error/interstitial page looks like, never a real ebook,
 * and saving it anyway (mislabeled with a guessed extension) is exactly
 * what caused corrupted "downloads" before this function existed.
 */
export async function downloadBook(
  match: AnnaMatch,
  bookInfo: { title: string | null; author: string | null }
): Promise<{ filePath: string; extension: string }> {
  const tempDir = path.join(path.dirname(config.dbPath), 'tmp');
  fs.mkdirSync(tempDir, { recursive: true });

  const finalUrl = await resolveDownloadUrl(match);

  logger.info('[Download] Starting stream download...');
  const response = await axios.get(finalUrl, {
    responseType: 'stream',
    timeout: 300000,
    maxRedirects: 10,
    headers: { 'User-Agent': BROWSER_USER_AGENT },
  });

  const contentType = (response.headers['content-type'] as string | undefined) ?? '';
  if (contentType.includes('text/html')) {
    throw new Error(`Download URL returned HTML instead of a file (content-type: ${contentType}) -- refusing to save`);
  }

  const extension = getFileExtension(response);
  const safeTitle = sanitizeFilename(`${bookInfo.author || 'Unknown'} - ${bookInfo.title || 'Unknown'}`);
  const tempPath = path.join(tempDir, `${safeTitle}${extension}`);

  const writer = fs.createWriteStream(tempPath);
  await pipeline(response.data, writer);

  const stats = fs.statSync(tempPath);
  logger.info({ sizeMb: (stats.size / 1024 / 1024).toFixed(2), tempPath }, '[Download] Completed');

  if (stats.size < 1024) {
    const content = fs.readFileSync(tempPath, 'utf-8');
    fs.unlinkSync(tempPath);
    throw new Error(`Downloaded file too small (${stats.size} bytes), likely an error page: ${content.substring(0, 300)}`);
  }

  return { filePath: tempPath, extension };
}
