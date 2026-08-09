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
 */
function summarizeResponseBody(data: unknown, maxLength = 300): string {
  if (data === null || data === undefined || data === '') return '(empty body)';
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

/**
 * Resolves a matched book to an actual downloadable file URL using Anna's
 * Archive's documented member JSON API (/dyn/api/fast_download.json) --
 * NOT the /fast_download/{md5}/... HTML page, which is meant for browsers
 * and requires scraping a "Download now" link out of a page that also
 * contains plenty of other links (nav, account menu, etc.) matching naive
 * substring heuristics. This plain JSON call doesn't need FlareSolverr.
 */
async function resolveDownloadUrl(match: AnnaMatch): Promise<string> {
  if (!config.annasArchiveApiKey) {
    throw new Error('AA_API_KEY is not configured -- cannot resolve a download URL');
  }

  const apiUrl = `https://${match.domain}/dyn/api/fast_download.json?md5=${match.md5}&key=${config.annasArchiveApiKey}`;
  const response = await axios.get<FastDownloadResponse>(apiUrl, {
    timeout: 30000,
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    // Non-200 means something rejected the request before we even get to
    // a download_url/error field -- an invalid or quota-exhausted API key,
    // a stale md5, or a flaky front server on Anna's Archive's end are all
    // plausible. The response body (logged in full, truncated in the
    // thrown message so it fits in the books.last_error column) is the
    // only way to tell which.
    const bodySnippet = summarizeResponseBody(response.data);
    logger.error(
      { status: response.status, domain: match.domain, md5: match.md5, body: response.data },
      '[Download] fast_download.json returned a non-200 response'
    );
    throw new Error(`fast_download.json returned HTTP ${response.status}: ${bodySnippet}`);
  }
  if (!response.data?.download_url) {
    throw new Error(`fast_download.json error: ${response.data?.error || 'no download_url in response'}`);
  }

  logger.info({ downloadUrl: response.data.download_url }, '[Download] Resolved via fast_download.json API');
  return response.data.download_url;
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
