import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Read directly from package.json rather than hardcoded/duplicated, so the
 * version shown in the dashboard (src/web/layout.ts) can never drift from
 * what's actually published. Resolved relative to this file's own location
 * (not process.cwd()) so it works the same whether running compiled
 * (dist/config.js -> ../package.json, copied into the runtime image by the
 * Dockerfile) or via tsx in dev (src/config.ts -> ../package.json, the repo
 * root) -- both are exactly one directory below package.json.
 */
const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
const appVersion: string = JSON.parse(readFileSync(packageJsonPath, 'utf-8')).version;

/**
 * All configuration read from the environment, in one place. Everything
 * that genuinely needs to vary per-deployment (paths, keys, timezone)
 * stays an env var; behavioural settings (rate limits, digest time) live
 * in the `settings` DB table instead so they're editable from the
 * dashboard -- see src/db/schema.ts.
 */
export const config = {
  version: appVersion,

  dbPath: process.env.DB_PATH || '/app/data/books.db',
  port: parseInt(process.env.PORT || '3000', 10),
  timezone: process.env.TZ || 'UTC',

  flareSolverrUrl: process.env.FLARE_URL || 'http://localhost:8191/v1',
  annasArchiveApiKey: process.env.AA_API_KEY || '',
  // Used to also try annas-archive.li first. Dropped after a real search
  // ("Red Dragon" by Thomas Harris) failed identically on both domains in
  // the same run -- .li never succeeded where .gl didn't, so it was only
  // ever adding a second FlareSolverr round-trip (each one 15-30s) with no
  // observed upside. Revisit if .gl itself ever becomes the unreliable one.
  annasArchiveDomains: ['annas-archive.gl'],
  // Search was epub-only for a while, which silently excluded books that
  // only have a PDF/mobi/azw3 upload on Anna's Archive -- confirmed via a
  // real book search returning just one candidate, whose only upload
  // turned out not to be fast-downloadable at all. downloadBook/folderScan
  // already understand all of these formats, so there's no reason search
  // shouldn't look for them too.
  annasArchiveExtensions: ['epub', 'pdf', 'mobi', 'azw3'],
  // Raised from 5: search.ts no longer filters by language (see
  // buildSearchParams's comment -- a lang=en filter provably hid an
  // English-tagged match), so a popular title's foreign-language
  // translations can now appear ahead of the real match in Anna's
  // Archive's own ranking. Checking more candidates before giving up
  // costs a few extra isGoodMatch comparisons per search, not extra
  // requests -- cheap insurance against the real match sitting just
  // past the old cutoff.
  maxSearchResultsToCheck: 15,

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
