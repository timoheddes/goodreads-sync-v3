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

  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || '',

  nodeEnv: process.env.NODE_ENV || 'development',
} as const;
