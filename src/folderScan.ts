import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { isGoodMatch } from './match.js';
import { extractEpubMetadata, guessMetadataFromFilename, type BookMeta } from './epubMeta.js';
import {
  getPendingBooksForUser,
  getTrackedFilenamesForUser,
  insertManualBook,
  linkUserBook,
  markManualMatch,
} from './db/repo.js';
import type { users } from './db/schema.js';

type UserRow = typeof users.$inferSelect;

const RECOGNIZED_EXTENSIONS = new Set(['.epub', '.pdf', '.mobi', '.azw3', '.cbz', '.cbr']);

function extractMetadata(filePath: string, filename: string): BookMeta {
  if (path.extname(filename).toLowerCase() === '.epub') {
    const epubMeta = extractEpubMetadata(filePath);
    if (epubMeta) return epubMeta;
  }
  // Non-epub formats (PDF, mobi, cbz, ...) don't get real metadata extraction
  // yet -- fall back to parsing our own "Author - Title.ext" naming
  // convention, or just the filename stem if that pattern isn't present.
  return guessMetadataFromFilename(filename);
}

export interface FolderScanSummary {
  scanned: number;
  matched: number;
  added: number;
}

/**
 * Reconciles one user's download folder against the database: any
 * recognized ebook file that isn't already tracked either fulfills an
 * existing pending/not_found book (matched by title/author, same fuzzy
 * logic used for Anna's Archive results) or gets recorded as a new
 * manually-added book so it shows up in the dashboard instead of being
 * invisible to the app.
 */
export function scanUserFolder(user: UserRow): FolderScanSummary {
  const summary: FolderScanSummary = { scanned: 0, matched: 0, added: 0 };

  let entries: string[];
  try {
    entries = fs.readdirSync(user.downloadPath);
  } catch (err) {
    logger.warn({ err, user: user.name, path: user.downloadPath }, '[FolderScan] Could not read download folder');
    return summary;
  }

  const tracked = getTrackedFilenamesForUser(user.id);
  const pendingBooks = getPendingBooksForUser(user.id);

  for (const filename of entries) {
    const ext = path.extname(filename).toLowerCase();
    if (!RECOGNIZED_EXTENSIONS.has(ext)) continue;
    if (tracked.has(filename)) continue;

    const filePath = path.join(user.downloadPath, filename);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    summary.scanned++;
    const meta = extractMetadata(filePath, filename);

    // Pick the best-scoring pending/not_found book this file could fulfil, if any.
    let best: { id: number; titleScore: number } | null = null;
    for (const candidate of pendingBooks) {
      const result = isGoodMatch(candidate.title, candidate.author, meta.title ?? '', meta.author ?? '');
      if (result.isMatch && (!best || result.titleScore > best.titleScore)) {
        best = { id: candidate.id, titleScore: result.titleScore };
      }
    }

    if (best) {
      markManualMatch(best.id, filename, stat.mtime);
      summary.matched++;
      logger.info(
        { user: user.name, filename, bookId: best.id, titleScore: best.titleScore },
        '[FolderScan] Matched existing pending book'
      );
    } else {
      const book = insertManualBook({
        title: meta.title,
        author: meta.author,
        filePath: filename,
        foundAt: stat.mtime,
      });
      linkUserBook(user.id, book.id);
      summary.added++;
      logger.info(
        { user: user.name, filename, title: meta.title, author: meta.author },
        '[FolderScan] New manual book recorded'
      );
    }
  }

  return summary;
}

let scanRunning = false;

export function scanAllUserFolders(users: UserRow[]): void {
  if (scanRunning) {
    logger.warn('[FolderScan] Scan already running, skipping this trigger');
    return;
  }

  scanRunning = true;
  try {
    logger.info('[FolderScan] Starting folder scan...');
    let totalMatched = 0;
    let totalAdded = 0;

    for (const user of users) {
      const summary = scanUserFolder(user);
      totalMatched += summary.matched;
      totalAdded += summary.added;
      if (summary.scanned > 0) {
        logger.info({ user: user.name, ...summary }, '[FolderScan] User folder scanned');
      }
    }

    logger.info({ totalMatched, totalAdded }, '[FolderScan] Folder scan complete');
  } finally {
    scanRunning = false;
  }
}
