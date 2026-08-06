import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * One row per reader. Each user has their own Goodreads "to-read" shelf
 * and their own download folder on the NAS.
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  goodreadsId: text('goodreads_id').notNull().unique(),
  downloadPath: text('download_path').notNull(),
  email: text('email'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  // Last time the daily digest email was sent to this user. Used to work out
  // what's new since the last digest, and whether to skip sending because
  // there's nothing to report.
  lastDigestSentAt: integer('last_digest_sent_at', { mode: 'timestamp' }),
});

/**
 * status:
 *   pending     - queued, waiting to be searched/downloaded (or retried)
 *   downloaded  - file exists in at least one user's folder
 *   not_found   - not currently available; will keep retrying on backoff
 *                 via next_retry_at rather than being marked permanently failed
 *
 * source: how the *file* was obtained, not how the book entered the DB --
 * a book discovered via Goodreads can still end up with source='manual' if
 * a matching file turns up in the folder scan before Anna's Archive does.
 *   goodreads   - downloaded automatically via Anna's Archive search
 *   manual      - found sitting in a user's folder by the daily folder
 *                 scan (either matched to a pending Goodreads book, or a
 *                 file with no corresponding shelf entry at all)
 */
export const books = sqliteTable('books', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  goodreadsBookId: text('goodreads_book_id').unique(),
  isbn: text('isbn'),
  title: text('title'),
  author: text('author'),
  status: text('status', { enum: ['pending', 'downloaded', 'not_found'] })
    .notNull()
    .default('pending'),
  source: text('source', { enum: ['goodreads', 'manual'] })
    .notNull()
    .default('goodreads'),
  attempts: integer('attempts').notNull().default(0),
  // When to try searching Anna's Archive again. NULL means "eligible now".
  // Set on every failed attempt using exponential backoff -- there is no
  // attempt cap and no permanent failure state.
  nextRetryAt: integer('next_retry_at', { mode: 'timestamp' }),
  lastError: text('last_error'),
  filePath: text('file_path'),
  addedAt: integer('added_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  downloadedAt: integer('downloaded_at', { mode: 'timestamp' }),
});

/**
 * Many-to-many link between users and books: the same book can be on
 * multiple users' shelves, and gets copied into each of their folders.
 */
export const userBooks = sqliteTable(
  'user_books',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id),
    // When this book was last included in a digest email sent to this user.
    // NULL means "not yet reported".
    notifiedAt: integer('notified_at', { mode: 'timestamp' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.bookId] }),
  })
);

/**
 * One row per user, tracking a cheap fingerprint of their Goodreads RSS feed
 * so the sync loop (running every ~10 min) can skip the full parse/diff when
 * nothing has changed since the last check.
 */
export const shelfState = sqliteTable('shelf_state', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  feedHash: text('feed_hash'),
  lastCheckedAt: integer('last_checked_at', { mode: 'timestamp' }),
  lastChangedAt: integer('last_changed_at', { mode: 'timestamp' }),
});

/**
 * Runtime-editable settings (rate limits, digest send time, etc.) that used
 * to be env vars in v2. Stored in the DB so they're editable from the
 * dashboard without a redeploy. Simple key/value with JSON-encoded values.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
