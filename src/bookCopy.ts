import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { sanitizeFilename } from './utils.js';
import { RECOGNIZED_EXTENSIONS } from './ebookExtensions.js';
import type { books } from './db/schema.js';

type BookRow = typeof books.$inferSelect;

// Deliberately narrower than the full users row -- getUsersForBook (the
// caller in both queue.ts and rss.ts) only selects id/name/downloadPath/
// email, not the whole row, and this module only ever needs id/name/
// downloadPath anyway.
export interface UserFolderInfo {
  id: number;
  name: string;
  downloadPath: string;
}

export interface ExistingCopy {
  user: UserFolderInfo;
  filename: string;
}

/**
 * Looks for a copy of `book` that's already sitting on disk in one of
 * `candidateUsers`' download folders, so it can be copied over instead of
 * spending an Anna's Archive search/download on it.
 *
 * Two cases, both exact-filename matches only -- deliberately not a fuzzy
 * title/author match against arbitrary files (that's what folderScan.ts's
 * isGoodMatch does *within* one user's own folder; this is scoped much more
 * narrowly, to avoid ever copying the wrong book/edition into someone's
 * library):
 *
 *   1. The book is already marked `downloaded` (filePath is the exact,
 *      known filename this app itself gave it). This is the common case: a
 *      user's Goodreads shelf sync just linked them to a book another user
 *      already has (see rss.ts). Once a book is `downloaded`, the queue
 *      never revisits it (getNextEligibleBook only considers
 *      pending/not_found rows), so a newly-linked user would otherwise
 *      never get a copy at all.
 *   2. The book is still `pending`/`not_found` (no filePath yet), but a
 *      copy from an earlier download might still be sitting in a linked
 *      user's folder -- e.g. the dashboard's "retry" button
 *      (requeueBooks) resets the DB row back to pending without deleting
 *      any files it already copied out. Falls back to the same
 *      deterministic "`Author - Title`.ext" filename queue.ts itself uses
 *      when it downloads a book, checked against every recognized ebook
 *      extension.
 */
export function findExistingCopyForBook(book: BookRow, candidateUsers: UserFolderInfo[]): ExistingCopy | null {
  const candidateFilenames = book.filePath
    ? [book.filePath]
    : (() => {
        const safeTitle = sanitizeFilename(`${book.author || 'Unknown'} - ${book.title || 'Unknown'}`);
        return [...RECOGNIZED_EXTENSIONS].map((ext) => `${safeTitle}${ext}`);
      })();

  for (const user of candidateUsers) {
    for (const filename of candidateFilenames) {
      if (fs.existsSync(path.join(user.downloadPath, filename))) {
        return { user, filename };
      }
    }
  }

  return null;
}

/**
 * Copies a file found by findExistingCopyForBook into another user's download
 * folder.
 *
 * Guarded against copying a user's file onto itself: `existing.user` is
 * whoever findExistingCopyForBook matched, and on a re-sync of an
 * already-linked, already-downloaded book that can legitimately be the same
 * person as `targetUser` (see rss.ts, which now filters this out before
 * calling findExistingCopyForBook, but this guard stays here too as the
 * single choke point every caller goes through). Without it,
 * fs.copyFileSync(path, path) either silently no-ops or throws EACCES
 * depending on that specific file's permissions -- confirmed on a real NAS
 * for one manually-added file whose ownership didn't match the app's
 * PUID/PGID, which crashed an entire sync cycle (see Bugs fixed #14).
 */
export function copyExistingFileToUser(existing: ExistingCopy, targetUser: UserFolderInfo): void {
  const sourcePath = path.join(existing.user.downloadPath, existing.filename);
  const destPath = path.join(targetUser.downloadPath, existing.filename);

  if (existing.user.id === targetUser.id) {
    logger.debug(
      { user: targetUser.name, filename: existing.filename },
      '[BookCopy] Skipped copy -- target user already has this file'
    );
    return;
  }

  fs.mkdirSync(targetUser.downloadPath, { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
  logger.info(
    { fromUser: existing.user.name, toUser: targetUser.name, filename: existing.filename },
    "[BookCopy] Copied existing file from another user's folder instead of re-downloading"
  );
}
