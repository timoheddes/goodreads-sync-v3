import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { getAllSettings } from './settings.js';
import {
  countDownloadsToday,
  countUserDownloadsToday,
  getNextEligibleBook,
  getUsersForBook,
  incrementAttempt,
  listUsers,
  markDownloaded,
} from './db/repo.js';
import { findBookOnAnna } from './search.js';
import { downloadBook } from './download.js';
import { computeNextRetry } from './backoff.js';
import { sanitizeFilename, sleep } from './utils.js';

export interface QueueSummary {
  processed: number;
  succeeded: number;
  failed: number;
  skippedRateLimit: number;
  /** userId -> books downloaded to them this cycle, for the daily digest (Phase 3). */
  downloadedPerUser: Map<number, { userName: string; books: { title: string | null; author: string | null }[] }>;
}

/**
 * Works through eligible books (pending, or not_found books whose backoff
 * window has elapsed) one at a time: search Anna's Archive, download, copy
 * into every subscribed user's folder. Respects global and per-user daily
 * download caps (from the settings table, editable from the dashboard in
 * Phase 4). Failures never permanently fail a book -- see src/backoff.ts.
 */
export async function processQueue(): Promise<QueueSummary> {
  const settings = getAllSettings();
  const summary: QueueSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skippedRateLimit: 0,
    downloadedPerUser: new Map(),
  };

  const todayCount = countDownloadsToday();
  logger.info(
    { todayCount, maxDownloadsPerDay: settings.maxDownloadsPerDay },
    '[Queue] Starting queue pass'
  );

  if (todayCount >= settings.maxDownloadsPerDay) {
    logger.info('[Queue] Daily download limit reached, skipping until tomorrow');
    return summary;
  }

  const rateLimitedUserIds = new Set<number>();
  for (const user of listUsers()) {
    const userCount = countUserDownloadsToday(user.id);
    if (userCount >= settings.maxDownloadsPerUserPerDay) {
      rateLimitedUserIds.add(user.id);
      logger.info({ user: user.name, userCount }, '[Queue] User at daily limit, skipping their books');
    }
  }

  const skippedBookIds: number[] = [];

  while (true) {
    if (countDownloadsToday() >= settings.maxDownloadsPerDay) {
      logger.info('[Queue] Daily download limit reached, stopping');
      break;
    }

    const job = getNextEligibleBook(skippedBookIds);
    if (!job) break;

    const linkedUsers = getUsersForBook(job.id);
    const eligibleUsers = linkedUsers.filter((u) => !rateLimitedUserIds.has(u.id));

    if (eligibleUsers.length === 0) {
      skippedBookIds.push(job.id);
      summary.skippedRateLimit++;
      continue;
    }

    const cleanTitle = (job.title || '').replace(/\(.*?\)/g, '').trim();
    const searchTerm = [cleanTitle, job.author].filter(Boolean).join(' ').trim();
    logger.info(
      { title: job.title, author: job.author, attempt: job.attempts + 1, bookId: job.id },
      '[Queue] Processing book'
    );

    try {
      if (!searchTerm) throw new Error('No title or author available to search');

      const matches = await findBookOnAnna(searchTerm, job.title, job.author);
      if (matches.length === 0) throw new Error("Book not found on Anna's Archive");

      const { filePath: tempPath, extension } = await downloadBook(matches, job);

      const safeTitle = sanitizeFilename(`${job.author || 'Unknown'} - ${job.title || 'Unknown'}`);
      const filename = `${safeTitle}${extension}`;

      for (const user of eligibleUsers) {
        fs.mkdirSync(user.downloadPath, { recursive: true });
        fs.copyFileSync(tempPath, path.join(user.downloadPath, filename));
        logger.info({ user: user.name, filename }, '[Queue] Saved to user folder');
      }

      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupErr) {
        logger.warn({ cleanupErr, tempPath }, '[Queue] Could not delete temp file');
      }

      markDownloaded(job.id, filename);
      summary.succeeded++;

      for (const user of eligibleUsers) {
        if (!summary.downloadedPerUser.has(user.id)) {
          summary.downloadedPerUser.set(user.id, { userName: user.name, books: [] });
        }
        summary.downloadedPerUser.get(user.id)!.books.push({ title: job.title, author: job.author });

        if (!rateLimitedUserIds.has(user.id)) {
          const newCount = countUserDownloadsToday(user.id);
          if (newCount >= settings.maxDownloadsPerUserPerDay) {
            rateLimitedUserIds.add(user.id);
            logger.info({ user: user.name, newCount }, '[Queue] User just reached daily limit');
          }
        }
      }

      logger.info({ title: job.title, author: job.author }, '[Queue] SUCCESS');
    } catch (err) {
      const attempts = job.attempts + 1;
      const nextRetryAt = computeNextRetry(attempts);
      const message = err instanceof Error ? err.message : String(err);
      incrementAttempt(job.id, nextRetryAt, message);
      logger.warn(
        { title: job.title, author: job.author, attempts, nextRetryAt, error: message },
        '[Queue] FAILED -- will retry later, never permanently'
      );
      summary.failed++;
    }

    summary.processed++;
    await sleep(settings.queueCooldownMs);
  }

  logger.info(
    { succeeded: summary.succeeded, failed: summary.failed, skippedRateLimit: summary.skippedRateLimit },
    '[Queue] Pass complete'
  );

  return summary;
}
