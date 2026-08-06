/**
 * All configuration read from the environment, in one place. Everything
 * that genuinely needs to vary per-deployment (paths, keys, timezone)
 * stays an env var; behavioural settings (rate limits, digest time) live
 * in the `settings` DB table instead so they're editable from the
 * dashboard -- see src/db/schema.ts.
 */
export const config = {
  dbPath: process.env.DB_PATH || '/app/data/books.db',
  port: parseInt(process.env.PORT || '3000', 10),
  timezone: process.env.TZ || 'UTC',

  flareSolverrUrl: process.env.FLARE_URL || 'http://localhost:8191/v1',
  annasArchiveApiKey: process.env.AA_API_KEY || '',
  annasArchiveDomains: ['annas-archive.li', 'annas-archive.gl'],
  maxSearchResultsToCheck: 5,

  // Cron expression for the sync cycle (RSS check + queue processing).
  // Every 10 minutes by default -- cheap because of the feed-hash
  // short-circuit in src/rss.ts, so this can run far more often than v2's
  // hourly default without hammering Goodreads or Anna's Archive.
  syncCronSchedule: process.env.SYNC_CRON || '*/10 * * * *',

  // Cron expression for the folder scan (Phase 2) -- once a day by default.
  // This walks each user's download folder, which is more I/O than the sync
  // cycle, so it doesn't need to run anywhere near as often.
  folderScanCronSchedule: process.env.FOLDER_SCAN_CRON || '0 3 * * *',

  // Cron expression for the daily digest email (Phase 3) -- once a day by
  // default, independent of the sync cycle and folder scan. Only actually
  // sends if a given user has something new to report, see src/digest.ts.
  digestCronSchedule: process.env.DIGEST_CRON || '0 8 * * *',

  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || '',

  nodeEnv: process.env.NODE_ENV || 'development',
} as const;
