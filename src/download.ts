import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import axios, { type AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { config } from './config.js';
import { logger } from './logger.js';
import { sanitizeFilename } from './utils.js';

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

/**
 * Resolves a fast_download URL to the real file URL via FlareSolverr (the
 * intermediate page is itself behind Cloudflare), then streams the file to
 * a temp path. Returns the temp file path and detected extension.
 */
export async function downloadBook(
  url: string,
  bookInfo: { title: string | null; author: string | null }
): Promise<{ filePath: string; extension: string }> {
  const tempDir = path.join(path.dirname(config.dbPath), 'tmp');
  fs.mkdirSync(tempDir, { recursive: true });

  let finalUrl = url;

  if (url.includes('/fast_download/')) {
    logger.info('[Download] Resolving fast_download page via FlareSolverr...');
    const flareResponse = await axios.post(
      config.flareSolverrUrl,
      { cmd: 'request.get', url, maxTimeout: 120000 },
      { timeout: 150000, validateStatus: () => true }
    );

    if (flareResponse.status !== 200 || flareResponse.data?.status !== 'ok') {
      const msg = flareResponse.data?.message || flareResponse.data?.status || `HTTP ${flareResponse.status}`;
      throw new Error(`FlareSolverr failed to resolve fast_download page: ${msg}`);
    }

    const html = flareResponse.data.solution.response;
    const $ = cheerio.load(html);

    let downloadLink: string | null = null;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (
        href &&
        (href.includes('/dl/') || href.includes('cloudflare-ipfs') || href.includes('.epub') || href.includes('.pdf') || href.includes('download'))
      ) {
        if (!downloadLink) downloadLink = href;
      }
    });

    if (!downloadLink) {
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 500);
      logger.warn({ bodyText }, '[Download] Could not find download link in fast_download page');
      throw new Error('Could not extract download link from fast_download page');
    }

    if ((downloadLink as string).startsWith('/')) {
      const urlObj = new URL(url);
      downloadLink = `${urlObj.protocol}//${urlObj.host}${downloadLink}`;
    }
    finalUrl = downloadLink;
    logger.info({ finalUrl }, '[Download] Resolved download link');
  }

  logger.info('[Download] Starting stream download...');
  const response = await axios.get(finalUrl, {
    responseType: 'stream',
    timeout: 300000,
    maxRedirects: 10,
  });

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
