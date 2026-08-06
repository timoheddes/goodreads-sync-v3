import { config } from './config.js';
import { logger } from './logger.js';
import { sendDigestEmail } from './email.js';
import { buildDigestContent } from './digestContent.js';
import {
  countDownloadedBooksForUser,
  getStillSearchingBooksForUser,
  getUnnotifiedDownloadedBooksForUser,
  listUsers,
  markDigestSent,
  markUserBooksNotified,
} from './db/repo.js';

let digestRunning = false;

/**
 * Once a day: for each user with an email on file, works out what's new
 * since the last digest (newly downloaded books) and what's still being
 * searched for (books stuck at status='not_found'), and emails a summary
 * -- but only if there's actually something to report. Guarded against
 * overlapping runs, same pattern as the sync cycle and folder scan.
 */
export async function sendDailyDigests(): Promise<void> {
  if (digestRunning) {
    logger.warn('[Digest] Already running, skipping this trigger');
    return;
  }

  digestRunning = true;
  try {
    if (!config.smtpUser || !config.smtpPass) {
      logger.warn('[Digest] SMTP_USER/SMTP_PASS not configured -- skipping digest run');
      return;
    }

    logger.info('[Digest] Starting daily digest run...');
    let sent = 0;
    let skipped = 0;

    for (const user of listUsers()) {
      if (!user.email) {
        skipped++;
        continue;
      }

      const found = getUnnotifiedDownloadedBooksForUser(user.id);
      const stillSearching = getStillSearchingBooksForUser(user.id);
      const totalBooks = countDownloadedBooksForUser(user.id);
      const content = buildDigestContent(found, stillSearching, totalBooks);

      if (!content) {
        skipped++;
        continue;
      }

      try {
        await sendDigestEmail(user.email, user.name, content);
        markUserBooksNotified(
          user.id,
          found.map((b) => b.id)
        );
        markDigestSent(user.id);
        sent++;
        logger.info(
          { user: user.name, found: found.length, stillSearching: stillSearching.length },
          '[Digest] Sent'
        );
      } catch (err) {
        logger.error({ err, user: user.name }, '[Digest] Failed to send -- will retry next run');
      }
    }

    logger.info({ sent, skipped }, '[Digest] Daily digest run complete');
  } finally {
    digestRunning = false;
  }
}
